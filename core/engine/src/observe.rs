//! Findings and scores, the critique after each edit, and text views (port of Observe.swift).
use serde_json::json;

use crate::craft;
use crate::engine::{EXTRA_SLOTS, SLOTS};
use crate::model::Document;
use crate::{Json, JsonMap};

// MARK: - findings and scores

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Issue,
    Tip,
}

impl Level {
    pub fn raw(&self) -> &'static str {
        match self {
            Level::Issue => "issue",
            Level::Tip => "tip",
        }
    }
}

/// One result of the automatic checks. Every issue and tip carries a stable `code`, so two reviews can be
/// compared (what an edit introduced, made worse or fixed), and a score deduction, so a run of edits has a
/// number to converge on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub code: String,
    pub category: String,
    pub level: Level,
    /// Points taken off the score (0-100) for this finding.
    pub points: i64,
    /// How much of it was measured (pixels, pairs, frames…): "worse" compares this, since points are capped.
    pub amount: i64,
    pub text: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Findings {
    pub list: Vec<Finding>,
}

impl Findings {
    /// A category never loses more than this, so one kind of problem can't hide the others.
    pub const CATEGORY_CAP: i64 = 40;

    pub fn new() -> Self {
        Findings::default()
    }

    pub fn issue(&mut self, code: &str, category: &str, points: i64, amount: i64, text: impl Into<String>) {
        self.push(code, category, Level::Issue, points, amount, text.into());
    }
    pub fn tip(&mut self, code: &str, category: &str, points: i64, amount: i64, text: impl Into<String>) {
        self.push(code, category, Level::Tip, points, amount, text.into());
    }
    fn push(&mut self, code: &str, category: &str, level: Level, points: i64, amount: i64, text: String) {
        self.list.push(Finding { code: code.into(), category: category.into(), level, points: points.max(0), amount, text });
    }
    pub fn append(&mut self, other: Findings) {
        self.list.extend(other.list);
    }

    pub fn issues(&self) -> Vec<String> {
        self.list.iter().filter(|f| f.level == Level::Issue).map(|f| f.text.clone()).collect()
    }
    pub fn tips(&self) -> Vec<String> {
        self.list.iter().filter(|f| f.level == Level::Tip).map(|f| f.text.clone()).collect()
    }

    /// 100 minus the deductions. Categories are listed when they were checked, so a 3D model has no shading
    /// score and a single frame has no animation score.
    pub fn score(&self, checked: &[&str]) -> JsonMap {
        // Points lost per category, in the order the categories first appear.
        let mut lost: Vec<(&str, i64)> = Vec::new();
        for f in &self.list {
            match lost.iter_mut().find(|(c, _)| *c == f.category) {
                Some(entry) => entry.1 += f.points,
                None => lost.push((&f.category, f.points)),
            }
        }
        let lost_in = |c: &str| lost.iter().find(|(k, _)| *k == c).map(|(_, v)| *v).unwrap_or(0);
        let mut by_category = JsonMap::new();
        for c in checked {
            by_category.insert(c.to_string(), json!(100 - lost_in(c).min(100)));
        }
        let total = (100 - lost.iter().map(|(_, v)| (*v).min(Findings::CATEGORY_CAP)).sum::<i64>()).max(0);
        let mut deducted: Vec<&Finding> = self.list.iter().filter(|f| f.points > 0).collect();
        deducted.sort_by_key(|f| std::cmp::Reverse(f.points));
        let deductions: Vec<Json> = deducted
            .iter()
            .map(|f| json!({"code": f.code, "category": f.category, "level": f.level.raw(), "points": -f.points}))
            .collect();
        let mut out = JsonMap::new();
        out.insert("total".into(), json!(total));
        out.insert("categories".into(), Json::Object(by_category));
        out.insert("deductions".into(), Json::Array(deductions));
        out.insert(
            "meaning".into(),
            json!("100 minus deductions for what the automatic checks can measure (lines, colours, light, cleanliness, frames, style lock). It does not judge the idea or appeal: look at the pictures too."),
        );
        out
    }

