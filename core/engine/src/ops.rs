//! Drawing operations on a document.
//!
//! Loops over shapes are limited to the cells that can land inside the model. The results are the
//! same as walking the whole shape (cells outside the model change nothing), but a far-away or huge
//! shape no longer takes forever.
use crate::model::{Document, Grid};

/// How a drawing operation treats voxels it touches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaintMode {
    /// place the colour everywhere it draws
    Replace,
    /// only recolour voxels that already exist
    Paint,
    /// only fill empty cells
    Add,
    /// remove voxels
    Erase,
}

impl PaintMode {
    pub fn parse(s: &str) -> Option<PaintMode> {
        match s {
            "replace" => Some(PaintMode::Replace),
            "paint" => Some(PaintMode::Paint),
            "add" => Some(PaintMode::Add),
            "erase" => Some(PaintMode::Erase),
            _ => None,
        }
    }
}

/// Mirror drawing across the model's centre (symmetry mode, in 3 axes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Symmetry {
    pub x: bool,
    pub y: bool,
    pub z: bool,
}

impl Symmetry {
    pub const NONE: Symmetry = Symmetry { x: false, y: false, z: false };

    pub fn parse(s: Option<&str>) -> Symmetry {
        let mut m = Symmetry::NONE;
        for ch in s.unwrap_or("").to_lowercase().chars() {
            match ch {
                'x' => m.x = true,
                'y' => m.y = true,
                'z' => m.z = true,
                _ => {}
            }
        }
        m
    }
}

/// A drawing pen bound to one cel (layer + frame).
#[derive(Debug, Clone, Copy)]
pub struct Pen {
    pub layer: usize,
    pub frame: usize,
    pub color: u8,
    pub mode: PaintMode,
    pub symmetry: Symmetry,
}

/// The coordinate and its mirror image (once, when they are the same cell).
fn mirrored(v: i64, size: i64, on: bool) -> ([i64; 2], usize) {
    let m = size - 1 - v;
    if on && m != v {
        ([v, m], 2)
    } else {
        ([v, v], 1)
    }
}

/// The whole numbers in [lo, hi] that also lie in [min, max], as a range for a `for` loop.
fn clamped(lo: f64, hi: f64, min: i64, max: i64) -> std::ops::RangeInclusive<i64> {
    let a = if lo.is_nan() { min } else { (lo as i64).max(min) };
    let b = if hi.is_nan() { max } else { (hi as i64).min(max) };
    a..=b
}

impl Document {
    /// Writes one voxel through the pen (with its mode and symmetry). Returns how many cells changed.
    pub fn put(&mut self, x: i64, y: i64, z: i64, pen: &Pen) -> i64 {
        // A cell outside the model has its mirror images outside too.
        if !self.in_bounds(x, y, z) {
            return 0;
        }
        let mut changed = 0;
        let (xs, nx) = mirrored(x, self.sx(), pen.symmetry.x);
        let (ys, ny) = mirrored(y, self.sy(), pen.symmetry.y);
        let (zs, nz) = mirrored(z, self.sz(), pen.symmetry.z);
        for &px in &xs[..nx] {
            for &py in &ys[..ny] {
                for &pz in &zs[..nz] {
                    changed += self.put_one(px, py, pz, pen);
                }
            }
        }
        changed
    }

    #[inline(always)]
    fn put_one(&mut self, x: i64, y: i64, z: i64, pen: &Pen) -> i64 {
        if !self.in_bounds(x, y, z) {
            return 0;
        }
        let i = self.index(x, y, z);
        let old = self.cels[pen.layer][pen.frame].data()[i];
        let new = match pen.mode {
            PaintMode::Replace => pen.color,
            PaintMode::Paint => {
                if old == 0 {
                    return 0;
                }
                pen.color
            }
            PaintMode::Add => {
                if old != 0 {
                    return 0;
                }
                pen.color
            }
            PaintMode::Erase => 0,
        };
        if old == new {
            return 0;
        }
        self.cels[pen.layer][pen.frame].data_mut()[i] = new;
        1
    }

