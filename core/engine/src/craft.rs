//! Pixel-art craft for agents (port of Craft.swift): the style guide they read before drawing, hue-shifted
//! colour ramps, checks for the classic mistakes (doubled line corners, stray pixels, pillow shading, too
//! many or near-identical colours) and the extra review pictures (pixel grid, values, silhouette, real size).
use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde_json::json;

use crate::formats::image_files;
use crate::model::{Document, Rgba};
use crate::observe::Findings;
use crate::render::{self, Picture};
use crate::style::StyleLock;
use crate::{num, Json, JsonMap, PcError};

// MARK: - guide

pub const TOPICS: [&str; 9] = ["all", "workflow", "shape", "color", "shading", "outline", "cleanup", "animation", "voxel"];

const GUIDE: [(&str, &str); 8] = [
    (
        "workflow",
        r#"WORKFLOW (2D sprite)
1. Pick the size first and draw at that size: 16×16 icons, 24-32 for characters and items, 48-64 for big subjects. Never draw big and shrink.
2. Choose the palette before drawing: 2-4 colour ramps (one per material: skin, cloth, metal, wood…), 3-5 shades each, plus one darkest outline colour. make_color_ramp with `base` builds a hue-shifted ramp.
3. Silhouette: fill the whole shape in ONE flat colour (paint_slice). Check it with review_model: the silhouette picture alone must say what the subject is.
4. Flat colours: block in each material with its middle shade. Keep shapes big and simple.
5. Shading: pick ONE light direction (top-left by default) and shade each form by how it faces the light, not by distance from the edge.
6. Outline and edges, then details last (eyes, buckles, highlights): a detail is 1-3 pixels at this size.
7. Clean up: run review_model, fix every issue it lists (pixel_perfect fixes doubled corners), and look at the actual-size picture: that is what players see.
Each edit's critique says which findings it introduced or resolved; view_as_text shows the canvas as text with coordinate rulers when you need exact positions.
Draw symmetric subjects (faces, front-facing characters, chests, trees) on one half and mirror with transform op=mirror, then break the symmetry slightly by hand if it looks stiff."#,
    ),
    (
        "shape",
        r#"SHAPE AND READABILITY
- Silhouette first: a strong, readable outline shape beats inner detail. Exaggerate proportions (big head, big hands, chunky props) at small sizes.
- Lines: draw curves and diagonals as runs of pixels that grow or shrink evenly (1-1-1, 2-2-2, 1-2-3-4, 4-3-2-1). A run that breaks the pattern (2-2-1-2-2, 3-1-3) is a "jaggy" and looks broken.
- Diagonal lines touch corner to corner. Never put a pixel in the inside corner of a 1-pixel line (an "L" step); that is a "double" and makes lines look thick and blurry.
- Clusters: group same-coloured pixels into clean clumps. Single pixels of a different colour floating in a fill read as noise.
- Leave a 1-pixel margin around the sprite for the outline.
- Every detail must earn its pixels: if it does not read at actual size, remove it."#,
    ),
    (
        "color",
        r#"COLOUR
- Few colours: about 4-8 for a 16px sprite, 8-16 for 32px, up to 24-32 for big pieces. Reuse ramps across materials.
- Hue-shift ramps: shadows move toward blue/purple and get more saturated; highlights move toward yellow/orange and get less saturated. A ramp that only gets darker or lighter looks muddy.
- Avoid pure black for shadows and pure white for highlights; use a dark hue (deep blue, purple, brown) and a warm off-white.
- Each step of a ramp must differ clearly in brightness from the next; two colours that are almost the same are wasted and look like noise. Check the value (grayscale) picture: the forms must still read.
- Contrast leads the eye: the strongest light/dark contrast belongs on the focal point (face, weapon, item).
- Built-in palettes (set_palette preset): db32, db16, pico8, edg32. A fixed palette keeps a set of sprites consistent."#,
    ),
    (
        "shading",
        r#"SHADING
- One light source for the whole sprite (and the whole set). Default: top-left, so lit faces are on the top and left, shadows bottom and right.
- Shade by form: think of the sprite as simple 3D shapes (spheres, cylinders, boxes). A sphere gets a highlight towards the light, a core shadow on the far side and a little reflected light at the very edge.
- Avoid PILLOW SHADING: dark at every edge and light in the middle, in rings that follow the outline. It ignores the light and looks flat.
- Avoid BANDING: steps of two shades that run exactly parallel and end at the same place look like stripes. Vary the lengths so the boundary staggers.
- Skies, water and other big gradients drawn as horizontal bands are a fine style, but perfectly straight, hard-edged stripes read flat. Stagger or dither a few pixels along each edge, make bands thinner toward the horizon, and let clouds, hills or light cross them.
- Use 2-3 shades per material; more shades at small sizes become noise.
- Dithering (checkerboard of two colours) only for large soft gradients or textures, used sparingly; never on small sprites.
- Anti-aliasing: an in-between colour on a few step corners of a curve, inside the sprite only. Keep the outer edge hard so the sprite works on any background."#,
    ),
    (
        "outline",
        r#"OUTLINES
- A 1-pixel outline around the silhouette helps a sprite read on any background.
- Selective outline ("sel-out"): instead of black everywhere, colour each outline pixel with a dark shade of the colour inside it, and lighten the outline on the lit side. Softer and more polished.
- Inner lines (between arm and body, folds) use a shade darker than the area, not the outline colour, unless the parts must separate clearly.
- Outlines follow the same line rules: no doubled corners, even runs."#,
    ),
    (
        "cleanup",
        r#"CLEANUP CHECKLIST (review_model reports most of these)
- Doubled corners in 1-pixel lines → pixel_perfect, or set_pixels to remove the inside-corner pixel.
- Stray single pixels → merge into a cluster or remove.
- Jaggies (uneven runs in lines and curves) → even out the run lengths.
- Pillow shading / no clear light direction → reshade from the light source.
- Near-identical colours → replace_color one with the other.
- Too many colours → merge ramps.
- Check the actual-size and silhouette pictures last, not just the enlarged one."#,
    ),
    (
        "animation",
        r#"ANIMATION
- Plan key poses first (contact, extreme, passing), then in-betweens. Small loops: idle 2-4 frames, walk 4-8, run 6-8, attack 3-6.
- Keep the volume: the sprite's size and mass stay the same unless it squashes and stretches on purpose (squash on landing, stretch on jumping).
- Anticipation before a big action, follow-through after it (hair, cloth, tails settle a frame later).
- Timing lives in frame durations (set_frame_duration): hold key poses longer (150-250 ms), move in-betweens quicker (60-100 ms).
- Loops must connect: the last frame leads into the first. No two frames should be identical unless the hold is intended (use a longer duration instead).
- Keep the ground line fixed so the sprite does not jitter; move parts by whole pixels and only what should move. Onion skin: view_as_text maps=["diff"] marks what changed since the previous frame.
- Make each frame with add_frame (copies the previous) and change only what moves."#,
    ),
    (
        "voxel",
        r#"VOXEL MODELS (3D)
- Size to the subject: 16-32 per side for props and characters, 32-64 for buildings. Chunky reads better than detailed.
- Block out big volumes first (fill_box, draw_sphere, draw_cylinder), check proportions from several angles, then carve and add detail.
- Use a hue-shifted ramp per material and shade with paint mode: darker at the bottom and in crevices, lighter on top surfaces and edges facing the light. apply_gradient on y gives a quick ground-to-top darkening.
- Avoid single floating voxels and 1-voxel-thin walls that vanish from some angles.
- Check every side with review_model; a model must work from all angles, not only the front."#,
    ),
];

