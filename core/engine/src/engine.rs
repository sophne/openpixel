//! The engine: the document, its undo history and every tool.
use std::collections::{BTreeSet, HashMap};

use base64::Engine as _;
use serde_json::json;

use crate::analysis;
use crate::args::{trunc, Args};
use crate::craft;
use crate::formats::{image_files, native_file, obj_file, vox_file, web_files};
use crate::io::{self, paths, BoxedIo, HostIo};
use crate::model::{Document, Grid, Rgba};
use crate::observe::Critique;
use crate::ops::{PaintMode, Pen, Symmetry};
use crate::palettes;
use crate::render::{self, view_preset, Picture, RenderOptions};
use crate::style::StyleLock;
use crate::tools;
use crate::updates;
use crate::{num, obj, ChangeFn, HostTool, Json, JsonMap, PcError, ToolOutput, VERSION};

/// Characters get_slice and view_as_text use for palette indexes 1-35, and paint_slice reads without a legend.
pub const SLOTS: &[u8] = b"123456789abcdefghijklmnopqrstuvwxyz";
/// Characters for higher indexes, handed out as they appear.
pub const EXTRA_SLOTS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ!@$%&*+=?<>^~";

/// One step of the undo history: the document before the edit, and where the person was.
#[derive(Debug, Clone)]
pub(crate) struct HistoryEntry {
    pub doc: Document,
    pub label: String,
    pub layer: usize,
    pub frame: usize,
}

/// The document, its undo history and every tool. The editor window and agents (MCP) both drive it,
/// so whatever an agent does shows up live on the canvas and can be undone by the person.
pub struct Engine {
    /// Called after any change with the tool's name (on the caller's thread).
    pub on_change: Option<ChangeFn>,
    /// Tools the host (the app window) answers, e.g. get_editor_screenshot.
    pub host_tools: HashMap<String, HostTool>,

    pub(crate) io: BoxedIo,
    pub(crate) doc: Document,
    pub(crate) active_layer: usize,
    pub(crate) active_frame: usize,
    pub(crate) path: Option<String>,
    pub(crate) revision: i64,
    pub(crate) dirty: bool,
    pub(crate) undo_stack: Vec<HistoryEntry>,
    pub(crate) redo_stack: Vec<HistoryEntry>,
    snapshots: HashMap<String, Document>,
    activity: Vec<JsonMap>,

    /// The style every agent edit must follow (set_style). Kept across new canvases, so a set stays consistent.
    pub(crate) style: Option<StyleLock>,
    /// Who is calling right now ("agent" or "person"): the style lock binds agents only.
    pub(crate) source: String,
    /// set while a tool may replace the palette under a style lock (opening files, new canvases, set_style).
    pub(crate) palette_lock_bypass: bool,
    /// Automatic critique after each agent edit (set_feedback), and what the last one saw.
    pub(crate) auto_critique: bool,
    pub(crate) last_critique: Option<Critique>,
    pub(crate) critique_revision: Option<i64>,
    pub(crate) critiques: i64,
    pub(crate) batch_depth: i64,

    /// What the agent's last review saw, so saves and exports can say when the work changed or still has open
    /// issues. Agents tend to review once and stop; this keeps the draw → review → fix loop going to the end.
    reviewed_revision: Option<i64>,
    review_issues: usize,
    reviews: i64,
    ramps_made: i64,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

const FINISHING_TOOLS: [&str; 8] =
    ["save_model", "export_png", "export_sheet", "export_gif", "export_svg", "export_html", "export_vox", "export_obj"];

impl Engine {
    /// Undo depth kept in memory. Models are small and their cels are shared until changed, so a generous
    /// fixed cap is used.
    pub const UNDO_LIMIT: usize = 500;
    /// Above this many cells the automatic critique is skipped (analyze_model still works).
    pub const CRITIQUE_CELL_LIMIT: usize = 300_000;

    /// A 32×32×32 model called "Untitled" with the db32 palette.
    pub fn new() -> Self {
        Self::with_doc(Document::default())
    }

    /// An engine on a given document.
    pub fn with_doc(doc: Document) -> Self {
        Self::with_doc_and_io(doc, io::default_io())
    }

    /// An engine whose files, clock and network are `io`.
    pub fn with_io(io: BoxedIo) -> Self {
        Self::with_doc_and_io(Document::default(), io)
    }

    pub fn with_doc_and_io(doc: Document, io: BoxedIo) -> Self {
        Engine {
            on_change: None,
            host_tools: HashMap::new(),
            io,
            doc,
            active_layer: 0,
            active_frame: 0,
            path: None,
            revision: 0,
            dirty: false,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            snapshots: HashMap::new(),
            activity: Vec::new(),
            style: None,
            source: "agent".into(),
            palette_lock_bypass: false,
            auto_critique: true,
            last_critique: None,
            critique_revision: None,
            critiques: 0,
            batch_depth: 0,
            reviewed_revision: None,
            review_issues: 0,
            reviews: 0,
            ramps_made: 0,
        }
    }

    // MARK: - state

    pub fn doc(&self) -> &Document {
        &self.doc
    }
    pub fn name(&self) -> &str {
        &self.doc.name
    }
    /// The file the document was opened from or saved to.
    pub fn path(&self) -> Option<&std::path::Path> {
        self.path.as_deref().map(std::path::Path::new)
    }
    /// The same as text, exactly as the host was given it.
    pub fn path_str(&self) -> Option<&str> {
        self.path.as_deref()
    }
    pub fn dirty(&self) -> bool {
        self.dirty
    }
    pub fn revision(&self) -> u64 {
        self.revision.max(0) as u64
    }
    pub fn active_layer(&self) -> usize {
        self.active_layer
    }
    pub fn active_frame(&self) -> usize {
        self.active_frame
    }
    pub fn style(&self) -> Option<&StyleLock> {
        self.style.as_ref()
    }
    /// The last tool calls (at most 100), oldest first.
    pub fn activity(&self) -> &[JsonMap] {
        &self.activity
    }
    pub fn io(&self) -> &dyn HostIo {
        self.io.as_ref()
    }
    /// True for a 2D sprite: a model one voxel deep.
    pub fn is_sprite(&self) -> bool {
        self.doc.sz() == 1
    }
    /// (x, y, z)
    pub fn size(&self) -> (usize, usize, usize) {
        (self.doc.sx() as usize, self.doc.sy() as usize, self.doc.sz() as usize)
    }

    /// Forget history and the unsaved flag (used for the welcome model).
    pub fn mark_clean(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.dirty = false;
    }

    /// Writes the document to `to` (or its own file) without logging a tool call: the app's autosave. The undo
    /// history stays as it is. Tells `on_change` with the tool name "autosave".
    pub fn autosave(&mut self, to: Option<&std::path::Path>) -> Result<(), PcError> {
        let to = to.map(|p| p.to_string_lossy().into_owned());
        self.autosave_to(to.as_deref())
    }

    /// `autosave` with the path as text.
    pub fn autosave_to(&mut self, to: Option<&str>) -> Result<(), PcError> {
        let Some(mut u) = to.map(String::from).or_else(|| self.path.clone()) else {
            return Err(PcError::invalid("no file to save to"));
        };
        if paths::extension(&u).is_empty() {
            u = paths::append_extension(&u, "openpixel");
        }
        io::write_file(self.io.as_ref(), &u, &native_file::encode(&self.doc)?)?;
        self.path = Some(u);
        self.dirty = false;
        self.changed("autosave");
        Ok(())
    }

    /// The document's file moved to `to` (None: it has none yet) and is now called `name`. Marks it changed,
    /// so the app's autosave writes the new name into the file. Tells `on_change` with the tool name "rename".
    pub fn rename(&mut self, to: Option<std::path::PathBuf>, name: &str) {
        let to = to.map(|p| p.to_string_lossy().into_owned());
        self.rename_to(to.as_deref(), name);
    }

    /// `rename` with the path as text.
    pub fn rename_to(&mut self, to: Option<&str>, name: &str) {
        if let Some(u) = to {
            self.path = Some(u.to_string());
        }
        self.doc.name = name.to_string();
        self.dirty = true;
        self.changed("rename");
    }

    pub(crate) fn changed(&mut self, tool: &str) {
        if let Some(f) = self.on_change.as_mut() {
            f(tool);
        }
    }

    // MARK: - entry point

    /// Runs a tool. `source` is "agent", "person", "sample" or "home".
    pub fn execute(&mut self, name: &str, raw: &JsonMap, source: &str) -> Result<ToolOutput, PcError> {
        let a = Args::new(raw);
        let outer = std::mem::replace(&mut self.source, source.to_string());
        let result = self.run(name, &a).map(|mut out| {
            if source == "agent" {
                self.coach(name, &mut out);
            }
            out
        });
        self.source = outer;
        let out = match result {
            Ok(out) => out,
            Err(e) => {
                self.log(name, source, false, Some(&e.0));
                return Err(e);
            }
        };
        // The activity list shows every agent call, and the person's edits (not the editor's own reads).
        let spec = tools::spec(name);
        let (hidden, read_only) = (spec.is_some_and(|s| s.hidden), spec.is_some_and(|s| s.read_only));
        if !hidden && (source == "agent" || !read_only) {
            self.log(name, source, true, None);
        }
        Ok(out)
    }

    // MARK: - coaching agents

