//! Pictures and the software renderer (port of Render.swift).
use crate::model::{Document, Rgba};
use crate::PcError;

/// An 8-bit RGBA picture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picture {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

impl Picture {
    /// Pictures larger than this many pixels are refused instead of exhausting memory.
    pub const MAX_PIXELS: i64 = 1 << 28;

    pub fn new(width: i64, height: i64, fill: Rgba) -> Result<Picture, PcError> {
        if width < 1 || height < 1 {
            return Err(PcError::invalid(format!("a picture of {width}×{height} pixels has nothing to show; use a scale of 1 or more")));
        }
        if width > Picture::MAX_PIXELS || height > Picture::MAX_PIXELS || width * height > Picture::MAX_PIXELS {
            return Err(PcError::invalid(format!("a picture of {width}×{height} pixels is too large; use a smaller scale")));
        }
        let (w, h) = (width as usize, height as usize);
        let mut p = Picture { width: w, height: h, pixels: vec![0; w * h * 4] };
        if fill.a != 0 {
            for i in 0..w * h {
                p.set_pixel(i, fill);
            }
        }
        Ok(p)
    }

    /// A transparent picture.
    pub fn clear(width: i64, height: i64) -> Result<Picture, PcError> {
        Picture::new(width, height, Rgba::new(0, 0, 0, 0))
    }

    #[inline(always)]
    pub fn set_pixel(&mut self, i: usize, c: Rgba) {
        self.pixels[i * 4] = c.r;
        self.pixels[i * 4 + 1] = c.g;
        self.pixels[i * 4 + 2] = c.b;
        self.pixels[i * 4 + 3] = c.a;
    }

    #[inline(always)]
    pub fn pixel(&self, i: usize) -> Rgba {
        Rgba::new(self.pixels[i * 4], self.pixels[i * 4 + 1], self.pixels[i * 4 + 2], self.pixels[i * 4 + 3])
    }

    /// Draws another picture on top (alpha over) at (ox, oy).
    pub fn blit(&mut self, p: &Picture, ox: i64, oy: i64) {
        for y in 0..p.height {
            let ty = y as i64 + oy;
            if ty < 0 || ty >= self.height as i64 {
                continue;
            }
            for x in 0..p.width {
                let tx = x as i64 + ox;
                if tx < 0 || tx >= self.width as i64 {
                    continue;
                }
                let s = p.pixel(y * p.width + x);
                if s.a == 0 {
                    continue;
                }
                let ti = ty as usize * self.width + tx as usize;
                if s.a == 255 {
                    self.set_pixel(ti, s);
                    continue;
                }
                let d = self.pixel(ti);
                let a = s.a as i64;
                let mix = |s: u8, d: u8| -> u8 { ((s as i64 * a + d as i64 * (255 - a)) / 255) as u8 };
                self.set_pixel(ti, Rgba::new(mix(s.r, d.r), mix(s.g, d.g), mix(s.b, d.b), (d.a as i64).max(a) as u8));
            }
        }
    }
}

