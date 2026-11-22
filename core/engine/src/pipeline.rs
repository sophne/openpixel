//! Tools for production pipelines (port of Pipeline.swift): automatic critique after edits, text views, the
//! style lock, batches of calls and reviewing a set of files together.
use std::collections::BTreeSet;

use serde_json::json;

use crate::analysis;
use crate::args::{trunc, Args};
use crate::engine::Engine;
use crate::formats::{image_files, pretty_sorted_json};
use crate::io::{self, paths};
use crate::model::{Document, Grid, Rgba};
use crate::observe::{text_view, Critique, Findings};
use crate::render::{self, Picture, RenderOptions};
use crate::style::StyleLock;
use crate::tools;
use crate::{num, obj, Json, JsonMap, PcError, ToolOutput};

impl Engine {
    // MARK: - automatic critique

    /// After an agent edit, the score and what the edit introduced, made worse or resolved.
    pub(crate) fn critique(&mut self, name: &str, out: &mut ToolOutput) {
        let Some(spec) = tools::spec(name) else { return };
        if !(self.auto_critique && self.batch_depth == 0 && !spec.read_only && Some(self.revision) != self.critique_revision) {
            return;
        }
        if self.doc.count() > Engine::CRITIQUE_CELL_LIMIT {
            if self.critiques == 0 {
                out.json.insert(
                    "critique".into(),
                    json!({"skipped": "model too large for the automatic critique; analyze_model still works"}),
                );
            }
            self.critiques += 1;
            self.critique_revision = Some(self.revision);
            return;
        }
        let (_, findings, total) = analysis::full(&self.doc, self.active_frame, self.style.as_ref());
        // Nothing drawn yet (e.g. a palette change on a new canvas): nothing to critique.
        if findings.list.iter().any(|f| f.code == "empty") {
            self.critique_revision = Some(self.revision);
            return;
        }
        let now = Critique::new(total, &findings);
        let mut c = now.compared(self.last_critique.as_ref());
        if self.critiques == 0 {
            c.insert(
                "about".into(),
                json!("Automatic after each edit: the score (0-100) from the checks and what this edit changed. review_model shows the pictures; set_feedback auto_critique=false turns this off."),
            );
        }
        out.json.insert("critique".into(), Json::Object(c));
        self.last_critique = Some(now);
        self.critique_revision = Some(self.revision);
        self.critiques += 1;
    }

    // MARK: - style lock

    pub(crate) fn refuse_off_palette(&self, before: &[Rgba], after: &[Rgba], s: &StyleLock) -> Result<(), PcError> {
        // Locked colours may come back (after an undo, or into a canvas opened with another palette); others may not.
        let fresh = after.iter().enumerate().skip(1).filter(|(i, c)| *i >= before.len() || before[*i] != **c).map(|(_, c)| c);
        let Some(c) = fresh.into_iter().find(|c| !s.contains(c)) else { return Ok(()) };
        Err(PcError::invalid(format!(
            "the \"{}\" style locks the palette and {} is not in it. Closest locked colours: {}. Use those indexes (get_palette lists them), or set_style lock_palette=false to unlock.",
            s.name,
            c.hex(),
            s.nearest(c, 3).join(", ")
        )))
    }