    fn coach(&mut self, name: &str, out: &mut ToolOutput) {
        match name {
            "new_sprite" | "new_model" | "open_model" => {
                self.reviewed_revision = None;
                self.review_issues = 0;
                self.reviews = 0;
                self.ramps_made = 0;
                self.last_critique = None;
                self.critiques = 0;
                self.critique_revision = Some(self.revision);
                if let Some(s) = &self.style {
                    out.json.insert(
                        "style".into(),
                        json!(format!("{} (locked palette: {}; see get_style)", s.name, s.lock_palette && s.palette.is_some())),
                    );
                }
                if name != "open_model" {
                    out.json.insert(
                        "next_steps".into(),
                        json!([
                            "pixel_art_guide once, if you have not read it",
                            "make_color_ramp base=<the material's middle colour> for each material (3-5 steps), plus a dark outline hue",
                            if self.is_sprite() { "paint_slice: silhouette, then flat colours" } else { "block out the big shapes" },
                            "review_model, fix what it lists",
                            "shade, outline, details",
                            "review_model again and fix every issue before saving or exporting",
                        ]),
                    );
                }
            }
            "make_color_ramp" => self.ramps_made += 1,
            "review_model" | "analyze_model" => {
                self.reviewed_revision = Some(self.revision);
                self.reviews += 1;
                // Only a list made of text counts (as the Swift app cast did).
                let issues: Vec<String> = out
                    .json
                    .get("issues")
                    .and_then(Json::as_array)
                    .and_then(|l| l.iter().map(|v| v.as_str().map(String::from)).collect::<Option<Vec<_>>>())
                    .unwrap_or_default();
                self.review_issues = issues.len();
                let mut next: Vec<String> = Vec::new();
                if !issues.is_empty() {
                    next.push(format!("Fix the {} issue(s) above, then call review_model again to confirm.", issues.len()));
                }
                let colour_trouble =
                    issues.iter().any(|i| i.contains("almost identical colours") || i.contains("colours; a sprite this size"));
                if colour_trouble && self.ramps_made == 0 {
                    next.push("make_color_ramp base=<colour> gives each material evenly spaced shades; replace_color merges the near-duplicates into them.".into());
                }
                if issues.is_empty() && self.reviews == 1 {
                    next.push("No issues. After further changes, review again before exporting.".into());
                }
                if !next.is_empty() {
                    out.json.insert("next".into(), json!(next));
                }
                if let Some(total) = out.json.get("score").and_then(Json::as_object).and_then(|s| s.get("total")).and_then(Json::as_i64) {
                    let findings = analysis::full(&self.doc, self.active_frame, self.style.as_ref()).1;
                    self.last_critique = Some(Critique::new(total, &findings));
                    self.critique_revision = Some(self.revision);
                }
            }
            _ => {
                self.critique(name, out);
                if !FINISHING_TOOLS.contains(&name) {
                    return;
                }
                let reminder = match self.reviewed_revision {
                    None => Some("Saved without a review. Call review_model, fix what it lists, then save or export again.".to_string()),
                    Some(r) if r != self.revision => Some(format!(
                        "{} edit(s) since the last review_model. Review again and fix what it lists before you finish.",
                        self.revision - r
                    )),
                    Some(_) if self.review_issues > 0 => Some(format!(
                        "The last review listed {} issue(s). Fix them (or say why they are deliberate) and review again before you finish.",
                        self.review_issues
                    )),
                    Some(_) => None,
                };
                if let Some(r) = reminder {
                    out.json.insert("review_reminder".into(), json!(r));
                }
            }
        }
    }

    fn log(&mut self, name: &str, source: &str, ok: bool, note: Option<&str>) {
        let mut e = obj(json!({"tool": name, "source": source, "ok": ok}));
        e.insert("time".into(), num(self.io.now()));
        if let Some(n) = note {
            e.insert("note".into(), json!(n));
        }
        self.activity.push(e);
        if self.activity.len() > 100 {
            let extra = self.activity.len() - 100;
            self.activity.drain(..extra);
        }
    }

    // MARK: - editing helpers

    /// Runs an edit as one undo step. Nothing is recorded when the document did not change.
    pub(crate) fn edit<F>(&mut self, label: &str, body: F) -> Result<ToolOutput, PcError>
    where
        F: FnOnce(&Engine, &mut Document) -> Result<JsonMap, PcError>,
    {
        let mut d = self.doc.clone();
        let mut res = body(self, &mut d)?;
        if let Some(s) = &self.style {
            if s.lock_palette && s.palette.is_some() && self.source == "agent" && !self.palette_lock_bypass && d.palette != self.doc.palette {
                self.refuse_off_palette(&self.doc.palette, &d.palette, s)?;
            }
        }
        if d != self.doc {
            let before = std::mem::replace(&mut self.doc, d);
            self.undo_stack.push(HistoryEntry { doc: before, label: label.to_string(), layer: self.active_layer, frame: self.active_frame });
            if self.undo_stack.len() > Engine::UNDO_LIMIT {
                self.undo_stack.remove(0);
            }
            self.redo_stack.clear();
            self.clamp_active();
            self.revision += 1;
            self.dirty = true;
            self.changed(label);
        } else if !res.contains_key("changed") {
            res.insert("changed".into(), json!(0));
        }
        res.insert("revision".into(), json!(self.revision));
        Ok(ToolOutput::new(res))
    }

    /// `edit` for tools that may replace the palette under a style lock.
    fn edit_bypassing_lock<F>(&mut self, label: &str, body: F) -> Result<ToolOutput, PcError>
    where
        F: FnOnce(&Engine, &mut Document) -> Result<JsonMap, PcError>,
    {
        self.palette_lock_bypass = true;
        let out = self.edit(label, body);
        self.palette_lock_bypass = false;
        out
    }

    fn clamp_active(&mut self) {
        self.active_layer = self.active_layer.min(self.doc.layers.len().saturating_sub(1));
        self.active_frame = self.active_frame.min(self.doc.frames.len().saturating_sub(1));
    }

    pub(crate) fn layer_index(&self, a: &Args) -> Result<usize, PcError> {
        let doc = &self.doc;
        if let Some(i) = a.int("layer") {
            if !(i >= 0 && i < doc.layers.len() as i64) {
                return Err(PcError::invalid(format!("layer {} does not exist (0-{})", i, doc.layers.len() as i64 - 1)));
            }
            return Ok(i as usize);
        }
        if let Some(n) = a.string("layer") {
            if !n.is_empty() {
                let wanted = n.to_lowercase();
                return doc
                    .layers
                    .iter()
                    .position(|l| l.name.to_lowercase() == wanted)
                    .ok_or_else(|| PcError::invalid(format!("no layer named \"{n}\"")));
            }
        }
        Ok(self.active_layer)
    }

    pub(crate) fn frame_index(&self, a: &Args) -> Result<usize, PcError> {
        self.frame_index_key(a, "frame")
    }

    pub(crate) fn frame_index_key(&self, a: &Args, key: &str) -> Result<usize, PcError> {
        if let Some(i) = a.int(key) {
            if !(i >= 0 && i < self.doc.frames.len() as i64) {
                return Err(PcError::invalid(format!("frame {} does not exist (0-{})", i, self.doc.frames.len() as i64 - 1)));
            }
            return Ok(i as usize);
        }
        Ok(self.active_frame)
    }

    fn editable_layer(&self, a: &Args) -> Result<usize, PcError> {
        let l = self.layer_index(a)?;
        if self.doc.layers[l].locked {
            return Err(PcError::invalid(format!("layer \"{}\" is locked; unlock it with set_layer", self.doc.layers[l].name)));
        }
        Ok(l)
    }

    /// Resolves a colour argument to a palette index, adding new hex colours to the palette.
    pub(crate) fn color(v: Option<&Json>, d: &mut Document) -> Result<u8, PcError> {
        let index = |i: i64, d: &Document| -> Result<u8, PcError> {
            if !(i >= 0 && i < d.palette.len() as i64) {
                return Err(PcError::invalid(format!("palette index {} does not exist (1-{})", i, d.palette.len() as i64 - 1)));
            }
            Ok(i as u8)
        };
        match v {
            Some(Json::String(s)) => {
                // Text that is a whole number is an index (so "123456" is not the colour #123456).
                if let Ok(i) = s.parse::<i64>() {
                    return index(i, d);
                }
                let Some(c) = Rgba::parse(s) else {
                    return Err(PcError::invalid(format!("\"{s}\" is not a colour; use a palette index or #rrggbb")));
                };
                Ok(Engine::add_color(c, d))
            }
            Some(n @ (Json::Number(_) | Json::Bool(_))) => index(trunc(Args::number(Some(n)).unwrap_or(-1.0)), d),
            _ => Err(PcError::invalid("missing colour")),
        }
    }

    pub(crate) fn add_color(c: Rgba, d: &mut Document) -> u8 {
        if let Some(i) = (1..d.palette.len()).find(|&i| d.palette[i].r == c.r && d.palette[i].g == c.g && d.palette[i].b == c.b) {
            return i as u8;
        }
        if d.palette.len() < Document::MAX_COLORS {
            d.palette.push(Rgba::rgb(c.r, c.g, c.b));
            return (d.palette.len() - 1) as u8;
        }
        Engine::nearest(c, &d.palette)
    }

    pub(crate) fn nearest(c: Rgba, pal: &[Rgba]) -> u8 {
        let (mut best, mut best_d) = (1usize, i64::MAX);
        for (i, p) in pal.iter().enumerate().skip(1) {
            let dd = p.distance(&c);
            if dd < best_d {
                best_d = dd;
                best = i;
            }
        }
        best as u8
    }

