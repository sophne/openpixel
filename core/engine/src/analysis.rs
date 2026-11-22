//! Checks an agent (or person) can use to review a model before refining it (port of Analysis.swift).
use std::collections::BTreeSet;

use serde_json::json;

use crate::craft;
use crate::model::Document;
use crate::observe::Findings;
use crate::style::StyleLock;
use crate::{num, Json, JsonMap};

pub fn analyze(doc: &Document, frame: usize, style: Option<&StyleLock>) -> JsonMap {
    full(doc, frame, style).0
}

/// The report plus its findings (coded and scored), which the automatic critique compares between edits,
/// and the total score.
pub fn full(doc: &Document, frame: usize, style: Option<&StyleLock>) -> (JsonMap, Findings, i64) {
    let g = doc.composite(frame);
    let (sx, sy, sz) = (doc.sx(), doc.sy(), doc.sz());
    let mut count: i64 = 0;
    let (mut lo, mut hi) = ((i64::MAX, i64::MAX, i64::MAX), (-1i64, -1i64, -1i64));
    let mut per_color = [0i64; 256];
    for y in 0..sy {
        for z in 0..sz {
            for x in 0..sx {
                let v = g[doc.index(x, y, z)];
                if v == 0 {
                    continue;
                }
                count += 1;
                per_color[v as usize] += 1;
                lo = (lo.0.min(x), lo.1.min(y), lo.2.min(z));
                hi = (hi.0.max(x), hi.1.max(y), hi.2.max(z));
            }
        }
    }
    let mut f = Findings::new();
    let mut result = JsonMap::new();
    result.insert("size".into(), json!([sx, sy, sz]));
    result.insert("frame".into(), json!(frame));
    result.insert("voxels".into(), json!(count));
    if count == 0 {
        f.issue("empty", "shape", 100, 1, "The model is empty.");
        result.insert("issues".into(), json!(f.issues()));
        result.insert("tips".into(), json!(Vec::<String>::new()));
        result.insert("score".into(), Json::Object(f.score(&["shape"])));
        return (result, f, 0);
    }
    result.insert(
        "bounds".into(),
        json!({"min": [lo.0, lo.1, lo.2], "max": [hi.0, hi.1, hi.2], "size": [hi.0 - lo.0 + 1, hi.1 - lo.1 + 1, hi.2 - lo.2 + 1]}),
    );
    // Most used first. (Swift left colours with equal counts in no particular order; here the lower index
    // comes first.)
    let mut used: Vec<(usize, i64)> = per_color.iter().copied().enumerate().filter(|(_, n)| *n > 0).collect();
    used.sort_by(|a, b| b.1.cmp(&a.1));
    result.insert(
        "colors".into(),
        json!(used.iter().map(|(i, n)| json!({"index": i, "hex": doc.color(*i as u8).hex(), "voxels": n})).collect::<Vec<_>>()),
    );
    let unused: Vec<usize> = (1..doc.palette.len()).filter(|&i| i >= 256 || per_color[i] == 0).collect();
    result.insert("unused_palette_indexes".into(), json!(unused));

    // Connected parts (6-neighbour). Parts not touching the ground and smaller than the largest are "floating".
    struct Part {
        size: i64,
        grounded: bool,
        sample: (i64, i64, i64),
    }
    let mut label = vec![-1i32; doc.count()];
    let mut parts: Vec<Part> = Vec::new();
    for y in 0..sy {
        for z in 0..sz {
            for x in 0..sx {
                let i = doc.index(x, y, z);
                if g[i] == 0 || label[i] >= 0 {
                    continue;
                }
                let id = parts.len() as i32;
                let mut stack = vec![(x, y, z)];
                label[i] = id;
                let (mut size, mut grounded) = (0i64, false);
                while let Some((cx, cy, cz)) = stack.pop() {
                    size += 1;
                    if cy == lo.1 {
                        grounded = true;
                    }
                    for (nx, ny, nz) in [(cx + 1, cy, cz), (cx - 1, cy, cz), (cx, cy + 1, cz), (cx, cy - 1, cz), (cx, cy, cz + 1), (cx, cy, cz - 1)] {
                        if !doc.in_bounds(nx, ny, nz) {
                            continue;
                        }
                        let j = doc.index(nx, ny, nz);
                        if g[j] != 0 && label[j] < 0 {
                            label[j] = id;
                            stack.push((nx, ny, nz));
                        }
                    }
                }
                parts.push(Part { size, grounded, sample: (x, y, z) });
            }
        }
    }
    let largest = parts.iter().map(|p| p.size).max().unwrap_or(0);
    let flat = sz == 1;
    // A picture that fills (nearly) the whole canvas is a background or scene, not a sprite on empty canvas:
    // margins, outlines and a single light direction don't apply to it.
    let full_frame = flat && count * 10 >= sx * sy * 9;
    result.insert(
        "kind".into(),
        json!(if flat { if full_frame { "full-frame background or scene" } else { "sprite" } } else { "3d model" }),
    );
    let floating: Vec<&Part> = if flat { Vec::new() } else { parts.iter().filter(|p| !p.grounded && p.size < largest).collect() };
    let part_count = parts.len() as i64;
    result.insert("parts".into(), json!(part_count));
    if flat && part_count > 1 && !full_frame {
        f.issue(
            "separate_shapes",
            "shape",
            (3 * (part_count - 1)).min(12),
            part_count,
            format!("{part_count} separate shapes; small ones may be stray pixels (see find_voxels)."),
        );
    }
    if !floating.is_empty() {
        // Tiny loose bits are almost always stray voxels; bigger separate pieces (clouds, a floating island's
        // rocks, a hovering prop) are often meant to float, so they only get a tip.
        let tiny = (count / 2000).min(8).max(3); // a few voxels: a stray click or a broken-off bit
        let strays = floating.iter().filter(|p| p.size <= tiny).count() as i64;
        let pieces = floating.iter().filter(|p| p.size > tiny).count() as i64;
        result.insert(
            "floating_parts".into(),
            json!(floating
                .iter()
                .take(20)
                .map(|p| json!({"voxels": p.size, "at": [p.sample.0, p.sample.1, p.sample.2]}))
                .collect::<Vec<_>>()),
        );
        if strays > 0 {
            f.issue(
                "floating_strays",
                "cleanup",
                (5 * strays).min(15),
                strays,
                format!("{strays} tiny loose piece(s) of {tiny} voxels or fewer float apart from everything else: probably strays (see floating_parts)."),
            );
        }
        if pieces > 0 {
            f.tip(
                "floating_pieces",
                "shape",
                0,
                1,
                format!("{pieces} larger piece(s) are separate from the main body. Fine for clouds or a floating scene; otherwise connect them."),
            );
        }
    }

    // Left/right symmetry around the occupied bounds' centre.
    let (mut same, mut total) = (0i64, 0i64);
    for y in lo.1..=hi.1 {
        for z in lo.2..=hi.2 {
            for x in lo.0..=hi.0 {
                let v = g[doc.index(x, y, z)];
                if v == 0 {
                    continue;
                }
                total += 1;
                let mx = lo.0 + hi.0 - x;
                if doc.in_bounds(mx, y, z) && g[doc.index(mx, y, z)] == v {
                    same += 1;
                }
            }
        }
    }
    let sym = if total == 0 { 1.0 } else { same as f64 / total as f64 };
    result.insert("symmetry_x".into(), num((sym * 1000.0).round() / 1000.0));
    if sym > 0.9 && sym < 0.999 && !full_frame {
        f.tip(
            "near_symmetric",
            "shape",
            2,
            1,
            format!(
                "Almost symmetric left/right ({}%): if it should be symmetric, transform op=mirror makes it exact.",
                (sym * 100.0) as i64
            ),
        );
    }

    if flat {
        if !full_frame && (lo.0 == 0 || lo.1 == 0 || hi.0 == sx - 1 || hi.1 == sy - 1) {
            f.issue("touches_edge", "shape", 6, 1, "The sprite touches the canvas edge; leave a 1-pixel margin for outlines.");
        }
    } else {
        if lo.0 == 0 || lo.2 == 0 || hi.0 == sx - 1 || hi.1 == sy - 1 || hi.2 == sz - 1 {
            f.issue("touches_edge", "shape", 6, 1, "The model touches the edge of the model space; resize_model gives it room.");
        }
        if lo.1 > 0 {
            f.tip(
                "off_ground",
                "shape",
                3,
                1,
                format!(
                    "The lowest voxel is at y={}; if the model should stand on the ground, move it down (transform op=move dy=-{}).",
                    lo.1, lo.1
                ),
            );
        }
    }
    if used.len() == 1 && count > 8 {
        f.issue("one_colour", "color", 15, 1, "Only one colour is used; shading with 2-4 tones of a ramp reads better as pixel art.");
    }
    // Surface share: lone voxels with no neighbours are often stray clicks.
    let mut lonely = 0i64;
    for y in lo.1..=hi.1 {
        for z in lo.2..=hi.2 {
            for x in lo.0..=hi.0 {
                if g[doc.index(x, y, z)] == 0 {
                    continue;
                }
                let mut n = 0;
                for (nx, ny, nz) in [(x + 1, y, z), (x - 1, y, z), (x, y + 1, z), (x, y - 1, z), (x, y, z + 1), (x, y, z - 1)] {
                    if doc.in_bounds(nx, ny, nz) && g[doc.index(nx, ny, nz)] != 0 {
                        n += 1;
                    }
                }
                if n == 0 {
                    lonely += 1;
                }
            }
        }
    }
    if lonely > 0 {
        f.issue(
            "lonely",
            "cleanup",
            (2 + 2 * lonely).min(12),
            lonely,
            format!("{} single {}(s) with no neighbours (possible strays).", lonely, if flat { "pixel" } else { "voxel" }),
        );
    }
    let (mut light, mut outline_share): (Option<String>, Option<f64>) = (None, None);
    if flat {
        craft::sprite_checks(doc, frame, full_frame, style, &mut result, &mut f);
        let art = result.get("pixel_art").and_then(Json::as_object);
        light = art
            .and_then(|a| a.get("light"))
            .and_then(Json::as_object)
            .and_then(|l| l.get("brightest_toward"))
            .and_then(Json::as_str)
            .map(String::from);
        outline_share = art.and_then(|a| a.get("outline_dark_share")).and_then(Json::as_f64);
    }
    let anim = craft::animation_checks(doc, full_frame, &mut f);
    if !anim.is_empty() {
        result.insert("animation".into(), Json::Object(anim));
    }
    if let Some(style) = style {
        let used_indexes: BTreeSet<i64> = used.iter().map(|(i, _)| *i as i64).collect();
        style.check(doc, &used_indexes, light.as_deref(), outline_share, &mut f);
        result.insert("style".into(), json!(style.name));
    }
    let mut categories = vec!["shape", "cleanup", "color"];
    if flat {
        categories.push("shading");
    }
    if doc.frames.len() > 1 {
        categories.push("animation");
    }
    if style.is_some() {
        categories.push("style");
    }
    result.insert("issues".into(), json!(f.issues()));
    result.insert("tips".into(), json!(f.tips()));
    let score = f.score(&categories);
    let total = score.get("total").and_then(Json::as_i64).unwrap_or(0);
    result.insert("score".into(), Json::Object(score));
    (result, f, total)
}

/// Differences between two grids of the same size.
pub fn diff(a: &[u8], b: &[u8], doc: &Document, limit: usize) -> JsonMap {
    let mut out = JsonMap::new();
    if a.len() != b.len() {
        out.insert("error".into(), json!("sizes differ"));
        return out;
    }
    let (mut added, mut removed, mut recolored) = (0i64, 0i64, 0i64);
    let mut samples: Vec<Json> = Vec::new();
    for y in 0..doc.sy() {
        for z in 0..doc.sz() {
            for x in 0..doc.sx() {
                let i = doc.index(x, y, z);
                let (o, n) = (a[i], b[i]);
                if o == n {
                    continue;
                }
                let kind = if o == 0 {
                    added += 1;
                    "added"
                } else if n == 0 {
                    removed += 1;
                    "removed"
                } else {
                    recolored += 1;
                    "recolored"
                };
                if samples.len() < limit {
                    samples.push(json!({"at": [x, y, z], "change": kind, "from": o, "to": n}));
                }
            }
        }
    }
    out.insert("added".into(), json!(added));
    out.insert("removed".into(), json!(removed));
    out.insert("recolored".into(), json!(recolored));
    out.insert("samples".into(), json!(samples));
    out
}