pub fn guide_text(topic: Option<&str>) -> String {
    let t = topic.unwrap_or("all").to_lowercase();
    GUIDE.iter().filter(|(name, _)| t == "all" || *name == t).map(|(_, text)| *text).collect::<Vec<_>>().join("\n\n")
}

/// The short version that goes into the MCP instructions.
pub const RULES: &str = "Pixel-art rules (call pixel_art_guide for the full guide before your first drawing): \
draw at the final size; silhouette first, then flat colours, then shading, then outline and details; \
few colours in hue-shifted ramps (make_color_ramp base=…); one light source (top-left); \
no pillow shading (dark rings along the edge); clean 1-pixel lines without doubled L-corners or uneven runs; \
no stray single pixels; check the actual-size, silhouette and value pictures from review_model and fix every issue it lists.";

// MARK: - colour

/// (hue 0-360, saturation 0-1, value 0-1)
pub fn hsv(c: Rgba) -> (f64, f64, f64) {
    let (r, g, b) = (c.r as f64 / 255.0, c.g as f64 / 255.0, c.b as f64 / 255.0);
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let d = mx - mn;
    let mut h = 0.0;
    if d > 0.0 {
        if mx == r {
            h = 60.0 * (((g - b) / d) % 6.0);
        } else if mx == g {
            h = 60.0 * ((b - r) / d + 2.0);
        } else {
            h = 60.0 * ((r - g) / d + 4.0);
        }
    }
    if h < 0.0 {
        h += 360.0;
    }
    (h, if mx == 0.0 { 0.0 } else { d / mx }, mx)
}

pub fn rgb(h: f64, s: f64, v: f64) -> Rgba {
    let hh = ((h % 360.0) + 360.0) % 360.0;
    let (s, v) = (s.max(0.0).min(1.0), v.max(0.0).min(1.0));
    let c = v * s;
    let x = c * (1.0 - (((hh / 60.0) % 2.0) - 1.0).abs());
    let m = v - c;
    let (r, g, b) = if hh < 60.0 {
        (c, x, 0.0)
    } else if hh < 120.0 {
        (x, c, 0.0)
    } else if hh < 180.0 {
        (0.0, c, x)
    } else if hh < 240.0 {
        (0.0, x, c)
    } else if hh < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    let q = |t: f64| -> u8 { ((t + m) * 255.0).round().min(255.0).max(0.0) as u8 };
    Rgba::rgb(q(r), q(g), q(b))
}

/// Turns hue `h` toward `target` by at most `by` degrees, the short way round.
fn turn(h: f64, target: f64, by: f64) -> f64 {
    let mut d = (target - h) % 360.0;
    if d > 180.0 {
        d -= 360.0;
    }
    if d < -180.0 {
        d += 360.0;
    }
    h + if d > 0.0 { d.min(by) } else { d.max(-by) }
}

/// Colours closer than this (weighted RGB distance) are too alike to tell apart in a sprite.
pub const NEAR_DISTANCE: i64 = 9 * 10 * 10;