    fn pen(&self, a: &Args, d: &mut Document, need_color: bool) -> Result<Pen, PcError> {
        let layer = self.editable_layer(a)?;
        let frame = self.frame_index(a)?;
        let mode = PaintMode::parse(a.string("mode").unwrap_or("replace")).unwrap_or(PaintMode::Replace);
        let mut c: u8 = 0;
        if mode != PaintMode::Erase {
            if a.has("color") {
                c = Engine::color(a.get("color"), d)?;
            } else if need_color {
                return Err(PcError::invalid("missing colour 'color'"));
            }
        }
        Ok(Pen { layer, frame, color: c, mode, symmetry: Symmetry::parse(a.string("symmetry")) })
    }

    fn frames(&self, a: &Args) -> Result<Vec<usize>, PcError> {
        if a.bool("all_frames", false) {
            Ok((0..self.doc.frames.len()).collect())
        } else {
            Ok(vec![self.frame_index(a)?])
        }
    }

    fn layers(&self, a: &Args) -> Result<Vec<usize>, PcError> {
        if a.bool("all_layers", false) {
            return Ok((0..self.doc.layers.len()).filter(|&i| !self.doc.layers[i].locked).collect());
        }
        Ok(vec![self.editable_layer(a)?])
    }

    // MARK: - info helpers

    pub fn info(&self) -> JsonMap {
        let g = self.doc.composite(self.active_frame);
        let doc = &self.doc;
        obj(json!({
            "name": doc.name, "size": [doc.sx(), doc.sy(), doc.sz()],
            "kind": if self.is_sprite() { "2d-sprite" } else { "3d-model" },
            "palette_colors": doc.palette.len() as i64 - 1,
            "layers": doc.layers.iter().enumerate().map(|(i, l)| json!({"index": i, "name": l.name, "visible": l.visible, "locked": l.locked})).collect::<Vec<_>>(),
            "frames": doc.frames.iter().enumerate().map(|(i, f)| json!({"index": i, "duration_ms": f.duration})).collect::<Vec<_>>(),
            "active_layer": self.active_layer, "active_frame": self.active_frame,
            "voxels_in_active_frame": g.iter().filter(|&&v| v != 0).count(),
            "file": self.path, "unsaved_changes": self.dirty,
            "undo_steps": self.undo_stack.len(), "redo_steps": self.redo_stack.len(), "revision": self.revision,
            "conventions": tools::CONVENTIONS,
        }))
    }

    /// Render settings from tool arguments. 2D sprites default to the exact front view: palette colours,
    /// no outline or shading, the whole canvas (so a scale-1 export is the sprite pixel for pixel).
    fn render_options(&self, a: &Args, default_scale: i64) -> RenderOptions {
        let mut o = RenderOptions::default();
        if self.is_sprite() {
            (o.yaw, o.pitch) = (0.0, 0.0);
            o.padding = 0;
            o.show_bounds = true;
        }
        if let Some(ang) = a.string("view").and_then(view_preset::angles) {
            (o.yaw, o.pitch) = ang;
        }
        if let Some(y) = a.double("yaw") {
            o.yaw = y;
        }
        if let Some(p) = a.double("pitch") {
            o.pitch = p;
        }
        o.scale = a.int("scale").unwrap_or(default_scale).min(64).max(1);
        let flat_view = self.is_sprite() && trunc(o.pitch) == 0 && trunc(o.yaw) % 180 == 0;
        o.flat = a.bool("flat", flat_view);
        o.outline = a.bool("outline", !flat_view);
        o.edges = a.bool("edges", !flat_view);
        if let Some(c) = a.string("background").and_then(Rgba::parse) {
            o.background = c;
        }
        o
    }

    /// A file argument as the path to hand to the host: "~" expanded, made absolute where the host can.
    pub(crate) fn file_path(&self, p: &str) -> String {
        self.io.absolute(&paths::expand_tilde(p, self.io.as_ref()))
    }

    /// The `path` argument for a file to write: with extension `ext` added when it has another (or none),
    /// and its folder created.
    fn url(&self, a: &Args, ext: Option<&str>) -> Result<String, PcError> {
        let mut u = self.file_path(a.req_string("path")?);
        if let Some(e) = ext {
            if paths::extension(&u).to_lowercase() != e {
                u = paths::append_extension(&u, e);
            }
        }
        io::create_parent(self.io.as_ref(), &u)?;
        Ok(u)
    }

    fn write(&self, path: &str, data: &[u8]) -> Result<(), PcError> {
        io::write_file(self.io.as_ref(), path, data)
    }

    /// Reads a .openpixel or .vox file: (the path handed to the host, the document).
    pub(crate) fn read_document(&self, p: &str) -> Result<(String, Document), PcError> {
        let u = self.file_path(p);
        let data = io::read_file(self.io.as_ref(), &u)?;
        let doc = if paths::extension(&u).to_lowercase() == "vox" {
            vox_file::decode(&data, paths::file_stem(&u))?
        } else {
            native_file::decode(&data)?
        };
        Ok((u, doc))
    }

    // MARK: - tools

