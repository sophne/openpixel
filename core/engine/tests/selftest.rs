//! The engine's self-test: every tool, the file formats and exports, reviews, and what a damaged or hostile file
//! must do (an error or a sound model, never a crash). A file parser's new damaged-file case goes here.
//! The list began as the Swift app's `OpenPixel --selftest` and keeps its order and wording; the MCP and HTTP-path
//! checks of that list are in core/app, the agents' socket and Agent Chat ones in desktop/host.
use std::collections::HashMap;
use std::path::PathBuf;

use openpixel_core::formats::{image_files, native_file, vox_file};
use openpixel_core::{sample, updates, Engine, Json, JsonMap, Rgba, StdIo, ToolOutput};
use serde_json::json;

// MARK: - helpers

/// The tool's answer, or nothing when it failed.
fn run(e: &mut Engine, tool: &str, args: Json) -> Option<ToolOutput> {
    run_as(e, tool, args, "agent")
}

fn run_as(e: &mut Engine, tool: &str, args: Json, source: &str) -> Option<ToolOutput> {
    e.execute(tool, args.as_object().expect("arguments are an object"), source).ok()
}

/// The tool's JSON, or nothing when it failed.
fn js(e: &mut Engine, tool: &str, args: Json) -> JsonMap {
    run(e, tool, args).map(|o| o.json).unwrap_or_default()
}

fn error_of(e: &mut Engine, tool: &str, args: Json) -> String {
    e.execute(tool, args.as_object().expect("arguments are an object"), "agent").err().map(|e| e.0).unwrap_or_default()
}

fn int(v: Option<&Json>) -> Option<i64> {
    v.and_then(Json::as_i64)
}

fn strings(v: Option<&Json>) -> Vec<String> {
    v.and_then(Json::as_array).map(|l| l.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn object(v: Option<&Json>) -> JsonMap {
    v.and_then(Json::as_object).cloned().unwrap_or_default()
}

fn filled(e: &mut Engine) -> Option<i64> {
    int(js(e, "get_model_info", json!({})).get("voxels_in_active_frame"))
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("openpixel-{}-{}", name, std::process::id()));
    std::fs::create_dir_all(&dir).expect("a temporary folder");
    dir
}

fn path(dir: &std::path::Path, name: &str) -> String {
    dir.join(name).to_string_lossy().into_owned()
}

/// Pillow shading: a disc that gets lighter toward its middle in rings, versus one lit from the top-left.
fn disc(light_from_top_left: bool) -> Vec<String> {
    (0..24)
        .map(|r| {
            (0..24)
                .map(|c| {
                    let (dx, dy) = (c as f64 - 11.5, r as f64 - 11.5);
                    let d = (dx * dx + dy * dy).sqrt();
                    if d > 10.0 {
                        return '.';
                    }
                    if d > 9.0 {
                        return '1';
                    }
                    if light_from_top_left {
                        let t = (dx + dy) / 20.0;
                        return if t < -0.3 { '4' } else if t < 0.1 { '3' } else { '2' };
                    }
                    if d < 4.0 { '4' } else if d < 7.0 { '3' } else { '2' }
                })
                .collect()
        })
        .collect()
}

/// A full-frame background: a sky of flat hard-edged stripes over a ground band.
fn sky(dithered: bool) -> Vec<String> {
    let bands: [(char, usize); 4] = [('1', 7), ('2', 6), ('3', 5), ('4', 4)];
    let mut rows: Vec<String> = Vec::new();
    for (k, (ch, h)) in bands.iter().enumerate() {
        for r in 0..*h {
            if dithered && r == h - 1 && k < bands.len() - 1 {
                // The last row of each band mixes with the next colour in a checkerboard.
                rows.push((0..48).map(|i| if i % 2 == 0 { *ch } else { bands[k + 1].0 }).collect());
            } else {
                rows.push(ch.to_string().repeat(48));
            }
        }
    }
    while rows.len() < 24 {
        rows.push("5".repeat(48));
    }
    rows
}

fn orb_colours() -> Json {
    json!({"1": "#222034", "2": "#45283c", "3": "#ac3232", "4": "#d95763"})
}

fn sky_colours() -> Json {
    json!({"1": "#1e1a3f", "2": "#2e2459", "3": "#473575", "4": "#6e4585", "5": "#243b2c"})
}

type TextGrid = HashMap<i64, HashMap<i64, char>>;

/// A text map from view_as_text as [row label: [column label: character]], read with the column and
/// row ranges the tool reports. Also checks that every row starts with its label and the units ruler
/// line matches the column labels.
fn text_grid(out: &JsonMap, key: &str) -> (TextGrid, bool) {
    fn labels(s: Option<&Json>) -> Vec<i64> {
        let last = s.and_then(Json::as_str).and_then(|t| t.split(' ').next_back()).unwrap_or("");
        let ends: Vec<i64> = last.split('→').filter_map(|p| p.parse().ok()).collect();
        if ends.len() != 2 {
            return Vec::new();
        }
        if ends[0] <= ends[1] { (ends[0]..=ends[1]).collect() } else { (ends[1]..=ends[0]).rev().collect() }
    }
    let (cols, rows, lines) = (labels(out.get("columns")), labels(out.get("rows")), strings(out.get(key)));
    if cols.is_empty() || rows.is_empty() || lines.len() <= rows.len() {
        return (HashMap::new(), false);
    }
    let head = lines.len() - rows.len();
    let suffix = |line: &str| -> Vec<char> {
        let chars: Vec<char> = line.chars().collect();
        chars[chars.len().saturating_sub(cols.len())..].to_vec()
    };
    let prefix = |line: &str| -> String {
        let chars: Vec<char> = line.chars().collect();
        chars[..chars.len().saturating_sub(cols.len())].iter().collect()
    };
    let units: Vec<char> = cols.iter().map(|c| char::from_digit((c % 10) as u32, 10).unwrap_or('?')).collect();
    let mut ok = suffix(&lines[head - 1]) == units;
    let mut g: TextGrid = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        let line = &lines[head + i];
        ok = ok && prefix(line).trim().parse::<i64>().ok() == Some(*r);
        for (j, c) in suffix(line).into_iter().enumerate() {
            g.entry(*r).or_default().insert(cols[j], c);
        }
    }
    (g, ok)
}

fn at(g: &TextGrid, row: i64, col: i64) -> Option<char> {
    g.get(&row).and_then(|r| r.get(&col)).copied()
}

fn score(e: &mut Engine) -> JsonMap {
    object(js(e, "analyze_model", json!({})).get("score"))
}

fn codes(s: &JsonMap) -> Vec<String> {
    s.get("deductions")
        .and_then(Json::as_array)
        .map(|l| l.iter().filter_map(|d| d.get("code").and_then(Json::as_str).map(String::from)).collect())
        .unwrap_or_default()
}

fn has(list: &[String], part: &str) -> bool {
    list.iter().any(|s| s.contains(part))
}

// MARK: - the checks

