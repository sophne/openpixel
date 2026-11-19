import Foundation

/// One tool as agents see it (MCP `tools/list`) and as the editor calls it.
public struct ToolSpec {
    public let name: String
    public let description: String
    public let properties: [String: [String: Any]]
    public let required: [String]
    public let readOnly: Bool
    /// Hidden tools are used by the editor only and never listed to agents.
    public let hidden: Bool

    public var inputSchema: [String: Any] {
        ["type": "object", "properties": properties, "required": required, "additionalProperties": false]
    }

    public var mcpJSON: [String: Any] {
        ["name": name, "description": description, "inputSchema": inputSchema,
         "annotations": ["readOnlyHint": readOnly, "destructiveHint": false, "openWorldHint": false]]
    }
}

/// Schema helpers.
enum S {
    static func int(_ d: String) -> [String: Any] { ["type": "integer", "description": d] }
    static func num(_ d: String) -> [String: Any] { ["type": "number", "description": d] }
    static func str(_ d: String) -> [String: Any] { ["type": "string", "description": d] }
    static func bool(_ d: String) -> [String: Any] { ["type": "boolean", "description": d] }
    static func oneOf(_ values: [String], _ d: String) -> [String: Any] { ["type": "string", "enum": values, "description": d] }
    static func point(_ d: String) -> [String: Any] {
        ["type": "array", "items": ["type": "number"], "minItems": 3, "maxItems": 3, "description": d + " as [x, y, z]"]
    }
    static let color: [String: Any] = [
        "type": ["integer", "string"],
        "description": "Palette index (1-255) or hex colour like \"#d95763\" (added to the palette if new).",
    ]
    static func colorList(_ d: String) -> [String: Any] {
        ["type": "array", "items": ["type": ["integer", "string"]], "description": d]
    }
    static let path = str("Absolute file path.")

    /// Where an edit goes; every drawing tool accepts these.
    static let target: [String: [String: Any]] = [
        "layer": ["type": ["integer", "string"], "description": "Layer index or name (default: the active layer)."],
        "frame": int("Frame index from 0 (default: the active frame)."),
    ]
    static let pen: [String: [String: Any]] = target.merging([
        "mode": oneOf(["replace", "paint", "add", "erase"],
                      "replace (default) overwrites; paint only recolours existing voxels; add only fills empty cells; erase removes."),
        "symmetry": str("Mirror the edit across the model centre on these axes, e.g. \"x\" or \"xz\"."),
    ]) { a, _ in a }

    static func merge(_ a: [String: [String: Any]], _ b: [String: [String: Any]]) -> [String: [String: Any]] {
        a.merging(b) { x, _ in x }
    }
}

public enum ToolCatalog {
    static func t(_ name: String, _ desc: String, _ props: [String: [String: Any]] = [:], required: [String] = [],
                  readOnly: Bool = false, hidden: Bool = false) -> ToolSpec {
        ToolSpec(name: name, description: desc, properties: props, required: required, readOnly: readOnly, hidden: hidden)
    }

    public static let conventions = """
    A model is a voxel grid; a 2D sprite is a model 1 voxel deep (new_sprite). \
    3D coordinates: x grows to the right, y grows UP (y=0 is the ground), z grows toward the FRONT (the viewer). \
    2D tools (set_pixels, paint_slice on axis z) use image rows instead: row 0 is the TOP. \
    Cells run from 0 to size-1 on each axis. Palette index 0 means empty. \
    Colours can be palette indexes or hex strings.
    """

