//! Lenient reader for tool arguments coming from JSON (port of Args.swift): agents send numbers as
//! integers or decimals, points as [x, y, z] or {"x": ..}.
use crate::{Json, JsonMap, PcError};

/// Whole numbers from arguments are kept inside ±2^53 (what a JSON number holds exactly), so later
/// arithmetic on coordinates can't overflow. (The Swift app trapped on values past Int's range.)
pub const INT_LIMIT: i64 = 1 << 53;

/// Swift's `Int(x)`: the whole part, toward zero.
pub fn trunc(x: f64) -> i64 {
    if x.is_nan() {
        return 0;
    }
    (x.trunc() as i64).clamp(-INT_LIMIT, INT_LIMIT)
}

/// Swift's `Int(x.rounded())`: to the nearest whole number, halves away from zero.
pub fn round(x: f64) -> i64 {
    if x.is_nan() {
        return 0;
    }
    (x.round() as i64).clamp(-INT_LIMIT, INT_LIMIT)
}

/// A JSON value as a whole number when it holds one exactly (Swift's `as? Int` on a JSON number;
/// true and false count as 1 and 0, as NSNumber does).
pub fn exact_int(v: &Json) -> Option<i64> {
    match v {
        Json::Bool(b) => Some(*b as i64),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(i.clamp(-INT_LIMIT, INT_LIMIT))
            } else if n.is_u64() {
                Some(INT_LIMIT)
            } else {
                let f = n.as_f64()?;
                (f.is_finite() && f.fract() == 0.0).then(|| trunc(f))
            }
        }
        _ => None,
    }
}

/// A JSON value as true or false (Swift's `as? Bool` on a JSON value: also 0 and 1).
pub fn exact_bool(v: &Json) -> Option<bool> {
    match v {
        Json::Bool(b) => Some(*b),
        Json::Number(n) => match n.as_f64() {
            Some(f) if f == 0.0 => Some(false),
            Some(f) if f == 1.0 => Some(true),
            _ => None,
        },
        _ => None,
    }
}

pub struct Args<'a> {
    pub d: &'a JsonMap,
}

impl<'a> Args<'a> {
    pub fn new(d: &'a JsonMap) -> Self {
        Args { d }
    }

    pub fn get(&self, k: &str) -> Option<&'a Json> {
        self.d.get(k)
    }

    pub fn has(&self, k: &str) -> bool {
        matches!(self.d.get(k), Some(v) if !v.is_null())
    }

    pub fn int(&self, k: &str) -> Option<i64> {
        match self.d.get(k)? {
            Json::String(s) => s.parse::<i64>().ok().map(|v| v.clamp(-INT_LIMIT, INT_LIMIT)),
            v @ (Json::Number(_) | Json::Bool(_)) => exact_int(v).or_else(|| v.as_f64().map(round)),
            _ => None,
        }
    }
    pub fn int_or(&self, k: &str, def: i64) -> i64 {
        self.int(k).unwrap_or(def)
    }
    pub fn req(&self, k: &str) -> Result<i64, PcError> {
        self.int(k).ok_or_else(|| PcError::invalid(format!("missing number '{k}'")))
    }

    pub fn double(&self, k: &str) -> Option<f64> {
        Args::number(self.d.get(k))
    }

    pub fn string(&self, k: &str) -> Option<&'a str> {
        self.d.get(k)?.as_str()
    }
    pub fn req_string(&self, k: &str) -> Result<&'a str, PcError> {
        match self.string(k) {
            Some(v) if !v.is_empty() => Ok(v),
            _ => Err(PcError::invalid(format!("missing text '{k}'"))),
        }
    }

    pub fn bool(&self, k: &str, def: bool) -> bool {
        match self.d.get(k) {
            Some(Json::Bool(b)) => *b,
            Some(Json::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(def),
            Some(Json::String(s)) => ["true", "yes", "1"].contains(&s.to_lowercase().as_str()),
            _ => def,
        }
    }

    pub fn number(v: Option<&Json>) -> Option<f64> {
        match v? {
            Json::Number(n) => n.as_f64(),
            Json::Bool(b) => Some(*b as i64 as f64),
            Json::String(s) => s.parse::<f64>().ok(),
            _ => None,
        }
    }

    pub fn point(&self, k: &str) -> Option<(f64, f64, f64)> {
        Args::point_of(self.d.get(k))
    }

    pub fn point_of(v: Option<&Json>) -> Option<(f64, f64, f64)> {
        match v? {
            Json::Array(a) if a.len() >= 3 => {
                Some((Args::number(a.first())?, Args::number(a.get(1))?, Args::number(a.get(2))?))
            }
            Json::Object(o) => Some((Args::number(o.get("x"))?, Args::number(o.get("y"))?, Args::number(o.get("z"))?)),
            _ => None,
        }
    }

    pub fn req_point(&self, k: &str) -> Result<(i64, i64, i64), PcError> {
        let p = self.point(k).ok_or_else(|| PcError::invalid(format!("missing point '{k}' as [x, y, z]")))?;
        Ok((round(p.0), round(p.1), round(p.2)))
    }

    pub fn array(&self, k: &str) -> Option<&'a Vec<Json>> {
        self.d.get(k)?.as_array()
    }
}