#[test]
fn sample_model_tools_files_and_exports() {
    let mut engine = Engine::new();
    sample::build(&mut engine, true);
    let info = js(&mut engine, "get_model_info", json!({}));
    assert!(int(info.get("voxels_in_active_frame")).unwrap_or(0) > 500, "sample model has voxels ({:?})", info.get("voxels_in_active_frame"));
    assert_eq!(info.get("layers").and_then(Json::as_array).map(Vec::len), Some(3), "sample has 3 layers");

    run(&mut engine, "new_model", json!({"size_x": 8, "size_y": 8, "size_z": 8}));
    let r = js(&mut engine, "paint_slice", json!({"axis": "z", "index": 2, "rows": ["..11..", ".1221.", "112211"], "depth": 2}));
    assert_eq!(int(r.get("changed")), Some(24), "paint_slice extrudes 12 cells × 2");
    let s = js(&mut engine, "get_slice", json!({"axis": "z", "index": 3}));
    let rows = strings(s.get("rows"));
    assert!(rows.len() == 8 && rows[0] == "..11....", "get_slice reads back the same rows ({:?})", rows.first());
    run(&mut engine, "undo", json!({}));
    assert_eq!(filled(&mut engine), Some(0), "undo removes the slice");
    run(&mut engine, "redo", json!({}));
    run(&mut engine, "fill_box", json!({"from": [0, 0, 0], "to": [7, 0, 7], "color": "#ff0000"}));
    run(&mut engine, "draw_sphere", json!({"center": [4, 5, 4], "radius": 2, "color": 5, "symmetry": "x"}));
    let render = run(&mut engine, "render_view", json!({"view": "iso", "scale": 4}));
    assert!(render.as_ref().and_then(|r| r.images.first()).map_or(0, Vec::len) > 100, "render_view returns a PNG");
    let review = run(&mut engine, "review_model", json!({})).expect("review_model runs");
    assert!(review.images.len() == 1 && review.json.contains_key("issues"), "review_model returns a sheet and checks");
    run(&mut engine, "take_snapshot", json!({}));
    run(&mut engine, "set_voxels", json!({"voxels": [[0, 1, 0, 3]]}));
    let diff = js(&mut engine, "compare_snapshot", json!({}));
    assert_eq!(int(diff.get("added")), Some(1), "compare_snapshot sees one added voxel");

    let tmp = temp("selftest");
    let file = path(&tmp, "t.openpixel");
    run(&mut engine, "save_model", json!({"path": file}));
    let before = filled(&mut engine);
    run(&mut engine, "open_model", json!({"path": file}));
    let reopened = filled(&mut engine);
    assert!(before.is_some() && before == reopened, "save and open keep every voxel ({before:?} = {reopened:?})");
    let vox = path(&tmp, "t.vox");
    run(&mut engine, "export_vox", json!({"path": vox}));
    run(&mut engine, "open_model", json!({"path": vox}));
    assert_eq!(filled(&mut engine), before, ".vox export and import round-trip");
    for (tool, ext) in [("export_png", "png"), ("export_sheet", "png"), ("export_gif", "gif"), ("export_obj", "obj"), ("export_svg", "svg"), ("export_html", "html")] {
        let p = path(&tmp, &format!("out-{tool}.{ext}"));
        run(&mut engine, tool, json!({"path": p}));
        assert!(std::path::Path::new(&p).exists(), "{tool} writes a file");
    }
    assert!(tmp.join("out-export_obj.mtl").exists(), "export_obj writes the materials beside the mesh");

    // 2D sprites
    let mut sprite = Engine::new();
    sample::build(&mut sprite, false);
    let s_info = js(&mut sprite, "get_model_info", json!({}));
    assert!(
        s_info.get("kind").and_then(Json::as_str) == Some("2d-sprite") && s_info.get("frames").and_then(Json::as_array).map(Vec::len) == Some(2),
        "welcome sprite is 2D with 2 frames"
    );
    run(&mut sprite, "set_pixels", json!({"pixels": [[0, 0, "#ff00ff"]]}));
    let top = js(&mut sprite, "get_voxel", json!({"at": [0, 31, 0]}));
    assert_eq!(top.get("hex").and_then(Json::as_str), Some("#ff00ff"), "set_pixels counts y from the top row");
    let png = path(&tmp, "sprite.png");
    let exp = js(&mut sprite, "export_png", json!({"path": png}));
    assert!(int(exp.get("width")) == Some(32) && int(exp.get("height")) == Some(32), "2D export_png is the sprite pixel for pixel (32×32)");
    let pic = image_files::read(&StdIo, &png).expect("the exported PNG reads back");
    assert_eq!(pic.pixel(0), Rgba::rgb(255, 0, 255), "exported pixel keeps its exact colour");
    run(&mut sprite, "extrude_to_3d", json!({"depth": 4}));
    let ext = js(&mut sprite, "get_model_info", json!({}));
    assert_eq!(ext.get("size"), Some(&json!([32, 32, 4])), "extrude_to_3d makes the sprite 4 voxels deep");
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn pixel_art_craft() {
    // Pixel-art craft: ramps, line cleanup, checks and review pictures.
    let mut craft = Engine::new();
    run(&mut craft, "new_sprite", json!({"width": 16, "height": 16}));
    let ramp = strings(js(&mut craft, "make_color_ramp", json!({"base": "#c0503c"})).get("colors"));
    let lumas: Vec<f64> =
        ramp.iter().filter_map(|c| Rgba::parse(c)).map(|c| 0.299 * c.r as f64 + 0.587 * c.g as f64 + 0.114 * c.b as f64).collect();
    let mut sorted = lumas.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).expect("no NaN"));
    assert!(ramp.len() == 5 && lumas == sorted && ramp[2] == "#c0503c", "make_color_ramp base: 5 colours, darkest first, base in the middle ({ramp:?})");
    let (dark, lit) = (Rgba::parse(&ramp[0]).expect("a colour"), Rgba::parse(&ramp[4]).expect("a colour"));
    assert!(dark.b as i64 - dark.r as i64 > 0x3c - 0xc0 && lit.g > lit.b, "ramp shadows lean cool, highlights warm");
    // A 1:1 diagonal drawn with doubled corners, next to a box outline whose corners must stay.
    run(
        &mut craft,
        "paint_slice",
        json!({"rows": [
            "1...............", "11..............", ".11.............", "..11............", "...1............",
            "................", "..........1111..", "..........1..1..", "..........1..1..", "..........1111..",
        ], "legend": {"1": "#222034"}}),
    );
    let lint = js(&mut craft, "analyze_model", json!({}));
    let doubled = int(object(object(lint.get("pixel_art")).get("doubled_corners")).get("count")).unwrap_or(0);
    assert!(doubled > 0, "analyze_model finds doubled corners in a staircase line ({doubled})");
    let pp = int(js(&mut craft, "pixel_perfect", json!({})).get("changed")).unwrap_or(0);
    let box_row: Vec<String> = strings(js(&mut craft, "get_slice", json!({"axis": "z", "index": 0})).get("rows"))
        .iter()
        .map(|r| r.chars().map(|ch| if ch == '.' { '.' } else { '#' }).collect())
        .collect();
    assert!(
        pp >= 2 && box_row.len() == 16 && box_row[4] == "...#............" && box_row[6].ends_with("####..") && box_row[9].ends_with("####.."),
        "pixel_perfect cleans the diagonal and keeps the box corners ({pp} removed)"
    );
    let again = js(&mut craft, "analyze_model", json!({}));
    assert!(!object(again.get("pixel_art")).contains_key("doubled_corners"), "no doubled corners left after pixel_perfect");
    let (mut pillow, mut lit_ok) = (false, false);
    for (rows, is_lit) in [(disc(false), false), (disc(true), true)] {
        run(&mut craft, "new_sprite", json!({"width": 24, "height": 24}));
        run(&mut craft, "paint_slice", json!({"rows": rows, "legend": orb_colours()}));
        let issues = strings(js(&mut craft, "analyze_model", json!({})).get("issues"));
        let flagged = has(&issues, "pillow");
        if is_lit {
            lit_ok = !flagged;
        } else {
            pillow = flagged;
        }
    }
    assert!(pillow && lit_ok, "pillow shading is flagged, top-left lighting is not");
    let ragged = strings(js(&mut craft, "paint_slice", json!({"rows": ["111", "11", "1111"], "color": 1})).get("warnings"));
    assert!(has(&ragged, "different lengths"), "paint_slice warns about rows of different widths");
    run(&mut craft, "add_frame", json!({}));
    let rev = run(&mut craft, "review_model", json!({})).expect("review_model runs");
    assert!(
        rev.images.len() == 3 && rev.json.get("pixel_art").is_some_and(Json::is_object) && rev.json.contains_key("tips"),
        "sprite review: grid/value, silhouette/sizes and frame pictures, plus pixel-art report"
    );
    for (i, image) in rev.images.iter().enumerate() {
        assert!(image_files::read_bytes(image).is_some(), "review picture {i} is a PNG");
    }
    let guide = js(&mut craft, "pixel_art_guide", json!({"topic": "shading"}));
    assert!(guide.get("guide").and_then(Json::as_str).unwrap_or("").contains("PILLOW"), "pixel_art_guide returns a section");

    let (mut stripe_tip, mut dither_tip, mut quiet) = (false, true, false);
    for dithered in [false, true] {
        run(&mut craft, "new_sprite", json!({"width": 48, "height": 24}));
        run(&mut craft, "paint_slice", json!({"rows": sky(dithered), "legend": sky_colours()}));
        let r = js(&mut craft, "analyze_model", json!({}));
        let (tips, issues) = (strings(r.get("tips")), strings(r.get("issues")));
        let striped = has(&tips, "flat full-width stripes");
        if dithered {
            dither_tip = striped;
        } else {
            stripe_tip = striped;
            quiet = r.get("kind").and_then(Json::as_str) == Some("full-frame background or scene")
                && !(has(&issues, "canvas edge") || has(&issues, "pillow"))
                && !(has(&tips, "silhouette edge") || has(&tips, "light direction") || has(&tips, "brightest pixels"));
        }
    }
    assert!(stripe_tip && !dither_tip, "stacked flat sky stripes get a tip; dithered transitions do not");
    assert!(quiet, "full-frame backgrounds skip the canvas-edge, outline and light checks");
}