    pub fn total(&self, categories: &[&str]) -> i64 {
        self.score(categories).get("total").and_then(Json::as_i64).unwrap_or(0)
    }
}

/// What the agent hears after each edit: the score, its change, and which findings the edit introduced,
/// made worse or resolved. One compact object instead of a full review, so the cause of a new problem is
/// seen at the edit that caused it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Critique {
    pub total: i64,
    /// One finding per code (the last with that code), in the order the codes first appeared.
    pub findings: Vec<Finding>,
}

impl Critique {
    pub fn new(total: i64, findings: &Findings) -> Self {
        let mut by_code: Vec<Finding> = Vec::new();
        for f in &findings.list {
            match by_code.iter_mut().find(|g| g.code == f.code) {
                Some(slot) => *slot = f.clone(),
                None => by_code.push(f.clone()),
            }
        }
        Critique { total, findings: by_code }
    }

    fn find(&self, code: &str) -> Option<&Finding> {
        self.findings.iter().find(|f| f.code == code)
    }

    pub fn compared(&self, before: Option<&Critique>) -> JsonMap {
        let line = |f: &Finding| -> String { format!("[{}] {}", f.level.raw(), f.text) };
        // Issues before tips, then by points lost. (Swift left equal ones in no particular order; here
        // they keep the order the checks reported them.)
        let rank = |f: &Finding| -> (i64, i64) { (if f.level == Level::Issue { 0 } else { 1 }, -f.points) };
        let mut now: Vec<&Finding> = self.findings.iter().collect();
        now.sort_by_key(|f| rank(f));
        let mut out = JsonMap::new();
        out.insert("score".into(), json!(self.total));
        out.insert(
            "open".into(),
            json!({
                "issues": now.iter().filter(|f| f.level == Level::Issue).count(),
                "tips": now.iter().filter(|f| f.level == Level::Tip).count(),
            }),
        );
        let Some(before) = before else {
            if !now.is_empty() {
                out.insert("findings".into(), json!(now.iter().take(5).map(|f| line(f)).collect::<Vec<_>>()));
            }
            return out;
        };
        out.insert("change".into(), json!(self.total - before.total));
        let introduced: Vec<&&Finding> = now.iter().filter(|f| before.find(&f.code).is_none() && f.points > 0).collect();
        let worse: Vec<&&Finding> = now
            .iter()
            .filter(|f| before.find(&f.code).map(|b| f.amount > b.amount || f.points > b.points).unwrap_or(false))
            .collect();
        let mut resolved: Vec<&Finding> = before.findings.iter().filter(|f| self.find(&f.code).is_none()).collect();
        resolved.sort_by_key(|f| rank(f));
        if !introduced.is_empty() {
            out.insert("introduced".into(), json!(introduced.iter().take(4).map(|f| line(f)).collect::<Vec<_>>()));
        }
        if !worse.is_empty() {
            out.insert("worse".into(), json!(worse.iter().take(4).map(|f| line(f)).collect::<Vec<_>>()));
        }
        if !resolved.is_empty() {
            out.insert("resolved".into(), json!(resolved.iter().take(4).map(|f| f.code.clone()).collect::<Vec<_>>()));
        }
        out
    }
}

// MARK: - text views

/// Pictures as text, for reading exact coordinates and checking form without images: the pixel grid with
/// coordinate rulers, a value map, a silhouette map and a frame-to-frame diff. 3D models are projected
/// along a view axis (the first voxel each ray meets), so the text matches what that view shows.
pub mod text_view {
    use super::*;

    pub const VIEWS: [&str; 6] = ["front", "back", "left", "right", "top", "bottom"];
    pub const MAPS: [&str; 4] = ["pixels", "values", "silhouette", "diff"];
    /// Text grids larger than this are cut (and say so); pass a region to read the rest.
    const MAX_SIDE: usize = 96;