    fn run(&mut self, name: &str, a: &Args) -> Result<ToolOutput, PcError> {
        match name {
            "new_model" => {
                let (sx, sy, sz) = (a.int_or("size_x", 32), a.int_or("size_y", 32), a.int_or("size_z", 32));
                Document::check_size(sx, sy, sz)?;
                let preset_name = a.string("palette").unwrap_or("db32");
                let Some(mut pal) = palettes::named(preset_name) else {
                    return Err(PcError::invalid(format!("unknown palette {}; use {}", preset_name, palettes::names().join(", "))));
                };
                if let Some(locked) = self.style.as_ref().and_then(|s| s.palette.clone()) {
                    pal = locked;
                }
                let doc_name = a.string("name").unwrap_or("Untitled").to_string();
                let out = self.edit_bypassing_lock("New model", move |_, d| {
                    *d = Document::new(doc_name, sx, sy, sz, Some(pal));
                    Ok(JsonMap::new())
                })?;
                self.active_layer = 0;
                self.active_frame = 0;
                self.path = None;
                self.dirty = false;
                self.changed("new_model");
                let mut info = self.info();
                for (k, v) in out.json {
                    info.entry(k).or_insert(v);
                }
                Ok(ToolOutput::new(info))
            }

            "get_model_info" => Ok(ToolOutput::new(self.info())),

            "new_sprite" => {
                let mut args = a.d.clone();
                let styled = self.style.as_ref().and_then(|s| s.size.clone()).filter(|s| s.len() == 2);
                args.insert("size_x".into(), json!(a.int_or("width", styled.as_ref().map_or(32, |s| s[0]))));
                args.insert("size_y".into(), json!(a.int_or("height", styled.as_ref().map_or(32, |s| s[1]))));
                args.insert("size_z".into(), json!(1));
                self.run("new_model", &Args::new(&args))
            }

            "set_pixels" => {
                let Some(list) = a.array("pixels") else { return Err(PcError::invalid("missing pixels")) };
                let depth = a.int_or("depth", 0);
                self.edit("Draw pixels", |e, d| {
                    let mut p = e.pen(a, d, false)?;
                    let base = p.color;
                    let mut n = 0;
                    for item in list {
                        let xy = item.as_array().filter(|v| v.len() >= 2).and_then(|v| Some((v, Args::number(v.first())?, Args::number(v.get(1))?)));
                        let Some((v, x, y)) = xy else {
                            return Err(PcError::invalid("each pixel is [x, y] or [x, y, color], with y counted from the top row"));
                        };
                        if v.len() >= 3 {
                            p.color = Engine::color(v.get(2), d)?;
                        } else {
                            if !(base != 0 || p.mode == PaintMode::Erase) {
                                return Err(PcError::invalid("give `color` or [x, y, color]"));
                            }
                            p.color = base;
                        }
                        n += d.put(trunc(x), d.sy() - 1 - trunc(y), depth, &p);
                    }
                    Ok(obj(json!({"changed": n})))
                })
            }

            "extrude_to_3d" => {
                let depth = a.req("depth")?;
                if !(depth >= 1 && depth <= Document::MAX_SIZE) {
                    return Err(PcError::invalid(format!("depth must be 1-{}", Document::MAX_SIZE)));
                }
                let from = a.int_or("from_slice", 0);
                if !(from >= 0 && from < self.doc.sz()) {
                    return Err(PcError::invalid(format!("from_slice must be 0-{}", self.doc.sz() - 1)));
                }
                self.edit("Extrude to 3D", |_, d| {
                    let old = d.clone();
                    d.resize(d.sx(), d.sy(), depth, "origin")?;
                    let (sx, sy) = (d.sx(), d.sy());
                    for l in 0..d.layers.len() {
                        for f in 0..d.frames.len() {
                            let src = old.cels[l][f].data();
                            let mut g = vec![0u8; d.count()];
                            for y in 0..sy {
                                for x in 0..sx {
                                    let v = src[old.index(x, y, from)];
                                    if v == 0 {
                                        continue;
                                    }
                                    for z in 0..depth {
                                        g[d.index(x, y, z)] = v;
                                    }
                                }
                            }
                            d.cels[l][f] = Grid::from_data(g);
                        }
                    }
                    Ok(obj(json!({"size": [d.sx(), d.sy(), d.sz()]})))
                })
            }

            "open_model" => {
                let (u, loaded) = self.read_document(a.req_string("path")?)?;
                let label = format!("Open {}", paths::file_name(&u));
                self.edit_bypassing_lock(&label, move |_, d| {
                    *d = loaded;
                    Ok(JsonMap::new())
                })?;
                self.active_layer = 0;
                self.active_frame = 0;
                self.path = if paths::extension(&u).to_lowercase() == "vox" { None } else { Some(u) };
                self.dirty = false;
                self.changed("open_model");
                Ok(ToolOutput::new(self.info()))
            }

            "save_model" => {
                let mut u = if a.has("path") {
                    self.url(a, Some("openpixel"))?
                } else if let Some(p) = &self.path {
                    p.clone()
                } else {
                    return Err(PcError::invalid("no file yet: give a path ending in .openpixel"));
                };
                if paths::extension(&u).is_empty() {
                    u = paths::append_extension(&u, "openpixel");
                }
                self.write(&u, &native_file::encode(&self.doc)?)?;
                self.path = Some(u.clone());
                self.dirty = false;
                self.changed("save_model");
                Ok(ToolOutput::new(obj(json!({"saved": u}))))
            }

            "resize_model" => {
                let (nx, ny, nz) = (a.req("size_x")?, a.req("size_y")?, a.req("size_z")?);
                self.edit(&format!("Resize to {nx}×{ny}×{nz}"), |_, d| {
                    d.resize(nx, ny, nz, a.string("anchor").unwrap_or("bottom-center"))?;
                    Ok(obj(json!({"size": [nx, ny, nz]})))
                })
            }

            // Palette
            "get_palette" => Ok(ToolOutput::new(obj(json!({
                "colors": self.doc.palette.iter().enumerate().skip(1).map(|(i, c)| json!({"index": i, "hex": c.hex()})).collect::<Vec<_>>(),
                "presets": palettes::names(),
            })))),

            "set_palette" => {
                let mut pal: Vec<Rgba>;
                if let Some(p) = a.string("preset") {
                    pal = palettes::named(p).ok_or_else(|| PcError::invalid(format!("unknown preset {p}")))?;
                } else if let Some(list) = a.array("colors") {
                    pal = vec![Rgba::new(0, 0, 0, 0)];
                    pal.extend(list.iter().take(255).filter_map(|v| v.as_str().and_then(Rgba::parse)));
                    if pal.len() <= 1 {
                        return Err(PcError::invalid("give at least one hex colour"));
                    }
                } else {
                    return Err(PcError::invalid("give a preset or colors"));
                }
                self.edit("Set palette", move |_, d| {
                    // Keep indexes valid: pad with the old colours when the new palette is shorter than what's used.
                    let mut max_used = 0usize;
                    for layer in &d.cels {
                        for cel in layer {
                            max_used = max_used.max(cel.data().iter().copied().max().unwrap_or(0) as usize);
                        }
                    }
                    while pal.len() <= max_used {
                        pal.push(d.color(pal.len() as u8));
                    }
                    let mut res = obj(json!({"palette_colors": pal.len() as i64 - 1}));
                    if a.has("colors") {
                        let w = craft::near_warnings(&pal[1..], &[]);
                        if !w.is_empty() {
                            res.insert("warnings".into(), json!(w));
                        }
                    }
                    d.palette = pal;
                    Ok(res)
                })
            }

            "set_palette_color" => {
                let i = a.req("index")?;
                if !(i >= 1 && i < Document::MAX_COLORS as i64) {
                    return Err(PcError::invalid("index must be 1-255"));
                }
                let Some(c) = Rgba::parse(a.req_string("color")?) else { return Err(PcError::invalid("not a hex colour")) };
                self.edit(&format!("Palette colour {i}"), |_, d| {
                    while d.palette.len() <= i as usize {
                        d.palette.push(Rgba::rgb(0, 0, 0));
                    }
                    d.palette[i as usize] = Rgba::rgb(c.r, c.g, c.b);
                    Ok(obj(json!({"index": i, "hex": c.hex()})))
                })
            }

            "add_colors" => {
                let Some(list) = a.array("colors") else { return Err(PcError::invalid("missing colors")) };
                self.edit("Add colours", |_, d| {
                    let before: Vec<Rgba> = d.palette.iter().skip(1).copied().collect();
                    let mut idx: Vec<i64> = Vec::new();
                    for v in list {
                        idx.push(Engine::color(Some(v), d)? as i64);
                    }
                    let mut res = obj(json!({"indexes": idx}));
                    // Only colours this call really added are checked (reused ones were already in the palette).
                    let fresh: Vec<Rgba> = d.palette.iter().skip(before.len() + 1).copied().collect();
                    let w = craft::near_warnings(&fresh, &before);
                    if !w.is_empty() {
                        res.insert("warnings".into(), json!(w));
                    }
                    Ok(res)
                })
            }

            "make_color_ramp" => {
                let steps = a.int_or("steps", if a.has("base") { 5 } else { 4 }).min(16).max(2);
                let colors: Vec<Rgba> = if let Some(b) = a.string("base") {
                    let Some(base) = Rgba::parse(b) else { return Err(PcError::invalid("base must be a hex colour")) };
                    craft::ramp_base(base, steps, a.double("hue_shift").unwrap_or(12.0))
                } else {
                    let ends = (a.string("from").and_then(Rgba::parse), a.string("to").and_then(Rgba::parse));
                    let (Some(c0), Some(c1)) = ends else {
                        return Err(PcError::invalid("give base (one hex colour), or from and to (hex colours)"));
                    };
                    craft::ramp_between(c0, c1, steps, a.double("hue_shift").unwrap_or(8.0))
                };
                self.edit("Colour ramp", |_, d| {
                    let idx: Vec<i64> = colors.iter().map(|c| Engine::add_color(*c, d) as i64).collect();
                    Ok(obj(json!({"indexes": idx, "colors": colors.iter().map(|c| c.hex()).collect::<Vec<_>>(), "order": "darkest first"})))
                })
            }

            "pixel_art_guide" => {
                let topic = a.string("topic").unwrap_or("all");
                if !craft::TOPICS.contains(&topic.to_lowercase().as_str()) {
                    return Err(PcError::invalid(format!("topic must be one of {}", craft::TOPICS.join(", "))));
                }
                Ok(ToolOutput::new(obj(json!({"topic": topic, "guide": craft::guide_text(Some(topic))}))))
            }

            "pixel_perfect" => {
                let l = self.editable_layer(a)?;
                let fs = self.frames(a)?;
                let depth = a.int_or("depth", 0);
                if !(depth >= 0 && depth < self.doc.sz()) {
                    return Err(PcError::invalid(format!("depth must be 0-{}", self.doc.sz() - 1)));
                }
                self.edit("Pixel-perfect lines", |_, d| {
                    let only: Option<u8> = if a.has("color") { Some(Engine::color(a.get("color"), d)?) } else { None };
                    let mut cells: Vec<Json> = Vec::new();
                    for &f in &fs {
                        for c in craft::pixel_perfect(d, l, f, depth, only) {
                            cells.push(json!({"frame": f, "x": c[0], "row": c[1]}));
                        }
                    }
                    let note = if cells.is_empty() { "no doubled corners found" } else { "each removed pixel took the colour around it; review_model to check" };
                    Ok(obj(json!({"changed": cells.len(), "cells": cells.iter().take(60).collect::<Vec<_>>(), "note": note})))
                })
            }

            // Layers & frames
            "add_layer" => {
                let name = a.string("name").map(String::from).unwrap_or_else(|| format!("Layer {}", self.doc.layers.len() + 1));
                let mut new_index = 0usize;
                let out = self.edit(&format!("Add layer {name}"), |e, d| {
                    new_index = d.add_layer(&name, Some(e.active_layer as i64 + 1));
                    Ok(JsonMap::new())
                })?;
                self.active_layer = new_index;
                self.changed("add_layer");
                Ok(ToolOutput::new(obj(json!({"layer": new_index, "name": name, "revision": out.json.get("revision").cloned().unwrap_or(json!(self.revision))}))))
            }

            "delete_layer" => {
                let l = self.layer_index(a)?;
                self.edit("Delete layer", |_, d| {
                    d.remove_layer(l)?;
                    Ok(obj(json!({"deleted": l})))
                })
            }

            "set_layer" => {
                let l = self.layer_index(a)?;
                self.edit("Layer settings", |_, d| {
                    if let Some(n) = a.string("name") {
                        d.layers[l].name = n.to_string();
                    }
                    if a.has("visible") {
                        d.layers[l].visible = a.bool("visible", true);
                    }
                    if a.has("locked") {
                        d.layers[l].locked = a.bool("locked", false);
                    }
                    Ok(obj(json!({"layer": l, "name": d.layers[l].name, "visible": d.layers[l].visible, "locked": d.layers[l].locked})))
                })
            }

            "move_layer" => {
                let l = self.layer_index(a)?;
                let n = self.doc.layers.len() as i64;
                let to = a.req("to")?;
                if !(to >= 0 && to < n) {
                    return Err(PcError::invalid(format!("to must be 0-{} (0 is the back)", n - 1)));
                }
                let to = to as usize;
                if to == l {
                    return Ok(ToolOutput::new(obj(json!({"layer": l, "unchanged": true}))));
                }
                let out = self.edit("Move layer", |_, d| {
                    let layer = d.layers.remove(l);
                    let name = layer.name.clone();
                    d.layers.insert(to, layer);
                    let cels = d.cels.remove(l);
                    d.cels.insert(to, cels);
                    Ok(obj(json!({"layer": to, "name": name})))
                })?;
                // The active layer stays the same layer, wherever it now sits.
                if self.active_layer == l {
                    self.active_layer = to;
                } else if l < self.active_layer && to >= self.active_layer {
                    self.active_layer -= 1;
                } else if l > self.active_layer && to <= self.active_layer {
                    self.active_layer += 1;
                }
                Ok(out)
            }

            "duplicate_layer" => {
                let l = self.layer_index(a)?;
                let out = self.edit("Duplicate layer", |_, d| {
                    let name = format!("{} copy", d.layers[l].name);
                    let i = d.add_layer(&name, Some(l as i64 + 1));
                    d.cels[i] = d.cels[l].clone();
                    Ok(obj(json!({"layer": i})))
                })?;
                self.active_layer = l + 1;
                Ok(out)
            }

            "merge_layer_down" => {
                let l = self.layer_index(a)?;
                if l == 0 {
                    return Err(PcError::invalid("the bottom layer has nothing below it"));
                }
                let out = self.edit("Merge layer down", |_, d| {
                    for f in 0..d.frames.len() {
                        if d.cels[l][f].is_empty() {
                            continue;
                        }
                        let upper = d.cels[l][f].clone();
                        for (dst, &src) in d.cels[l - 1][f].data_mut().iter_mut().zip(upper.data()) {
                            if src != 0 {
                                *dst = src;
                            }
                        }
                    }
                    d.remove_layer(l)?;
                    Ok(obj(json!({"merged_into": l - 1})))
                })?;
                self.active_layer = l - 1;
                Ok(out)
            }

            "set_active" => {
                if a.has("layer") {
                    self.active_layer = self.layer_index(a)?;
                }
                if a.has("frame") {
                    self.active_frame = self.frame_index(a)?;
                }
                self.changed("set_active");
                Ok(ToolOutput::new(obj(json!({"active_layer": self.active_layer, "active_frame": self.active_frame}))))
            }

            "add_frame" => {
                let after = self.frame_index_key(a, "after")?;
                let mut i = 0usize;
                let out = self.edit("Add frame", |_, d| {
                    i = d.add_frame(after, a.bool("copy", true));
                    Ok(JsonMap::new())
                })?;
                self.active_frame = i;
                self.changed("add_frame");
                Ok(ToolOutput::new(obj(json!({"frame": i, "frames": self.doc.frames.len(), "revision": out.json.get("revision").cloned().unwrap_or(json!(self.revision))}))))
            }

            "delete_frame" => {
                let f = self.frame_index(a)?;
                self.edit("Delete frame", |_, d| {
                    d.remove_frame(f)?;
                    Ok(obj(json!({"deleted": f})))
                })
            }

            "set_frame_duration" => {
                let ms = a.req("duration_ms")?.max(1);
                let list = self.frames(a)?;
                self.edit("Frame duration", |_, d| {
                    for &f in &list {
                        d.frames[f].duration = ms;
                    }
                    Ok(obj(json!({"frames": list, "duration_ms": ms})))
                })
            }

            // Drawing
            "set_voxels" => {
                let Some(list) = a.array("voxels") else { return Err(PcError::invalid("missing voxels")) };
                self.edit("Place voxels", |e, d| {
                    let mut p = e.pen(a, d, false)?;
                    let base = p.color;
                    let mut n = 0;
                    for item in list {
                        let cell = item.as_array().filter(|v| v.len() >= 3).and_then(|v| {
                            Some((v, Args::number(v.first())?, Args::number(v.get(1))?, Args::number(v.get(2))?))
                        });
                        let Some((v, x, y, z)) = cell else {
                            return Err(PcError::invalid("each voxel is [x, y, z] or [x, y, z, color]"));
                        };
                        if v.len() >= 4 {
                            p.color = Engine::color(v.get(3), d)?;
                        } else {
                            if !(base != 0 || p.mode == PaintMode::Erase) {
                                return Err(PcError::invalid("give `color` or [x,y,z,color]"));
                            }
                            p.color = base;
                        }
                        n += d.put(trunc(x), trunc(y), trunc(z), &p);
                    }
                    Ok(obj(json!({"changed": n})))
                })
            }

            "erase_voxels" => {
                let Some(list) = a.array("voxels") else { return Err(PcError::invalid("missing voxels")) };
                self.edit("Erase voxels", |e, d| {
                    let p = Pen {
                        layer: e.editable_layer(a)?,
                        frame: e.frame_index(a)?,
                        color: 0,
                        mode: PaintMode::Erase,
                        symmetry: Symmetry::parse(a.string("symmetry")),
                    };
                    let mut n = 0;
                    for item in list {
                        let Some(pt) = Args::point_of(Some(item)) else { return Err(PcError::invalid("each voxel is [x, y, z]")) };
                        n += d.put(trunc(pt.0), trunc(pt.1), trunc(pt.2), &p);
                    }
                    Ok(obj(json!({"changed": n})))
                })
            }

            "fill_box" => {
                let (p0, p1) = (a.req_point("from")?, a.req_point("to")?);
                self.edit("Box", |e, d| {
                    let pen = e.pen(a, d, true)?;
                    Ok(obj(json!({"changed": d.fill_box(p0, p1, a.bool("hollow", false), &pen)})))
                })
            }

            "draw_sphere" => {
                let Some(c) = a.point("center") else { return Err(PcError::invalid("missing center")) };
                let r = if let Some(rr) = Args::number(a.get("radius")) {
                    (rr, rr, rr)
                } else if let Some(rr) = Args::point_of(a.get("radius")) {
                    rr
                } else {
                    return Err(PcError::invalid("radius is a number or [rx, ry, rz]"));
                };
                self.edit("Sphere", |e, d| {
                    let pen = e.pen(a, d, true)?;
                    Ok(obj(json!({"changed": d.ellipsoid(c, r, a.bool("hollow", false), &pen)})))
                })
            }

            "draw_cylinder" => {
                let (Some(b), Some(r)) = (a.point("base"), a.double("radius")) else {
                    return Err(PcError::invalid("missing base or radius"));
                };
                self.edit("Cylinder", |e, d| {
                    let length = a.req("length")?;
                    let pen = e.pen(a, d, true)?;
                    Ok(obj(json!({"changed": d.cylinder(b, r, length, a.string("axis").unwrap_or("y"), a.bool("hollow", false), &pen)})))
                })
            }

            "draw_line" => {
                let (p0, p1) = (a.req_point("from")?, a.req_point("to")?);
                self.edit("Line", |e, d| {
                    let pen = e.pen(a, d, true)?;
                    Ok(obj(json!({"changed": d.line(p0, p1, a.int_or("radius", 0).max(0), &pen)})))
                })
            }

            "flood_fill" => {
                let s = a.req_point("at")?;
                self.edit("Fill", |e, d| {
                    let pen = e.pen(a, d, true)?;
                    Ok(obj(json!({"changed": d.flood_fill(s, a.bool("volume", false), &pen)})))
                })
            }

            "paint_slice" => self.paint_slice(a),

            "replace_color" => {
                let (ls, fs) = (self.layers(a)?, self.frames(a)?);
                self.edit("Replace colour", |_, d| {
                    let from = Engine::color(a.get("from"), d)?;
                    let to = Engine::color(a.get("to"), d)?;
                    let mut n = 0;
                    for &l in &ls {
                        for &f in &fs {
                            n += d.replace_color(l, f, from, to);
                        }
                    }
                    Ok(obj(json!({"changed": n})))
                })
            }

            "apply_gradient" => {
                let Some(list) = a.array("colors").filter(|l| !l.is_empty()) else { return Err(PcError::invalid("missing colors")) };
                let (l, f) = (self.editable_layer(a)?, self.frame_index(a)?);
                self.edit("Gradient", |_, d| {
                    let mut ramp: Vec<u8> = Vec::new();
                    for v in list {
                        ramp.push(Engine::color(Some(v), d)?);
                    }
                    let only = if a.has("only_color") { Some(Engine::color(a.get("only_color"), d)?) } else { None };
                    Ok(obj(json!({"changed": d.gradient(l, f, a.string("axis").unwrap_or("y"), &ramp, only)})))
                })
            }

            "transform" => {
                let op = a.req_string("op")?;
                let (ls, fs) = (self.layers(a)?, self.frames(a)?);
                let axis = a.string("axis").unwrap_or("y");
                self.edit(&format!("Transform: {op}"), |_, d| {
                    for &l in &ls {
                        for &f in &fs {
                            match op {
                                "move" => d.translate(l, f, a.int_or("dx", 0), a.int_or("dy", 0), a.int_or("dz", 0), a.bool("wrap", false)),
                                "flip" => d.flip(l, f, axis),
                                "rotate" => d.rotate(l, f, axis, a.int_or("turns", 1)),
                                "mirror" => d.mirror(l, f, a.string("axis").unwrap_or("x"), a.string("keep").unwrap_or("low")),
                                _ => return Err(PcError::invalid("op is move, flip, rotate or mirror")),
                            }
                        }
                    }
                    Ok(obj(json!({"op": op, "layers": ls, "frames": fs})))
                })
            }

            "clear" => {
                let (l, f) = (self.editable_layer(a)?, self.frame_index(a)?);
                self.edit("Clear", |_, d| {
                    d.cels[l][f] = Grid::new(d.count());
                    Ok(obj(json!({"cleared_layer": l, "frame": f})))
                })
            }

            "import_image" => self.import_image(a),

            // Review
            "get_voxel" => {
                let (p, f) = (a.req_point("at")?, self.frame_index(a)?);
                let doc = &self.doc;
                if !doc.in_bounds(p.0, p.1, p.2) {
                    return Err(PcError::invalid(format!("cell is outside the model (size {}×{}×{})", doc.sx(), doc.sy(), doc.sz())));
                }
                for l in (0..doc.layers.len()).rev() {
                    if !doc.layers[l].visible {
                        continue;
                    }
                    let v = doc.get(l, f, p.0, p.1, p.2);
                    if v != 0 {
                        return Ok(ToolOutput::new(obj(json!({"at": [p.0, p.1, p.2], "index": v, "hex": doc.color(v).hex(), "layer": l}))));
                    }
                }
                Ok(ToolOutput::new(obj(json!({"at": [p.0, p.1, p.2], "index": 0, "empty": true}))))
            }

            "get_slice" => self.get_slice(a),

            "view_as_text" => self.view_as_text(a),
            "set_style" => self.set_style(a),
            "get_style" => Ok(ToolOutput::new(match &self.style {
                Some(s) => obj(json!({"style": s.json()})),
                None => obj(json!({"style": null, "note": "no style set; set_style locks one"})),
            })),
            "set_feedback" => {
                if a.has("auto_critique") {
                    self.auto_critique = a.bool("auto_critique", true);
                }
                Ok(ToolOutput::new(obj(json!({"auto_critique": self.auto_critique, "cell_limit": Engine::CRITIQUE_CELL_LIMIT}))))
            }
            "check_for_updates" => {
                // With the window open, the app answers this itself (it can show the update dialog).
                if let Some(h) = self.host_tools.get(name) {
                    return h(a.d);
                }
                let mut o = updates::report_with(self.io.as_ref(), VERSION, a.bool("refresh", false))?;
                if a.bool("install", false) {
                    let available = o.get("update_available").and_then(Json::as_bool).unwrap_or(false);
                    o.insert(
                        "install".into(),
                        json!(if available {
                            "No OpenPixel window is open, so no dialog was shown. Ask the person to open OpenPixel and click Update at the bottom of the sidebar, or to download it from the link."
                        } else {
                            "Nothing to install."
                        }),
                    );
                }
                Ok(ToolOutput::new(o))
            }
            "batch" => self.batch(a),
            "review_set" => self.review_set(a),

            "find_voxels" => {
                let f = self.frame_index(a)?;
                let doc = &self.doc;
                let merged = !a.has("layer");
                let g: Vec<u8> = if merged { doc.composite(f) } else { doc.cels[self.layer_index(a)?][f].data().to_vec() };
                let mut d2 = doc.clone();
                let only: Option<u8> = if a.has("color") { Some(Engine::color(a.get("color"), &mut d2)?) } else { None };
                let cell = |p: (f64, f64, f64)| (trunc(p.0), trunc(p.1), trunc(p.2));
                let lo = a.point("from").map(cell).unwrap_or((0, 0, 0));
                let hi = a.point("to").map(cell).unwrap_or((doc.sx() - 1, doc.sy() - 1, doc.sz() - 1));
                let limit = a.int_or("limit", 500).clamp(1, u32::MAX as i64) as usize;
                let mut cells: Vec<[i64; 4]> = Vec::new();
                let mut total = 0i64;
                // A box that lies outside the model finds nothing. (The Swift app crashed on it.)
                for y in lo.1.min(hi.1).max(0)..=lo.1.max(hi.1).min(doc.sy() - 1) {
                    for z in lo.2.min(hi.2).max(0)..=lo.2.max(hi.2).min(doc.sz() - 1) {
                        for x in lo.0.min(hi.0).max(0)..=lo.0.max(hi.0).min(doc.sx() - 1) {
                            let v = g[doc.index(x, y, z)];
                            if v == 0 || only.is_some_and(|o| v != o) {
                                continue;
                            }
                            total += 1;
                            if cells.len() < limit {
                                cells.push([x, y, z, v as i64]);
                            }
                        }
                    }
                }
                Ok(ToolOutput::new(obj(json!({"total": total, "returned": cells.len(), "voxels": cells, "format": "[x, y, z, palette index]"}))))
            }

            "analyze_model" => {
                let f = self.frame_index(a)?;
                Ok(ToolOutput::new(self.analysis_report(f)))
            }

            "render_view" => {
                let f = self.frame_index(a)?;
                let o = self.render_options(a, render::auto_scale(&self.doc, 384));
                let pic = render::render(&self.doc, f, &o)?;
                let mut json = obj(json!({"width": pic.width, "height": pic.height, "scale": o.scale, "frame": f}));
                json.insert("yaw".into(), num(o.yaw));
                json.insert("pitch".into(), num(o.pitch));
                Ok(ToolOutput::with_images(json, vec![image_files::png(&pic)]))
            }

            "review_model" => {
                let f = self.frame_index(a)?;
                if self.is_sprite() {
                    // A 2D sprite: enlarged with a pixel grid and as values, then silhouette and real sizes.
                    let (images, layout) = craft::sprite_review(&self.doc, f, a.int("scale"))?;
                    let mut json = self.analysis_report(f);
                    json.insert("picture_layout".into(), json!(layout));
                    return Ok(ToolOutput::with_images(json, images));
                }
                let scale = a.int("scale").unwrap_or_else(|| render::auto_scale(&self.doc, 200));
                let views = ["iso", "iso-front-left", "iso-back-right", "iso-back-left", "front", "right", "top"];
                let mut pics: Vec<Picture> = Vec::new();
                for v in views {
                    let mut o = RenderOptions::default();
                    (o.yaw, o.pitch) = view_preset::angles(v).unwrap_or((45.0, 30.0));
                    o.scale = scale;
                    pics.push(render::render(&self.doc, f, &o)?);
                }
                let (sheet, _) = render::sheet(&pics, 4, 6, Rgba::rgb(44, 44, 48))?;
                let mut json = self.analysis_report(f);
                json.insert(
                    "picture_layout".into(),
                    json!("Row 1: iso (front-right), iso-front-left, iso-back-right, iso-back-left. Row 2: front, right, top."),
                );
                Ok(ToolOutput::with_images(json, vec![image_files::png(&sheet)]))
            }

            "take_snapshot" => {
                let n = a.string("name").unwrap_or("last");
                self.snapshots.insert(n.to_string(), self.doc.clone());
                Ok(ToolOutput::new(obj(json!({"snapshot": n, "revision": self.revision}))))
            }

            "compare_snapshot" => {
                let n = a.string("name").unwrap_or("last");
                let Some(old) = self.snapshots.get(n) else {
                    return Err(PcError::invalid(format!("no snapshot named {n}; call take_snapshot first")));
                };
                let doc = &self.doc;
                if !(old.sx() == doc.sx() && old.sy() == doc.sy() && old.sz() == doc.sz()) {
                    return Ok(ToolOutput::new(obj(json!({"note": "the model was resized since the snapshot", "before_size": [old.sx(), old.sy(), old.sz()]}))));
                }
                let f = self.active_frame.min(old.frames.len() - 1);
                let mut json = analysis::diff(&old.composite(f), &doc.composite(self.active_frame), doc, 50);
                let mut o = self.render_options(a, render::auto_scale(doc, 260));
                if a.string("view").is_none() {
                    (o.yaw, o.pitch) = (45.0, 30.0);
                }
                let pics = [render::render(old, f, &o)?, render::render(doc, self.active_frame, &o)?];
                let (sheet, _) = render::sheet(&pics, 2, 6, Rgba::rgb(44, 44, 48))?;
                json.insert("picture_layout".into(), json!(format!("Left: snapshot \"{n}\". Right: now.")));
                Ok(ToolOutput::with_images(json, vec![image_files::png(&sheet)]))
            }

            "undo" | "redo" => {
                let steps = a.int_or("steps", 1).max(1);
                let mut done: Vec<String> = Vec::new();
                for _ in 0..steps {
                    let (from, to) = if name == "undo" { (&mut self.undo_stack, &mut self.redo_stack) } else { (&mut self.redo_stack, &mut self.undo_stack) };
                    let Some(e) = from.pop() else { break };
                    let current = std::mem::replace(&mut self.doc, e.doc);
                    to.push(HistoryEntry { doc: current, label: e.label.clone(), layer: self.active_layer, frame: self.active_frame });
                    self.active_layer = e.layer;
                    self.active_frame = e.frame;
                    done.push(e.label);
                }
                self.clamp_active();
                if !done.is_empty() {
                    self.revision += 1;
                    self.dirty = true;
                    self.changed(name);
                }
                let mut json = obj(json!({"undo_steps": self.undo_stack.len(), "redo_steps": self.redo_stack.len(), "revision": self.revision}));
                json.insert(if name == "undo" { "undone" } else { "redone" }.into(), json!(done));
                Ok(ToolOutput::new(json))
            }

            "get_history" => Ok(ToolOutput::new(obj(json!({
                "undo": self.undo_stack.iter().map(|e| e.label.as_str()).collect::<Vec<_>>(),
                "redo": self.redo_stack.iter().rev().map(|e| e.label.as_str()).collect::<Vec<_>>(),
            })))),

            // Export
            "export_png" => {
                let u = self.url(a, Some("png"))?;
                let o = self.render_options(a, if self.is_sprite() { 1 } else { 8 });
                let pic = render::render(&self.doc, self.frame_index(a)?, &o)?;
                self.write(&u, &image_files::png(&pic))?;
                Ok(ToolOutput::new(obj(json!({"saved": u, "width": pic.width, "height": pic.height}))))
            }

            "export_sheet" => self.export_sheet(a),

            "export_gif" => {
                let u = self.url(a, Some("gif"))?;
                let o = self.render_options(a, if self.is_sprite() { 4 } else { 6 });
                let (framed, delays, kind) = self.animation_pictures(a, o, 16, 64, 80)?;
                self.write(&u, &image_files::gif(&framed, &delays, true)?)?;
                Ok(ToolOutput::new(obj(json!({"saved": u, "frames": framed.len(), "kind": kind}))))
            }

            "export_svg" => {
                let u = self.url(a, Some("svg"))?;
                // 2D sprites: one SVG unit per sprite pixel. 3D: the rendered picture's pixels.
                let o = self.render_options(a, if self.is_sprite() { 1 } else { 4 });
                let pic = render::render(&self.doc, self.frame_index(a)?, &o)?;
                let zoom = a.int_or("zoom", if self.is_sprite() { 8 } else { 2 }).max(1);
                self.write(&u, web_files::svg(&pic, zoom, None).as_bytes())?;
                let (w, h) = (pic.width as i64, pic.height as i64);
                Ok(ToolOutput::new(obj(json!({"saved": u, "width": w.saturating_mul(zoom), "height": h.saturating_mul(zoom), "pixels": [w, h]}))))
            }

            "export_html" => {
                let u = self.url(a, Some("html"))?;
                let o = self.render_options(a, if self.is_sprite() { 1 } else { 4 });
                let (framed, delays, kind) = self.animation_pictures(a, o, 8, 32, 150)?;
                let zoom = a.int_or("zoom", if self.is_sprite() { 8 } else { 2 }).max(1);
                self.write(&u, web_files::html(&self.doc.name, &framed, &delays, zoom).as_bytes())?;
                Ok(ToolOutput::new(obj(json!({"saved": u, "frames": framed.len(), "kind": kind}))))
            }

            "export_vox" => {
                let u = self.url(a, Some("vox"))?;
                self.write(&u, &vox_file::encode(&self.doc, self.frame_index(a)?)?)?;
                Ok(ToolOutput::new(obj(json!({"saved": u}))))
            }

            "export_obj" => {
                let u = self.url(a, Some("obj"))?;
                let mtl = paths::append_extension(paths::without_extension(&u), "mtl");
                let (obj_text, m) = obj_file::encode(&self.doc, self.frame_index(a)?, paths::file_name(&mtl));
                self.write(&u, obj_text.as_bytes())?;
                self.write(&mtl, m.as_bytes())?;
                Ok(ToolOutput::new(obj(json!({"saved": u, "materials": mtl}))))
            }

            "ui_state" => Ok(ToolOutput::new(self.ui_state(a.bool("onion", false)))),

            "ui_activity" => {
                let from = self.activity.len().saturating_sub(30);
                Ok(ToolOutput::new(obj(json!({"activity": &self.activity[from..]}))))
            }

            _ => {
                if let Some(h) = self.host_tools.get(name) {
                    return h(a.d);
                }
                if name == "get_editor_screenshot" {
                    return Err(PcError::invalid("the OpenPixel window is not open; use render_view or review_model instead"));
                }
                Err(PcError::invalid(format!("unknown tool {name}")))
            }
        }
    }