    pub fn fill_box(&mut self, a: (i64, i64, i64), b: (i64, i64, i64), hollow: bool, pen: &Pen) -> i64 {
        let (x0, x1) = (a.0.min(b.0), a.0.max(b.0));
        let (y0, y1) = (a.1.min(b.1), a.1.max(b.1));
        let (z0, z1) = (a.2.min(b.2), a.2.max(b.2));
        let mut n = 0;
        for y in y0.max(0)..=y1.min(self.sy() - 1) {
            for z in z0.max(0)..=z1.min(self.sz() - 1) {
                for x in x0.max(0)..=x1.min(self.sx() - 1) {
                    if hollow && x != x0 && x != x1 && y != y0 && y != y1 && z != z0 && z != z1 {
                        continue;
                    }
                    n += self.put(x, y, z, pen);
                }
            }
        }
        n
    }

    /// Ellipsoid centred at c (may be fractional) with radii r.
    pub fn ellipsoid(&mut self, c: (f64, f64, f64), r: (f64, f64, f64), hollow: bool, pen: &Pen) -> i64 {
        let (rx, ry, rz) = (r.0.max(0.5), r.1.max(0.5), r.2.max(0.5));
        let mut n = 0;
        let inside = |x: f64, y: f64, z: f64| -> bool {
            let (dx, dy, dz) = ((x - c.0) / rx, (y - c.1) / ry, (z - c.2) / rz);
            dx * dx + dy * dy + dz * dz <= 1.0 + 1e-9
        };
        for y in clamped((c.1 - ry).floor(), (c.1 + ry).ceil(), 0, self.sy() - 1) {
            for z in clamped((c.2 - rz).floor(), (c.2 + rz).ceil(), 0, self.sz() - 1) {
                for x in clamped((c.0 - rx).floor(), (c.0 + rx).ceil(), 0, self.sx() - 1) {
                    let (fx, fy, fz) = (x as f64, y as f64, z as f64);
                    if !inside(fx, fy, fz) {
                        continue;
                    }
                    if hollow
                        && inside(fx + 1.0, fy, fz)
                        && inside(fx - 1.0, fy, fz)
                        && inside(fx, fy + 1.0, fz)
                        && inside(fx, fy - 1.0, fz)
                        && inside(fx, fy, fz + 1.0)
                        && inside(fx, fy, fz - 1.0)
                    {
                        continue;
                    }
                    n += self.put(x, y, z, pen);
                }
            }
        }
        n
    }

    /// Cylinder along an axis: base centre, radius, length along the axis.
    pub fn cylinder(&mut self, base: (f64, f64, f64), radius: f64, length: i64, axis: &str, hollow: bool, pen: &Pen) -> i64 {
        let mut n = 0;
        let r = radius.max(0.5);
        let ri = if r.is_nan() { 0 } else { (r.ceil() as i64).min(crate::args::INT_LIMIT) };
        let inside = |a: f64, b: f64| -> bool { a * a + b * b <= r * r + 1e-9 };
        let trunc = crate::args::trunc;
        // Which base coordinates the axis (t), a and b offsets move along, and how far the model reaches there.
        let (bt, ba, bb, st, sa, sb) = match axis {
            "x" => (base.0, base.1, base.2, self.sx(), self.sy(), self.sz()),
            "z" => (base.2, base.0, base.1, self.sz(), self.sx(), self.sy()),
            _ => (base.1, base.0, base.2, self.sy(), self.sx(), self.sz()),
        };
        let t_range = (-trunc(bt)).max(0)..=(st - 1 - trunc(bt)).min(length.max(1) - 1);
        let a_range = clamped((-1.0 - ba).floor(), (sa as f64 - ba).ceil(), -ri, ri);
        let b_range = clamped((-1.0 - bb).floor(), (sb as f64 - bb).ceil(), -ri, ri);
        for t in t_range {
            for a in a_range.clone() {
                for b in b_range.clone() {
                    let (da, db) = (a as f64, b as f64);
                    if !inside(da, db) {
                        continue;
                    }
                    let edge = !(inside(da + 1.0, db) && inside(da - 1.0, db) && inside(da, db + 1.0) && inside(da, db - 1.0));
                    if hollow && !edge && t != 0 && t != length - 1 {
                        continue;
                    }
                    let round = crate::args::round;
                    let (x, y, z) = match axis {
                        "x" => (trunc(base.0) + t, round(base.1 + da), round(base.2 + db)),
                        "z" => (round(base.0 + da), round(base.1 + db), trunc(base.2) + t),
                        _ => (round(base.0 + da), trunc(base.1) + t, round(base.2 + db)),
                    };
                    n += self.put(x, y, z, pen);
                }
            }
        }
        n
    }