    /// A view of one frame as a grid of palette indexes, with the model coordinate each column and row stands for.
    pub struct Projection {
        pub cols: Vec<i64>,
        pub rows: Vec<i64>,
        /// rows.len() × cols.len()
        pub cells: Vec<u8>,
        pub col_axis: &'static str,
        pub row_axis: &'static str,
        pub layout: String,
    }

    impl Projection {
        fn at(&self, c: usize, r: usize) -> u8 {
            self.cells[r * self.cols.len() + c]
        }
    }

    pub fn project(doc: &Document, frame: usize, view: &str) -> Projection {
        let g = doc.composite(frame);
        let (sx, sy, sz) = (doc.sx(), doc.sy(), doc.sz());
        let sprite = sz == 1;
        let up = |n: i64| -> Vec<i64> { (0..n).collect() };
        let down = |n: i64| -> Vec<i64> { (0..n).rev().collect() };
        // The first filled cell along a ray, given the cells from the viewer's side inward.
        let first_hit = |cells: &mut dyn Iterator<Item = (i64, i64, i64)>| -> u8 {
            for (x, y, z) in cells {
                let v = g[doc.index(x, y, z)];
                if v != 0 {
                    return v;
                }
            }
            0
        };
        let mut p = Projection { cols: vec![], rows: vec![], cells: vec![], col_axis: "x", row_axis: "y", layout: String::new() };
        let mut cells: Vec<u8> = Vec::new();
        match view {
            "back" => {
                p.cols = down(sx);
                p.rows = down(sy);
                p.layout = format!("seen from behind: columns x={}→0 (mirrored), rows y={} (top) → 0", sx - 1, sy - 1);
                for &y in &p.rows {
                    for &x in &p.cols {
                        cells.push(first_hit(&mut (0..sz).map(|z| (x, y, z))));
                    }
                }
            }
            "left" => {
                p.col_axis = "z";
                p.cols = up(sz);
                p.rows = down(sy);
                p.layout = format!("seen from the left: columns z=0 (back) → {} (front), rows y={} (top) → 0", sz - 1, sy - 1);
                for &y in &p.rows {
                    for &z in &p.cols {
                        cells.push(first_hit(&mut (0..sx).map(|x| (x, y, z))));
                    }
                }
            }
            "right" => {
                p.col_axis = "z";
                p.cols = down(sz);
                p.rows = down(sy);
                p.layout = format!("seen from the right: columns z={} (front) → 0 (back), rows y={} (top) → 0", sz - 1, sy - 1);
                for &y in &p.rows {
                    for &z in &p.cols {
                        cells.push(first_hit(&mut (0..sx).rev().map(|x| (x, y, z))));
                    }
                }
            }
            "top" => {
                p.row_axis = "z";
                p.cols = up(sx);
                p.rows = up(sz);
                p.layout = format!("seen from above: columns x=0→{}, rows z=0 (back) → {} (front)", sx - 1, sz - 1);
                for &z in &p.rows {
                    for &x in &p.cols {
                        cells.push(first_hit(&mut (0..sy).rev().map(|y| (x, y, z))));
                    }
                }
            }
            "bottom" => {
                p.row_axis = "z";
                p.cols = up(sx);
                p.rows = down(sz);
                p.layout = format!("seen from below: columns x=0→{}, rows z={} (front) → 0 (back)", sx - 1, sz - 1);
                for &z in &p.rows {
                    for &x in &p.cols {
                        cells.push(first_hit(&mut (0..sy).map(|y| (x, y, z))));
                    }
                }
            }
            _ => {
                // front
                p.cols = up(sx);
                if sprite {
                    // Image rows, as set_pixels and paint_slice count them.
                    p.row_axis = "row";
                    p.rows = up(sy);
                    p.layout = format!("the sprite: columns x=0→{}, rows 0 (top) → {}, as set_pixels counts them", sx - 1, sy - 1);
                    for &r in &p.rows {
                        for &x in &p.cols {
                            cells.push(g[doc.index(x, sy - 1 - r, 0)]);
                        }
                    }
                } else {
                    p.rows = down(sy);
                    p.layout = format!("seen from the front: columns x=0→{}, rows y={} (top) → 0", sx - 1, sy - 1);
                    for &y in &p.rows {
                        for &x in &p.cols {
                            cells.push(first_hit(&mut (0..sz).rev().map(|z| (x, y, z))));
                        }
                    }
                }
            }
        }
        p.cells = cells;
        p
    }