    /// The analyze_model report for a frame, with the style's notes.
    fn analysis_report(&self, frame: usize) -> JsonMap {
        let mut json = analysis::analyze(&self.doc, frame, self.style.as_ref());
        if let Some(s) = &self.style {
            if !s.notes.is_empty() {
                json.insert("style_notes".into(), json!(s.notes));
            }
        }
        json
    }

    /// The pictures of export_gif and export_html: the animation frames or a turntable spin, all on one canvas
    /// size, with their delays and the kind used.
    fn animation_pictures(
        &self,
        a: &Args,
        mut o: RenderOptions,
        default_steps: i64,
        max_steps: i64,
        step_delay: i64,
    ) -> Result<(Vec<Picture>, Vec<i64>, String), PcError> {
        let doc = &self.doc;
        let default_kind = if doc.frames.len() > 1 || self.is_sprite() { "animation" } else { "turntable" };
        let kind = a.string("kind").unwrap_or(default_kind).to_string();
        let (mut pics, mut delays): (Vec<Picture>, Vec<i64>) = (Vec::new(), Vec::new());
        if kind == "turntable" {
            let steps = a.int_or("steps", default_steps).min(max_steps).max(2);
            for k in 0..steps {
                o.yaw = 45.0 + 360.0 * k as f64 / steps as f64;
                pics.push(render::render(doc, self.active_frame, &o)?);
                delays.push(step_delay);
            }
        } else {
            for f in 0..doc.frames.len() {
                pics.push(render::render(doc, f, &o)?);
                delays.push(doc.frames[f].duration);
            }
        }
        // Same canvas size for every frame.
        let w = pics.iter().map(|p| p.width as i64).max().unwrap_or(1);
        let h = pics.iter().map(|p| p.height as i64).max().unwrap_or(1);
        let mut framed = Vec::with_capacity(pics.len());
        for p in &pics {
            let mut c = Picture::new(w, h, o.background)?;
            c.blit(p, (w - p.width as i64) / 2, (h - p.height as i64) / 2);
            framed.push(c);
        }
        Ok((framed, delays, kind))
    }