/// Warnings for colours that are almost identical to another colour, checking each of `fresh` against
/// `fresh` and `existing`. Used when an agent sets or extends a palette by hand, before it paints with it.
pub fn near_warnings(fresh: &[Rgba], existing: &[Rgba]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (i, a) in fresh.iter().enumerate() {
        for b in fresh.iter().skip(i + 1).chain(existing.iter()) {
            if a != b && a.distance(b) < NEAR_DISTANCE {
                out.push(format!("{} and {} are almost identical", a.hex(), b.hex()));
            }
        }
    }
    if out.is_empty() {
        return out;
    }
    out.truncate(12);
    out.push("Near-identical colours add noise without adding shape: drop or change one of each pair. make_color_ramp base=<colour> spaces a material's shades evenly.".into());
    out
}

/// Perceived brightness 0-1.
pub fn luma(c: Rgba) -> f64 {
    (0.299 * c.r as f64 + 0.587 * c.g as f64 + 0.114 * c.b as f64) / 255.0
}

/// A shading ramp around one base colour, darkest first. The base sits in the middle; shadows turn toward
/// blue and gain saturation, highlights turn toward yellow and lose it.
pub fn ramp_base(base: Rgba, steps: i64, hue_shift: f64) -> Vec<Rgba> {
    let (h, s, v) = hsv(base);
    let mid = (steps - 1) as f64 / 2.0;
    // Greys pick up a slight tint so the shift shows.
    let grey = s < 0.08;
    (0..steps)
        .map(|k| {
            let t = if mid == 0.0 { 0.0 } else { (k as f64 - mid) / mid }; // -1 shadow … +1 highlight
            let away = (k as f64 - mid).abs();
            if t < 0.0 {
                let hh = turn(h, 245.0, hue_shift * away);
                let ss = if grey { 0.12 * -t } else { (s + (1.0 - s) * 0.25 * -t).min(1.0) };
                let vv = v - (v - (v * 0.3).max(0.1)) * -t;
                return rgb(if grey { 245.0 } else { hh }, ss, vv);
            }
            if t > 0.0 {
                let hh = turn(h, 55.0, hue_shift * away);
                let ss = if grey { 0.08 * t } else { s * (1.0 - 0.45 * t) };
                let vv = v + ((v + 0.35).min(1.0) - v) * t + (1.0 - v) * 0.15 * t;
                return rgb(if grey { 55.0 } else { hh }, ss, vv.min(1.0));
            }
            base
        })
        .collect()
}

/// A ramp between two colours (darkest first), bent toward cool in the shadows and warm in the lights.
pub fn ramp_between(c0: Rgba, c1: Rgba, steps: i64, hue_shift: f64) -> Vec<Rgba> {
    (0..steps)
        .map(|k| {
            let t = k as f64 / (steps - 1) as f64;
            let mix = |a: u8, b: u8| -> u8 { (a as f64 + (b as f64 - a as f64) * t).round() as u8 };
            let c = Rgba::rgb(mix(c0.r, c1.r), mix(c0.g, c1.g), mix(c0.b, c1.b));
            if k == 0 || k == steps - 1 || hue_shift == 0.0 {
                return c;
            }
            let (h, s, v) = hsv(c);
            if s < 0.05 {
                return c;
            }
            let pull = (t - 0.5) * 2.0; // -1 … 1, zero in the middle
            rgb(turn(h, if pull < 0.0 { 245.0 } else { 55.0 }, pull.abs() * hue_shift), s, v)
        })
        .collect()
}

// MARK: - 2D sprite checks

/// A sprite's front slice as rows top to bottom.
pub struct Image2D {
    pub w: i64,
    pub h: i64,
    pub px: Vec<u8>,
}

impl Image2D {
    pub fn new(doc: &Document, frame: usize) -> Self {
        let (w, h) = (doc.sx(), doc.sy());
        let g = doc.composite(frame);
        let mut px = vec![0u8; (w * h) as usize];
        for r in 0..h {
            for c in 0..w {
                px[(r * w + c) as usize] = g[doc.index(c, h - 1 - r, 0)];
            }
        }
        Image2D { w, h, px }
    }
    #[inline(always)]
    fn at(&self, c: i64, r: i64) -> u8 {
        if c < 0 || r < 0 || c >= self.w || r >= self.h {
            0
        } else {
            self.px[(r * self.w + c) as usize]
        }
    }
}