    /// Column and row positions to show: the region asked for (in the view's own coordinates), or the
    /// filled area with a one-cell margin, cut to `MAX_SIDE`.
    fn window(p: &Projection, also: Option<&Projection>, region: Option<&[i64]>) -> (Vec<usize>, Vec<usize>, Option<String>) {
        let mut col_idx: Vec<usize> = (0..p.cols.len()).collect();
        let mut row_idx: Vec<usize> = (0..p.rows.len()).collect();
        match region {
            Some(r) if r.len() == 4 => {
                let (c0, c1) = (r[0].min(r[2]), r[0].max(r[2]));
                let (r0, r1) = (r[1].min(r[3]), r[1].max(r[3]));
                col_idx.retain(|&i| (c0..=c1).contains(&p.cols[i]));
                row_idx.retain(|&i| (r0..=r1).contains(&p.rows[i]));
            }
            _ => {
                let (mut c_min, mut c_max, mut r_min, mut r_max) = (usize::MAX, None::<usize>, usize::MAX, 0usize);
                for r in 0..p.rows.len() {
                    for c in 0..p.cols.len() {
                        if p.at(c, r) != 0 || also.map(|q| q.at(c, r)).unwrap_or(0) != 0 {
                            c_min = c_min.min(c);
                            c_max = Some(c_max.map_or(c, |m| m.max(c)));
                            r_min = r_min.min(r);
                            r_max = r_max.max(r);
                        }
                    }
                }
                if let Some(c_max) = c_max {
                    col_idx = (c_min.saturating_sub(1)..=(p.cols.len() - 1).min(c_max + 1)).collect();
                    row_idx = (r_min.saturating_sub(1)..=(p.rows.len() - 1).min(r_max + 1)).collect();
                }
            }
        }
        let mut note = None;
        if col_idx.len() > MAX_SIDE || row_idx.len() > MAX_SIDE {
            note = Some(format!("cut to {MAX_SIDE}×{MAX_SIDE} cells; pass region [col0, row0, col1, row1] to read another part"));
            col_idx.truncate(MAX_SIDE);
            row_idx.truncate(MAX_SIDE);
        }
        (col_idx, row_idx, note)
    }

    /// Ruler lines (hundreds, tens, units) over the columns, then each row with its coordinate in front.
    fn ruled(cols: &[i64], rows: &[i64], mut ch: impl FnMut(usize, usize) -> char) -> Vec<String> {
        let digit = |v: i64| -> char { char::from_digit((v % 10) as u32, 10).unwrap_or('?') };
        let labels: Vec<String> = rows.iter().map(|r| r.to_string()).collect();
        let w = labels.iter().map(|l| l.chars().count()).max().unwrap_or(1).max(1);
        let pad = " ".repeat(w + 1);
        let mut out = Vec::new();
        let widest = cols.iter().map(|c| c.abs()).max().unwrap_or(0);
        if widest >= 100 {
            out.push(pad.clone() + &cols.iter().map(|&c| if c >= 100 { digit(c / 100) } else { ' ' }).collect::<String>());
        }
        if widest >= 10 {
            out.push(pad.clone() + &cols.iter().map(|&c| if c >= 10 { digit(c / 10) } else { ' ' }).collect::<String>());
        }
        out.push(pad.clone() + &cols.iter().map(|&c| digit(c)).collect::<String>());
        for (ri, label) in labels.iter().enumerate() {
            let cells: String = (0..cols.len()).map(|c| ch(c, ri)).collect();
            out.push(" ".repeat(w - label.chars().count()) + label + " " + &cells);
        }
        out
    }