    // MARK: - bigger tools

    fn paint_slice(&mut self, a: &Args) -> Result<ToolOutput, PcError> {
        let axis = a.string("axis").unwrap_or("z");
        let start = a.int_or("index", 0);
        let texts = |v: &Vec<Json>| -> Vec<Vec<char>> { v.iter().filter_map(|r| r.as_str().map(|s| s.chars().collect())).collect() };
        let mut slices: Vec<Vec<Vec<char>>> = Vec::new();
        if let Some(s) = a.array("slices") {
            slices = s.iter().filter_map(|v| v.as_array().map(texts)).collect();
        }
        if let Some(r) = a.array("rows") {
            slices.insert(0, texts(r));
        }
        if slices.is_empty() {
            return Err(PcError::invalid("give rows (one slice) or slices (several)"));
        }
        let depth = a.int_or("depth", 1).max(1);
        let merge = a.string("mode") == Some("merge");
        let off: Vec<i64> = a.array("offset").map(|l| l.iter().filter_map(|v| Args::number(Some(v))).map(trunc).collect()).unwrap_or_default();
        let (oc, or) = (off.first().copied().unwrap_or(0), off.get(1).copied().unwrap_or(0));
        let (l, f) = (self.editable_layer(a)?, self.frame_index(a)?);
        self.edit(&format!("Paint {axis} slice"), |_, d| {
            // Legend colours join the palette in the order of their characters. (Swift walked its dictionary
            // in no particular order.)
            let mut legend: Vec<(char, u8)> = Vec::new();
            if let Some(lg) = a.get("legend").and_then(Json::as_object) {
                let mut keys: Vec<&String> = lg.keys().collect();
                keys.sort();
                for k in keys {
                    if let Some(ch) = k.chars().next() {
                        let v = Engine::color(lg.get(k), d)?;
                        match legend.iter_mut().find(|(c, _)| *c == ch) {
                            Some(entry) => entry.1 = v,
                            None => legend.push((ch, v)),
                        }
                    }
                }
            }
            let (cols, rows, depth_max) = d.slice_size(axis);
            let mut n = 0i64;
            let mut unknown: BTreeSet<char> = BTreeSet::new();
            let mut clipped = false;
            let mut grid = d.cels[l][f].data().to_vec();
            for (si, slice) in slices.iter().enumerate() {
                // Slice positions this text covers: first..first+depth, kept to the model.
                let first = start.saturating_add((si as i64).saturating_mul(depth));
                let (lo, hi) = (first.max(0), first.saturating_add(depth).min(depth_max));
                if first < 0 || first.saturating_add(depth) > depth_max {
                    clipped = true;
                }
                for k in lo..hi {
                    if !merge {
                        // Replace mode clears the slice region the text covers.
                        for (ri, row) in slice.iter().enumerate() {
                            for ci in 0..row.len() {
                                let (c, r) = (ci as i64 + oc, ri as i64 + or);
                                if !(c >= 0 && r >= 0 && c < cols && r < rows) {
                                    continue;
                                }
                                let (x, y, z) = d.slice_cell(axis, k, c, r);
                                grid[d.index(x, y, z)] = 0;
                            }
                        }
                    }
                    for (ri, row) in slice.iter().enumerate() {
                        for (ci, &ch) in row.iter().enumerate() {
                            if ch == '.' || ch == ' ' {
                                continue;
                            }
                            let (c, r) = (ci as i64 + oc, ri as i64 + or);
                            if !(c >= 0 && r >= 0 && c < cols && r < rows) {
                                clipped = true;
                                continue;
                            }
                            let mut v: Option<u8> = legend.iter().find(|(k, _)| *k == ch).map(|(_, v)| *v);
                            if v.is_none() {
                                if let Some(i) = SLOTS.iter().position(|&s| s as char == ch) {
                                    if i + 1 < d.palette.len() {
                                        v = Some(i as u8 + 1);
                                    }
                                }
                            }
                            let Some(color) = v else {
                                unknown.insert(ch);
                                continue;
                            };
                            let (x, y, z) = d.slice_cell(axis, k, c, r);
                            let i = d.index(x, y, z);
                            if grid[i] != color {
                                grid[i] = color;
                                n += 1;
                            }
                        }
                    }
                }
            }
            d.cels[l][f] = Grid::from_data(grid);
            let mut res = obj(json!({"changed": n, "axis": axis, "slice_size": {"columns": cols, "rows": rows}}));
            let mut warn: Vec<String> = Vec::new();
            if !unknown.is_empty() {
                warn.push(format!("characters with no colour (add them to legend): {}", unknown.iter().collect::<String>()));
            }
            if clipped {
                warn.push("some text fell outside the model and was skipped".into());
            }
            for (si, slice) in slices.iter().enumerate() {
                let lengths: BTreeSet<usize> = slice.iter().map(|r| r.len()).collect();
                if let (false, true, Some(lo), Some(hi)) = (merge, lengths.len() > 1, lengths.first(), lengths.last()) {
                    warn.push(format!("slice {si}: rows have different lengths ({lo}-{hi} characters), so columns may be misaligned; pad rows with '.' to the same width"));
                }
            }
            if !warn.is_empty() {
                res.insert("warnings".into(), json!(warn));
            }
            Ok(res)
        })
    }

