//! The document model: colours, layers, frames and the voxel grids.
use std::sync::Arc;

use crate::palettes;
use crate::PcError;

/// An RGBA colour. Palette index 0 is always "empty" (no voxel).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Rgba { r, g, b, a }
    }
    /// An opaque colour.
    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Rgba { r, g, b, a: 255 }
    }

    pub fn hex(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Reads "#rgb", "#rrggbb" or "#rrggbbaa" (the "#" is optional).
    pub fn parse(text: &str) -> Option<Rgba> {
        // Swift trimmed `.whitespaces`: spaces and tabs, not line breaks.
        let trimmed = text.trim_matches(|c: char| {
            c.is_whitespace() && !matches!(c, '\n' | '\r' | '\u{0b}' | '\u{0c}' | '\u{85}' | '\u{2028}' | '\u{2029}')
        });
        let mut s = trimmed.to_lowercase();
        if s.starts_with('#') {
            s.remove(0);
        }
        if s.chars().count() == 3 {
            s = s.chars().flat_map(|c| [c, c]).collect();
        }
        let n = s.chars().count();
        if n != 6 && n != 8 {
            return None;
        }
        let v = u64::from_str_radix(&s, 16).ok()?;
        if n == 6 {
            return Some(Rgba::rgb(((v >> 16) & 255) as u8, ((v >> 8) & 255) as u8, (v & 255) as u8));
        }
        Some(Rgba::new(((v >> 24) & 255) as u8, ((v >> 16) & 255) as u8, ((v >> 8) & 255) as u8, (v & 255) as u8))
    }

    /// Weighted RGB distance (perceptual enough for nearest-colour lookup).
    pub fn distance(&self, o: &Rgba) -> i64 {
        let dr = self.r as i64 - o.r as i64;
        let dg = self.g as i64 - o.g as i64;
        let db = self.b as i64 - o.b as i64;
        3 * dr * dr + 4 * dg * dg + 2 * db * db
    }
}

/// A layer: every frame has one cel per layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layer {
    pub name: String,
    pub visible: bool,
    pub locked: bool,
}

impl Layer {
    pub fn new(name: impl Into<String>) -> Self {
        Layer { name: name.into(), visible: true, locked: false }
    }
}

/// A frame of the animation. New frames last 100 ms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame {
    pub duration: i64,
}

impl Default for Frame {
    fn default() -> Self {
        Frame { duration: 100 }
    }
}

/// A dense voxel grid of palette indexes (0 = empty).
/// Coordinates: x grows to the right, y grows up, z grows toward the viewer (front).
///
/// The cells are shared until written (like Swift's copy-on-write arrays), so the undo history and
/// snapshots only cost memory for the cels an edit really changed.
#[derive(Debug, Clone)]
pub struct Grid {
    data: Arc<Vec<u8>>,
}

impl Grid {
    pub fn new(count: usize) -> Self {
        Grid { data: Arc::new(vec![0; count]) }
    }
    pub fn from_data(data: Vec<u8>) -> Self {
        Grid { data: Arc::new(data) }
    }
    pub fn data(&self) -> &[u8] {
        &self.data
    }
    pub fn data_mut(&mut self) -> &mut Vec<u8> {
        Arc::make_mut(&mut self.data)
    }
    pub fn is_empty(&self) -> bool {
        !self.data.iter().any(|&v| v != 0)
    }
}

impl PartialEq for Grid {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.data, &other.data) || self.data == other.data
    }
}
impl Eq for Grid {}

/// The whole model: size, palette, layers × frames of cels.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub name: String,
    sx: i64,
    sy: i64,
    sz: i64,
    pub palette: Vec<Rgba>,
    pub layers: Vec<Layer>,
    pub frames: Vec<Frame>,
    /// cels[layer][frame]
    pub cels: Vec<Vec<Grid>>,
}

impl Default for Document {
    fn default() -> Self {
        Document::new("Untitled", 32, 32, 32, None)
    }
}

impl Document {
    pub const MAX_SIZE: i64 = 256;
    pub const MAX_COLORS: usize = 256;
    /// Limits for files read from disk (each layer × frame is a full grid in memory).
    pub const MAX_LAYERS: usize = 256;
    pub const MAX_FRAMES: usize = 1024;
    pub const MAX_CELLS: usize = 1 << 28;

    /// A document with one empty layer and frame. Sizes must be 1-256 (see `check_size`); `palette`
    /// defaults to db32.
    pub fn new(name: impl Into<String>, sx: i64, sy: i64, sz: i64, palette: Option<Vec<Rgba>>) -> Self {
        let (sx, sy, sz) = (sx.max(0), sy.max(0), sz.max(0));
        Document {
            name: name.into(),
            sx,
            sy,
            sz,
            palette: palette.unwrap_or_else(|| palettes::named("db32").expect("db32 is built in")),
            layers: vec![Layer::new("Layer 1")],
            frames: vec![Frame::default()],
            cels: vec![vec![Grid::new((sx * sy * sz) as usize)]],
        }
    }

    pub fn sx(&self) -> i64 {
        self.sx
    }
    pub fn sy(&self) -> i64 {
        self.sy
    }
    pub fn sz(&self) -> i64 {
        self.sz
    }

