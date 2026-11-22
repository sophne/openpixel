//! The tool catalogue: what agents see in MCP `tools/list`.
use std::sync::OnceLock;

use serde_json::json;

use crate::craft;
use crate::observe::text_view;
use crate::style::StyleLock;
use crate::{Json, JsonMap};

/// One tool as agents see it (MCP `tools/list`) and as the editor calls it.
pub struct ToolSpec {
    pub name: &'static str,
    pub description: String,
    pub properties: JsonMap,
    pub required: Vec<&'static str>,
    pub read_only: bool,
    /// Hidden tools are used by the editor only and never listed to agents.
    pub hidden: bool,
}

impl ToolSpec {
    pub fn input_schema(&self) -> JsonMap {
        let mut o = JsonMap::new();
        o.insert("type".into(), json!("object"));
        o.insert("properties".into(), Json::Object(self.properties.clone()));
        o.insert("required".into(), json!(self.required));
        o.insert("additionalProperties".into(), json!(false));
        o
    }

    pub fn mcp_json(&self) -> JsonMap {
        let mut o = JsonMap::new();
        o.insert("name".into(), json!(self.name));
        o.insert("description".into(), json!(self.description));
        o.insert("inputSchema".into(), Json::Object(self.input_schema()));
        o.insert("annotations".into(), json!({"readOnlyHint": self.read_only, "destructiveHint": false, "openWorldHint": false}));
        o
    }
}

/// The conventions every tool shares; part of the instructions agents read (`\(ToolCatalog.conventions)` there).
pub const CONVENTIONS: &str = "A model is a voxel grid; a 2D sprite is a model 1 voxel deep (new_sprite). \
3D coordinates: x grows to the right, y grows UP (y=0 is the ground), z grows toward the FRONT (the viewer). \
2D tools (set_pixels, paint_slice on axis z) use image rows instead: row 0 is the TOP. \
Cells run from 0 to size-1 on each axis. Palette index 0 means empty. \
Colours can be palette indexes or hex strings.";

/// Schema helpers.
mod s {
    use super::*;

    pub fn int(d: &str) -> Json {
        json!({"type": "integer", "description": d})
    }
    pub fn num(d: &str) -> Json {
        json!({"type": "number", "description": d})
    }
    pub fn str(d: &str) -> Json {
        json!({"type": "string", "description": d})
    }
    pub fn bool(d: &str) -> Json {
        json!({"type": "boolean", "description": d})
    }
    pub fn one_of(values: &[&str], d: &str) -> Json {
        json!({"type": "string", "enum": values, "description": d})
    }
    pub fn point(d: &str) -> Json {
        json!({"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": format!("{d} as [x, y, z]")})
    }
    pub fn color() -> Json {
        json!({
            "type": ["integer", "string"],
            "description": "Palette index (1-255) or hex colour like \"#d95763\" (added to the palette if new).",
        })
    }
    pub fn color_list(d: &str) -> Json {
        json!({"type": "array", "items": {"type": ["integer", "string"]}, "description": d})
    }
    pub fn path() -> Json {
        str("Absolute file path.")
    }

    pub fn props(items: Vec<(&str, Json)>) -> JsonMap {
        items.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    /// Where an edit goes; every drawing tool accepts these.
    pub fn target() -> JsonMap {
        props(vec![
            ("layer", json!({"type": ["integer", "string"], "description": "Layer index or name (default: the active layer)."})),
            ("frame", int("Frame index from 0 (default: the active frame).")),
        ])
    }
    pub fn pen() -> JsonMap {
        merge(
            target(),
            vec![
                (
                    "mode",
                    one_of(
                        &["replace", "paint", "add", "erase"],
                        "replace (default) overwrites; paint only recolours existing voxels; add only fills empty cells; erase removes.",
                    ),
                ),
                ("symmetry", str("Mirror the edit across the model centre on these axes, e.g. \"x\" or \"xz\".")),
            ],
        )
    }

    /// `a` plus the entries of `b` it does not have yet.
    pub fn merge(mut a: JsonMap, b: Vec<(&str, Json)>) -> JsonMap {
        for (k, v) in b {
            if !a.contains_key(k) {
                a.insert(k.to_string(), v);
            }
        }
        a
    }
}

fn t(name: &'static str, desc: impl Into<String>, props: JsonMap, required: &[&'static str], read_only: bool, hidden: bool) -> ToolSpec {
    ToolSpec { name, description: desc.into(), properties: props, required: required.to_vec(), read_only, hidden }
}