    pub fn render(doc: &Document, frame: usize, view: &str, wanted: &[String], compare: Option<usize>, region: Option<&[i64]>) -> JsonMap {
        let p = project(doc, frame, view);
        let q = compare.map(|c| project(doc, c, view));
        let (ci, ri, note) = window(&p, q.as_ref(), region);
        let cols: Vec<i64> = ci.iter().map(|&i| p.cols[i]).collect();
        let rows: Vec<i64> = ri.iter().map(|&i| p.rows[i]).collect();
        let mut out = JsonMap::new();
        out.insert("view".into(), json!(view));
        out.insert("frame".into(), json!(frame));
        out.insert("layout".into(), json!(p.layout));
        out.insert(
            "columns".into(),
            json!(format!("{} {}→{}", p.col_axis, cols.first().copied().unwrap_or(0), cols.last().copied().unwrap_or(0))),
        );
        out.insert(
            "rows".into(),
            json!(format!("{} {}→{}", p.row_axis, rows.first().copied().unwrap_or(0), rows.last().copied().unwrap_or(0))),
        );
        if let Some(n) = note {
            out.insert("note".into(), json!(n));
        }
        if ci.is_empty() || ri.is_empty() {
            out.insert("note".into(), json!("nothing in this region"));
            return out;
        }
        let cell = |c: usize, r: usize| -> u8 { p.at(ci[c], ri[r]) };
        let has = |name: &str| wanted.iter().any(|m| m == name);

        if has("pixels") {
            let mut legend = JsonMap::new();
            let mut custom: Vec<(u8, char)> = Vec::new();
            let mut extra = 0usize;
            let lines = ruled(&cols, &rows, |c, r| {
                let v = cell(c, r);
                if v == 0 {
                    return '.';
                }
                let ch = if v as usize <= SLOTS.len() {
                    SLOTS[v as usize - 1] as char
                } else if let Some((_, k)) = custom.iter().find(|(cv, _)| *cv == v) {
                    *k
                } else {
                    let k = if extra < EXTRA_SLOTS.len() { EXTRA_SLOTS[extra] as char } else { '#' };
                    extra += 1;
                    custom.push((v, k));
                    k
                };
                legend.insert(ch.to_string(), json!({"index": v, "hex": doc.color(v).hex()}));
                ch
            });
            out.insert("pixels".into(), json!(lines));
            out.insert("legend".into(), Json::Object(legend));
        }
        if has("values") {
            let lines = ruled(&cols, &rows, |c, r| {
                let v = cell(c, r);
                if v == 0 {
                    return '.';
                }
                let level = ((craft::luma(doc.color(v)) * 10.0) as i64).min(9);
                char::from_digit(level.max(0) as u32, 10).unwrap_or('9')
            });
            out.insert("values".into(), json!(lines));
            out.insert("value_scale".into(), json!("0 darkest … 9 brightest (perceived brightness of each colour); '.' empty"));
        }
        if has("silhouette") {
            let lines = ruled(&cols, &rows, |c, r| if cell(c, r) == 0 { '.' } else { '#' });
            out.insert("silhouette".into(), json!(lines));
        }
        if let (true, Some(q), Some(other)) = (has("diff"), q.as_ref(), compare) {
            let (mut added, mut removed, mut recolored, mut same) = (0, 0, 0, 0);
            let lines = ruled(&cols, &rows, |c, r| {
                let (now, was) = (cell(c, r), q.at(ci[c], ri[r]));
                match (was, now) {
                    (0, 0) => '.',
                    (0, _) => {
                        added += 1;
                        '+'
                    }
                    (_, 0) => {
                        removed += 1;
                        '-'
                    }
                    _ if was == now => {
                        same += 1;
                        'o'
                    }
                    _ => {
                        recolored += 1;
                        '*'
                    }
                }
            });
            out.insert("diff".into(), json!(lines));
            out.insert("diff_against_frame".into(), json!(other));
            out.insert("diff_counts".into(), json!({"added": added, "removed": removed, "recolored": recolored, "same": same}));
            out.insert("diff_key".into(), json!("o unchanged, + filled in this frame, - emptied, * recoloured, . empty in both"));
        }
        out
    }
}
