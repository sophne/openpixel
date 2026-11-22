//! The style lock (port of Style.swift).
use std::collections::BTreeSet;

use serde_json::json;

use crate::args::{trunc, Args};
use crate::model::{Document, Rgba};
use crate::observe::Findings;
use crate::palettes;
use crate::{Json, JsonMap, PcError};

/// A style that every sprite in a set must follow: a locked palette, a colour budget, the light direction,
/// the outline policy, the canvas size and free-form notes. Set by an agent (or loaded from a style file
/// shared by a whole pipeline) and kept across new_sprite/new_model, so a set of assets stays consistent.
/// The lock binds agents only; the person in the editor can still change anything.
#[derive(Debug, Clone, PartialEq)]
pub struct StyleLock {
    pub name: String,
    /// Index 0 is the transparent slot, as in Document.palette.
    pub palette: Option<Vec<Rgba>>,
    pub lock_palette: bool,
    pub max_colors: Option<i64>,
    pub light: Option<String>,
    pub outline: Option<String>,
    pub size: Option<Vec<i64>>,
    pub notes: Vec<String>,
}

impl Default for StyleLock {
    fn default() -> Self {
        StyleLock {
            name: "style".into(),
            palette: None,
            lock_palette: true,
            max_colors: None,
            light: None,
            outline: None,
            size: None,
            notes: Vec::new(),
        }
    }
}

fn joined(list: &[i64], sep: &str) -> String {
    list.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(sep)
}