    public static let all: [ToolSpec] = [
        // 2D sprites
        t("new_sprite", "Start a new 2D pixel-art sprite (a canvas 1 voxel deep) (default 32×32). Draw with paint_slice (rows of text) or set_pixels; export_png saves it pixel for pixel.",
          ["width": S.int("Width in pixels, 1-256 (default 32)."), "height": S.int("Height in pixels, 1-256 (default 32)."),
           "name": S.str("Sprite name."), "palette": S.str("Palette preset: db32 (default), db16, pico8, edg32, grayscale.")]),
        t("set_pixels", "Draw pixels on a 2D sprite (or the front slice z=depth of a model). Each item is [x, y] (uses `color`) or [x, y, color]; y counts from the TOP row like an image.",
          S.merge(S.pen, ["pixels": ["type": "array", "items": ["type": "array"], "description": "List of [x,y] or [x,y,color]."],
                          "color": S.color, "depth": S.int("Which z slice of a 3D model (default 0).")]), required: ["pixels"]),
        t("extrude_to_3d", "Turn a 2D sprite into a 3D voxel model by repeating it `depth` voxels deep (then reshape it with the 3D tools).",
          ["depth": S.int("Depth in voxels, 1-256."), "from_slice": S.int("Which z slice to extrude (default 0).")], required: ["depth"]),

        // Model
        t("new_model", "Start a new empty voxel model (replaces the open one; undo brings it back). " + conventions,
          ["size_x": S.int("Width (x), 1-256, default 32."), "size_y": S.int("Height (y, up), 1-256, default 32."),
           "size_z": S.int("Depth (z, toward front), 1-256, default 32."), "name": S.str("Model name."),
           "palette": S.str("Palette preset: db32 (default), db16, pico8, edg32, grayscale.")]),
        t("get_model_info", "Size, palette size, layers, frames, active layer/frame, voxel count, file path and undo depth. Call this first.",
          readOnly: true),
        t("open_model", "Open a .openpixel or MagicaVoxel .vox file.", ["path": S.path], required: ["path"]),
        t("save_model", "Save as .openpixel (JSON). Without a path, saves to the file it was opened from.",
          ["path": S.path]),
        t("resize_model", "Change the model space size. Content stays on the ground and centred (anchor bottom-center) or keeps its coordinates (anchor origin).",
          ["size_x": S.int("New width."), "size_y": S.int("New height."), "size_z": S.int("New depth."),
           "anchor": S.oneOf(["bottom-center", "origin"], "Where existing voxels stay.")],
          required: ["size_x", "size_y", "size_z"]),

        // Palette
        t("get_palette", "List palette colours with their indexes (index 0 is empty).", readOnly: true),
        t("set_palette", "Replace the palette with a preset or a list of hex colours. Voxels keep their indexes.",
          ["preset": S.str("db32, db16, pico8, edg32 or grayscale."), "colors": S.colorList("Hex colours; first becomes index 1.")]),
        t("set_palette_color", "Change one palette entry (every voxel using it changes colour).",
          ["index": S.int("1-255."), "color": S.str("Hex colour.")], required: ["index", "color"]),
        t("add_colors", "Add hex colours to the palette (existing ones are reused) and return their indexes.",
          ["colors": S.colorList("Hex colours.")], required: ["colors"]),
        t("make_color_ramp", "Add a hue-shifted shading ramp (darkest first) to the palette and return the indexes. Give `base` (the material's middle colour): shadows turn cooler and more saturated, highlights warmer and paler, as in hand-made pixel-art palettes. Or give `from` and `to` to blend between two colours.",
          ["base": S.str("Middle colour of the material, e.g. \"#c0503c\" for red cloth (recommended)."),
           "from": S.str("Darkest hex colour (instead of base)."), "to": S.str("Lightest hex colour (instead of base)."),
           "steps": S.int("Number of colours, 2-16 (default 5 with base, 4 with from/to). 3-5 suits most sprites."),
           "hue_shift": S.num("Degrees of hue shift per step away from the base (default 12; 0 = none).")]),

        // Layers and frames
        t("add_layer", "Add a layer above the active one and make it active.", ["name": S.str("Layer name.")]),
        t("delete_layer", "Delete a layer.", S.target),
        t("set_layer", "Rename, show/hide or lock a layer.",
          S.merge(S.target, ["name": S.str("New name."), "visible": S.bool("Shown in renders and the canvas."),
                             "locked": S.bool("Locked layers refuse edits.")])),
        t("duplicate_layer", "Copy a layer with all its frames and put the copy above it.", S.target),
        t("merge_layer_down", "Merge a layer into the one below (upper voxels win).", S.target),
        t("set_active", "Choose the active layer and/or frame used when tools are called without layer/frame.", S.target),
        t("add_frame", "Add an animation frame after a frame (a copy of it by default) and make it active.",
          ["after": S.int("Frame index (default: active)."), "copy": S.bool("Copy the voxels (default true).")]),
        t("delete_frame", "Delete an animation frame.", ["frame": S.int("Frame index.")]),
        t("set_frame_duration", "Set how long a frame shows, in milliseconds (default for new frames: 100).",
          ["frame": S.int("Frame index (default: active)."), "duration_ms": S.int("Milliseconds."),
           "all_frames": S.bool("Apply to every frame.")], required: ["duration_ms"]),

        // Drawing
        t("set_voxels", "Place voxels. Each item is [x, y, z] (uses `color`) or [x, y, z, color]. Best for small details; use shapes or paint_slice for bulk.",
          S.merge(S.pen, ["voxels": ["type": "array", "items": ["type": "array"], "description": "List of [x,y,z] or [x,y,z,color]."],
                          "color": S.color]), required: ["voxels"]),
        t("erase_voxels", "Remove voxels at the listed [x, y, z] cells.",
          S.merge(S.target, ["voxels": ["type": "array", "items": ["type": "array"], "description": "List of [x,y,z]."],
                             "symmetry": S.str("Mirror axes, e.g. \"x\".")]), required: ["voxels"]),
        t("fill_box", "Fill a box between two corners (inclusive).",
          S.merge(S.pen, ["from": S.point("One corner"), "to": S.point("The opposite corner"), "color": S.color,
                          "hollow": S.bool("Only the shell.")]), required: ["from", "to"]),
        t("draw_sphere", "Fill a sphere or ellipsoid.",
          S.merge(S.pen, ["center": S.point("Centre (may be .5 to centre between cells)"),
                          "radius": ["type": ["number", "array"], "description": "Radius, or [rx, ry, rz] for an ellipsoid."],
                          "color": S.color, "hollow": S.bool("Only the shell.")]), required: ["center", "radius"]),
        t("draw_cylinder", "Fill a cylinder standing along an axis from a base centre.",
          S.merge(S.pen, ["base": S.point("Centre of the base"), "radius": S.num("Radius."), "length": S.int("Length along the axis."),
                          "axis": S.oneOf(["x", "y", "z"], "Axis (default y = upright)."), "color": S.color,
                          "hollow": S.bool("Only the wall and caps.")]), required: ["base", "radius", "length"]),
        t("draw_line", "Draw a straight 3D line, optionally thick.",
          S.merge(S.pen, ["from": S.point("Start"), "to": S.point("End"), "color": S.color,
                          "radius": S.int("Thickness radius (0 = one voxel).")]), required: ["from", "to"]),
        t("flood_fill", "Bucket fill: recolour the connected region of the same colour as the start cell. On an empty start cell the fill stays in that horizontal slice unless volume is true.",
          S.merge(S.pen, ["at": S.point("Start cell"), "color": S.color, "volume": S.bool("Fill empty space in 3D.")]),
          required: ["at"]),
        t("paint_slice", """
          Draw a 2D slice with text rows, like pixel art: the fastest way to build models. \
          axis "z": a front view (columns = x left→right, rows = y top→bottom) at depth z=index. \
          axis "y": a top view of the horizontal layer y=index (columns = x, rows = z back→front). \
          axis "x": a side view at x=index (columns = z back→front, rows = y top→bottom). \
          '.' or ' ' is empty. Without a legend, characters 1-9 and a-z mean palette indexes 1-35. \
          depth repeats the slice over index..index+depth-1 (extrude). slices draws several consecutive slices at once.
          """,
          S.merge(S.target, [
            "axis": S.oneOf(["x", "y", "z"], "Slice axis (default z, a front view)."),
            "index": S.int("Slice position along the axis (default 0)."),
            "rows": ["type": "array", "items": ["type": "string"], "description": "Text rows, top row first."],
            "slices": ["type": "array", "items": ["type": "array", "items": ["type": "string"]],
                       "description": "Several slices (each a list of rows) for index, index+1, ..."],
            "legend": ["type": "object", "additionalProperties": ["type": ["integer", "string"]],
                       "description": "Map of character to colour, e.g. {\"R\": \"#ac3232\", \"w\": 22}."],
            "depth": S.int("Extrude the slice this many cells along the axis (default 1)."),
            "mode": S.oneOf(["replace", "merge"], "replace (default): '.' clears the cell; merge: '.' leaves it as it is."),
            "offset": ["type": "array", "items": ["type": "integer"], "description": "[column, row] where the text starts (default [0,0])."],
          ])),
        t("replace_color", "Replace one colour with another.",
          S.merge(S.target, ["from": S.color, "to": S.color, "all_layers": S.bool("Every layer."),
                             "all_frames": S.bool("Every frame.")]), required: ["from", "to"]),
        t("apply_gradient", "Recolour existing voxels along an axis with a list of colours (low end first), e.g. darker at the bottom. Good for shading.",
          S.merge(S.target, ["axis": S.oneOf(["x", "y", "z"], "Axis (default y)."), "colors": S.colorList("Colours from low to high."),
                             "only_color": S.color]), required: ["colors"]),
        t("transform", "Move, flip, rotate or mirror a layer's voxels. move: dx/dy/dz; flip: axis; rotate: axis + turns (quarter turns, counter-clockwise seen from the + end of the axis); mirror: copy one half onto the other (keep low or high side).",
          S.merge(S.target, ["op": S.oneOf(["move", "flip", "rotate", "mirror"], "Operation."),
                             "dx": S.int("Move x."), "dy": S.int("Move y."), "dz": S.int("Move z."),
                             "wrap": S.bool("Wrap around when moving."), "axis": S.oneOf(["x", "y", "z"], "Axis."),
                             "turns": S.int("Quarter turns for rotate."),
                             "keep": S.oneOf(["low", "high"], "For mirror: low keeps left/bottom/back."),
                             "all_layers": S.bool("Apply to every layer."), "all_frames": S.bool("Apply to every frame.")]),
          required: ["op"]),
        t("clear", "Remove every voxel of a layer in a frame.", S.target),
        t("import_image", "Turn a 2D picture (a PNG from any pixel-art editor) into voxels on a slice, optionally extruded. Colours snap to the palette, or are added with add_colors=true.",
          S.merge(S.target, ["path": S.path, "axis": S.oneOf(["x", "y", "z"], "Slice axis (default z, a front view)."),
                             "index": S.int("Slice position (default 0)."), "depth": S.int("Extrude depth (default 1)."),
                             "add_colors": S.bool("Add the picture's exact colours to the palette instead of snapping."),
                             "grow": S.bool("Enlarge the model when the picture is bigger (default true).")]),
          required: ["path"]),

        // Review
        t("get_voxel", "What is at one cell: colour and which layer it comes from.",
          ["at": S.point("Cell"), "frame": S.int("Frame (default active).")], required: ["at"], readOnly: true),
        t("get_slice", "Read a 2D slice as text rows with a legend (same layout as paint_slice). The precise way to check a model.",
          S.merge(S.target, ["axis": S.oneOf(["x", "y", "z"], "Slice axis (default z)."), "index": S.int("Slice position."),
                             "merged": S.bool("Read all visible layers merged (default true); false reads only the layer.")]),
          readOnly: true),
        t("find_voxels", "List filled cells, optionally of one colour or inside a box (at most `limit`).",
          S.merge(S.target, ["color": S.color, "from": S.point("Box corner"), "to": S.point("Opposite corner"),
                             "limit": S.int("Most cells to return (default 500).")]), readOnly: true),
        t("analyze_model", "Review checks: voxel count, bounds, colours used, floating parts, stray voxels, left/right symmetry, edge contact, animation consistency (identical frames, volume jumps, ground-line jitter), and for 2D sprites pixel-art checks (colour count, near-identical colours, doubled line corners, stray pixels, outline, light direction, pillow shading), plus the style lock. Returns issues to fix, style tips, and a score (0-100) with the deduction behind each point lost.",
          ["frame": S.int("Frame (default active).")], readOnly: true),
        t("render_view", "Render the model to a crisp pixel-art picture and return it. A 2D sprite renders flat at its exact colours by default. Views: iso (2:1 pixel-art isometric), iso-front-left, iso-back-right, iso-back-left, front, back, left, right, top, bottom; or give yaw/pitch in degrees.",
          ["view": S.str("View name (default iso)."), "yaw": S.num("Degrees around the up axis (0 = front)."),
           "pitch": S.num("Degrees looking down (30 = 2:1 isometric)."), "scale": S.int("Pixels per voxel (default: auto)."),
           "frame": S.int("Frame (default active)."), "outline": S.bool("Dark outline (default true)."),
           "edges": S.bool("Darken depth edges (default true)."), "background": S.str("Hex background (default transparent).")],
          readOnly: true),
        t("review_model", "Review pictures plus the analyze_model report. 3D: 4 isometric angles plus front, right and top views. 2D sprite: enlarged with a pixel grid, grayscale values, silhouette, actual size on dark and light, and every animation frame. Use after each big change and fix the issues it lists.",
          ["frame": S.int("Frame (default active)."), "scale": S.int("Pixels per voxel (default: auto).")], readOnly: true),
        t("view_as_text", "The canvas as text, for exact coordinates and form without pictures: `pixels` (the grid with x/row rulers and a legend), `values` (brightness 0-9, to check light and contrast), `silhouette` (# and .), and `diff` against another frame (onion skin: + added, - removed, * recoloured). 3D models are projected from a view (first voxel each ray meets). Shows the filled area plus a 1-cell margin unless you give a region.",
          ["view": S.oneOf(TextView.views, "3D projection (default front; a 2D sprite is always its image)."),
           "maps": ["type": "array", "items": ["type": "string", "enum": TextView.maps],
                    "description": "Which maps (default pixels, values, silhouette). diff compares with the previous frame unless compare_frame is given."],
           "frame": S.int("Frame (default active)."), "compare_frame": S.int("Frame for the diff map."),
           "region": ["type": "array", "items": ["type": "integer"], "minItems": 4, "maxItems": 4,
                      "description": "[col0, row0, col1, row1] in the view's own coordinates (for sprites: x and image row)."]],
          readOnly: true),
        t("set_style", "Lock a style for every sprite in a set: palette (preset or colours; default: the current palette), colour budget, light direction, outline, canvas size and notes. While the palette is locked, agent edits may only use locked colours (hex colours must match one; palette tools are refused), new canvases start with the style, and every review and critique checks it (category \"style\"). Drawn colours on the open canvas move to the closest locked colour (one undo step). Load or save a style file to share it across a pipeline. The person in the editor is not restricted.",
          ["name": S.str("Style name."), "preset": S.str("Palette preset: db32, db16, pico8, edg32, grayscale."),
           "colors": S.colorList("Hex colours of the locked palette (instead of preset)."),
           "lock_palette": S.bool("Refuse colours outside the palette (default true)."),
           "max_colors": S.int("Most colours one sprite may use."),
           "light": S.oneOf(StyleLock.lights, "Where the light comes from (none = flat-shaded style)."),
           "outline": S.oneOf(StyleLock.outlines, "dark: a dark outline all round; none: no outline; any: not checked."),
           "size": ["type": "array", "items": ["type": "integer"], "description": "[width, height] for sprites, [x, y, z] for models."],
           "notes": ["type": ["array", "string"], "items": ["type": "string"], "description": "House rules, repeated with every review."],
           "path": S.str("Load a style file (JSON) first; other arguments override it."),
           "save_path": S.str("Write the resulting style to this JSON file."),
           "clear": S.bool("Remove the style lock.")]),
        t("get_style", "The style lock in force (set_style), or none.", readOnly: true),
        t("set_feedback", "Turn the automatic critique on or off. When on (default), every editing call returns `critique`: the score (0-100), its change, and the findings that edit introduced, made worse or resolved.",
          ["auto_critique": S.bool("On or off.")]),
        t("batch", "Run several tool calls in one request, in order: [{\"tool\": \"set_pixels\", \"args\": {...}}, ...]. Every call is checked before any runs; each stays its own undo step. Returns each call's result and one critique for the whole batch. atomic=true undoes the whole batch if a call fails.",
          ["calls": ["type": "array", "items": ["type": "object", "properties": ["tool": ["type": "string"], "args": ["type": "object"]], "required": ["tool"]],
                     "description": "Up to 200 calls."],
           "stop_on_error": S.bool("Stop at the first failing call (default true)."),
           "atomic": S.bool("If a call fails, roll back every change the batch made (default false).")],
          required: ["calls"]),
        t("review_set", "Review several saved files together (.openpixel or .vox): one contact-sheet picture at a common scale, each file's score and top issues, and set checks: different sizes, light from different sides, palettes drifting apart, uneven outlines. Uses the style lock when one is set. The open canvas is not changed.",
          ["paths": ["type": "array", "items": ["type": "string"], "description": "Up to 24 files."],
           "frame": S.int("Frame to review in each file (default 0)."), "scale": S.int("Pixels per voxel in the picture (default: auto).")],
          required: ["paths"], readOnly: true),
        t("pixel_art_guide", "The pixel-art style guide: workflow, shape and line rules, colour and hue-shifted ramps, shading (light source, pillow shading, banding), outlines, cleanup, animation timing and voxel models. Read it before your first drawing.",
          ["topic": S.oneOf(Craft.topics, "Section (default all).")], readOnly: true),
        t("pixel_perfect", "Clean 1-pixel lines: remove doubled corner pixels (L-shaped steps) so diagonals and curves step cleanly, like a pixel-perfect pen. Box corners and filled areas are kept; each removed pixel takes the colour around it. Undo if it removed a wanted detail.",
          S.merge(S.target, ["color": S.color, "depth": S.int("Which z slice of a 3D model (default 0)."),
                             "all_frames": S.bool("Clean every frame.")])),
        t("take_snapshot", "Remember the current model under a name, to compare later.", ["name": S.str("Snapshot name (default \"last\").")]),
        t("compare_snapshot", "Compare the model with a snapshot: counts of added, removed and recoloured voxels, examples, and a before/after picture.",
          ["name": S.str("Snapshot name (default \"last\")."), "view": S.str("View for the pictures (default iso).")], readOnly: true),
        t("undo", "Undo the last edits.", ["steps": S.int("How many (default 1).")]),
        t("redo", "Redo undone edits.", ["steps": S.int("How many (default 1).")]),
        t("get_history", "The undo history labels, newest last.", readOnly: true),

        // Export
        t("export_png", "Save a rendered view as PNG.",
          ["path": S.path, "view": S.str("View (default iso)."), "yaw": S.num("Yaw."), "pitch": S.num("Pitch."),
           "scale": S.int("Pixels per voxel (default 8)."), "frame": S.int("Frame."), "outline": S.bool("Outline (default true)."),
           "background": S.str("Hex background (default transparent).")], required: ["path"]),
        t("export_sheet", "Save a sprite sheet PNG: rows are animation frames, columns are views (default: 8 turnaround angles), ready for 2D games. Returns the cell layout.",
          ["path": S.path, "views": ["type": "array", "items": ["type": "string"], "description": "View names, or [\"turnaround4\"] / [\"turnaround8\"]."],
           "scale": S.int("Pixels per voxel (default 4)."), "pitch": S.num("Pitch for turnaround views (default 30).")],
          required: ["path"]),
        t("export_gif", "Save an animated GIF: the animation frames, or a turntable spin of the model.",
          ["path": S.path, "kind": S.oneOf(["animation", "turntable"], "Default: animation when there are several frames, else turntable."),
           "view": S.str("View for animation (default iso)."), "scale": S.int("Pixels per voxel (default 6)."),
           "steps": S.int("Turntable steps (default 16).")], required: ["path"]),
        t("export_svg", "Save a sharp vector SVG of a view (2D sprites: one square per pixel; 3D: the rendered pixel art).",
          ["path": S.path, "view": S.str("View (2D default front, 3D default iso)."), "yaw": S.num("Yaw."), "pitch": S.num("Pitch."),
           "scale": S.int("Picture pixels per voxel (2D default 1, 3D default 4)."), "zoom": S.int("Display size multiplier (2D default 8)."),
           "frame": S.int("Frame."), "outline": S.bool("Outline (3D default true)."), "background": S.str("Hex background (default transparent).")],
          required: ["path"]),
        t("export_html", "Save a self-contained web page (no outside files) showing the model as inline SVG: the animation frames, or a turntable spin of a 3D model.",
          ["path": S.path, "kind": S.oneOf(["animation", "turntable"], "Default: animation for sprites or several frames, else turntable."),
           "view": S.str("View."), "scale": S.int("Picture pixels per voxel."), "zoom": S.int("Display size multiplier."),
           "steps": S.int("Turntable steps (default 8).")], required: ["path"]),
        t("export_vox", "Save the active frame as a MagicaVoxel .vox file.", ["path": S.path, "frame": S.int("Frame.")], required: ["path"]),
        t("export_obj", "Save the active frame as a Wavefront .obj mesh with a .mtl palette beside it.",
          ["path": S.path, "frame": S.int("Frame.")], required: ["path"]),

        // Only meaningful while the OpenPixel window is open.
        t("get_editor_screenshot", "Picture of the OpenPixel editor window as the person sees it (only when the app is open).", readOnly: true),

        // Editor-only helpers.
        t("ui_state", "Editor state for the canvas.", ["onion": S.bool("Include neighbouring frames.")], readOnly: true, hidden: true),
        t("ui_activity", "Recent tool calls.", readOnly: true, hidden: true),
    ]

    public static func spec(_ name: String) -> ToolSpec? { all.first { $0.name == name } }
}