#[test]
fn coaching_and_review_reminders() {
    // Coaching: next steps on a new sprite, and reminders when saving without (or after) a review.
    let mut coach = Engine::new();
    let started = strings(js(&mut coach, "new_sprite", json!({"width": 16, "height": 16})).get("next_steps"));
    assert!(
        has(&started, "make_color_ramp") && started.last().is_some_and(|s| s.contains("review_model again")),
        "a new sprite lists next steps with ramps and a second review"
    );
    let coach_dir = temp("coach");
    let target = path(&coach_dir, "x.png");
    let reminder = |e: &mut Engine| -> Option<String> {
        js(e, "export_png", json!({"path": target})).get("review_reminder").and_then(Json::as_str).map(String::from)
    };
    run(&mut coach, "paint_slice", json!({"rows": ["..11..", ".1221.", "112211"], "legend": {"1": "#222034", "2": "#df7126"}}));
    let unreviewed = reminder(&mut coach);
    run(&mut coach, "add_colors", json!({"colors": ["#df7127"]}));
    run(&mut coach, "set_pixels", json!({"pixels": [[2, 4, "#df7127"]]}));
    let first_review = js(&mut coach, "review_model", json!({}));
    let open_issues = reminder(&mut coach);
    run(&mut coach, "set_pixels", json!({"pixels": [[2, 4, "#df7126"]]}));
    let changed = reminder(&mut coach);
    let second = strings(js(&mut coach, "review_model", json!({})).get("issues")).len();
    let re_reviewed = reminder(&mut coach);
    let next = strings(first_review.get("next"));
    assert!(
        unreviewed.as_deref().is_some_and(|s| s.contains("without a review"))
            && open_issues.as_deref().is_some_and(|s| s.contains("issue(s)"))
            && changed.as_deref().is_some_and(|s| s.contains("since the last review")),
        "exports remind: not reviewed, issues still open, changed since the review ({unreviewed:?} | {open_issues:?} | {changed:?})"
    );
    let pal_warn = strings(js(&mut coach, "set_palette", json!({"colors": ["#2b2a55", "#2c2b57", "#a65a86"]})).get("warnings"));
    let add_warn = strings(js(&mut coach, "add_colors", json!({"colors": ["#a75b87", "#ffd23f"]})).get("warnings"));
    assert!(
        pal_warn.first().is_some_and(|s| s.contains("#2b2a55 and #2c2b57"))
            && add_warn.first().is_some_and(|s| s.contains("#a75b87 and #a65a86"))
            && !has(&add_warn, "#ffd23f"),
        "set_palette and add_colors warn about near-identical colours as they are chosen ({:?} | {:?})",
        pal_warn.first(),
        add_warn.first()
    );
    assert!(
        has(&next, "review_model again") && has(&next, "make_color_ramp"),
        "a review with colour issues says to review again and points to make_color_ramp ({next:?})"
    );
    if second == 0 {
        assert!(re_reviewed.is_none(), "after a fresh review the reminder only reflects that review's open issues ({re_reviewed:?})");
    } else {
        assert!(
            re_reviewed.as_deref().is_some_and(|s| s.contains(&format!("listed {second} issue(s)"))),
            "after a fresh review the reminder only reflects that review's open issues ({re_reviewed:?})"
        );
    }
    let _ = std::fs::remove_dir_all(&coach_dir);
}

#[test]
fn floating_scene() {
    // A floating 3D scene: a grounded block, a big separate cloud (fine) and one broken-off voxel (a stray).
    let mut scene = Engine::new();
    run(&mut scene, "new_model", json!({"size_x": 24, "size_y": 24, "size_z": 24}));
    run(&mut scene, "fill_box", json!({"from": [4, 0, 4], "to": [12, 6, 12], "color": 3}));
    run(&mut scene, "fill_box", json!({"from": [15, 16, 15], "to": [20, 18, 19], "color": 22}));
    run(&mut scene, "set_voxels", json!({"voxels": [[2, 10, 2]], "color": 5}));
    let sr = js(&mut scene, "analyze_model", json!({}));
    let (issues, tips) = (strings(sr.get("issues")), strings(sr.get("tips")));
    assert!(
        has(&issues, "1 tiny loose piece") && has(&tips, "1 larger piece") && !has(&issues, "float in the air"),
        "3D: a broken-off voxel is an issue, a separate cloud only a tip ({issues:?}, {tips:?})"
    );
}