impl StyleLock {
    pub const LIGHTS: [&'static str; 6] = ["top-left", "top", "top-right", "left", "right", "none"];
    pub const OUTLINES: [&'static str; 3] = ["dark", "none", "any"];

    pub fn json(&self) -> JsonMap {
        let mut o = JsonMap::new();
        o.insert("name".into(), json!(self.name));
        o.insert("lock_palette".into(), json!(self.lock_palette));
        o.insert("notes".into(), json!(self.notes));
        if let Some(p) = &self.palette {
            o.insert("colors".into(), json!(p.iter().skip(1).map(|c| c.hex()).collect::<Vec<_>>()));
        }
        if let Some(m) = self.max_colors {
            o.insert("max_colors".into(), json!(m));
        }
        if let Some(l) = &self.light {
            o.insert("light".into(), json!(l));
        }
        if let Some(ol) = &self.outline {
            o.insert("outline".into(), json!(ol));
        }
        if let Some(s) = &self.size {
            o.insert("size".into(), json!(s));
        }
        o
    }

    /// Reads a style file (or tool arguments: the same keys).
    pub fn from(o: &JsonMap, base: StyleLock) -> Result<StyleLock, PcError> {
        let mut s = base;
        let a = Args::new(o);
        if let Some(n) = a.string("name") {
            s.name = n.to_string();
        }
        if let Some(preset) = a.string("preset") {
            let Some(p) = palettes::named(preset) else {
                return Err(PcError::invalid(format!("unknown palette {}; use {}", preset, palettes::names().join(", "))));
            };
            s.palette = Some(p);
        }
        if let Some(list) = a.array("colors") {
            let cols: Vec<Rgba> =
                list.iter().filter_map(|v| v.as_str().and_then(Rgba::parse)).map(|c| Rgba::rgb(c.r, c.g, c.b)).collect();
            if !(cols.len() == list.len() && !cols.is_empty() && cols.len() < Document::MAX_COLORS) {
                return Err(PcError::invalid("colors must be 1-255 hex colours like \"#d95763\""));
            }
            let mut pal = vec![Rgba::new(0, 0, 0, 0)];
            pal.extend(cols);
            s.palette = Some(pal);
        }
        if a.has("lock_palette") {
            s.lock_palette = a.bool("lock_palette", true);
        }
        if a.has("max_colors") {
            match a.int("max_colors") {
                Some(m) if (1..=255).contains(&m) => s.max_colors = Some(m),
                _ => return Err(PcError::invalid("max_colors must be 1-255")),
            }
        }
        if let Some(l) = a.string("light") {
            if !StyleLock::LIGHTS.contains(&l) {
                return Err(PcError::invalid(format!("light must be one of {}", StyleLock::LIGHTS.join(", "))));
            }
            s.light = Some(l.to_string());
        }
        if let Some(ol) = a.string("outline") {
            if !StyleLock::OUTLINES.contains(&ol) {
                return Err(PcError::invalid(format!("outline must be one of {}", StyleLock::OUTLINES.join(", "))));
            }
            s.outline = Some(ol.to_string());
        }
        if let Some(sz) = a.array("size") {
            let v: Vec<i64> = sz.iter().filter_map(|n| Args::number(Some(n)).map(trunc)).collect();
            if !((2..=3).contains(&v.len()) && v.len() == sz.len() && v.iter().all(|n| (1..=256).contains(n))) {
                return Err(PcError::invalid("size must be [width, height] for sprites or [x, y, z] for models, each 1-256"));
            }
            s.size = Some(v);
        }
        if let Some(n) = a.string("notes") {
            s.notes = vec![n.to_string()];
        }
        if let Some(list) = a.array("notes") {
            s.notes = list.iter().filter_map(|v| v.as_str().map(String::from)).collect();
        }
        Ok(s)
    }

    pub fn same_rgb(a: &Rgba, b: &Rgba) -> bool {
        a.r == b.r && a.g == b.g && a.b == b.b
    }

    pub fn contains(&self, c: &Rgba) -> bool {
        match &self.palette {
            Some(p) => p.iter().skip(1).any(|x| StyleLock::same_rgb(x, c)),
            None => true,
        }
    }

    /// The closest locked colours to `c`, for error messages.
    pub fn nearest(&self, c: &Rgba, n: usize) -> Vec<String> {
        let Some(p) = &self.palette else { return Vec::new() };
        let mut order: Vec<usize> = (1..p.len()).collect();
        order.sort_by_key(|&i| p[i].distance(c));
        order.iter().take(n).map(|&i| format!("{} {}", i, p[i].hex())).collect()
    }

    /// Whether the brightest side found by the light check agrees with the locked light.
    pub fn light_agrees(locked: &str, found: &str) -> bool {
        if locked == "none" || found.is_empty() || found == "no clear side" {
            return true;
        }
        let parts = |s: &str| -> BTreeSet<String> { s.split('-').filter(|p| !p.is_empty()).map(String::from).collect() };
        let (want, got) = (parts(locked), parts(found));
        if got.contains("bottom") {
            return false;
        }
        // Top-left light: lit toward the top, the left, or both. A side light must not be lit on the other side.
        if want.contains("left") && got.contains("right") || want.contains("right") && got.contains("left") {
            return false;
        }
        let only_top = want.len() == 1 && want.contains("top");
        !want.is_disjoint(&got) || (only_top && got.iter().all(|g| ["top", "left", "right"].contains(&g.as_str())))
    }

    /// Style checks for a model or sprite (added to the analysis as category "style").
    pub fn check(&self, doc: &Document, used_indexes: &BTreeSet<i64>, found: Option<&str>, outline_dark_share: Option<f64>, f: &mut Findings) {
        let name = &self.name;
        if self.palette.is_some() {
            let off: Vec<Rgba> =
                used_indexes.iter().map(|&i| doc.color(i as u8)).filter(|c| !self.contains(c)).collect();
            if !off.is_empty() {
                let n = off.len() as i64;
                f.issue(
                    "style_palette",
                    "style",
                    (6 + 2 * n).min(20),
                    n,
                    format!(
                        "{} colour(s) outside the locked \"{}\" palette: {}. Replace them with locked colours (replace_color).",
                        n,
                        name,
                        off.iter().take(6).map(|c| c.hex()).collect::<Vec<_>>().join(", ")
                    ),
                );
            }
        }
        let used = used_indexes.len() as i64;
        if let Some(m) = self.max_colors {
            if used > m {
                f.issue(
                    "style_max_colors",
                    "style",
                    (3 * (used - m)).min(15),
                    used,
                    format!("Uses {used} colours; the \"{name}\" style allows {m}. Merge shades with replace_color."),
                );
            }
        }
        if let Some(s) = &self.size {
            let have: Vec<i64> = if s.len() == 2 { vec![doc.sx(), doc.sy()] } else { vec![doc.sx(), doc.sy(), doc.sz()] };
            if &have != s {
                f.issue(
                    "style_size",
                    "style",
                    8,
                    1,
                    format!("The canvas is {}; the \"{}\" style is {}.", joined(&have, "×"), name, joined(s, "×")),
                );
            }
        }
        if let (Some(l), Some(found)) = (&self.light, found) {
            if !StyleLock::light_agrees(l, found) {
                f.issue(
                    "style_light",
                    "style",
                    10,
                    1,
                    format!("The brightest pixels sit toward the {found}, but the \"{name}\" style lights from the {l}. Reshade so lit faces point {l}."),
                );
            }
        }
        if let (Some("dark"), Some(share)) = (self.outline.as_deref(), outline_dark_share) {
            if share < 0.6 {
                f.issue(
                    "style_outline",
                    "style",
                    8,
                    1,
                    format!(
                        "Only {}% of the silhouette edge is dark; the \"{}\" style asks for a dark outline all round.",
                        (share * 100.0) as i64,
                        name
                    ),
                );
            }
        }
    }
}

/// The style as a JSON value (null when there is none).
pub fn json_or_null(style: Option<&StyleLock>) -> Json {
    style.map(|s| Json::Object(s.json())).unwrap_or(Json::Null)
}