    fn get_slice(&self, a: &Args) -> Result<ToolOutput, PcError> {
        let axis = a.string("axis").unwrap_or("z");
        let f = self.frame_index(a)?;
        let doc = &self.doc;
        let g: Vec<u8> =
            if a.bool("merged", true) && !a.has("layer") { doc.composite(f) } else { doc.cels[self.layer_index(a)?][f].data().to_vec() };
        let (cols, rows, depth) = doc.slice_size(axis);
        let k = a.int_or("index", 0);
        if !(k >= 0 && k < depth) {
            return Err(PcError::invalid(format!("index must be 0-{} for axis {}", depth - 1, axis)));
        }
        let mut legend = JsonMap::new();
        let mut extra = 0usize;
        let mut custom: Vec<(u8, char)> = Vec::new();
        let mut lines: Vec<String> = Vec::new();
        for r in 0..rows {
            let mut line = String::new();
            for c in 0..cols {
                let (x, y, z) = doc.slice_cell(axis, k, c, r);
                let v = g[doc.index(x, y, z)];
                if v == 0 {
                    line.push('.');
                    continue;
                }
                let ch = if v as usize <= SLOTS.len() {
                    SLOTS[v as usize - 1] as char
                } else if let Some((_, cch)) = custom.iter().find(|(cv, _)| *cv == v) {
                    *cch
                } else {
                    let ch = if extra < EXTRA_SLOTS.len() { EXTRA_SLOTS[extra] as char } else { '#' };
                    extra += 1;
                    custom.push((v, ch));
                    ch
                };
                legend.insert(ch.to_string(), json!({"index": v, "hex": doc.color(v).hex()}));
                line.push(ch);
            }
            lines.push(line);
        }
        let layout = match axis {
            "y" => format!("top view of y={}: columns x=0→{}, rows z=0 (back) → {} (front)", k, cols - 1, rows - 1),
            "x" => format!("side view of x={}: columns z=0 (back) → {} (front), rows y={} (top) → 0", k, cols - 1, rows - 1),
            _ => format!("front view of z={}: columns x=0→{}, rows y={} (top) → 0", k, cols - 1, rows - 1),
        };
        Ok(ToolOutput::new(obj(json!({"axis": axis, "index": k, "layout": layout, "rows": lines, "legend": legend}))))
    }