    pub(crate) fn set_style(&mut self, a: &Args) -> Result<ToolOutput, PcError> {
        if a.bool("clear", false) {
            self.style = None;
            return Ok(ToolOutput::new(obj(json!({"style": null, "cleared": true}))));
        }
        let mut base = self.style.clone().unwrap_or_default();
        if let Some(p) = a.string("path") {
            let u = self.file_path(p);
            let data = io::read_file(self.io.as_ref(), &u)?;
            let parsed: Option<Json> = serde_json::from_slice(data.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&data)).ok();
            let Some(Json::Object(o)) = parsed else {
                return Err(PcError::invalid(format!("{u} is not a style file (a JSON object)")));
            };
            base = StyleLock::from(&o, StyleLock::default())?;
        }
        let mut s = StyleLock::from(a.d, base)?;
        // Locking without naming colours locks the palette the canvas has now.
        if s.lock_palette && s.palette.is_none() {
            s.palette = Some(self.doc.palette.clone());
        }
        let mut res = JsonMap::new();
        // Bring the open canvas into the style: the locked palette, with drawn colours moved to the closest
        // locked colour (exact matches keep their colour). One undo step.
        if let Some(pal) = s.palette.clone() {
            let differs = self.doc.palette.len() != pal.len() || self.doc.palette.iter().zip(&pal).any(|(x, y)| !StyleLock::same_rgb(x, y));
            if differs {
                let mut moved = 0usize;
                self.palette_lock_bypass = true;
                let edited = self.edit(&format!("Apply style {}", s.name), |_, d| {
                    let mut map = [0u8; 256];
                    for i in 1..d.palette.len().min(256) {
                        map[i] = Engine::nearest(d.palette[i], &pal);
                    }
                    let locked = |i: u8| pal.get(i as usize).copied().unwrap_or(Rgba::rgb(0, 0, 0));
                    let mut used_changed: BTreeSet<usize> = BTreeSet::new();
                    for l in 0..d.cels.len() {
                        for f in 0..d.cels[l].len() {
                            if d.cels[l][f].is_empty() {
                                continue;
                            }
                            let mut g = d.cels[l][f].data().to_vec();
                            for cell in g.iter_mut() {
                                if *cell == 0 {
                                    continue;
                                }
                                let v = *cell as usize;
                                if v < d.palette.len() && !StyleLock::same_rgb(&locked(map[v]), &d.palette[v]) {
                                    used_changed.insert(v);
                                }
                                *cell = if v < d.palette.len() { map[v] } else { 0 };
                            }
                            d.cels[l][f] = Grid::from_data(g);
                        }
                    }
                    d.palette = pal.clone();
                    moved = used_changed.len();
                    Ok(JsonMap::new())
                });
                self.palette_lock_bypass = false;
                let edited = edited?;
                res.insert(
                    "applied_to_canvas".into(),
                    json!({
                        "palette_colors": pal.len() as i64 - 1, "drawn_colours_moved_to_closest": moved,
                        "revision": edited.json.get("revision").cloned().unwrap_or(json!(self.revision)),
                    }),
                );
            }
        }
        self.style = Some(s.clone());
        if let Some(p) = a.string("save_path") {
            let mut u = self.file_path(p);
            if paths::extension(&u).is_empty() {
                u = paths::append_extension(&u, "json");
            }
            io::create_parent(self.io.as_ref(), &u)?;
            io::write_file(self.io.as_ref(), &u, pretty_sorted_json(&Json::Object(s.json())).as_bytes())?;
            res.insert("saved".into(), json!(u));
        }
        res.insert("style".into(), Json::Object(s.json()));
        let locked = match &s.palette {
            Some(p) if s.lock_palette => {
                format!("agent edits can only use the {} locked colours (hex colours must match one; palette tools are refused)", p.len() as i64 - 1)
            }
            _ => "palette not locked".to_string(),
        };
        let size = s.size.as_ref().map(|v| format!(" and size {}", v.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("×"))).unwrap_or_default();
        res.insert(
            "effect".into(),
            json!([
                locked,
                format!("new_sprite/new_model start with this palette{size}"),
                "analyze_model, review_model, review_set and the automatic critique check the style (category \"style\")",
            ]),
        );
        Ok(ToolOutput::new(res))
    }

    // MARK: - text views

    pub(crate) fn view_as_text(&self, a: &Args) -> Result<ToolOutput, PcError> {
        let f = self.frame_index(a)?;
        let view = a.string("view").unwrap_or("front");
        if !text_view::VIEWS.contains(&view) {
            return Err(PcError::invalid(format!("view must be one of {}", text_view::VIEWS.join(", "))));
        }
        // The list counts only when every entry is text (as the Swift cast did).
        let mut maps: Vec<String> = a
            .array("maps")
            .and_then(|l| l.iter().map(|v| v.as_str().map(String::from)).collect::<Option<Vec<_>>>())
            .unwrap_or_else(|| vec!["pixels".into(), "values".into(), "silhouette".into()]);
        if let Some(bad) = maps.iter().find(|m| !text_view::MAPS.contains(&m.as_str())) {
            return Err(PcError::invalid(format!("unknown map {}; use {}", bad, text_view::MAPS.join(", "))));
        }
        let mut compare: Option<usize> = None;
        if a.has("compare_frame") {
            compare = Some(self.frame_index_key(a, "compare_frame")?);
            if !maps.iter().any(|m| m == "diff") {
                maps.push("diff".into());
            }
        } else if maps.iter().any(|m| m == "diff") {
            let count = self.doc.frames.len();
            if count <= 1 {
                return Err(PcError::invalid("diff needs two frames; add_frame first or give compare_frame"));
            }
            compare = Some((f + count - 1) % count);
        }
        let region: Vec<i64> = a.array("region").map(|l| l.iter().filter_map(|v| Args::number(Some(v))).map(trunc).collect()).unwrap_or_default();
        if a.has("region") && region.len() != 4 {
            return Err(PcError::invalid("region is [col0, row0, col1, row1] in the view's coordinates"));
        }
        let region = if region.is_empty() { None } else { Some(region.as_slice()) };
        Ok(ToolOutput::new(text_view::render(&self.doc, f, view, &maps, compare, region)))
    }

    // MARK: - batch

    pub const BATCH_LIMIT: usize = 200;

    pub(crate) fn batch(&mut self, a: &Args) -> Result<ToolOutput, PcError> {
        if self.batch_depth != 0 {
            return Err(PcError::invalid("batch cannot contain another batch"));
        }
        let Some(calls) = a.array("calls").filter(|c| !c.is_empty()) else {
            return Err(PcError::invalid("calls must be a list of {\"tool\": name, \"args\": {...}}"));
        };
        if calls.len() > Engine::BATCH_LIMIT {
            return Err(PcError::invalid(format!("at most {} calls per batch", Engine::BATCH_LIMIT)));
        }
        // Check every call before running any, so a typo doesn't leave half a batch done.
        let empty = JsonMap::new();
        let mut plan: Vec<(&str, &JsonMap)> = Vec::new();
        for (i, c) in calls.iter().enumerate() {
            let Some(tool) = c.as_object().and_then(|o| o.get("tool")).and_then(Json::as_str) else {
                return Err(PcError::invalid(format!("call {i} needs a \"tool\" name")));
            };
            if !tools::spec(tool).is_some_and(|s| !s.hidden) || tool == "batch" {
                return Err(PcError::invalid(format!("call {i}: unknown tool {tool}")));
            }
            plan.push((tool, c.get("args").and_then(Json::as_object).unwrap_or(&empty)));
        }
        let (stop, atomic) = (a.bool("stop_on_error", true), a.bool("atomic", false));
        let saved = (
            self.doc.clone(),
            self.undo_stack.clone(),
            self.redo_stack.clone(),
            self.active_layer,
            self.active_frame,
            self.dirty,
            self.path.clone(),
        );
        let mut results: Vec<Json> = Vec::new();
        let mut images: Vec<Vec<u8>> = Vec::new();
        let mut failed = 0;
        self.batch_depth += 1;
        let source = self.source.clone();
        for (i, (tool, args)) in plan.iter().enumerate() {
            match self.execute(tool, args, &source) {
                Ok(out) => {
                    let mut r = obj(json!({"call": i, "tool": tool, "ok": true}));
                    let mut json = out.json;
                    json.remove("conventions");
                    if !json.is_empty() {
                        r.insert("result".into(), Json::Object(json));
                    }
                    results.push(Json::Object(r));
                    images.extend(out.images);
                }
                Err(e) => {
                    failed += 1;
                    results.push(json!({"call": i, "tool": tool, "ok": false, "error": e.0}));
                    if stop || atomic {
                        break;
                    }
                }
            }
        }
        self.batch_depth -= 1;
        let mut res = obj(json!({"calls": plan.len(), "ran": results.len(), "failed": failed, "results": results}));
        if failed > 0 && atomic {
            (self.doc, self.undo_stack, self.redo_stack, self.active_layer, self.active_frame, self.dirty, self.path) = saved;
            self.revision += 1;
            self.changed("batch");
            res.insert("rolled_back".into(), json!(true));
        }
        res.insert("revision".into(), json!(self.revision));
        Ok(ToolOutput::with_images(res, images))
    }

    // MARK: - reviewing a set

    pub const SET_LIMIT: usize = 24;

    pub(crate) fn review_set(&self, a: &Args) -> Result<ToolOutput, PcError> {
        let paths: Vec<&str> = a.array("paths").map(|l| l.iter().filter_map(Json::as_str).collect()).unwrap_or_default();
        if paths.is_empty() {
            return Err(PcError::invalid("paths: the .openpixel or .vox files of the set"));
        }
        if paths.len() > Engine::SET_LIMIT {
            return Err(PcError::invalid(format!("at most {} files", Engine::SET_LIMIT)));
        }
        let mut docs: Vec<(String, Document)> = Vec::new();
        for p in paths {
            docs.push(self.read_document(p)?);
        }
        let frame_arg = a.int_or("frame", 0);
        let mut items: Vec<JsonMap> = Vec::new();
        let mut pics: Vec<Picture> = Vec::new();
        // Which files are lit from which side, each colour's files, and the outline shares, in file order.
        let mut lights: Vec<(String, Vec<usize>)> = Vec::new();
        let mut usage: Vec<(Rgba, BTreeSet<usize>)> = Vec::new();
        let mut outlines: Vec<f64> = Vec::new();
        let mut scores: Vec<i64> = Vec::new();
        let tallest = docs.iter().map(|(_, d)| d.sy().max(if d.sz() == 1 { 0 } else { d.sz() })).max().unwrap_or(32);
        for (k, (p, d)) in docs.iter().enumerate() {
            let f = frame_arg.max(0).min(d.frames.len() as i64 - 1) as usize;
            let (json, _, total) = analysis::full(d, f, self.style.as_ref());
            let issues: Vec<&str> = json.get("issues").and_then(Json::as_array).map(|l| l.iter().filter_map(Json::as_str).collect()).unwrap_or_default();
            let mut item = obj(json!({"file": p, "size": [d.sx(), d.sy(), d.sz()], "score": total, "issues": issues.len()}));
            scores.push(total);
            if !issues.is_empty() {
                item.insert("top_issues".into(), json!(issues.iter().take(3).collect::<Vec<_>>()));
            }
            let art = json.get("pixel_art").and_then(Json::as_object);
            if let Some(l) = art.and_then(|a| a.get("light")).and_then(Json::as_object).and_then(|l| l.get("brightest_toward")).and_then(Json::as_str) {
                item.insert("light".into(), json!(l));
                if l != "no clear side" {
                    match lights.iter_mut().find(|(side, _)| side == l) {
                        Some(entry) => entry.1.push(k),
                        None => lights.push((l.to_string(), vec![k])),
                    }
                }
            }
            if let Some(o) = art.and_then(|a| a.get("outline_dark_share")).and_then(Json::as_f64) {
                outlines.push(o);
                item.insert("outline_dark_share".into(), num(o));
            }
            let g = d.composite(f);
            let used: BTreeSet<u8> = g.iter().copied().filter(|&v| v != 0).collect();
            item.insert("colors_used".into(), json!(used.len()));
            for &v in &used {
                let c = d.color(v);
                let c = Rgba::rgb(c.r, c.g, c.b);
                match usage.iter_mut().find(|(colour, _)| *colour == c) {
                    Some(entry) => {
                        entry.1.insert(k);
                    }
                    None => usage.push((c, BTreeSet::from([k]))),
                }
            }
            items.push(item);
            let mut o = RenderOptions::default();
            if d.sz() == 1 {
                (o.yaw, o.pitch) = (0.0, 0.0);
                o.padding = 0;
                o.show_bounds = true;
                o.flat = true;
                o.outline = false;
                o.edges = false;
            } else {
                (o.yaw, o.pitch) = (45.0, 30.0);
            }
            o.scale = a.int("scale").unwrap_or((96 / tallest.max(1)).clamp(1, 8));
            o.background = Rgba::rgb(44, 44, 48);
            pics.push(render::render(d, f, &o)?);
        }
        // Set-level consistency.
        let mut f = Findings::new();
        let sizes: BTreeSet<String> = docs
            .iter()
            .map(|(_, d)| format!("{}×{}", d.sx(), d.sy()) + &(if d.sz() == 1 { String::new() } else { format!("×{}", d.sz()) }))
            .collect();
        if sizes.len() > 1 {
            f.tip(
                "set_sizes",
                "shape",
                3,
                1,
                format!(
                    "The files have different sizes ({}); a set usually shares one canvas size.",
                    sizes.iter().cloned().collect::<Vec<_>>().join(", ")
                ),
            );
        }
        if lights.len() > 1 {
            // The side most files share first. (Swift left sides with equally many files in no particular
            // order; here the one seen first comes first.)
            let mut by_count = lights.clone();
            by_count.sort_by_key(|side| std::cmp::Reverse(side.1.len()));
            let desc: Vec<String> = by_count
                .iter()
                .map(|(side, files)| format!("{}: files {}", side, files.iter().map(|k| k.to_string()).collect::<Vec<_>>().join(",")))
                .collect();
            f.issue(
                "set_light",
                "shading",
                10,
                1,
                format!("The light comes from different sides across the set ({}). Use one light direction for every file.", desc.join("; ")),
            );
        }
        if docs.len() >= 3 {
            let lone: Vec<usize> = usage.iter().filter(|(_, files)| files.len() == 1).filter_map(|(_, files)| files.first().copied()).collect();
            if lone.len() > (usage.len() / 4).max(2) {
                let files: BTreeSet<usize> = lone.iter().copied().collect();
                let mut by_file: Vec<String> = files.iter().map(|k| format!("file {}: {}", k, lone.iter().filter(|&&x| x == *k).count())).collect();
                by_file.sort();
                f.tip(
                    "set_palette_drift",
                    "color",
                    6,
                    1,
                    format!(
                        "{} of {} colours appear in only one file ({}): the set's palettes drift apart. set_style locks one palette for all of them.",
                        lone.len(),
                        usage.len(),
                        by_file.join(", ")
                    ),
                );
            }
        }
        let lo = outlines.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = outlines.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if !outlines.is_empty() && hi - lo > 0.4 {
            f.tip(
                "set_outline",
                "shape",
                4,
                1,
                format!(
                    "Outline darkness varies a lot between files ({}%-{}% of the edge dark); outline the whole set the same way.",
                    (lo * 100.0) as i64,
                    (hi * 100.0) as i64
                ),
            );
        }
        let mut weakest = 0usize;
        for (i, s) in scores.iter().enumerate() {
            if *s < scores[weakest] {
                weakest = i;
            }
        }
        let per_row = (pics.len() as i64).min(6);
        let (sheet, _) = render::sheet(&pics, per_row, 6, Rgba::rgb(70, 70, 76))?;
        let average = if scores.is_empty() { 0 } else { scores.iter().sum::<i64>() / scores.len() as i64 };
        let res = obj(json!({
            "files": items,
            "set": {
                "issues": f.issues(), "tips": f.tips(), "score": f.total(&["shape", "color", "shading"]),
                "average_file_score": average, "weakest_file": weakest,
                "distinct_colors": usage.len(), "colors_in_two_or_more_files": usage.iter().filter(|(_, files)| files.len() >= 2).count(),
            },
            "picture_layout": format!("The files in the order given, left to right then down ({per_row} per row), at the same scale."),
        }));
        Ok(ToolOutput::with_images(res, vec![image_files::png(&sheet)]))
    }
}