/// Named camera angles. Isometric uses the 2:1 pixel-art angle (yaw 45°, pitch 30°).
pub mod view_preset {
    /// (yaw, pitch) in degrees.
    pub fn angles(name: &str) -> Option<(f64, f64)> {
        match name.to_lowercase().as_str() {
            "front" => Some((0.0, 0.0)),
            "right" => Some((90.0, 0.0)),
            "back" => Some((180.0, 0.0)),
            "left" => Some((270.0, 0.0)),
            "top" => Some((0.0, 90.0)),
            "bottom" => Some((0.0, -90.0)),
            "iso" | "isometric" | "iso-front-right" => Some((45.0, 30.0)),
            "iso-back-right" => Some((135.0, 30.0)),
            "iso-back-left" => Some((225.0, 30.0)),
            "iso-front-left" => Some((315.0, 30.0)),
            _ => None,
        }
    }
    pub const ALL: [&str; 10] =
        ["iso", "iso-front-left", "iso-back-right", "iso-back-left", "front", "back", "left", "right", "top", "bottom"];
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderOptions {
    pub yaw: f64,
    pub pitch: f64,
    /// Pixels per voxel edge.
    pub scale: i64,
    /// Dark outline around the silhouette (classic pixel-art look).
    pub outline: bool,
    /// Darken pixels where depth jumps, so separate blocks read clearly.
    pub edges: bool,
    pub background: Rgba,
    pub padding: i64,
    /// Fit the picture to the whole model space instead of the occupied part.
    pub show_bounds: bool,
    /// No light shading: colours come out exactly as in the palette (2D sprites).
    pub flat: bool,
}

impl Default for RenderOptions {
    fn default() -> Self {
        RenderOptions {
            yaw: 45.0,
            pitch: 30.0,
            scale: 4,
            outline: true,
            edges: true,
            background: Rgba::new(0, 0, 0, 0),
            padding: 1,
            show_bounds: false,
            flat: false,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct V3 {
    x: f64,
    y: f64,
    z: f64,
}

impl V3 {
    #[inline(always)]
    fn new(x: f64, y: f64, z: f64) -> V3 {
        V3 { x, y, z }
    }
    #[inline(always)]
    fn sub(self, b: V3) -> V3 {
        V3::new(self.x - b.x, self.y - b.y, self.z - b.z)
    }
    #[inline(always)]
    fn add(self, b: V3) -> V3 {
        V3::new(self.x + b.x, self.y + b.y, self.z + b.z)
    }
    #[inline(always)]
    fn mul(self, s: f64) -> V3 {
        V3::new(self.x * s, self.y * s, self.z * s)
    }
    #[inline(always)]
    fn dot(self, b: V3) -> f64 {
        self.x * b.x + self.y * b.y + self.z * b.z
    }
    #[inline(always)]
    fn cross(self, b: V3) -> V3 {
        V3::new(self.y * b.z - self.z * b.y, self.z * b.x - self.x * b.z, self.x * b.y - self.y * b.x)
    }
}

/// Software ray caster: one orthographic ray per output pixel, walked through the grid (Amanatides–Woo).
/// Crisp pixels, exact for front/side/top views and clean 2:1 for isometric.
pub fn render(doc: &Document, frame: usize, o: &RenderOptions) -> Result<Picture, PcError> {
    render_grid(doc, &doc.composite(frame), o)
}

/// Renders `vox` (a grid of the document's size) with the document's palette.
pub fn render_grid(doc: &Document, vox: &[u8], o: &RenderOptions) -> Result<Picture, PcError> {
    use std::f64::consts::PI;
    let (sx, sy, sz) = (doc.sx(), doc.sy(), doc.sz());
    let yaw = o.yaw * PI / 180.0;
    let pitch = (-89.999f64).max(89.999f64.min(o.pitch)) * PI / 180.0;
    // v points from the scene toward the camera.
    // libm's sin and cos, not the platform's: every build then draws the same pixels.
    let (sin_yaw, cos_yaw, sin_pitch, cos_pitch) = (libm::sin(yaw), libm::cos(yaw), libm::sin(pitch), libm::cos(pitch));
    let v = V3::new(sin_yaw * cos_pitch, sin_pitch, cos_yaw * cos_pitch);
    let f = v.mul(-1.0);
    let r = V3::new(cos_yaw, 0.0, -sin_yaw);
    let u = r.cross(f);
    let c = V3::new(sx as f64 / 2.0, sy as f64 / 2.0, sz as f64 / 2.0);

    // Fit the image to the occupied part of the model (or the whole box when empty).
    let (mut lo, mut hi) = ((sx, sy, sz), (0i64, 0i64, 0i64));
    for y in 0..sy {
        for z in 0..sz {
            let row = ((y * sz + z) * sx) as usize;
            for x in 0..sx {
                if vox[row + x as usize] != 0 {
                    lo = (lo.0.min(x), lo.1.min(y), lo.2.min(z));
                    hi = (hi.0.max(x + 1), hi.1.max(y + 1), hi.2.max(z + 1));
                }
            }
        }
    }
    if o.show_bounds || lo.0 > hi.0 {
        lo = (0, 0, 0);
        hi = (sx, sy, sz);
    }
    let (mut min_a, mut max_a, mut min_b, mut max_b) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for cx in [lo.0, hi.0] {
        for cy in [lo.1, hi.1] {
            for cz in [lo.2, hi.2] {
                let p = V3::new(cx as f64, cy as f64, cz as f64).sub(c);
                let (a, b) = (p.dot(r), p.dot(u));
                min_a = min_a.min(a);
                max_a = max_a.max(a);
                min_b = min_b.min(b);
                max_b = max_b.max(b);
            }
        }
    }
    let s = o.scale.max(1) as f64;
    let pad = o.padding + if o.outline { 1 } else { 0 };
    let w = ((max_a - min_a) * s).ceil() as i64 + pad * 2;
    let h = ((max_b - min_b) * s).ceil() as i64 + pad * 2;
    let mut pic = Picture::new(w.max(1), h.max(1), o.background)?;
    let (pw, ph) = (pic.width, pic.height);
    let mut depth = vec![f64::INFINITY; pw * ph];
    let mut hit_mask = vec![false; pw * ph];
    let far = (sx + sy + sz) as f64 * 2.0;

    // Light comes from the upper left of the viewer, so shading stays readable at any angle.
    let light = r.mul(-0.45).add(u.mul(1.0)).add(v.mul(0.55));
    let ln = light.dot(light).sqrt();
    let l = light.mul(1.0 / ln);

    let pal = &doc.palette;
    for py in 0..ph {
        for px in 0..pw {
            let a = min_a + ((px as i64 - pad) as f64 + 0.5) / s;
            let b = max_b - ((py as i64 - pad) as f64 + 0.5) / s;
            let origin = c.add(r.mul(a)).add(u.mul(b)).add(v.mul(far));
            let Some((hit, t, normal)) = cast(vox, sx, sy, sz, origin, f) else { continue };
            let col = pal[hit as usize];
            let n = V3::new(normal.0 as f64, normal.1 as f64, normal.2 as f64);
            let lambert = n.dot(l).max(0.0);
            let shade = if o.flat { 1.0 } else { 0.62 + 0.38 * lambert };
            let i = py * pw + px;
            let ch = |v: u8| -> u8 { (v as f64 * shade).min(255.0) as u8 };
            pic.set_pixel(i, Rgba::new(ch(col.r), ch(col.g), ch(col.b), 255));
            depth[i] = t;
            hit_mask[i] = true;
        }
    }

    let neighbours = |px: usize, py: usize| -> [(i64, i64); 4] {
        let (x, y) = (px as i64, py as i64);
        [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    };
    let inside = |nx: i64, ny: i64| -> bool { nx >= 0 && ny >= 0 && nx < pw as i64 && ny < ph as i64 };

    if o.edges {
        // Darken pixels sitting on a depth step toward the camera (silhouettes of nearer blocks).
        let step = 0.9;
        let mut out = pic.clone();
        for py in 0..ph {
            for px in 0..pw {
                let i = py * pw + px;
                if !hit_mask[i] {
                    continue;
                }
                let mut edge = false;
                for (nx, ny) in neighbours(px, py) {
                    if !inside(nx, ny) {
                        continue;
                    }
                    let j = ny as usize * pw + nx as usize;
                    if hit_mask[j] && depth[j] - depth[i] < -step {
                        edge = false;
                        break;
                    }
                    if hit_mask[j] && depth[j] - depth[i] > step {
                        edge = true;
                    }
                }
                if edge {
                    let p = pic.pixel(i);
                    let dim = |v: u8| -> u8 { (v as f64 * 0.78) as u8 };
                    out.set_pixel(i, Rgba::new(dim(p.r), dim(p.g), dim(p.b), p.a));
                }
            }
        }
        pic = out;
    }

    if o.outline {
        let mut out = pic.clone();
        for py in 0..ph {
            for px in 0..pw {
                let i = py * pw + px;
                if hit_mask[i] {
                    continue;
                }
                let mut near: Option<Rgba> = None;
                for (nx, ny) in neighbours(px, py) {
                    if inside(nx, ny) && hit_mask[ny as usize * pw + nx as usize] {
                        near = Some(pic.pixel(ny as usize * pw + nx as usize));
                        break;
                    }
                }
                if let Some(n) = near {
                    let dim = |v: u8| -> u8 { (v as f64 * 0.25) as u8 };
                    out.set_pixel(i, Rgba::new(dim(n.r), dim(n.g), dim(n.b), 255));
                }
            }
        }
        pic = out;
    }
    Ok(pic)
}

/// Walks a ray through the grid; returns the first solid cell's value, distance and face normal.
#[inline(always)]
fn cast(g: &[u8], sx: i64, sy: i64, sz: i64, o: V3, d: V3) -> Option<(u8, f64, (i64, i64, i64))> {
    // Slab test against the box.
    let mut tmin = 0.0f64;
    let mut tmax = f64::INFINITY;
    let mut enter_axis = -1i32;
    let mut slab = |oc: f64, dc: f64, size: f64, k: i32| -> bool {
        if dc.abs() < 1e-12 {
            return oc >= 0.0 && oc <= size;
        }
        let (mut t1, mut t2) = ((0.0 - oc) / dc, (size - oc) / dc);
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        if t1 > tmin {
            tmin = t1;
            enter_axis = k;
        }
        tmax = tmax.min(t2);
        tmin <= tmax
    };
    if !slab(o.x, d.x, sx as f64, 0) || !slab(o.y, d.y, sy as f64, 1) || !slab(o.z, d.z, sz as f64, 2) {
        return None;
    }
    let p = o.add(d.mul(tmin + 1e-7));
    let mut ix = (p.x.floor() as i64).max(0).min(sx - 1);
    let mut iy = (p.y.floor() as i64).max(0).min(sy - 1);
    let mut iz = (p.z.floor() as i64).max(0).min(sz - 1);
    let (step_x, step_y, step_z): (i64, i64, i64) =
        (if d.x > 0.0 { 1 } else { -1 }, if d.y > 0.0 { 1 } else { -1 }, if d.z > 0.0 { 1 } else { -1 });
    let tdx = if d.x.abs() < 1e-12 { f64::INFINITY } else { (1.0 / d.x).abs() };
    let tdy = if d.y.abs() < 1e-12 { f64::INFINITY } else { (1.0 / d.y).abs() };
    let tdz = if d.z.abs() < 1e-12 { f64::INFINITY } else { (1.0 / d.z).abs() };
    let ahead = |i: i64, step: i64| -> f64 { i as f64 + if step > 0 { 1.0 } else { 0.0 } };
    let mut tmx = if d.x.abs() < 1e-12 { f64::INFINITY } else { (ahead(ix, step_x) - o.x) / d.x };
    let mut tmy = if d.y.abs() < 1e-12 { f64::INFINITY } else { (ahead(iy, step_y) - o.y) / d.y };
    let mut tmz = if d.z.abs() < 1e-12 { f64::INFINITY } else { (ahead(iz, step_z) - o.z) / d.z };
    let mut axis = enter_axis;
    let mut t = tmin;
    loop {
        let v = g[((iy * sz + iz) * sx + ix) as usize];
        if v != 0 {
            let n = match axis {
                0 => (-step_x, 0, 0),
                1 => (0, -step_y, 0),
                2 => (0, 0, -step_z),
                _ => (0, 1, 0),
            };
            return Some((v, t, n));
        }
        if tmx < tmy && tmx < tmz {
            ix += step_x;
            t = tmx;
            tmx += tdx;
            axis = 0;
            if ix < 0 || ix >= sx {
                return None;
            }
        } else if tmy < tmz {
            iy += step_y;
            t = tmy;
            tmy += tdy;
            axis = 1;
            if iy < 0 || iy >= sy {
                return None;
            }
        } else {
            iz += step_z;
            t = tmz;
            tmz += tdz;
            axis = 2;
            if iz < 0 || iz >= sz {
                return None;
            }
        }
    }
}

/// Picks a scale so the longest side of the picture is close to `target` pixels.
pub fn auto_scale(doc: &Document, target: i64) -> i64 {
    let longest = doc.sx().max(doc.sy()).max(doc.sz()) as f64 * 1.75;
    crate::args::trunc(target as f64 / longest).clamp(1, 32)
}

/// Several pictures side by side in a grid. Also returns each cell's rectangle (x, y, width, height).
#[allow(clippy::type_complexity)]
pub fn sheet(pics: &[Picture], columns: i64, gap: i64, background: Rgba) -> Result<(Picture, Vec<(i64, i64, i64, i64)>), PcError> {
    let count = pics.len() as i64;
    let cols = columns.min(count).max(1);
    let rows = (count + cols - 1) / cols;
    let cw = pics.iter().map(|p| p.width as i64).max().unwrap_or(1);
    let ch = pics.iter().map(|p| p.height as i64).max().unwrap_or(1);
    let mut sheet = Picture::new(cols * cw + (cols + 1) * gap, rows * ch + (rows + 1) * gap, background)?;
    let mut rects = Vec::with_capacity(pics.len());
    for (i, p) in pics.iter().enumerate() {
        let i = i as i64;
        let x = gap + (i % cols) * (cw + gap) + (cw - p.width as i64) / 2;
        let y = gap + (i / cols) * (ch + gap) + (ch - p.height as i64) / 2;
        sheet.blit(p, x, y);
        rects.push((gap + (i % cols) * (cw + gap), gap + (i / cols) * (ch + gap), cw, ch));
    }
    Ok((sheet, rects))
}
