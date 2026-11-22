//! JSON text as the Mac app wrote it (Foundation's JSONSerialization), and small readers for loosely typed
//! JSON. Agents read the pretty text of every tool result, so its layout stays the same: keys in order,
//! `"key" : value`, two spaces per level, whole numbers without a fraction.
use openpixel_core::{Json, JsonMap};

/// How to write: JSONSerialization's `.prettyPrinted` and `.sortedKeys` (slashes are never escaped).
#[derive(Clone, Copy, Default)]
pub struct Style {
    pub pretty: bool,
    pub sorted: bool,
}

/// One line, sorted keys, slashes as they are: what MCP replies use.
pub const COMPACT: Style = Style { pretty: false, sorted: true };
/// Indented, sorted keys, slashes as they are: the text of a tool result.
pub const PRETTY: Style = Style { pretty: true, sorted: true };

pub fn write(v: &Json, style: Style) -> String {
    let mut out = String::new();
    value(&mut out, v, style, 0);
    out
}

pub fn write_map(m: &JsonMap, style: Style) -> String {
    let mut out = String::new();
    object(&mut out, m, style, 0);
    out
}

fn indent(out: &mut String, level: usize) {
    for _ in 0..level {
        out.push_str("  ");
    }
}

fn value(out: &mut String, v: &Json, style: Style, level: usize) {
    match v {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Number(n) => number(out, n),
        Json::String(s) => string(out, s),
        Json::Array(items) => {
            out.push('[');
            if style.pretty {
                out.push('\n');
            }
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                    if style.pretty {
                        out.push('\n');
                    }
                }
                if style.pretty {
                    indent(out, level + 1);
                }
                value(out, item, style, level + 1);
            }
            if style.pretty {
                out.push('\n');
                indent(out, level);
            }
            out.push(']');
        }
        Json::Object(m) => object(out, m, style, level),
    }
}

fn object(out: &mut String, m: &JsonMap, style: Style, level: usize) {
    let mut keys: Vec<&String> = m.keys().collect();
    if style.sorted {
        keys.sort();
    }
    out.push('{');
    if style.pretty {
        out.push('\n');
    }
    for (i, k) in keys.iter().enumerate() {
        if i > 0 {
            out.push(',');
            if style.pretty {
                out.push('\n');
            }
        }
        if style.pretty {
            indent(out, level + 1);
        }
        string(out, k);
        out.push_str(if style.pretty { " : " } else { ":" });
        value(out, &m[k.as_str()], style, level + 1);
    }
    if style.pretty {
        out.push('\n');
        indent(out, level);
    }
    out.push('}');
}

fn number(out: &mut String, n: &serde_json::Number) {
    if n.is_i64() || n.is_u64() {
        out.push_str(&n.to_string());
        return;
    }
    match n.as_f64() {
        // Foundation writes 2.0 as 2.
        Some(f) if f.is_finite() && f.fract() == 0.0 && f.abs() < 1e15 => out.push_str(&format!("{f:.0}")),
        _ => out.push_str(&n.to_string()),
    }
}

fn string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Parses text that must hold one JSON object.
pub fn parse_object(text: &str) -> Option<JsonMap> {
    match serde_json::from_str::<Json>(text) {
        Ok(Json::Object(m)) => Some(m),
        _ => None,
    }
}

/// true / false, and the numbers 1 and 0 (what Swift's `as? Bool` accepted).
pub fn bool_of(v: Option<&Json>) -> Option<bool> {
    match v? {
        Json::Bool(b) => Some(*b),
        Json::Number(n) => match n.as_f64() {
            Some(0.0) => Some(false),
            Some(1.0) => Some(true),
            _ => None,
        },
        _ => None,
    }
}

/// A list whose every item is text (one other item and the whole list does not count).
pub fn str_list(v: Option<&Json>) -> Option<Vec<&str>> {
    v?.as_array()?.iter().map(Json::as_str).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pretty_text_matches_foundation() {
        let v = json!({"b": [1, 2.0, "x/y"], "a": {"k": null}, "e": [], "o": {}, "t": true});
        assert_eq!(
            write(&v, PRETTY),
            "{\n  \"a\" : {\n    \"k\" : null\n  },\n  \"b\" : [\n    1,\n    2,\n    \"x/y\"\n  ],\n  \"e\" : [\n\n  ],\n  \"o\" : {\n\n  },\n  \"t\" : true\n}"
        );
        assert_eq!(write(&v, COMPACT), "{\"a\":{\"k\":null},\"b\":[1,2,\"x/y\"],\"e\":[],\"o\":{},\"t\":true}");
    }

    #[test]
    fn strings_escape_like_foundation() {
        let v = json!("a\"b\\c/d\n\u{1b}é");
        assert_eq!(write(&v, COMPACT), "\"a\\\"b\\\\c/d\\n\\u001bé\"");
    }

    #[test]
    fn loose_readers() {
        assert_eq!(bool_of(Some(&json!(1))), Some(true));
        assert_eq!(bool_of(Some(&json!("yes"))), None);
        assert!(str_list(Some(&json!(["a", 1]))).is_none());
        assert_eq!(str_list(Some(&json!(["a"]))), Some(vec!["a"]));
        assert!(parse_object("[1]").is_none());
    }
}