    /// 3D line (DDA through the larger axis) with an optional cube brush radius.
    pub fn line(&mut self, a: (i64, i64, i64), b: (i64, i64, i64), radius: i64, pen: &Pen) -> i64 {
        let (dx, dy, dz) = (b.0 - a.0, b.1 - a.1, b.2 - a.2);
        let steps = dx.abs().max(dy.abs()).max(dz.abs()).max(1);
        let r = radius.max(0);
        // The steps whose brush can reach the model (with a margin for rounding).
        let (mut lo, mut hi) = (0.0f64, steps as f64);
        for (start, delta, size) in [(a.0, dx, self.sx()), (a.1, dy, self.sy()), (a.2, dz, self.sz())] {
            let (min, max) = (-(r as f64) - 2.0, size as f64 + r as f64 + 1.0);
            if delta == 0 {
                if (start as f64) < min || (start as f64) > max {
                    return 0;
                }
                continue;
            }
            let t0 = (min - start as f64) / delta as f64 * steps as f64;
            let t1 = (max - start as f64) / delta as f64 * steps as f64;
            lo = lo.max(t0.min(t1) - 8.0);
            hi = hi.min(t0.max(t1) + 8.0);
        }
        if lo > hi {
            return 0;
        }
        let (first, last) = ((lo.floor() as i64).max(0), (hi.ceil() as i64).min(steps));
        let mut n = 0;
        for i in first..=last {
            let t = i as f64 / steps as f64;
            let x = (a.0 as f64 + dx as f64 * t).round() as i64;
            let y = (a.1 as f64 + dy as f64 * t).round() as i64;
            let z = (a.2 as f64 + dz as f64 * t).round() as i64;
            if r <= 0 {
                n += self.put(x, y, z, pen);
                continue;
            }
            let rr = r as i128 * r as i128;
            for oy in (-r).max(-y)..=r.min(self.sy() - 1 - y) {
                for oz in (-r).max(-z)..=r.min(self.sz() - 1 - z) {
                    for ox in (-r).max(-x)..=r.min(self.sx() - 1 - x) {
                        let d = ox as i128 * ox as i128 + oy as i128 * oy as i128 + oz as i128 * oz as i128;
                        if d <= rr {
                            n += self.put(x + ox, y + oy, z + oz, pen);
                        }
                    }
                }
            }
        }
        n
    }

    /// 6-connected flood fill of the region that has the same value as the start cell.
    /// When the start is empty, the fill is limited to the start's horizontal slice (like a 2D bucket)
    /// unless `volume` is true.
    pub fn flood_fill(&mut self, s: (i64, i64, i64), volume: bool, pen: &Pen) -> i64 {
        if !self.in_bounds(s.0, s.1, s.2) {
            return 0;
        }
        let target = self.get(pen.layer, pen.frame, s.0, s.1, s.2);
        let replacement: u8 = if pen.mode == PaintMode::Erase { 0 } else { pen.color };
        if target == replacement {
            return 0;
        }
        let flat = target == 0 && !volume;
        let mut seen = vec![false; self.count()];
        let mut stack = vec![s];
        let mut cells: Vec<(i64, i64, i64)> = Vec::new();
        seen[self.index(s.0, s.1, s.2)] = true;
        {
            let data = self.cels[pen.layer][pen.frame].data();
            while let Some((x, y, z)) = stack.pop() {
                cells.push((x, y, z));
                let all = [(x + 1, y, z), (x - 1, y, z), (x, y, z + 1), (x, y, z - 1), (x, y + 1, z), (x, y - 1, z)];
                let nbs = if flat { &all[..4] } else { &all[..] };
                for &(nx, ny, nz) in nbs {
                    if !self.in_bounds(nx, ny, nz) {
                        continue;
                    }
                    let i = self.index(nx, ny, nz);
                    if !seen[i] && data[i] == target {
                        seen[i] = true;
                        stack.push((nx, ny, nz));
                    }
                }
            }
        }
        let mut p = *pen;
        p.mode = if pen.mode == PaintMode::Erase { PaintMode::Erase } else { PaintMode::Replace };
        p.symmetry = Symmetry::NONE;
        let mut n = 0;
        for (x, y, z) in cells {
            n += self.put(x, y, z, &p);
        }
        n
    }

