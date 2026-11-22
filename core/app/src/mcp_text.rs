//! The words agents read. They are the Swift app's, character for character, so an agent is told the same on every
//! system and version (the tests pin them). `\\(…)` marks where a value goes in (see mcp.rs).

pub const INSTRUCTIONS: &str = r#"OpenPixel makes pixel art: flat 2D sprites and 3D voxel models that render to crisp sprites.
\(ToolCatalog.conventions)
\(Craft.rules)
2D sprite workflow: pixel_art_guide → new_sprite at the final size (16-64) → make_color_ramp per material →
paint_slice with rows of text (axis z, index 0; row 0 is the top; every row the same width) for the silhouette and flat colours →
shade and outline → review_model → fix every issue (pixel_perfect for doubled corners, set_pixels for single pixels) →
review again → add_frame for animation → export_png (scale 1) / export_sheet / export_gif.
extrude_to_3d turns a finished sprite into a voxel model.
Review at least twice (after blocking in, and before exporting) and build colours with make_color_ramp rather than
picking hex values one by one. Saves and exports add a review_reminder when the work changed since the last
review or its issues are still open: act on it before you finish.
Every edit returns a `critique`: the score (0-100) and the findings that edit introduced, made worse or resolved.
If an edit introduces a problem, fix or undo it right away. The score only counts what the checks can measure:
aim for no open issues, then judge the pictures.
view_as_text gives the canvas as text with coordinate rulers (pixels, values 0-9, silhouette, and a diff against
another frame): read exact x/row positions there before set_pixels, and check light and silhouette without pictures.
For a set of assets: set_style locks the palette, size, light and outline for all of them (load or save a style
file); batch runs many calls in one request; review_set reviews saved files side by side for consistency.
Updates: call check_for_updates once at the start of a session. If an update is out, tell the person (install=true
shows the update dialog in the OpenPixel window for them to confirm). If it says reconnect_needed, your connection
runs an older OpenPixel than the one installed: reconnect the OpenPixel MCP server before you continue.
3D workflow:
1. get_model_info (or new_model with a size that fits the subject, e.g. 16-48 per side).
2. Pick colours: get_palette, or make_color_ramp base=… for a hue-shifted ramp per material.
3. Block out big shapes with fill_box / draw_sphere / draw_cylinder, or draw slices with paint_slice
   (front views on axis z, top views on axis y; depth extrudes).
4. Add details with set_voxels; shade with apply_gradient or paint mode.
5. Review: review_model (pictures from 7 angles + automatic checks) and get_slice for exact cells.
6. Refine: take_snapshot before a change, compare_snapshot after; undo if it got worse.
7. Export: export_png / export_svg / export_html / export_sheet (sprite sheets for games) / export_gif / export_vox / export_obj.
Use layers for parts (body, eyes, props) and frames for animation. If the OpenPixel window is open,
edits appear there live and get_editor_screenshot shows what the person sees."#;

pub const MAKE_SPRITE: &str = r#"Make a 2D pixel-art sprite of \(subject) with OpenPixel.

1. Call pixel_art_guide (topic all) and follow it.
2. Decide the size (16, 24, 32 or 48), the view (front, side or 3/4) and the light direction (top-left). Say them in one line.
3. Choose 2-4 materials and make one ramp each with make_color_ramp base=… (3-5 steps), plus a dark outline hue.
4. new_sprite, then paint_slice: first the silhouette in one colour, then flat colours, then shading, then outline and details.
5. After each step call review_model. Look at the silhouette, the grayscale values and the actual-size pictures, not only the enlarged one.
   Read each edit's critique: if it introduced an issue, fix or undo it before moving on. Use view_as_text for exact coordinates.
   List what looks wrong (shape, readability, light, lines, colours) and every issue it reports, fix them, and review again.
6. Stop when the issues list is empty or every remaining item is deliberate, and the sprite reads at actual size.
\(MCPServer.instructions)"#;

pub const ANIMATE_SPRITE: &str = r#"Animate the open sprite: \(subject).

1. Call pixel_art_guide with topic animation.
2. Plan the key poses and the frame count in one line (idle 2-4, walk 4-8, attack 3-6), and which frames are holds.
3. For each frame: add_frame (copies the previous), change only what moves, keep the ground line and the volume steady.
4. Set durations with set_frame_duration: key poses longer, in-betweens shorter.
5. review_model shows every frame side by side and checks for identical frames, jumps in volume and a ground line that moves; fix them.
   view_as_text maps=["diff"] shows exactly which pixels change from the previous frame.
6. Export with export_gif and export_sheet."#;
