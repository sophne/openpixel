//! Built-in palettes. Index 0 is the "empty" slot, so palette colours start at index 1.
//! These are well-known community palettes (credited in README); the colour values are plain data.
use crate::model::Rgba;

/// Sorted by name, as `names()` lists them.
const TABLE: &[(&str, &str)] = &[
    ("db16", "140c1c 442434 30346d 4e4a4e 854c30 346524 d04648 757161 597dce d27d2c 8595a1 6daa2c d2aa99 6dc2ca dad45e deeed6"),
    ("db32", "000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30"),
    ("edg32", "be4a2f d87644 ead4aa e4a672 b86f50 743f39 3f2832 9e2835 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0095e9 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 ff0044 181425 68386c b55088 f6757a e8b796 c28569"),
    ("grayscale", "000000 111111 222222 333333 444444 555555 666666 777777 888888 999999 aaaaaa bbbbbb cccccc dddddd eeeeee ffffff"),
    // No palette: one colour to draw with (index 1, black); colours picked later are added one by one.
    ("none", "000000"),
    ("pico8", "000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa"),
];

/// The preset names, sorted.
pub fn names() -> Vec<&'static str> {
    TABLE.iter().map(|(n, _)| *n).collect()
}

/// A preset by name (case and "-" are ignored), with the empty slot at index 0.
pub fn named(name: &str) -> Option<Vec<Rgba>> {
    let key = name.to_lowercase().replace('-', "");
    let (_, s) = TABLE.iter().find(|(n, _)| *n == key)?;
    let mut out = vec![Rgba::new(0, 0, 0, 0)];
    out.extend(s.split(' ').filter(|p| !p.is_empty()).filter_map(Rgba::parse));
    Some(out)
}