    /// Clears voxels whose colour index has no palette entry, so a damaged or hostile file can't make
    /// later code look up colours past the end of the palette.
    pub fn drop_colours_outside_palette(&mut self) {
        let n = self.palette.len();
        if n >= 256 {
            return;
        }
        for layer in self.cels.iter_mut() {
            for cel in layer.iter_mut() {
                if cel.data().iter().any(|&v| v as usize >= n) {
                    for v in cel.data_mut().iter_mut() {
                        if *v as usize >= n {
                            *v = 0;
                        }
                    }
                }
            }
        }
    }

    /// The colour of a palette index (black for an index past the palette, which no tool produces).
    pub fn color(&self, v: u8) -> Rgba {
        self.palette.get(v as usize).copied().unwrap_or(Rgba::rgb(0, 0, 0))
    }

    /// Cells in one grid.
    pub fn count(&self) -> usize {
        (self.sx * self.sy * self.sz) as usize
    }

    #[inline(always)]
    pub fn in_bounds(&self, x: i64, y: i64, z: i64) -> bool {
        x >= 0 && y >= 0 && z >= 0 && x < self.sx && y < self.sy && z < self.sz
    }

    /// Storage order: x fastest, then z, then y (one horizontal slice per y).
    #[inline(always)]
    pub fn index(&self, x: i64, y: i64, z: i64) -> usize {
        ((y * self.sz + z) * self.sx + x) as usize
    }

    pub fn get(&self, layer: usize, frame: usize, x: i64, y: i64, z: i64) -> u8 {
        if !self.in_bounds(x, y, z) {
            return 0;
        }
        self.cels[layer][frame].data()[self.index(x, y, z)]
    }

    pub fn set(&mut self, layer: usize, frame: usize, x: i64, y: i64, z: i64, c: u8) {
        if !self.in_bounds(x, y, z) {
            return;
        }
        let i = self.index(x, y, z);
        self.cels[layer][frame].data_mut()[i] = c;
    }

    /// All visible layers of a frame merged: upper layers cover lower ones.
    pub fn composite(&self, frame: usize) -> Vec<u8> {
        self.composite_layers(frame, true)
    }

    pub fn composite_layers(&self, frame: usize, only_visible: bool) -> Vec<u8> {
        let mut out = vec![0u8; self.count()];
        for (li, layer) in self.layers.iter().enumerate() {
            if !(layer.visible || !only_visible) {
                continue;
            }
            for (dst, &src) in out.iter_mut().zip(self.cels[li][frame].data()) {
                if src != 0 {
                    *dst = src;
                }
            }
        }
        out
    }

    // MARK: structure

    pub fn resize(&mut self, nx: i64, ny: i64, nz: i64, anchor: &str) -> Result<(), PcError> {
        Document::check_size(nx, ny, nz)?;
        // Keep the model standing on the ground and centred unless asked otherwise.
        let (ox, oz) = if anchor == "origin" { (0, 0) } else { ((nx - self.sx) / 2, (nz - self.sz) / 2) };
        let old = self.clone();
        self.sx = nx;
        self.sy = ny;
        self.sz = nz;
        for li in 0..self.layers.len() {
            for fi in 0..self.frames.len() {
                let mut g = vec![0u8; self.count()];
                let src = old.cels[li][fi].data();
                for y in 0..old.sy.min(ny) {
                    for z in 0..old.sz {
                        for x in 0..old.sx {
                            let v = src[old.index(x, y, z)];
                            if v == 0 {
                                continue;
                            }
                            let (tx, tz) = (x + ox, z + oz);
                            if self.in_bounds(tx, y, tz) {
                                g[self.index(tx, y, tz)] = v;
                            }
                        }
                    }
                }
                self.cels[li][fi] = Grid::from_data(g);
            }
        }
        Ok(())
    }

    pub fn check_size(x: i64, y: i64, z: i64) -> Result<(), PcError> {
        for v in [x, y, z] {
            if v < 1 || v > Document::MAX_SIZE {
                return Err(PcError::invalid(format!(
                    "each size must be between 1 and {} (got {}×{}×{})",
                    Document::MAX_SIZE,
                    x,
                    y,
                    z
                )));
            }
        }
        Ok(())
    }

    /// Adds an empty layer at `at` (default: on top) and returns its index.
    pub fn add_layer(&mut self, name: &str, at: Option<i64>) -> usize {
        let n = self.layers.len() as i64;
        let i = at.unwrap_or(n).max(0).min(n) as usize;
        self.layers.insert(i, Layer::new(name));
        let empty = Grid::new(self.count());
        self.cels.insert(i, vec![empty; self.frames.len()]);
        i
    }

    pub fn remove_layer(&mut self, i: usize) -> Result<(), PcError> {
        if self.layers.len() <= 1 {
            return Err(PcError::invalid("a model needs at least one layer"));
        }
        self.layers.remove(i);
        self.cels.remove(i);
        Ok(())
    }

    /// Adds a frame after `after` (a copy of it, or empty) and returns its index.
    pub fn add_frame(&mut self, after: usize, copy: bool) -> usize {
        let i = after + 1;
        self.frames.insert(i, Frame { duration: self.frames[after].duration });
        let count = self.count();
        for li in 0..self.layers.len() {
            let cel = if copy { self.cels[li][after].clone() } else { Grid::new(count) };
            self.cels[li].insert(i, cel);
        }
        i
    }

    pub fn remove_frame(&mut self, i: usize) -> Result<(), PcError> {
        if self.frames.len() <= 1 {
            return Err(PcError::invalid("a model needs at least one frame"));
        }
        self.frames.remove(i);
        for li in 0..self.layers.len() {
            self.cels[li].remove(i);
        }
        Ok(())
    }
}