    pub fn replace_color(&mut self, layer: usize, frame: usize, from: u8, to: u8) -> i64 {
        if !self.cels[layer][frame].data().contains(&from) {
            return 0;
        }
        let mut n = 0;
        for v in self.cels[layer][frame].data_mut().iter_mut() {
            if *v == from {
                *v = to;
                n += 1;
            }
        }
        n
    }

    /// Moves every voxel of a cel; voxels pushed outside are lost (or wrap when asked).
    pub fn translate(&mut self, layer: usize, frame: usize, dx: i64, dy: i64, dz: i64, wrap: bool) {
        let (sx, sy, sz) = (self.sx(), self.sy(), self.sz());
        let mut g = vec![0u8; self.count()];
        let old = self.cels[layer][frame].data();
        for y in 0..sy {
            for z in 0..sz {
                for x in 0..sx {
                    let v = old[self.index(x, y, z)];
                    if v == 0 {
                        continue;
                    }
                    let (mut nx, mut ny, mut nz) = (x + dx, y + dy, z + dz);
                    if wrap {
                        nx = ((nx % sx) + sx) % sx;
                        ny = ((ny % sy) + sy) % sy;
                        nz = ((nz % sz) + sz) % sz;
                    }
                    if self.in_bounds(nx, ny, nz) {
                        g[self.index(nx, ny, nz)] = v;
                    }
                }
            }
        }
        self.cels[layer][frame] = Grid::from_data(g);
    }

    pub fn flip(&mut self, layer: usize, frame: usize, axis: &str) {
        let (sx, sy, sz) = (self.sx(), self.sy(), self.sz());
        let mut g = vec![0u8; self.count()];
        let old = self.cels[layer][frame].data();
        for y in 0..sy {
            for z in 0..sz {
                for x in 0..sx {
                    let v = old[self.index(x, y, z)];
                    if v == 0 {
                        continue;
                    }
                    let i = match axis {
                        "x" => self.index(sx - 1 - x, y, z),
                        "y" => self.index(x, sy - 1 - y, z),
                        _ => self.index(x, y, sz - 1 - z),
                    };
                    g[i] = v;
                }
            }
        }
        self.cels[layer][frame] = Grid::from_data(g);
    }

    /// Copies one half onto the other, across the centre plane of an axis.
    /// `keep` = "low" keeps the low side (x<mid, left / bottom / back) and mirrors it to the high side.
    pub fn mirror(&mut self, layer: usize, frame: usize, axis: &str, keep: &str) {
        let (sx, sy, sz) = (self.sx(), self.sy(), self.sz());
        let low_kept = keep != "high";
        let mut g = self.cels[layer][frame].data().to_vec();
        for y in 0..sy {
            for z in 0..sz {
                for x in 0..sx {
                    let ((mx, my, mz), is_low) = match axis {
                        "x" => ((sx - 1 - x, y, z), x < sx - 1 - x),
                        "y" => ((x, sy - 1 - y, z), y < sy - 1 - y),
                        _ => ((x, y, sz - 1 - z), z < sz - 1 - z),
                    };
                    if is_low == low_kept && (mx, my, mz) != (x, y, z) {
                        g[self.index(mx, my, mz)] = g[self.index(x, y, z)];
                    }
                }
            }
        }
        self.cels[layer][frame] = Grid::from_data(g);
    }