const SIDES: [(i64, i64); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

fn colour(palette: &[Rgba], v: u8) -> Rgba {
    palette.get(v as usize).copied().unwrap_or(Rgba::rgb(0, 0, 0))
}

/// Pixels in the inside corner of a 1-pixel line ("doubles", "L-corners"). A pixel counts when exactly two of its
/// side neighbours share its colour, they sit at a right angle, the cell between them diagonally does not, and the
/// line does not run straight on from both of them (that would be the corner of a box, which is wanted).
/// Only line work is checked: the pixel and both neighbours are 1 pixel thin, the line is at least 4 pixels long,
/// and it is either on the silhouette edge or darker than what lies outside the corner (a contour), so small
/// clusters of texture and highlights are left alone.
fn doubles(img: &Image2D, palette: &[Rgba], only: Option<u8>) -> Vec<(i64, i64)> {
    let same_sides = |c: i64, r: i64, v: u8| -> usize { SIDES.iter().filter(|s| img.at(c + s.0, r + s.1) == v).count() };
    // Size of each same-colour run (8-connected), to skip tiny clusters.
    let mut comp = vec![-1i64; (img.w * img.h) as usize];
    let mut sizes: Vec<i64> = Vec::new();
    for start in 0..img.px.len() {
        if img.px[start] == 0 || comp[start] >= 0 {
            continue;
        }
        let (v, id) = (img.px[start], sizes.len() as i64);
        let mut stack = vec![start as i64];
        comp[start] = id;
        let mut n = 0;
        while let Some(i) = stack.pop() {
            n += 1;
            let (c, r) = (i % img.w, i / img.w);
            for dr in -1..=1 {
                for dc in -1..=1 {
                    if dr == 0 && dc == 0 {
                        continue;
                    }
                    let (nc, nr) = (c + dc, r + dr);
                    if nc < 0 || nr < 0 || nc >= img.w || nr >= img.h {
                        continue;
                    }
                    let j = (nr * img.w + nc) as usize;
                    if img.px[j] == v && comp[j] < 0 {
                        comp[j] = id;
                        stack.push(j as i64);
                    }
                }
            }
        }
        sizes.push(n);
    }
    let mut out: Vec<(i64, i64)> = Vec::new();
    for r in 0..img.h {
        for c in 0..img.w {
            let v = img.px[(r * img.w + c) as usize];
            if v == 0 || only.is_some_and(|o| v != o) {
                continue;
            }
            let dirs: Vec<(i64, i64)> = SIDES.iter().copied().filter(|s| img.at(c + s.0, r + s.1) == v).collect();
            if dirs.len() != 2 {
                continue;
            }
            let (a, b) = (dirs[0], dirs[1]);
            if a.0 * b.0 + a.1 * b.1 != 0 {
                continue; // a straight line, not a corner
            }
            if img.at(c + a.0 + b.0, r + a.1 + b.1) == v {
                continue; // part of a 2×2 block
            }
            let a_on = img.at(c + 2 * a.0, r + 2 * a.1) == v;
            let b_on = img.at(c + 2 * b.0, r + 2 * b.1) == v;
            if a_on && b_on {
                continue;
            }
            if !(sizes[comp[(r * img.w + c) as usize] as usize] >= 4
                && same_sides(c + a.0, r + a.1, v) <= 2
                && same_sides(c + b.0, r + b.1, v) <= 2)
            {
                continue;
            }
            // Outside the corner: the two cells opposite a and b.
            let outside = [img.at(c - a.0, r - a.1), img.at(c - b.0, r - b.1)];
            let mut on_edge = outside.contains(&0);
            for dr in -1..=1 {
                for dc in -1..=1 {
                    if img.at(c + dc, r + dr) == 0 {
                        on_edge = true;
                    }
                }
            }
            let contour = outside.iter().all(|&o| o != 0 && luma(colour(palette, o)) > luma(colour(palette, v)) + 0.06);
            if !(on_edge || contour) {
                continue;
            }
            out.push((c, r));
        }
    }
    out
}

/// Pixels whose colour differs from all eight neighbours, inside the sprite (not lone pixels on empty canvas).
fn strays(img: &Image2D) -> Vec<(i64, i64)> {
    let mut out = Vec::new();
    for r in 0..img.h {
        for c in 0..img.w {
            let v = img.px[(r * img.w + c) as usize];
            if v == 0 {
                continue;
            }
            let (mut same, mut filled) = (false, 0);
            for dr in -1..=1 {
                for dc in -1..=1 {
                    if dr == 0 && dc == 0 {
                        continue;
                    }
                    let n = img.at(c + dc, r + dr);
                    if n == v {
                        same = true;
                    }
                    if n != 0 {
                        filled += 1;
                    }
                }
            }
            if !same && filled >= 5 {
                out.push((c, r));
            }
        }
    }
    out
}

/// The tallest stack of 3 or more flat, full-width bands (one colour across at least 92% of every row, each band
/// at least 2 rows) that follow each other with hard edges. A dithered or staggered transition row breaks the stack.
/// Returns (first row, last row, band heights).
fn stripes(img: &Image2D) -> Option<(i64, i64, Vec<i64>)> {
    if img.w < 24 || img.h < 8 {
        return None;
    }
    #[derive(Clone, Copy)]
    struct Band {
        start: i64,
        height: i64,
        color: u8, // 0 = the row is not flat
    }
    let mut bands: Vec<Band> = Vec::new();
    for r in 0..img.h {
        let mut count = [0i64; 256];
        for c in 0..img.w {
            count[img.px[(r * img.w + c) as usize] as usize] += 1;
        }
        let (mut top_key, mut top_value) = (0usize, -1i64);
        for (k, &n) in count.iter().enumerate() {
            if n > top_value {
                top_key = k;
                top_value = n;
            }
        }
        let color: u8 = if top_key != 0 && top_value * 100 >= img.w * 92 { top_key as u8 } else { 0 };
        match bands.last_mut() {
            Some(last) if last.color == color => last.height += 1,
            _ => bands.push(Band { start: r, height: 1, color }),
        }
    }
    let total = |list: &[Band]| -> i64 { list.iter().map(|b| b.height).sum() };
    let (mut best, mut run): (Vec<Band>, Vec<Band>) = (Vec::new(), Vec::new());
    for b in bands {
        if b.color != 0 && b.height >= 2 {
            run.push(b);
        } else {
            run.clear();
        }
        if run.len() >= 3 && total(&run) > total(&best) {
            best = run.clone();
        }
    }
    if best.len() < 3 {
        return None;
    }
    let (first, last) = (best[0], best[best.len() - 1]);
    Some((first.start, last.start + last.height - 1, best.iter().map(|b| b.height).collect()))
}

fn pearson(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len() as f64;
    if n <= 2.0 {
        return 0.0;
    }
    let ma = a.iter().fold(0.0, |s, x| s + x) / n;
    let mb = b.iter().fold(0.0, |s, x| s + x) / n;
    let (mut sab, mut saa, mut sbb) = (0.0, 0.0, 0.0);
    for i in 0..a.len() {
        let (x, y) = (a[i] - ma, b[i] - mb);
        sab += x * y;
        saa += x * x;
        sbb += y * y;
    }
    if saa == 0.0 || sbb == 0.0 {
        0.0
    } else {
        sab / (saa * sbb).sqrt()
    }
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// A Double as Swift prints it in text ("0.46", "1.0").
fn swift_double(x: f64) -> String {
    format!("{x:?}")
}

fn join_ints(list: &[i64], sep: &str) -> String {
    list.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(sep)
}

/// Pixel-art checks for a 2D sprite: adds its report to `result` and its problems and gentler style tips
/// to `f`. A style lock replaces the default colour budget and light/outline expectations.
pub fn sprite_checks(doc: &Document, frame: usize, full_frame: bool, style: Option<&StyleLock>, result: &mut JsonMap, f: &mut Findings) {
    let img = Image2D::new(doc, frame);
    let mut report = JsonMap::new();
    let pal = &doc.palette;
    let mut used: BTreeMap<u8, i64> = BTreeMap::new();
    for &v in &img.px {
        if v != 0 {
            *used.entry(v).or_insert(0) += 1;
        }
    }
    let filled: i64 = used.values().sum();
    if filled <= 0 {
        return;
    }
    let used_count = used.len() as i64;

    // Colours.
    let side = img.w.max(img.h);
    let budget = if side <= 16 { 8 } else if side <= 32 { 16 } else if side <= 64 { 32 } else { 48 };
    report.insert("colors_used".into(), json!(used_count));
    if used_count > budget && style.and_then(|s| s.max_colors).is_none() {
        f.issue(
            "too_many_colours",
            "color",
            (3 + 2 * (used_count - budget)).min(15),
            used_count,
            format!("Uses {used_count} colours; a sprite this size reads best with about {budget} or fewer. Merge similar shades (replace_color)."),
        );
    }
    let keys: Vec<u8> = used.keys().copied().collect();
    let mut near: Vec<String> = Vec::new();
    for i in 0..keys.len() {
        for j in (i + 1)..keys.len() {
            let (a, b) = (colour(pal, keys[i]), colour(pal, keys[j]));
            if a.distance(&b) < NEAR_DISTANCE {
                near.push(format!("{} (index {}) ≈ {} (index {})", a.hex(), keys[i], b.hex(), keys[j]));
            }
        }
    }
    if !near.is_empty() {
        let n = near.len() as i64;
        report.insert("near_identical_colors".into(), json!(near));
        f.issue(
            "near_identical_colours",
            "color",
            (4 * n).min(12),
            n,
            format!("{n} pair(s) of almost identical colours; they add noise without adding shape. Merge them with replace_color."),
        );
    }
    let black: i64 = used
        .iter()
        .filter(|(k, _)| {
            let c = colour(pal, **k);
            c.r < 8 && c.g < 8 && c.b < 8
        })
        .map(|(_, n)| *n)
        .sum();

    // Lines.
    let dbl = doubles(&img, pal, None);
    if !dbl.is_empty() {
        let n = dbl.len() as i64;
        report.insert(
            "doubled_corners".into(),
            json!({"count": n, "at_x_row": dbl.iter().take(12).map(|p| vec![p.0, p.1]).collect::<Vec<_>>()}),
        );
        f.issue(
            "doubled_corners",
            "cleanup",
            (4 + 2 * n).min(20),
            n,
            format!("{n} doubled corner pixel(s) in 1-pixel lines (L-shaped steps make lines look thick). pixel_perfect removes them; check the result."),
        );
    }
    let st = strays(&img);
    let st_count = st.len() as i64;
    if st_count > (filled / 40).max(3) {
        report.insert(
            "stray_pixels".into(),
            json!({"count": st_count, "at_x_row": st.iter().take(12).map(|p| vec![p.0, p.1]).collect::<Vec<_>>()}),
        );
        let text = if full_frame {
            format!("{st_count} single pixels unlike all their neighbours. Stars, fireflies and sparkles are fine; scattered noise in large areas is not.")
        } else {
            format!("{st_count} single pixels unlike all their neighbours. Keep deliberate ones (eye glints, highlights, small fruit) and merge the rest into clusters; too many read as noise.")
        };
        if st_count > (filled / 15).max(6) && !full_frame {
            f.issue("stray_pixels", "cleanup", (3 + st_count / 2).min(12), st_count, text);
        } else {
            f.tip("stray_pixels", "cleanup", if full_frame { 2 } else { 3 }, st_count, text);
        }
    }

    // Edge and interior pixels; distance from the edge for the interior.
    let mut dist = vec![-1i64; (img.w * img.h) as usize];
    let mut queue: Vec<usize> = Vec::new();
    let mut edge: Vec<usize> = Vec::new();
    for r in 0..img.h {
        for c in 0..img.w {
            let i = (r * img.w + c) as usize;
            if img.px[i] == 0 {
                continue;
            }
            let open = SIDES.iter().any(|s| img.at(c + s.0, r + s.1) == 0);
            if open {
                dist[i] = 0;
                queue.push(i);
                edge.push(i);
            }
        }
    }
    let mut qi = 0;
    while qi < queue.len() {
        let i = queue[qi];
        qi += 1;
        let (c, r) = (i as i64 % img.w, i as i64 / img.w);
        for (dc, dr) in SIDES {
            let (nc, nr) = (c + dc, r + dr);
            if nc < 0 || nr < 0 || nc >= img.w || nr >= img.h {
                continue;
            }
            let j = (nr * img.w + nc) as usize;
            if img.px[j] != 0 && dist[j] < 0 {
                dist[j] = dist[i] + 1;
                queue.push(j);
            }
        }
    }

    // Stacked flat stripes (skies, water, gradients drawn as bands).
    if let Some((from, to, heights)) = stripes(&img) {
        report.insert("stripes".into(), json!({"rows": [from, to], "heights": heights}));
        let even = heights.iter().max().copied().unwrap_or(1) * 10 <= heights.iter().min().copied().unwrap_or(1) * 13;
        f.tip(
            "flat_stripes",
            "shading",
            if even { 6 } else { 5 },
            1,
            format!("Rows {}-{} are {} flat full-width stripes with hard straight edges", from, to, heights.len())
                + &(if even { ", all about the same height".to_string() } else { format!(" (heights {})", join_ints(&heights, ", ")) })
                + ". A valid style, but it reads flat: stagger or dither a few pixels along each edge, vary the heights, or let clouds, hills or light cross the bands.",
        );
    }

    // A full-frame background has no silhouette on empty canvas: outline, light direction and pillow shading
    // are about sprites, so they are skipped.
    if full_frame {
        report.insert("note".into(), json!("Full-frame background: outline, light-direction and pillow-shading checks are skipped."));
        result.insert("pixel_art".into(), Json::Object(report));
        return;
    }

    // Outline.
    let dark_edge = edge.iter().filter(|&&i| luma(colour(pal, img.px[i])) < 0.22).count();
    let edge_share = dark_edge as f64 / edge.len().max(1) as f64;
    report.insert("outline_dark_share".into(), num(round2(edge_share)));
    if side >= 16 && edge_share < 0.35 && style.and_then(|s| s.outline.as_ref()).is_none() {
        f.tip(
            "weak_outline",
            "shape",
            5,
            1,
            format!(
                "Only {}% of the silhouette edge is dark; a 1-pixel outline (or a darker rim) makes the shape read on any background.",
                (edge_share * 100.0) as i64
            ),
        );
    }
    if black > filled / 5 {
        f.tip(
            "pure_black",
            "color",
            3,
            1,
            format!(
                "Pure black covers {}% of the sprite; a dark hue (deep blue, purple, brown) or a selective outline looks richer.",
                black * 100 / filled
            ),
        );
    }

    // Light: how brightness inside the sprite (not the outline) leans across the shape.
    let (mut l, mut x, mut y, mut d): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) = (vec![], vec![], vec![], vec![]);
    let mut interior: HashSet<u8> = HashSet::new();
    for i in 0..img.px.len() {
        if dist[i] >= 1 {
            l.push(luma(colour(pal, img.px[i])));
            x.push((i as i64 % img.w) as f64);
            y.push((i as i64 / img.w) as f64);
            d.push(dist[i] as f64);
            interior.insert(img.px[i]);
        }
    }
    let interior_colours = interior.len();
    let style_light = style.and_then(|s| s.light.as_deref());
    if l.len() >= 30 && interior_colours >= 3 {
        let (cx, cy, cd) = (pearson(&l, &x), pearson(&l, &y), pearson(&l, &d));
        let mut dir = String::new();
        if cy < -0.12 {
            dir = "top".into();
        } else if cy > 0.12 {
            dir = "bottom".into();
        }
        if cx < -0.12 {
            dir += if dir.is_empty() { "left" } else { "-left" };
        } else if cx > 0.12 {
            dir += if dir.is_empty() { "right" } else { "-right" };
        }
        let mut light = JsonMap::new();
        light.insert("brightest_toward".into(), json!(if dir.is_empty() { "no clear side" } else { dir.as_str() }));
        light.insert("brightness_vs_x".into(), num(round2(cx)));
        light.insert("brightness_vs_row".into(), num(round2(cy)));
        light.insert("brightness_vs_edge_distance".into(), num(round2(cd)));
        report.insert("light".into(), Json::Object(light));
        let directional = cx.abs().max(cy.abs());
        if cd > 0.45 && directional < 0.2 {
            f.issue(
                "pillow_shading",
                "shading",
                15,
                1,
                format!(
                    "Looks pillow-shaded: brightness follows the distance from the edge ({}) instead of a light direction. Pick one light (top-left) and reshade by form.",
                    swift_double(round2(cd))
                ),
            );
        } else if dir.starts_with("bottom") {
            if style_light.is_none() {
                f.tip(
                    "light_from_below",
                    "shading",
                    6,
                    1,
                    format!("The brightest pixels sit toward the {dir}; light usually comes from above (top-left). Check the shading direction."),
                );
            }
        } else if dir.is_empty() && style_light != Some("none") {
            f.tip(
                "no_light_direction",
                "shading",
                6,
                1,
                "No clear light direction inside the sprite; shade the side facing the light lighter and the far side darker.",
            );
        }
    }
    // Too-flat: big areas of one colour with no shading.
    if filled >= 64 && interior_colours < 3 && style_light != Some("none") {
        f.tip(
            "flat_interior",
            "shading",
            6,
            1,
            format!("The inside uses {interior_colours} colour(s); 2-3 shades per material give the shape volume."),
        );
    }
    result.insert("pixel_art".into(), Json::Object(report));
}

/// Animation checks across all frames of a sprite (or model).
pub fn animation_checks(doc: &Document, full_frame: bool, f: &mut Findings) -> JsonMap {
    let mut info = JsonMap::new();
    if doc.frames.len() <= 1 {
        return info;
    }
    let grids: Vec<Vec<u8>> = (0..doc.frames.len()).map(|i| doc.composite(i)).collect();
    let counts: Vec<i64> = grids.iter().map(|g| g.iter().filter(|&&v| v != 0).count() as i64).collect();
    let mut same: Vec<String> = Vec::new();
    for i in 0..grids.len() {
        let j = (i + 1) % grids.len();
        if i == grids.len() - 1 && grids.len() < 3 {
            break;
        }
        if grids[i] == grids[j] {
            same.push(format!("{i}→{j}"));
        }
    }
    if !same.is_empty() {
        let n = same.len() as i64;
        f.tip(
            "identical_frames",
            "animation",
            (4 * n).min(10),
            n,
            format!("Identical neighbouring frames ({}): drop one and lengthen the other's duration instead.", same.join(", ")),
        );
    }
    let mut jumps: Vec<String> = Vec::new();
    for i in 0..counts.len() - 1 {
        if counts[i] <= 0 {
            continue;
        }
        let change = (counts[i + 1] - counts[i]).abs() as f64 / counts[i] as f64;
        if change > 0.3 {
            jumps.push(format!("{}→{} ({}%)", i, i + 1, (change * 100.0) as i64));
        }
    }
    if !jumps.is_empty() {
        let n = jumps.len() as i64;
        f.tip(
            "volume_jumps",
            "animation",
            (3 * n).min(10),
            n,
            format!(
                "The amount of filled cells jumps between frames {}; unless that is a deliberate squash/stretch or effect, keep the volume steady.",
                jumps.join(", ")
            ),
        );
    }
    let durations: Vec<i64> = doc.frames.iter().map(|fr| fr.duration).collect();
    if durations.len() >= 4 && durations.iter().collect::<BTreeSet<_>>().len() == 1 {
        f.tip(
            "uniform_timing",
            "animation",
            3,
            1,
            format!("Every frame lasts {} ms; holding key poses longer (set_frame_duration) gives the motion weight.", durations[0]),
        );
    }
    info.insert("frames".into(), json!(doc.frames.len()));
    info.insert("filled_per_frame".into(), json!(counts));
    info.insert("durations_ms".into(), json!(durations));
    // The ground line: the lowest filled row (y) of each frame. Feet that move up and down between frames
    // make a walk or idle jitter, unless the sprite jumps or flies on purpose. Backgrounds have no ground.
    if !full_frame {
        // Storage runs y upward (then z, then x), so the first filled cell is on the lowest filled row.
        let layer = (doc.sx() * doc.sz()).max(1) as usize;
        let ground: Vec<Option<i64>> = grids.iter().map(|g| g.iter().position(|&v| v != 0).map(|i| (i / layer) as i64)).collect();
        let rows: Vec<i64> = ground.iter().flatten().copied().collect();
        if rows.len() == ground.len() && !rows.is_empty() {
            let (lo, hi) = (*rows.iter().min().unwrap_or(&0), *rows.iter().max().unwrap_or(&0));
            // Report as image rows for sprites (row 0 at the top), as y for models.
            let flat = doc.sz() == 1;
            let shown: Vec<i64> = if flat { rows.iter().map(|r| doc.sy() - 1 - r).collect() } else { rows.clone() };
            info.insert("ground_line".into(), json!(shown));
            if hi > lo {
                let moved: Vec<i64> = (0..rows.len()).filter(|&i| rows[i] != rows[0]).map(|i| i as i64).collect();
                f.tip(
                    "ground_jitter",
                    "animation",
                    (3 + 2 * (hi - lo)).min(10),
                    hi - lo,
                    format!(
                        "The lowest filled {} moves by up to {} between frames (frames {} differ from frame 0): the sprite bobs against its ground line. Keep the feet planted unless it jumps or flies on purpose.",
                        if flat { "row" } else { "y" },
                        hi - lo,
                        join_ints(&moved, ", ")
                    ),
                );
            }
        }
    }
    info
}

// MARK: - pixel-perfect cleanup

/// Removes doubled corner pixels from 1-pixel lines on one z slice of a layer, giving each removed pixel the
/// colour around it (often empty). Repeats until clean. Returns the cells changed as [x, row].
pub fn pixel_perfect(d: &mut Document, layer: usize, frame: usize, depth: i64, only: Option<u8>) -> Vec<[i64; 2]> {
    let mut changed: Vec<[i64; 2]> = Vec::new();
    for _ in 0..6 {
        // Read this layer's slice as an image.
        let (w, h) = (d.sx(), d.sy());
        let mut img = Image2D { w, h, px: vec![0u8; (w * h) as usize] };
        for r in 0..h {
            for c in 0..w {
                img.px[(r * w + c) as usize] = d.get(layer, frame, c, h - 1 - r, depth);
            }
        }
        let found = doubles(&img, &d.palette, only);
        if found.is_empty() {
            break;
        }
        let mut done: HashSet<i64> = HashSet::new();
        for (c, r) in found {
            // Skip a pixel whose neighbour was just removed in this pass: re-check next pass.
            if SIDES.iter().any(|s| done.contains(&((r + s.1) * img.w + c + s.0))) {
                continue;
            }
            let v = img.px[(r * img.w + c) as usize];
            let mut votes: BTreeMap<u8, i64> = BTreeMap::new();
            for dr in -1..=1i64 {
                for dc in -1..=1i64 {
                    if dr == 0 && dc == 0 {
                        continue;
                    }
                    let n = img.at(c + dc, r + dr);
                    if n != v {
                        *votes.entry(n).or_insert(0) += if dr == 0 || dc == 0 { 2 } else { 1 };
                    }
                }
            }
            // Most votes wins; a tie goes to the lower index (empty first).
            let mut fill = 0u8;
            let mut best = -1i64;
            for (&k, &n) in &votes {
                if n > best {
                    best = n;
                    fill = k;
                }
            }
            d.set(layer, frame, c, img.h - 1 - r, depth, fill);
            img.px[(r * img.w + c) as usize] = fill;
            done.insert(r * img.w + c);
            changed.push([c, r]);
        }
    }
    changed
}

// MARK: - review pictures

/// The sprite at `scale` pixels per pixel on `bg`; `map` can recolour (value, silhouette).
fn picture(doc: &Document, frame: usize, s: i64, bg: Rgba, grid: bool, map: Option<&dyn Fn(Rgba) -> Rgba>) -> Result<Picture, PcError> {
    let img = Image2D::new(doc, frame);
    let mut pic = Picture::new(img.w * s, img.h * s, bg)?;
    let s = s as usize;
    let (w, h) = (img.w as usize, img.h as usize);
    for r in 0..h {
        for c in 0..w {
            let v = img.px[r * w + c];
            if v == 0 {
                continue;
            }
            let mut col = colour(&doc.palette, v);
            col.a = 255;
            if let Some(m) = map {
                col = m(col);
            }
            for y in 0..s {
                for x in 0..s {
                    pic.set_pixel((r * s + y) * pic.width + c * s + x, col);
                }
            }
        }
    }
    if grid && s >= 5 {
        // A thin line on every pixel border, stronger every 8 pixels (counting from 0 at the top-left).
        for y in 0..pic.height {
            for x in 0..pic.width {
                let (on_x, on_y) = (x % s == 0, y % s == 0);
                if !(on_x || on_y) {
                    continue;
                }
                let major = (on_x && (x / s) % 8 == 0) || (on_y && (y / s) % 8 == 0);
                let p = pic.pixel(y * pic.width + x);
                let k = if major { 0.45 } else { 0.18 };
                let toward: f64 = if luma(p) > 0.55 { 0.0 } else { 255.0 };
                let m = |ch: u8| -> u8 { (ch as f64 + (toward - ch as f64) * k) as u8 };
                pic.set_pixel(y * pic.width + x, Rgba::rgb(m(p.r), m(p.g), m(p.b)));
            }
        }
    }
    Ok(pic)
}

fn gray(c: Rgba) -> Rgba {
    let l = (luma(c) * 255.0).round() as u8;
    Rgba::rgb(l, l, l)
}

/// Review pictures for a 2D sprite: (PNG pictures, what each shows).
pub fn sprite_review(doc: &Document, frame: usize, scale: Option<i64>) -> Result<(Vec<Vec<u8>>, String), PcError> {
    let side = doc.sx().max(doc.sy());
    let big = scale.unwrap_or((300 / side).clamp(4, 14));
    let (dark, light, mid) = (Rgba::rgb(44, 44, 48), Rgba::rgb(214, 214, 206), Rgba::rgb(110, 132, 120));
    let (detail, _) = render::sheet(
        &[picture(doc, frame, big, dark, true, None)?, picture(doc, frame, big, Rgba::rgb(30, 30, 30), true, Some(&gray))?],
        2,
        8,
        Rgba::rgb(20, 20, 22),
    )?;
    let small = (128 / side).clamp(2, 4);
    let (sizes, _) = render::sheet(
        &[
            picture(doc, frame, small, light, false, Some(&|_| Rgba::rgb(30, 28, 40)))?,
            picture(doc, frame, 1, dark, false, None)?,
            picture(doc, frame, 1, light, false, None)?,
            picture(doc, frame, 2, mid, false, None)?,
            picture(doc, frame, 2, dark, false, None)?,
        ],
        5,
        8,
        Rgba::rgb(70, 70, 76),
    )?;
    let mut images = vec![image_files::png(&detail), image_files::png(&sizes)];
    let mut layout = String::from("Picture 1: left, the sprite enlarged with a pixel grid (bold lines every 8 pixels from the top-left, x to the right, rows down); right, the same in grayscale values. ")
        + "Picture 2: silhouette, actual size on dark, actual size on light, 2× on green, 2× on dark.";
    if doc.frames.len() > 1 {
        let frames = doc.frames.len() as i64;
        let fs = (480 / (doc.sx() * frames).max(1)).clamp(2, 6);
        let pics = (0..doc.frames.len()).map(|i| picture(doc, i, fs, dark, false, None)).collect::<Result<Vec<_>, _>>()?;
        let (strip, _) = render::sheet(&pics, frames, 4, Rgba::rgb(70, 70, 76))?;
        images.push(image_files::png(&strip));
        layout += " Picture 3: every animation frame in order, left to right.";
    }
    Ok((images, layout))
}