#[test]
fn observation_static_sprite() {
    // STATIC: the score ranks a top-left-lit orb above a pillow-shaded one, and the automatic critique
    // pins each change on the edit that made it.
    let mut st = Engine::new();
    run(&mut st, "new_sprite", json!({"width": 24, "height": 24}));
    let c1 = object(js(&mut st, "paint_slice", json!({"rows": disc(false), "legend": orb_colours()})).get("critique"));
    let c2 = object(js(&mut st, "paint_slice", json!({"rows": disc(true), "legend": orb_colours()})).get("critique"));
    let (pillow_score, lit_score) = (int(c1.get("score")).unwrap_or(-1), int(c2.get("score")).unwrap_or(-1));
    assert!(
        has(&strings(c1.get("findings")), "pillow")
            && lit_score > pillow_score
            && int(c2.get("change")) == Some(lit_score - pillow_score)
            && strings(c2.get("resolved")).contains(&"pillow_shading".to_string()),
        "static: the first edit's critique lists pillow shading; relighting resolves it and raises the score ({pillow_score} → {lit_score})"
    );
    let cleaned = js(&mut st, "pixel_perfect", json!({}));
    let clean_crit = object(cleaned.get("critique"));
    let removed = cleaned.get("cells").and_then(Json::as_array).and_then(|c| c.first()).cloned().unwrap_or(json!({}));
    let (x, row) = (int(removed.get("x")).unwrap_or(0), int(removed.get("row")).unwrap_or(0));
    let redo = object(js(&mut st, "set_pixels", json!({"pixels": [[x, row, "#222034"]]})).get("critique"));
    assert!(
        strings(clean_crit.get("resolved")).contains(&"doubled_corners".to_string())
            && has(&strings(redo.get("introduced")), "doubled corner")
            && int(redo.get("change")).unwrap_or(0) < 0,
        "static: pixel_perfect's critique resolves doubled corners; putting one back is reported as introduced, with the score drop"
    );
    run(&mut st, "undo", json!({}));
    run(&mut st, "set_pixels", json!({"pixels": [[6, 9, "#ff00ff"]]}));
    let st_text = js(&mut st, "view_as_text", json!({"region": [0, 0, 23, 23]}));
    let (pix, pix_rulers) = text_grid(&st_text, "pixels");
    let magenta = object(st_text.get("legend")).iter().find(|(_, v)| v.get("hex").and_then(Json::as_str) == Some("#ff00ff")).map(|(k, _)| k.clone());
    assert!(
        pix_rulers && magenta.is_some() && at(&pix, 9, 6).map(|c| c.to_string()) == magenta && at(&pix, 0, 0) == Some('.'),
        "static: view_as_text pixels put x=6, row 9 under its ruler labels, with the legend colour"
    );
    let (vals, _) = text_grid(&st_text, "values");
    let mean_value = |rows: std::ops::RangeInclusive<i64>, cols: std::ops::RangeInclusive<i64>| -> f64 {
        let ds: Vec<u32> = rows.flat_map(|r| cols.clone().filter_map(|c| at(&vals, r, c).and_then(|ch| ch.to_digit(10))).collect::<Vec<_>>()).collect();
        if ds.is_empty() { 0.0 } else { ds.iter().sum::<u32>() as f64 / ds.len() as f64 }
    };
    assert!(
        mean_value(4..=10, 4..=10) > mean_value(13..=19, 13..=19),
        "static: the value map is brighter toward the top-left light ({} vs {})",
        mean_value(4..=10, 4..=10),
        mean_value(13..=19, 13..=19)
    );
}

#[test]
fn observation_animation() {
    // ANIMATION: a walk frame that lifts the whole body (feet off the ground line) versus one that only
    // swings the arms; the diff map agrees with the frame counts.
    let walker = json!([
        "................", "......1111......", ".....133331.....", ".....134431.....", ".....133331.....",
        "......1331......", ".....133331.....", "....13333331....", "....13333331....", ".....133331.....",
        ".....133331.....", ".....13..31.....", ".....13..31.....", ".....13..31.....", "....113..311....", "................"
    ]);
    let walk = |lift: bool| -> Engine {
        let mut w = Engine::new();
        run(&mut w, "new_sprite", json!({"width": 16, "height": 16}));
        run(&mut w, "paint_slice", json!({"rows": walker, "legend": orb_colours()}));
        run(&mut w, "add_frame", json!({}));
        if lift {
            run(&mut w, "transform", json!({"op": "move", "dy": 1}));
        } else {
            run(&mut w, "set_pixels", json!({"pixels": [[3, 8, "#222034"], [12, 8, "#222034"], [4, 7, "#ac3232"], [11, 7, "#ac3232"]]}));
        }
        w
    };
    let (mut lifted, mut planted) = (walk(true), walk(false));
    let lift_json = js(&mut lifted, "analyze_model", json!({}));
    let lift_anim = object(lift_json.get("animation"));
    let (lift_score, plant_score) = (object(lift_json.get("score")), score(&mut planted));
    let anim_cat = |s: &JsonMap| int(object(s.get("categories")).get("animation")).unwrap_or(-1);
    assert!(
        codes(&lift_score).contains(&"ground_jitter".to_string())
            && !codes(&plant_score).contains(&"ground_jitter".to_string())
            && lift_anim.get("ground_line") == Some(&json!([14, 13]))
            && anim_cat(&plant_score) > anim_cat(&lift_score),
        "animation: lifting the feet is flagged as ground-line jitter (rows {:?}); swinging the arms is not ({} < {})",
        lift_anim.get("ground_line"),
        anim_cat(&lift_score),
        anim_cat(&plant_score)
    );
    let last_crit = object(js(&mut lifted, "transform", json!({"op": "move", "dy": -1})).get("critique"));
    assert!(
        strings(last_crit.get("resolved")).contains(&"ground_jitter".to_string()),
        "animation: moving the frame back down resolves the jitter in the critique ({last_crit:?})"
    );
    run(&mut lifted, "undo", json!({}));
    let frame_diff = js(&mut lifted, "view_as_text", json!({"maps": ["diff"], "frame": 1}));
    let dc = object(frame_diff.get("diff_counts"));
    let count = |k: &str, missing: i64| int(dc.get(k)).unwrap_or(missing);
    let filled_per_frame: Vec<i64> = lift_anim.get("filled_per_frame").and_then(Json::as_array).map(|l| l.iter().filter_map(Json::as_i64).collect()).unwrap_or_default();
    let (dg, diff_rulers) = text_grid(&frame_diff, "diff");
    assert!(
        diff_rulers
            && filled_per_frame.len() == 2
            && count("added", -1) + count("same", 0) + count("recolored", 0) == filled_per_frame[1]
            && count("removed", -1) + count("same", 0) + count("recolored", 0) == filled_per_frame[0]
            && int(frame_diff.get("diff_against_frame")) == Some(0)
            && at(&dg, 14, 4) == Some('-')
            && at(&dg, 0, 6) == Some('+'),
        "animation: the diff map against the previous frame accounts for every filled pixel of both frames ({dc:?})"
    );
    let no_diff = error_of(&mut Engine::new(), "view_as_text", json!({"maps": ["diff"]}));
    assert_eq!(no_diff, "diff needs two frames; add_frame first or give compare_frame", "animation: a diff on a single frame is refused with a reason");
}