    fn import_image(&mut self, a: &Args) -> Result<ToolOutput, PcError> {
        let u = self.file_path(a.req_string("path")?);
        let pic = image_files::read(self.io.as_ref(), &u)?;
        let axis = a.string("axis").unwrap_or("z");
        let (start, depth) = (a.int_or("index", 0), a.int_or("depth", 1).max(1));
        let (l, f) = (self.editable_layer(a)?, self.frame_index(a)?);
        let (pw, ph) = (pic.width as i64, pic.height as i64);
        self.edit(&format!("Import {}", paths::file_name(&u)), |_, d| {
            let (mut cols, mut rows, mut dmax) = d.slice_size(axis);
            if (pw > cols || ph > rows || start + depth > dmax) && a.bool("grow", true) {
                let need = (cols.max(pw).min(256), rows.max(ph).min(256), dmax.max(start + depth).min(256));
                match axis {
                    "y" => d.resize(need.0, need.2, need.1, "origin")?,
                    "x" => d.resize(need.2, need.1, need.0, "origin")?,
                    _ => d.resize(need.0, need.1, need.2, "origin")?,
                }
                (cols, rows, dmax) = d.slice_size(axis);
            }
            let mut cache: HashMap<Rgba, u8> = HashMap::new();
            let mut n = 0i64;
            // Slice positions start..end; those outside the model are counted but hold nothing.
            let end = (start + depth).min(dmax);
            let per_pixel = (end - start).max(0);
            let mut grid = d.cels[l][f].data().to_vec();
            for py in 0..ph.min(rows) {
                for px in 0..pw.min(cols) {
                    let c = pic.pixel((py * pw + px) as usize);
                    if c.a < 128 {
                        continue;
                    }
                    let key = Rgba::rgb(c.r, c.g, c.b);
                    let v = match cache.get(&key) {
                        Some(v) => *v,
                        None => {
                            let v = if a.bool("add_colors", false) { Engine::add_color(key, d) } else { Engine::nearest(key, &d.palette) };
                            cache.insert(key, v);
                            v
                        }
                    };
                    for k in start.max(0)..end {
                        let (x, y, z) = d.slice_cell(axis, k, px, py);
                        if d.in_bounds(x, y, z) {
                            grid[d.index(x, y, z)] = v;
                        }
                    }
                    n = n.saturating_add(per_pixel);
                }
            }
            d.cels[l][f] = Grid::from_data(grid);
            Ok(obj(json!({"changed": n, "picture": [pw, ph], "size": [d.sx(), d.sy(), d.sz()]})))
        })
    }

    fn export_sheet(&mut self, a: &Args) -> Result<ToolOutput, PcError> {
        let u = self.url(a, Some("png"))?;
        let doc = &self.doc;
        let mut views: Vec<&str> = a.array("views").map(|l| l.iter().filter_map(Json::as_str).collect()).unwrap_or_default();
        let pitch = a.double("pitch").unwrap_or(30.0);
        let mut angles: Vec<(String, f64, f64)> = Vec::new();
        if views.is_empty() {
            views = vec![if self.is_sprite() { "front" } else { "turnaround8" }];
        }
        let durations: Vec<i64> = doc.frames.iter().map(|f| f.duration).collect();
        if self.is_sprite() && views == ["front"] {
            // Classic sprite strip: one row, one cell per animation frame, real pixels.
            let scale_args = obj(json!({"scale": a.int("scale").unwrap_or(1)}));
            let o = self.render_options(&Args::new(&scale_args), 1);
            let mut pics: Vec<Picture> = Vec::new();
            for f in 0..doc.frames.len() {
                pics.push(render::render(doc, f, &o)?);
            }
            let mut sheet =
                Picture::clear(pics.iter().map(|p| p.width as i64).sum(), pics.iter().map(|p| p.height as i64).max().unwrap_or(1))?;
            let mut x = 0i64;
            for p in &pics {
                sheet.blit(p, x, 0);
                x += p.width as i64;
            }
            self.write(&u, &image_files::png(&sheet))?;
            return Ok(ToolOutput::new(obj(json!({
                "saved": u, "cell_width": pics.first().map_or(0, |p| p.width), "cell_height": pics.first().map_or(0, |p| p.height),
                "columns": doc.frames.len(), "rows": 1, "frame_durations_ms": durations,
            }))));
        }
        for v in views {
            if v == "turnaround8" || v == "turnaround4" {
                let n = if v == "turnaround8" { 8 } else { 4 };
                for k in 0..n {
                    let yaw = 45.0 * (k * 8 / n) as f64;
                    angles.push((format!("yaw {}", yaw as i64), yaw, pitch));
                }
            } else if let Some(ang) = view_preset::angles(v) {
                angles.push((v.to_string(), ang.0, ang.1));
            } else {
                return Err(PcError::invalid(format!("unknown view {v}")));
            }
        }
        let mut o = RenderOptions { scale: a.int_or("scale", 4).max(1), ..RenderOptions::default() };
        let mut pics: Vec<Picture> = Vec::new();
        for f in 0..doc.frames.len() {
            for (_, y, p) in &angles {
                o.yaw = *y;
                o.pitch = *p;
                pics.push(render::render(doc, f, &o)?);
            }
        }
        // Uniform cells so game engines can slice the sheet by a fixed size.
        let cw = pics.iter().map(|p| p.width as i64).max().unwrap_or(1);
        let ch = pics.iter().map(|p| p.height as i64).max().unwrap_or(1);
        let count = angles.len() as i64;
        let mut sheet = Picture::clear(cw.saturating_mul(count), ch.saturating_mul(doc.frames.len() as i64))?;
        for (i, p) in pics.iter().enumerate() {
            let i = i as i64;
            sheet.blit(p, (i % count) * cw + (cw - p.width as i64) / 2, (i / count) * ch + (ch - p.height as i64) / 2);
        }
        self.write(&u, &image_files::png(&sheet))?;
        Ok(ToolOutput::new(obj(json!({
            "saved": u, "cell_width": cw, "cell_height": ch, "columns": angles.iter().map(|a| a.0.as_str()).collect::<Vec<_>>(),
            "rows": doc.frames.len(), "frame_durations_ms": durations,
        }))))
    }

    /// Compact state for the HTML canvas: merged grid of the active frame (+ active layer, onion frames).
    fn ui_state(&self, onion: bool) -> JsonMap {
        let b64 = |g: &[u8]| base64::engine::general_purpose::STANDARD.encode(g);
        let doc = &self.doc;
        let mut s = self.info();
        s.insert(
            "palette".into(),
            json!(doc.palette.iter().map(|c| if c.a == 0 { "transparent".to_string() } else { c.hex() }).collect::<Vec<_>>()),
        );
        s.insert("composite".into(), json!(b64(&doc.composite(self.active_frame))));
        s.insert("active_cel".into(), json!(b64(doc.cels[self.active_layer][self.active_frame].data())));
        s.insert(
            "cels_filled".into(),
            json!(doc.cels.iter().map(|row| row.iter().map(|c| !c.is_empty()).collect::<Vec<_>>()).collect::<Vec<_>>()),
        );
        if onion && doc.frames.len() > 1 {
            // Onion skin: 1 frame each side, opacity 68 (then 28 less per further frame).
            let mut o: Vec<Json> = Vec::new();
            for df in [-1i64, 1] {
                let f = self.active_frame as i64 + df;
                if f >= 0 && f < doc.frames.len() as i64 {
                    o.push(json!({"frame": f, "opacity": 68, "data": b64(&doc.composite(f as usize))}));
                }
            }
            s.insert("onion".into(), json!(o));
        }
        s
    }
}