    /// Rotates a cel by quarter turns around an axis through the model's centre.
    /// Cells that land outside the box are dropped (use a cube-shaped model to keep everything).
    pub fn rotate(&mut self, layer: usize, frame: usize, axis: &str, turns: i64) {
        let t = ((turns % 4) + 4) % 4;
        if t == 0 {
            return;
        }
        let (sx, sy, sz) = (self.sx(), self.sy(), self.sz());
        for _ in 0..t {
            let mut g = vec![0u8; self.count()];
            let old = self.cels[layer][frame].data();
            let (cx, cy, cz) = ((sx - 1) as f64 / 2.0, (sy - 1) as f64 / 2.0, (sz - 1) as f64 / 2.0);
            for y in 0..sy {
                for z in 0..sz {
                    for x in 0..sx {
                        let v = old[self.index(x, y, z)];
                        if v == 0 {
                            continue;
                        }
                        let (px, py, pz) = (x as f64 - cx, y as f64 - cy, z as f64 - cz);
                        let (mut nx, mut ny, mut nz) = (px, py, pz);
                        // Counter-clockwise when looking from the positive end of the axis.
                        match axis {
                            "x" => {
                                ny = -pz;
                                nz = py;
                            }
                            "z" => {
                                nx = -py;
                                ny = px;
                            }
                            _ => {
                                nx = pz;
                                nz = -px;
                            }
                        }
                        let (ix, iy, iz) = ((nx + cx).round() as i64, (ny + cy).round() as i64, (nz + cz).round() as i64);
                        if self.in_bounds(ix, iy, iz) {
                            g[self.index(ix, iy, iz)] = v;
                        }
                    }
                }
            }
            self.cels[layer][frame] = Grid::from_data(g);
        }
    }

    /// Recolours existing voxels along an axis using a ramp of palette indexes (low end → high end).
    pub fn gradient(&mut self, layer: usize, frame: usize, axis: &str, ramp: &[u8], only_color: Option<u8>) -> i64 {
        if ramp.is_empty() {
            return 0;
        }
        let (sx, sy, sz) = (self.sx(), self.sy(), self.sz());
        let len = if axis == "x" { sx } else if axis == "z" { sz } else { sy };
        let count = ramp.len() as i64;
        let mut g = self.cels[layer][frame].data().to_vec();
        let mut n = 0;
        for y in 0..sy {
            for z in 0..sz {
                for x in 0..sx {
                    let i = self.index(x, y, z);
                    let v = g[i];
                    if v == 0 {
                        continue;
                    }
                    if let Some(only) = only_color {
                        if v != only {
                            continue;
                        }
                    }
                    let p = if axis == "x" { x } else if axis == "z" { z } else { y };
                    let k = if len <= 1 { 0 } else { (count - 1).min(p * count / len) } as usize;
                    if ramp[k] != v {
                        g[i] = ramp[k];
                        n += 1;
                    }
                }
            }
        }
        if n > 0 {
            self.cels[layer][frame] = Grid::from_data(g);
        }
        n
    }

    // MARK: slices (2D views agents can read and write as text)

    /// Maps a slice (axis, depth index) + 2D (column, row) into a 3D cell.
    /// - axis "y": a horizontal layer seen from above; columns = x, rows = z from back (0) to front.
    /// - axis "z": a vertical slice seen from the front; columns = x, rows = y from top to bottom.
    /// - axis "x": a vertical slice seen from the side; columns = z from back to front, rows = y from top to bottom.
    pub fn slice_cell(&self, axis: &str, k: i64, col: i64, row: i64) -> (i64, i64, i64) {
        match axis {
            "y" => (col, k, row),
            "x" => (k, self.sy() - 1 - row, col),
            _ => (col, self.sy() - 1 - row, k),
        }
    }

    /// (columns, rows, depth) of the slices along an axis.
    pub fn slice_size(&self, axis: &str) -> (i64, i64, i64) {
        match axis {
            "y" => (self.sx(), self.sz(), self.sy()),
            "x" => (self.sz(), self.sy(), self.sx()),
            _ => (self.sx(), self.sy(), self.sz()),
        }
    }
}