#[test]
fn observation_background() {
    // BACKGROUND: hard flat sky stripes score below dithered ones; neither is wrecked by sprite-only checks
    // (edge, outline, light), and the text view shows the whole canvas.
    let mut sky_scores: HashMap<bool, i64> = HashMap::new();
    let mut sky_rows: HashMap<bool, TextGrid> = HashMap::new();
    for dithered in [false, true] {
        let mut bg = Engine::new();
        run(&mut bg, "new_sprite", json!({"width": 48, "height": 24}));
        run(&mut bg, "paint_slice", json!({"rows": sky(dithered), "legend": sky_colours()}));
        sky_scores.insert(dithered, int(score(&mut bg).get("total")).unwrap_or(-1));
        let t = js(&mut bg, "view_as_text", json!({"maps": ["pixels"]}));
        if t.get("columns").and_then(Json::as_str) == Some("x 0→47") && t.get("rows").and_then(Json::as_str) == Some("row 0→23") {
            sky_rows.insert(dithered, text_grid(&t, "pixels").0);
        }
    }
    assert!(
        sky_scores[&true] > sky_scores[&false] && sky_scores[&false] >= 85,
        "background: dithered band edges score above hard stripes, and a background is not penalised as a sprite ({} < {})",
        sky_scores[&false],
        sky_scores[&true]
    );
    let distinct = |g: Option<&TextGrid>, r: i64| -> usize {
        g.and_then(|g| g.get(&r)).map(|row| row.values().collect::<std::collections::HashSet<_>>().len()).unwrap_or(0)
    };
    assert!(
        sky_rows.len() == 2 && distinct(sky_rows.get(&false), 6) == 1 && distinct(sky_rows.get(&true), 6) == 2,
        "background: the text view covers the full canvas; a hard band edge is one character wide, a dithered one mixes two"
    );
}

#[test]
fn observation_voxel_model() {
    // VOXEL: projections face the right way, and the critique catches a stray voxel when it is placed and
    // clears it when it is erased.
    let mut vx = Engine::new();
    run(&mut vx, "new_model", json!({"size_x": 12, "size_y": 12, "size_z": 12}));
    run(&mut vx, "fill_box", json!({"from": [2, 0, 2], "to": [8, 5, 8], "color": 3}));
    let tower_crit = object(js(&mut vx, "fill_box", json!({"from": [2, 6, 6], "to": [4, 9, 8], "color": 5})).get("critique"));
    let stray_crit = object(js(&mut vx, "set_voxels", json!({"voxels": [[10, 8, 10]], "color": 7})).get("critique"));
    let erase_crit = object(js(&mut vx, "erase_voxels", json!({"voxels": [[10, 8, 10]]})).get("critique"));
    assert!(
        has(&strings(stray_crit.get("introduced")), "loose piece")
            && int(stray_crit.get("change")).unwrap_or(0) < 0
            && strings(erase_crit.get("resolved")).contains(&"floating_strays".to_string())
            && int(erase_crit.get("score")).is_some()
            && int(erase_crit.get("score")) == int(tower_crit.get("score")),
        "voxel: placing a stray voxel is reported as introduced; erasing it resolves it and restores the score ({:?})",
        tower_crit.get("score")
    );
    // The tower stands on the left (x 2-4) at the front (z 6-8) of the block.
    let mut sil = |view: &str| -> TextGrid { text_grid(&js(&mut vx, "view_as_text", json!({"view": view, "maps": ["silhouette"]})), "silhouette").0 };
    let (front, left, right, above) = (sil("front"), sil("left"), sil("right"), sil("top"));
    assert!(
        at(&front, 9, 2) == Some('#')
            && at(&front, 9, 5) == Some('.')
            && at(&left, 9, 7) == Some('#')
            && at(&left, 9, 3) == Some('.')
            && at(&right, 9, 7) == Some('#')
            && at(&above, 7, 3) == Some('#')
            && at(&above, 3, 3) == Some('#')
            && at(&front, 5, 8) == Some('#'),
        "voxel: front, left, right and top projections put the tower at the left front of the block"
    );
    // Reading order, not just labels: from the left the front (high z) is on the right of each text row, from
    // the right it is on the left, from the front low x is on the left.
    let mut order = |view: &str| -> Option<String> {
        js(&mut vx, "view_as_text", json!({"view": view, "maps": ["silhouette"]})).get("columns").and_then(Json::as_str).map(String::from)
    };
    assert!(
        order("left").as_deref() == Some("z 1→9")
            && order("right").as_deref() == Some("z 9→1")
            && order("front").as_deref() == Some("x 1→9")
            && order("back").as_deref() == Some("x 9→1"),
        "voxel: each projection reads left to right as that view is seen"
    );
    let top_text = js(&mut vx, "view_as_text", json!({"view": "top", "maps": ["pixels"]}));
    let top_pix = text_grid(&top_text, "pixels").0;
    let tower_char = object(top_text.get("legend")).iter().find(|(_, v)| int(v.get("index")) == Some(5)).map(|(k, _)| k.clone());
    assert!(
        tower_char.is_some() && at(&top_pix, 7, 3).map(|c| c.to_string()) == tower_char && at(&top_pix, 3, 3).map(|c| c.to_string()) != tower_char,
        "voxel: the top projection shows the first voxel from above (the tower's colour on top of the tower only)"
    );
}