const PALETTE_PRESETS: &str = "Palette preset: db32 (default), db16, pico8, edg32, grayscale, or none (one colour, black; colours you use are added).";

fn build() -> Vec<ToolSpec> {
    use s::{bool, color, color_list, int, merge, num, one_of, path, pen, point, props, str, target};
    let none = JsonMap::new;
    let axes = ["x", "y", "z"];
    vec![
        // 2D sprites
        t("new_sprite", "Start a new 2D pixel-art sprite (a canvas 1 voxel deep) (default 32×32). Draw with paint_slice (rows of text) or set_pixels; export_png saves it pixel for pixel.",
          props(vec![("width", int("Width in pixels, 1-256 (default 32).")), ("height", int("Height in pixels, 1-256 (default 32).")),
                     ("name", str("Sprite name.")), ("palette", str(PALETTE_PRESETS))]), &[], false, false),
        t("set_pixels", "Draw pixels on a 2D sprite (or the front slice z=depth of a model). Each item is [x, y] (uses `color`) or [x, y, color]; y counts from the TOP row like an image.",
          merge(pen(), vec![("pixels", json!({"type": "array", "items": {"type": "array"}, "description": "List of [x,y] or [x,y,color]."})),
                            ("color", color()), ("depth", int("Which z slice of a 3D model (default 0)."))]), &["pixels"], false, false),
        t("extrude_to_3d", "Turn a 2D sprite into a 3D voxel model by repeating it `depth` voxels deep (then reshape it with the 3D tools).",
          props(vec![("depth", int("Depth in voxels, 1-256.")), ("from_slice", int("Which z slice to extrude (default 0)."))]), &["depth"], false, false),

        // Model
        t("new_model", format!("Start a new empty voxel model (replaces the open one; undo brings it back). {CONVENTIONS}"),
          props(vec![("size_x", int("Width (x), 1-256, default 32.")), ("size_y", int("Height (y, up), 1-256, default 32.")),
                     ("size_z", int("Depth (z, toward front), 1-256, default 32.")), ("name", str("Model name.")),
                     ("palette", str(PALETTE_PRESETS))]), &[], false, false),
        t("get_model_info", "Size, palette size, layers, frames, active layer/frame, voxel count, file path and undo depth. Call this first.",
          none(), &[], true, false),
        t("open_model", "Open a .openpixel or MagicaVoxel .vox file.", props(vec![("path", path())]), &["path"], false, false),
        t("save_model", "Save as .openpixel (JSON). Without a path, saves to the file it was opened from.",
          props(vec![("path", path())]), &[], false, false),
        t("resize_model", "Change the model space size. Content stays on the ground and centred (anchor bottom-center) or keeps its coordinates (anchor origin).",
          props(vec![("size_x", int("New width.")), ("size_y", int("New height.")), ("size_z", int("New depth.")),
                     ("anchor", one_of(&["bottom-center", "origin"], "Where existing voxels stay."))]),
          &["size_x", "size_y", "size_z"], false, false),

        // Palette
        t("get_palette", "List palette colours with their indexes (index 0 is empty).", none(), &[], true, false),
        t("set_palette", "Replace the palette with a preset or a list of hex colours. Voxels keep their indexes.",
          props(vec![("preset", str("db32, db16, pico8, edg32 or grayscale.")), ("colors", color_list("Hex colours; first becomes index 1."))]), &[], false, false),
        t("set_palette_color", "Change one palette entry (every voxel using it changes colour).",
          props(vec![("index", int("1-255.")), ("color", str("Hex colour."))]), &["index", "color"], false, false),
        t("add_colors", "Add hex colours to the palette (existing ones are reused) and return their indexes.",
          props(vec![("colors", color_list("Hex colours."))]), &["colors"], false, false),
        t("make_color_ramp", "Add a hue-shifted shading ramp (darkest first) to the palette and return the indexes. Give `base` (the material's middle colour): shadows turn cooler and more saturated, highlights warmer and paler, as in hand-made pixel-art palettes. Or give `from` and `to` to blend between two colours.",
          props(vec![("base", str("Middle colour of the material, e.g. \"#c0503c\" for red cloth (recommended).")),
                     ("from", str("Darkest hex colour (instead of base).")), ("to", str("Lightest hex colour (instead of base).")),
                     ("steps", int("Number of colours, 2-16 (default 5 with base, 4 with from/to). 3-5 suits most sprites.")),
                     ("hue_shift", num("Degrees of hue shift per step away from the base (default 12; 0 = none)."))]), &[], false, false),

        // Layers and frames
        t("add_layer", "Add a layer above the active one and make it active.", props(vec![("name", str("Layer name."))]), &[], false, false),
        t("delete_layer", "Delete a layer.", target(), &[], false, false),
        t("set_layer", "Rename, show/hide or lock a layer.",
          merge(target(), vec![("name", str("New name.")), ("visible", bool("Shown in renders and the canvas.")),
                               ("locked", bool("Locked layers refuse edits."))]), &[], false, false),
        t("duplicate_layer", "Copy a layer with all its frames and put the copy above it.", target(), &[], false, false),
        t("move_layer", "Move a layer in the stack, with all its frames. Index 0 is at the back; the last layer is in front.",
          merge(target(), vec![("to", int("Its new index: 0 (back) to layer count - 1 (front)."))]), &["to"], false, false),
        t("merge_layer_down", "Merge a layer into the one below (upper voxels win).", target(), &[], false, false),
        t("set_active", "Choose the active layer and/or frame used when tools are called without layer/frame.", target(), &[], false, false),
        t("add_frame", "Add an animation frame after a frame (a copy of it by default) and make it active.",
          props(vec![("after", int("Frame index (default: active).")), ("copy", bool("Copy the voxels (default true)."))]), &[], false, false),
        t("delete_frame", "Delete an animation frame.", props(vec![("frame", int("Frame index."))]), &[], false, false),
        t("set_frame_duration", "Set how long a frame shows, in milliseconds (default for new frames: 100).",
          props(vec![("frame", int("Frame index (default: active).")), ("duration_ms", int("Milliseconds.")),
                     ("all_frames", bool("Apply to every frame."))]), &["duration_ms"], false, false),

        // Drawing
        t("set_voxels", "Place voxels. Each item is [x, y, z] (uses `color`) or [x, y, z, color]. Best for small details; use shapes or paint_slice for bulk.",
          merge(pen(), vec![("voxels", json!({"type": "array", "items": {"type": "array"}, "description": "List of [x,y,z] or [x,y,z,color]."})),
                            ("color", color())]), &["voxels"], false, false),
        t("erase_voxels", "Remove voxels at the listed [x, y, z] cells.",
          merge(target(), vec![("voxels", json!({"type": "array", "items": {"type": "array"}, "description": "List of [x,y,z]."})),
                               ("symmetry", str("Mirror axes, e.g. \"x\"."))]), &["voxels"], false, false),
        t("fill_box", "Fill a box between two corners (inclusive).",
          merge(pen(), vec![("from", point("One corner")), ("to", point("The opposite corner")), ("color", color()),
                            ("hollow", bool("Only the shell."))]), &["from", "to"], false, false),
        t("draw_sphere", "Fill a sphere or ellipsoid.",
          merge(pen(), vec![("center", point("Centre (may be .5 to centre between cells)")),
                            ("radius", json!({"type": ["number", "array"], "description": "Radius, or [rx, ry, rz] for an ellipsoid."})),
                            ("color", color()), ("hollow", bool("Only the shell."))]), &["center", "radius"], false, false),
        t("draw_cylinder", "Fill a cylinder standing along an axis from a base centre.",
          merge(pen(), vec![("base", point("Centre of the base")), ("radius", num("Radius.")), ("length", int("Length along the axis.")),
                            ("axis", one_of(&axes, "Axis (default y = upright).")), ("color", color()),
                            ("hollow", bool("Only the wall and caps."))]), &["base", "radius", "length"], false, false),
        t("draw_line", "Draw a straight 3D line, optionally thick.",
          merge(pen(), vec![("from", point("Start")), ("to", point("End")), ("color", color()),
                            ("radius", int("Thickness radius (0 = one voxel)."))]), &["from", "to"], false, false),
        t("flood_fill", "Bucket fill: recolour the connected region of the same colour as the start cell. On an empty start cell the fill stays in that horizontal slice unless volume is true.",
          merge(pen(), vec![("at", point("Start cell")), ("color", color()), ("volume", bool("Fill empty space in 3D."))]),
          &["at"], false, false),
        t("paint_slice", "Draw a 2D slice with text rows, like pixel art: the fastest way to build models. \
axis \"z\": a front view (columns = x left→right, rows = y top→bottom) at depth z=index. \
axis \"y\": a top view of the horizontal layer y=index (columns = x, rows = z back→front). \
axis \"x\": a side view at x=index (columns = z back→front, rows = y top→bottom). \
'.' or ' ' is empty. Without a legend, characters 1-9 and a-z mean palette indexes 1-35. \
depth repeats the slice over index..index+depth-1 (extrude). slices draws several consecutive slices at once.",
          merge(target(), vec![
            ("axis", one_of(&axes, "Slice axis (default z, a front view).")),
            ("index", int("Slice position along the axis (default 0).")),
            ("rows", json!({"type": "array", "items": {"type": "string"}, "description": "Text rows, top row first."})),
            ("slices", json!({"type": "array", "items": {"type": "array", "items": {"type": "string"}},
                              "description": "Several slices (each a list of rows) for index, index+1, ..."})),
            ("legend", json!({"type": "object", "additionalProperties": {"type": ["integer", "string"]},
                              "description": "Map of character to colour, e.g. {\"R\": \"#ac3232\", \"w\": 22}."})),
            ("depth", int("Extrude the slice this many cells along the axis (default 1).")),
            ("mode", one_of(&["replace", "merge"], "replace (default): '.' clears the cell; merge: '.' leaves it as it is.")),
            ("offset", json!({"type": "array", "items": {"type": "integer"}, "description": "[column, row] where the text starts (default [0,0])."})),
          ]), &[], false, false),
        t("replace_color", "Replace one colour with another.",
          merge(target(), vec![("from", color()), ("to", color()), ("all_layers", bool("Every layer.")),
                               ("all_frames", bool("Every frame."))]), &["from", "to"], false, false),
        t("apply_gradient", "Recolour existing voxels along an axis with a list of colours (low end first), e.g. darker at the bottom. Good for shading.",
          merge(target(), vec![("axis", one_of(&axes, "Axis (default y).")), ("colors", color_list("Colours from low to high.")),
                               ("only_color", color())]), &["colors"], false, false),
        t("transform", "Move, flip, rotate or mirror a layer's voxels. move: dx/dy/dz; flip: axis; rotate: axis + turns (quarter turns, counter-clockwise seen from the + end of the axis); mirror: copy one half onto the other (keep low or high side).",
          merge(target(), vec![("op", one_of(&["move", "flip", "rotate", "mirror"], "Operation.")),
                               ("dx", int("Move x.")), ("dy", int("Move y.")), ("dz", int("Move z.")),
                               ("wrap", bool("Wrap around when moving.")), ("axis", one_of(&axes, "Axis.")),
                               ("turns", int("Quarter turns for rotate.")),
                               ("keep", one_of(&["low", "high"], "For mirror: low keeps left/bottom/back.")),
                               ("all_layers", bool("Apply to every layer.")), ("all_frames", bool("Apply to every frame."))]),
          &["op"], false, false),
        t("clear", "Remove every voxel of a layer in a frame.", target(), &[], false, false),
        t("import_image", "Turn a 2D picture (a PNG from any pixel-art editor) into voxels on a slice, optionally extruded. Colours snap to the palette, or are added with add_colors=true.",
          merge(target(), vec![("path", path()), ("axis", one_of(&axes, "Slice axis (default z, a front view).")),
                               ("index", int("Slice position (default 0).")), ("depth", int("Extrude depth (default 1).")),
                               ("add_colors", bool("Add the picture's exact colours to the palette instead of snapping.")),
                               ("grow", bool("Enlarge the model when the picture is bigger (default true)."))]),
          &["path"], false, false),

        // Review
        t("get_voxel", "What is at one cell: colour and which layer it comes from.",
          props(vec![("at", point("Cell")), ("frame", int("Frame (default active)."))]), &["at"], true, false),
        t("get_slice", "Read a 2D slice as text rows with a legend (same layout as paint_slice). The precise way to check a model.",
          merge(target(), vec![("axis", one_of(&axes, "Slice axis (default z).")), ("index", int("Slice position.")),
                               ("merged", bool("Read all visible layers merged (default true); false reads only the layer."))]),
          &[], true, false),
        t("find_voxels", "List filled cells, optionally of one colour or inside a box (at most `limit`).",
          merge(target(), vec![("color", color()), ("from", point("Box corner")), ("to", point("Opposite corner")),
                               ("limit", int("Most cells to return (default 500)."))]), &[], true, false),
        t("analyze_model", "Review checks: voxel count, bounds, colours used, floating parts, stray voxels, left/right symmetry, edge contact, animation consistency (identical frames, volume jumps, ground-line jitter), and for 2D sprites pixel-art checks (colour count, near-identical colours, doubled line corners, stray pixels, outline, light direction, pillow shading), plus the style lock. Returns issues to fix, style tips, and a score (0-100) with the deduction behind each point lost.",
          props(vec![("frame", int("Frame (default active)."))]), &[], true, false),
        t("render_view", "Render the model to a crisp pixel-art picture and return it. A 2D sprite renders flat at its exact colours by default. Views: iso (2:1 pixel-art isometric), iso-front-left, iso-back-right, iso-back-left, front, back, left, right, top, bottom; or give yaw/pitch in degrees.",
          props(vec![("view", str("View name (default iso).")), ("yaw", num("Degrees around the up axis (0 = front).")),
                     ("pitch", num("Degrees looking down (30 = 2:1 isometric).")), ("scale", int("Pixels per voxel (default: auto).")),
                     ("frame", int("Frame (default active).")), ("outline", bool("Dark outline (default true).")),
                     ("edges", bool("Darken depth edges (default true).")), ("background", str("Hex background (default transparent)."))]),
          &[], true, false),
        t("review_model", "Review pictures plus the analyze_model report. 3D: 4 isometric angles plus front, right and top views. 2D sprite: enlarged with a pixel grid, grayscale values, silhouette, actual size on dark and light, and every animation frame. Use after each big change and fix the issues it lists.",
          props(vec![("frame", int("Frame (default active).")), ("scale", int("Pixels per voxel (default: auto)."))]), &[], true, false),
        t("view_as_text", "The canvas as text, for exact coordinates and form without pictures: `pixels` (the grid with x/row rulers and a legend), `values` (brightness 0-9, to check light and contrast), `silhouette` (# and .), and `diff` against another frame (onion skin: + added, - removed, * recoloured). 3D models are projected from a view (first voxel each ray meets). Shows the filled area plus a 1-cell margin unless you give a region.",
          props(vec![("view", one_of(&text_view::VIEWS, "3D projection (default front; a 2D sprite is always its image).")),
                     ("maps", json!({"type": "array", "items": {"type": "string", "enum": text_view::MAPS},
                                     "description": "Which maps (default pixels, values, silhouette). diff compares with the previous frame unless compare_frame is given."})),
                     ("frame", int("Frame (default active).")), ("compare_frame", int("Frame for the diff map.")),
                     ("region", json!({"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4,
                                       "description": "[col0, row0, col1, row1] in the view's own coordinates (for sprites: x and image row)."}))]),
          &[], true, false),
        t("set_style", "Lock a style for every sprite in a set: palette (preset or colours; default: the current palette), colour budget, light direction, outline, canvas size and notes. While the palette is locked, agent edits may only use locked colours (hex colours must match one; palette tools are refused), new canvases start with the style, and every review and critique checks it (category \"style\"). Drawn colours on the open canvas move to the closest locked colour (one undo step). Load or save a style file to share it across a pipeline. The person in the editor is not restricted.",
          props(vec![("name", str("Style name.")), ("preset", str("Palette preset: db32, db16, pico8, edg32, grayscale.")),
                     ("colors", color_list("Hex colours of the locked palette (instead of preset).")),
                     ("lock_palette", bool("Refuse colours outside the palette (default true).")),
                     ("max_colors", int("Most colours one sprite may use.")),
                     ("light", one_of(&StyleLock::LIGHTS, "Where the light comes from (none = flat-shaded style).")),
                     ("outline", one_of(&StyleLock::OUTLINES, "dark: a dark outline all round; none: no outline; any: not checked.")),
                     ("size", json!({"type": "array", "items": {"type": "integer"}, "description": "[width, height] for sprites, [x, y, z] for models."})),
                     ("notes", json!({"type": ["array", "string"], "items": {"type": "string"}, "description": "House rules, repeated with every review."})),
                     ("path", str("Load a style file (JSON) first; other arguments override it.")),
                     ("save_path", str("Write the resulting style to this JSON file.")),
                     ("clear", bool("Remove the style lock."))]), &[], false, false),
        t("get_style", "The style lock in force (set_style), or none.", none(), &[], true, false),
        t("check_for_updates", "Whether a newer OpenPixel is out, and whether your MCP connection runs an older version than the one installed (then reconnect the OpenPixel MCP server). Call it once at the start of a session. install=true shows the update dialog in the OpenPixel window for the person to confirm; nothing installs without them.",
          props(vec![("install", bool("Show the update dialog in the OpenPixel window when an update is available.")),
                     ("refresh", bool("Ask the feed again instead of using the answer from the last 10 minutes."))]), &[], false, false),
        t("set_feedback", "Turn the automatic critique on or off. When on (default), every editing call returns `critique`: the score (0-100), its change, and the findings that edit introduced, made worse or resolved.",
          props(vec![("auto_critique", bool("On or off."))]), &[], false, false),
        t("batch", "Run several tool calls in one request, in order: [{\"tool\": \"set_pixels\", \"args\": {...}}, ...]. Every call is checked before any runs; each stays its own undo step. Returns each call's result and one critique for the whole batch. atomic=true undoes the whole batch if a call fails.",
          props(vec![("calls", json!({"type": "array", "items": {"type": "object", "properties": {"tool": {"type": "string"}, "args": {"type": "object"}}, "required": ["tool"]},
                                      "description": "Up to 200 calls."})),
                     ("stop_on_error", bool("Stop at the first failing call (default true).")),
                     ("atomic", bool("If a call fails, roll back every change the batch made (default false)."))]),
          &["calls"], false, false),
        t("review_set", "Review several saved files together (.openpixel or .vox): one contact-sheet picture at a common scale, each file's score and top issues, and set checks: different sizes, light from different sides, palettes drifting apart, uneven outlines. Uses the style lock when one is set. The open canvas is not changed.",
          props(vec![("paths", json!({"type": "array", "items": {"type": "string"}, "description": "Up to 24 files."})),
                     ("frame", int("Frame to review in each file (default 0).")), ("scale", int("Pixels per voxel in the picture (default: auto)."))]),
          &["paths"], true, false),
        t("pixel_art_guide", "The pixel-art style guide: workflow, shape and line rules, colour and hue-shifted ramps, shading (light source, pillow shading, banding), outlines, cleanup, animation timing and voxel models. Read it before your first drawing.",
          props(vec![("topic", one_of(&craft::TOPICS, "Section (default all)."))]), &[], true, false),
        t("pixel_perfect", "Clean 1-pixel lines: remove doubled corner pixels (L-shaped steps) so diagonals and curves step cleanly, like a pixel-perfect pen. Box corners and filled areas are kept; each removed pixel takes the colour around it. Undo if it removed a wanted detail.",
          merge(target(), vec![("color", color()), ("depth", int("Which z slice of a 3D model (default 0).")),
                               ("all_frames", bool("Clean every frame."))]), &[], false, false),
        t("take_snapshot", "Remember the current model under a name, to compare later.", props(vec![("name", str("Snapshot name (default \"last\")."))]), &[], false, false),
        t("compare_snapshot", "Compare the model with a snapshot: counts of added, removed and recoloured voxels, examples, and a before/after picture.",
          props(vec![("name", str("Snapshot name (default \"last\").")), ("view", str("View for the pictures (default iso)."))]), &[], true, false),
        t("undo", "Undo the last edits.", props(vec![("steps", int("How many (default 1)."))]), &[], false, false),
        t("redo", "Redo undone edits.", props(vec![("steps", int("How many (default 1)."))]), &[], false, false),
        t("get_history", "The undo history labels, newest last.", none(), &[], true, false),

        // Export
        t("export_png", "Save a rendered view as PNG.",
          props(vec![("path", path()), ("view", str("View (default iso).")), ("yaw", num("Yaw.")), ("pitch", num("Pitch.")),
                     ("scale", int("Pixels per voxel (default 8).")), ("frame", int("Frame.")), ("outline", bool("Outline (default true).")),
                     ("background", str("Hex background (default transparent)."))]), &["path"], false, false),
        t("export_sheet", "Save a sprite sheet PNG: rows are animation frames, columns are views (default: 8 turnaround angles), ready for 2D games. Returns the cell layout.",
          props(vec![("path", path()), ("views", json!({"type": "array", "items": {"type": "string"}, "description": "View names, or [\"turnaround4\"] / [\"turnaround8\"]."})),
                     ("scale", int("Pixels per voxel (default 4).")), ("pitch", num("Pitch for turnaround views (default 30)."))]),
          &["path"], false, false),
        t("export_gif", "Save an animated GIF: the animation frames, or a turntable spin of the model.",
          props(vec![("path", path()), ("kind", one_of(&["animation", "turntable"], "Default: animation when there are several frames, else turntable.")),
                     ("view", str("View for animation (default iso).")), ("scale", int("Pixels per voxel (default 6).")),
                     ("steps", int("Turntable steps (default 16)."))]), &["path"], false, false),
        t("export_svg", "Save a sharp vector SVG of a view (2D sprites: one square per pixel; 3D: the rendered pixel art).",
          props(vec![("path", path()), ("view", str("View (2D default front, 3D default iso).")), ("yaw", num("Yaw.")), ("pitch", num("Pitch.")),
                     ("scale", int("Picture pixels per voxel (2D default 1, 3D default 4).")), ("zoom", int("Display size multiplier (2D default 8).")),
                     ("frame", int("Frame.")), ("outline", bool("Outline (3D default true).")), ("background", str("Hex background (default transparent)."))]),
          &["path"], false, false),
        t("export_html", "Save a self-contained web page (no outside files) showing the model as inline SVG: the animation frames, or a turntable spin of a 3D model.",
          props(vec![("path", path()), ("kind", one_of(&["animation", "turntable"], "Default: animation for sprites or several frames, else turntable.")),
                     ("view", str("View.")), ("scale", int("Picture pixels per voxel.")), ("zoom", int("Display size multiplier.")),
                     ("steps", int("Turntable steps (default 8)."))]), &["path"], false, false),
        t("export_vox", "Save the active frame as a MagicaVoxel .vox file.", props(vec![("path", path()), ("frame", int("Frame."))]), &["path"], false, false),
        t("export_obj", "Save the active frame as a Wavefront .obj mesh with a .mtl palette beside it.",
          props(vec![("path", path()), ("frame", int("Frame."))]), &["path"], false, false),

        // Only meaningful while the OpenPixel window is open.
        t("get_editor_screenshot", "Picture of the OpenPixel editor window as the person sees it (only when the app is open).", none(), &[], true, false),

        // Editor-only helpers.
        t("ui_state", "Editor state for the canvas.", props(vec![("onion", bool("Include neighbouring frames."))]), &[], true, true),
        t("ui_activity", "Recent tool calls.", none(), &[], true, true),
    ]
}

/// Every tool, in the order agents see them.
pub fn catalog() -> &'static [ToolSpec] {
    static ALL: OnceLock<Vec<ToolSpec>> = OnceLock::new();
    ALL.get_or_init(build)
}

pub fn spec(name: &str) -> Option<&'static ToolSpec> {
    catalog().iter().find(|t| t.name == name)
}