#[test]
fn style_lock() {
    // STYLE LOCK: a locked palette, size and light for a set; agents can't drift, the person still can.
    let dir = temp("style");
    let mut sty = Engine::new();
    let style_file = path(&dir, "house.json");
    let set = js(
        &mut sty,
        "set_style",
        json!({"name": "house", "preset": "pico8", "max_colors": 6, "light": "top-left", "outline": "dark", "size": [16, 16],
               "notes": ["2px chunky outlines"], "save_path": style_file}),
    );
    run(&mut sty, "new_sprite", json!({}));
    let info = js(&mut sty, "get_model_info", json!({}));
    let refusal = error_of(&mut sty, "set_pixels", json!({"pixels": [[3, 3, "#123456"]]}));
    let ramp_refused = run(&mut sty, "make_color_ramp", json!({"base": "#c0503c"})).is_none();
    let exact = run(&mut sty, "set_pixels", json!({"pixels": [[3, 3, "#ff004d"]]}));
    assert!(!set.contains_key("critique"), "style: locking a style on an empty canvas gives no critique (nothing is drawn yet)");
    assert!(
        set.contains_key("saved")
            && info.get("size") == Some(&json!([16, 16, 1]))
            && int(info.get("palette_colors")) == Some(16)
            && refusal.contains("locks the palette")
            && refusal.contains("Closest")
            && ramp_refused
            && exact.is_some(),
        "style: new canvases take the locked size and palette; off-palette hex colours and ramps are refused with the closest colours, exact matches pass ({refusal})"
    );
    run_as(&mut sty, "set_pixels", json!({"pixels": [[4, 4, "#123456"]]}), "person");
    let sty_score = score(&mut sty);
    let sty_notes = strings(js(&mut sty, "review_model", json!({})).get("style_notes"));
    assert!(
        codes(&sty_score).contains(&"style_palette".to_string()) && object(sty_score.get("categories")).contains_key("style") && sty_notes == ["2px chunky outlines"],
        "style: the person may still use any colour; the review flags it against the style and repeats the notes"
    );
    let mut loaded = Engine::new();
    run(&mut loaded, "paint_slice", json!({"rows": disc(true), "legend": orb_colours()}));
    let applied = js(&mut loaded, "set_style", json!({"path": style_file}));
    let loaded_style = object(js(&mut loaded, "get_style", json!({})).get("style"));
    let moved = int(object(applied.get("applied_to_canvas")).get("drawn_colours_moved_to_closest")).unwrap_or(0);
    assert!(
        loaded_style.get("name").and_then(Json::as_str) == Some("house")
            && strings(loaded_style.get("colors")).len() == 16
            && moved > 0
            && !codes(&score(&mut loaded)).contains(&"style_palette".to_string()),
        "style: a saved style file loads in another session and moves a drawing's colours into the locked palette ({moved} moved)"
    );
    run(&mut loaded, "undo", json!({}));
    let relocked = run(&mut loaded, "set_pixels", json!({"pixels": [[1, 1, "#ff004d"]]}));
    assert!(relocked.is_some(), "style: after undoing the palette change, a locked colour can still be used (it is added back)");
    let mut light_lock = Engine::new();
    run(&mut light_lock, "new_sprite", json!({"width": 24, "height": 24}));
    run(&mut light_lock, "set_style", json!({"name": "lit", "lock_palette": false, "light": "top-left"}));
    run(&mut light_lock, "paint_slice", json!({"rows": disc(true), "legend": orb_colours()}));
    let lit_ok = !codes(&score(&mut light_lock)).contains(&"style_light".to_string());
    run(&mut light_lock, "transform", json!({"op": "flip", "axis": "x"}));
    run(&mut light_lock, "transform", json!({"op": "flip", "axis": "y"}));
    assert!(
        lit_ok && codes(&score(&mut light_lock)).contains(&"style_light".to_string()),
        "style: shading that agrees with the locked light passes; the same orb lit from the bottom-right is flagged"
    );
    // The style file is laid out as the Swift app wrote it.
    let saved = std::fs::read_to_string(&style_file).expect("the style file");
    assert!(saved.starts_with("{\n  \"colors\" : [\n    \"#000000\",\n") && saved.contains("\n  \"lock_palette\" : true,\n") && saved.ends_with("\n}"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn batches() {
    // BATCH: many calls in one request, one critique; checked up front; atomic rollback.
    let mut bat = Engine::new();
    run(&mut bat, "new_sprite", json!({"width": 8, "height": 8}));
    let ok3 = js(
        &mut bat,
        "batch",
        json!({"calls": [
            {"tool": "paint_slice", "args": {"rows": ["........", ".1111...", ".1221...", ".1111..."], "legend": {"1": "#222034", "2": "#df7126"}}},
            {"tool": "set_pixels", "args": {"pixels": [[5, 2, "#df7126"]]}},
            {"tool": "view_as_text", "args": {"maps": ["silhouette"]}},
        ]}),
    );
    let inner: Vec<JsonMap> = ok3.get("results").and_then(Json::as_array).map(|l| l.iter().map(|r| object(Some(r))).collect()).unwrap_or_default();
    assert!(
        int(ok3.get("ran")) == Some(3)
            && int(ok3.get("failed")) == Some(0)
            && ok3.contains_key("critique")
            && !inner.iter().any(|r| object(r.get("result")).contains_key("critique"))
            && inner.last().is_some_and(|r| object(r.get("result")).contains_key("silhouette")),
        "batch: three calls run in one request with one critique for the whole batch"
    );
    let rev_before = bat.revision();
    let typo = run(&mut bat, "batch", json!({"calls": [{"tool": "set_pixels", "args": {"pixels": [[0, 0, 1]]}}, {"tool": "set_pixel"}]}));
    let rev_after_typo = bat.revision();
    let filled_before = filled(&mut bat);
    let atomic = js(
        &mut bat,
        "batch",
        json!({"atomic": true, "calls": [
            {"tool": "set_pixels", "args": {"pixels": [[0, 7, 1], [1, 7, 1]]}}, {"tool": "fill_box", "args": {"from": [0, 0, 0]}},
        ]}),
    );
    let filled_after = filled(&mut bat);
    assert!(
        typo.is_none() && rev_after_typo == rev_before && atomic.get("rolled_back") == Some(&json!(true)) && filled_before == filled_after,
        "batch: an unknown tool is refused before anything runs; atomic=true rolls back when a call fails ({filled_before:?} = {filled_after:?} pixels)"
    );
}

#[test]
fn set_review() {
    // SET REVIEW: three saved orbs, one lit from the other side in other colours.
    let dir = temp("set");
    let mut set_paths: Vec<String> = Vec::new();
    let cool = json!({"1": "#1a1c2c", "2": "#3b5dc9", "3": "#41a6f6", "4": "#73eff7"});
    for (k, (flip, colours)) in [(false, orb_colours()), (false, orb_colours()), (true, cool)].into_iter().enumerate() {
        let mut e2 = Engine::new();
        run(&mut e2, "new_sprite", json!({"width": 24, "height": 24}));
        run(&mut e2, "paint_slice", json!({"rows": disc(true), "legend": colours}));
        if flip {
            run(&mut e2, "transform", json!({"op": "flip", "axis": "x"}));
            run(&mut e2, "transform", json!({"op": "flip", "axis": "y"}));
        }
        let p = path(&dir, &format!("orb{k}.openpixel"));
        run(&mut e2, "save_model", json!({"path": p}));
        set_paths.push(p);
    }
    let rs = run(&mut Engine::new(), "review_set", json!({"paths": set_paths})).expect("review_set runs");
    let set_json = object(rs.json.get("set"));
    let (set_issues, set_tips) = (strings(set_json.get("issues")), strings(set_json.get("tips")));
    assert!(
        rs.images.len() == 1
            && rs.json.get("files").and_then(Json::as_array).map(Vec::len) == Some(3)
            && set_json.contains_key("weakest_file")
            && has(&set_issues, "different sides")
            && has(&set_tips, "drift"),
        "review_set: one contact sheet, a score per file, and set checks for mixed light and palette drift ({set_issues:?} {set_tips:?})"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn update_feed() {
    // UPDATES: agents read the feed the app's own updater reads (here a local file as electron-builder writes it).
    assert!(
        updates::compare("1.10.0", "1.9.2") == 1 && updates::compare("1.0", "1.0.0") == 0 && updates::compare("1.99.99", "2.0.0") == -1,
        "updates: versions compare by number, not as text"
    );
    assert!(
        updates::compare("1.3.0-beta.1", "1.3.0") == -1 && updates::compare("1.3.0-beta.2", "1.3.0-beta.10") == -1 && updates::compare("1.3.0-beta.1", "1.2.9") == 1,
        "updates: a pre-release is older than its release and newer than the release before"
    );
    fn feed_text(version: &str) -> String {
        format!(
            "version: {version}\nfiles:\n  - url: OpenPixel.AppImage\n    sha512: c2hhNTEy\n    size: 1\n    blockMapSize: 1\npath: OpenPixel.AppImage\nsha512: c2hhNTEy\nreleaseDate: '2026-11-22T11:24:00.000Z'\n"
        )
    }
    let dir = temp("updates");
    let feed = dir.join("latest-linux.yml");
    updates::set_feed_override(Some(feed.to_string_lossy().into_owned()));
    std::fs::write(&feed, feed_text("9.10.1")).expect("writes the feed");
    let mut upd = Engine::new();
    let newer = js(&mut upd, "check_for_updates", json!({"refresh": true}));
    let install_note = js(&mut upd, "check_for_updates", json!({"install": true}));
    let text = |m: &JsonMap, k: &str| m.get(k).and_then(Json::as_str).unwrap_or("").to_string();
    assert!(
        text(&newer, "latest_version") == "9.10.1"
            && newer.get("update_available") == Some(&json!(true))
            && text(&newer, "download") == "https://openpixel.dev/downloads"
            && text(&newer, "release_notes") == "https://github.com/sophne/openpixel/releases/tag/v9.10.1"
            && text(&newer, "release_date") == "2026-11-22T11:24:00.000Z"
            && text(&newer, "next").contains("install=true")
            && text(&install_note, "install").contains("No OpenPixel window"),
        "updates: the release in the feed is found, with its download page and notes; without a window, install says what to do ({newer:?})"
    );
    std::fs::write(&feed, feed_text("0.0.1")).expect("writes the feed");
    let cached_answer = text(&js(&mut upd, "check_for_updates", json!({})), "latest_version");
    let current = js(&mut upd, "check_for_updates", json!({"refresh": true}));
    assert!(
        cached_answer == "9.10.1" && current.get("update_available") == Some(&json!(false)) && text(&current, "next").contains("up to date"),
        "updates: answers are cached for a while, refresh asks again, and an older feed means up to date"
    );
    // Damaged feeds: an error page, the old appcast, a file cut short, one far too large. An error, never
    // "up to date", never a crash.
    for damaged in [
        "<html><body><h1>Not Found</h1></body></html>".to_string(),
        "<rss><channel></channel></rss>".to_string(),
        "versi".to_string(),
        "version: \"9.10".to_string(),
        "files:\n  - url: OpenPixel.AppImage\n    version: 9.9.9\n".to_string(),
        String::new(),
    ] {
        std::fs::write(&feed, &damaged).expect("writes the feed");
        assert_eq!(
            error_of(&mut upd, "check_for_updates", json!({"refresh": true})),
            "the update feed lists no release",
            "updates: a feed without a release is an error, not \"up to date\" ({damaged:?})"
        );
    }
    std::fs::write(&feed, format!("version: 9.10.1\n{}", "x".repeat(updates::MAX_FEED_BYTES))).expect("writes the feed");
    assert_eq!(error_of(&mut upd, "check_for_updates", json!({"refresh": true})), "the update feed is too large to be one");
    std::fs::write(&feed, [0xffu8, 0xfe, 0x00, 0x80, 0xc3, 0x28]).expect("writes the feed");
    assert_eq!(error_of(&mut upd, "check_for_updates", json!({"refresh": true})), "the update feed lists no release");
    // The same answer from feed text a host fetched itself, and the restart note when a newer one is installed.
    let pure = updates::report_from_feed(&feed_text("9.10.1"), "9.9.0", Some("9.10.1")).expect("reads the feed");
    assert!(text(&pure, "latest_version") == "9.10.1" && text(&pure, "installed_version") == "9.10.1" && text(&pure, "restart_needed").contains("still runs 9.9.0"));
    // Each system reads its own file of the newest release.
    assert!(
        updates::default_feed_for(updates::Os::Mac).ends_with("/releases/latest/download/latest-mac.yml")
            && updates::default_feed_for(updates::Os::Windows).ends_with("/releases/latest/download/latest.yml")
            && updates::default_feed_for(updates::Os::Linux).ends_with("/releases/latest/download/latest-linux.yml"),
        "updates: the feed is electron-builder's file for the system"
    );
    updates::set_feed_override(None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn damaged_and_hostile_files() {
    // Damaged and hostile files must fail with an error, never crash or read past the data.
    fn chunk(id: &str, len: u32, body: &[u8]) -> Vec<u8> {
        let mut c = id.as_bytes().to_vec();
        c.extend(len.to_le_bytes());
        c.extend([0, 0, 0, 0]);
        c.extend(body);
        c
    }
    let cat = |parts: &[&[u8]]| -> Vec<u8> { parts.concat() };
    let header: Vec<u8> = cat(&[b"VOX ", &[150, 0, 0, 0]]);
    let hostile: Vec<(&str, Vec<u8>)> = vec![
        ("truncated SIZE", cat(&[&header, &chunk("SIZE", 12, &[8, 0, 0, 0])])),
        (
            "chunk longer than file",
            cat(&[&header, &chunk("SIZE", 12, &[2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]), &chunk("XYZI", 0xFFFF_FFF0, &[1, 0, 0, 0])]),
        ),
        ("huge model size", cat(&[&header, &chunk("SIZE", 12, &[0, 0, 0, 0x7F, 0, 0, 0, 0x7F, 0, 0, 0, 0x7F])])),
        ("zero model size", cat(&[&header, &chunk("SIZE", 12, &[0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])])),
        ("short palette", cat(&[&header, &chunk("SIZE", 12, &[4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]), &chunk("RGBA", 8, &[1, 2, 3, 4, 5, 6, 7, 8])])),
        ("only a header", header.clone()),
    ];
    for (what, bytes) in &hostile {
        assert!(vox_file::decode(bytes, "x").is_err(), ".vox {what} is refused");
    }
    // Colour 200 with no palette: the voxel stays inside the model but is cleared, not looked up.
    let no_palette = cat(&[&header, &chunk("SIZE", 12, &[2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]), &chunk("XYZI", 8, &[1, 0, 0, 0, 1, 1, 1, 200])]);
    let d = vox_file::decode(&no_palette, "x").expect(".vox without palette opens");
    assert!(d.cels[0][0].data().iter().all(|&v| (v as usize) < d.palette.len()), ".vox colours past the palette are dropped");
    let big_json = r#"{"format":"openpixel","size":[256,256,256],"frames":[{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}]}"#;
    assert!(native_file::decode(big_json.as_bytes()).is_err(), ".openpixel asking for too much memory is refused");
    let short_pal = r##"{"format":"openpixel","size":[1,1,1],"palette":["transparent","#ff0000"],"cels":[{"layer":0,"frame":0,"encoding":"zlib-base64","data":"OwEA"}]}"##;
    let d = native_file::decode(short_pal.as_bytes()).expect(".openpixel with a short palette opens");
    assert!(d.cels[0][0].data().iter().all(|&v| (v as usize) < d.palette.len()), ".openpixel colours past the palette are dropped");

    // Beyond the Swift app list: every way of cutting a real file short, and stray bytes, end in an error or a
    // document, never a panic.
    let mut e = Engine::new();
    sample::build(&mut e, true);
    let good_vox = vox_file::encode(e.doc(), 0).expect("encodes");
    for cut in 0..good_vox.len().min(2000) {
        let _ = vox_file::decode(&good_vox[..cut], "x");
    }
    for i in (0..good_vox.len().min(1200)).step_by(7) {
        let mut b = good_vox.clone();
        b[i] = 0xFF;
        let _ = vox_file::decode(&b, "x");
    }
    let good_native = native_file::encode(e.doc()).expect("encodes");
    for cut in (0..good_native.len()).step_by(37) {
        let _ = native_file::decode(&good_native[..cut]);
    }
    for (what, text) in [
        ("not JSON", "hello"),
        ("an array", "[]"),
        ("another format", r#"{"format":"other","size":[1,1,1]}"#),
        ("a size that is not whole numbers", r#"{"format":"openpixel","size":[1.5,1,1]}"#),
        ("a size of zero", r#"{"format":"openpixel","size":[0,1,1]}"#),
        ("a cel of the wrong size", r#"{"format":"openpixel","size":[2,2,2],"cels":[{"layer":0,"frame":0,"data":"OwEA"}]}"#),
        ("a cel that is not DEFLATE data", r#"{"format":"openpixel","size":[2,2,2],"cels":[{"layer":0,"frame":0,"data":"/////w=="}]}"#),
    ] {
        assert!(native_file::decode(text.as_bytes()).is_err(), ".openpixel {what} is refused");
    }
    // Entries that the Swift app reader skipped are skipped here too.
    let skipped = r#"{"format":"openpixel","size":[1,1,1],"cels":[{"layer":5,"frame":0,"data":"OwEA"},{"layer":0,"frame":0,"data":"not base64!"},{"layer":"0"}]}"#;
    assert!(native_file::decode(skipped.as_bytes()).is_ok(), ".openpixel cels that point nowhere are skipped");
    for bytes in [&b"\x89PNG\r\n\x1a\n"[..], &b"GIF89a"[..], &b"GIF89a\xff\xff\xff\xff\x00\x00\x00"[..], &b""[..], &b"plain text"[..]] {
        assert!(image_files::read_bytes(bytes).is_none(), "a damaged picture is refused");
    }
}

// MARK: - beyond the Swift app list: what the rest of the program relies on

#[test]
fn the_engine_can_move_between_threads() {
    fn assert_send<T: Send>() {}
    assert_send::<Engine>();
    let mut e = Engine::new();
    sample::build(&mut e, false);
    let moved = std::thread::spawn(move || e.name().to_string()).join().expect("joins");
    assert_eq!(moved, "Mushroom");
}

#[test]
fn paths_are_worked_out_as_text_for_both_kinds_of_separator() {
    use openpixel_core::io::paths;
    struct Home(&'static str);
    impl openpixel_core::HostIo for Home {
        fn read(&self, _: &str) -> Result<Vec<u8>, String> {
            Err("no".into())
        }
        fn write(&self, _: &str, _: &[u8]) -> Result<(), String> {
            Err("no".into())
        }
        fn exists(&self, _: &str) -> bool {
            false
        }
        fn create_dir_all(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn home_dir(&self) -> Option<String> {
            Some(self.0.to_string())
        }
        fn now(&self) -> f64 {
            0.0
        }
        fn http_get(&self, _: &str) -> Result<Vec<u8>, String> {
            Err("no".into())
        }
    }
    for (path, name, stem, ext, parent) in [
        ("/a/b/sprite.png", "sprite.png", "sprite", "png", Some("/a/b")),
        (r"C:\art\sprite.PNG", "sprite.PNG", "sprite", "PNG", Some(r"C:\art")),
        (r"C:\sprite.vox", "sprite.vox", "sprite", "vox", None),
        ("sprite", "sprite", "sprite", "", None),
        ("/a.b/sprite", "sprite", "sprite", "", Some("/a.b")),
        ("/a/.hidden", ".hidden", ".hidden", "", Some("/a")),
        ("/a/archive.tar.gz", "archive.tar.gz", "archive.tar", "gz", Some("/a")),
        ("/x.png", "x.png", "x", "png", None),
    ] {
        assert_eq!(paths::file_name(path), name, "{path}");
        assert_eq!(paths::file_stem(path), stem, "{path}");
        assert_eq!(paths::extension(path), ext, "{path}");
        assert_eq!(paths::parent(path), parent, "{path}");
    }
    assert_eq!(paths::without_extension(r"C:\art\hut.obj"), r"C:\art\hut");
    assert_eq!(paths::append_extension("/a/hut", "mtl"), "/a/hut.mtl");
    assert_eq!(paths::expand_tilde("~/art/x.png", &Home("/home/me")), "/home/me/art/x.png");
    assert_eq!(paths::expand_tilde(r"~\art\x.png", &Home(r"C:\Users\me")), r"C:\Users\me\art\x.png");
    assert_eq!(paths::expand_tilde("~", &Home("/home/me/")), "/home/me");
    assert_eq!(paths::expand_tilde("~other/x.png", &Home("/home/me")), "~other/x.png");
    assert_eq!(paths::expand_tilde("/a/~b", &Home("/home/me")), "/a/~b");

    // A host without files: every file tool answers with an error, and nothing panics.
    let mut e = Engine::with_io(Box::new(openpixel_core::NoIo));
    assert_eq!(error_of(&mut e, "open_model", json!({"path": "/x.openpixel"})), "could not read /x.openpixel: this host cannot read files");
    assert_eq!(error_of(&mut e, "export_png", json!({"path": "/x/y.png"})), "could not create folder /x: this host cannot create folders");
    assert_eq!(error_of(&mut e, "export_png", json!({"path": "y"})), "could not write y.png: this host cannot write files");
    assert_eq!(error_of(&mut e, "import_image", json!({"path": "y.png"})), "could not read image y.png");
    assert!(run(&mut e, "review_model", json!({})).is_some());
}

#[test]
fn absurd_arguments_are_refused_or_ignored_without_a_crash() {
    let mut e = Engine::new();
    run(&mut e, "new_model", json!({"size_x": 8, "size_y": 8, "size_z": 8}));
    let huge = 1.0e300;
    for (tool, args) in [
        ("fill_box", json!({"from": [-huge, -huge, -huge], "to": [huge, huge, huge], "color": 1})),
        ("draw_sphere", json!({"center": [4, 4, 4], "radius": huge, "color": 2})),
        ("draw_sphere", json!({"center": ["nan", 4, 4], "radius": 2, "color": 2})),
        ("draw_cylinder", json!({"base": [4, 0, 4], "radius": 1.0e12, "length": 9007199254740993i64, "color": 3})),
        ("draw_line", json!({"from": [0, 0, 0], "to": [1.0e15, 3, 2], "radius": 2, "color": 4})),
        ("draw_line", json!({"from": [-9.0e15, 0, 0], "to": [9.0e15, 7, 7], "color": 4})),
        ("set_voxels", json!({"voxels": [[huge, 0, 0], [-huge, 1, 1]], "color": 5})),
        ("set_pixels", json!({"pixels": [[0, -huge], [huge, huge]], "color": 5})),
        ("transform", json!({"op": "move", "dx": 9007199254740993i64, "dy": -9007199254740993i64, "wrap": true})),
        ("transform", json!({"op": "rotate", "turns": -9007199254740993i64})),
        ("paint_slice", json!({"rows": ["11"], "index": -5, "depth": 9007199254740993i64, "offset": [huge, -huge]})),
        ("find_voxels", json!({"from": [40, 40, 40], "to": [50, 50, 50], "limit": huge})),
        ("render_view", json!({"scale": huge, "yaw": huge, "pitch": -huge})),
        ("review_model", json!({"scale": 0})),
        ("review_model", json!({"scale": 1000000})),
        ("undo", json!({"steps": huge})),
        ("set_frame_duration", json!({"duration_ms": -huge})),
        ("get_slice", json!({"index": huge})),
        ("view_as_text", json!({"region": [huge, -huge, 0, 0]})),
        ("resize_model", json!({"size_x": huge, "size_y": 1, "size_z": 1})),
    ] {
        // An answer or a refusal; the point is that it returns.
        let _ = e.execute(tool, args.as_object().expect("an object"), "agent");
    }
    assert!(run(&mut e, "analyze_model", json!({})).is_some());
}
