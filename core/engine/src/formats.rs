//! File formats (port of Formats.swift): the native .openpixel file, PNG and GIF pictures,
//! MagicaVoxel .vox, Wavefront .obj, SVG and HTML.
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};

use base64::Engine as _;
use serde_json::json;

use crate::args::{exact_bool, exact_int};
use crate::io::HostIo;
use crate::model::{Document, Frame, Grid, Layer, Rgba};
use crate::palettes;
use crate::render::Picture;
use crate::{Json, PcError};

// MARK: - JSON as the Mac app wrote it

/// JSON text laid out like Foundation's JSONSerialization with `.prettyPrinted` and `.sortedKeys`:
/// two-space indents, `"key" : value`, keys in order, "/" written as "\/". The Mac app wrote
/// .openpixel and style files this way, so files stay the same text whichever app saves them.
pub fn pretty_sorted_json(v: &Json) -> String {
    let mut out = String::new();
    write_pretty(v, 0, &mut out);
    out
}

fn write_pretty(v: &Json, indent: usize, out: &mut String) {
    let pad = |n: usize, out: &mut String| out.extend(std::iter::repeat_n("  ", n));
    match v {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Number(n) => out.push_str(&n.to_string()),
        Json::String(s) => write_json_string(s, out),
        Json::Array(a) => {
            out.push_str("[\n");
            for (i, e) in a.iter().enumerate() {
                if i > 0 {
                    out.push_str(",\n");
                }
                pad(indent + 1, out);
                write_pretty(e, indent + 1, out);
            }
            out.push('\n');
            pad(indent, out);
            out.push(']');
        }
        Json::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            out.push_str("{\n");
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push_str(",\n");
                }
                pad(indent + 1, out);
                write_json_string(k, out);
                out.push_str(" : ");
                write_pretty(&o[*k], indent + 1, out);
            }
            out.push('\n');
            pad(indent, out);
            out.push('}');
        }
    }
}

fn write_json_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '/' => out.push_str("\\/"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

// MARK: - Native file (.openpixel, JSON)

/// The .openpixel format is plain JSON so people and agents can read it:
/// {"format":"openpixel","version":1,"name":..,"size":[x,y,z],"palette":["#rrggbb",..],
///  "layers":[{"name":..,"visible":true,"locked":false}],"frames":[{"duration":100}],
///  "cels":[{"layer":0,"frame":0,"encoding":"zlib-base64","data":".."}]}
/// palette[0] is the empty slot. Cell order: x fastest, then z (back→front), then y (bottom→top).
///
/// "zlib-base64" is what the Mac app called it; the bytes are a raw DEFLATE stream (no zlib header),
/// which is what Foundation's `.zlib` compression writes.
pub mod native_file {
    use super::*;

    fn base64() -> base64::engine::GeneralPurpose {
        use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
        let config = GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(DecodePaddingMode::RequireCanonical);
        GeneralPurpose::new(&base64::alphabet::STANDARD, config)
    }

    pub fn encode(doc: &Document) -> Result<Vec<u8>, PcError> {
        let mut cels: Vec<Json> = Vec::new();
        for li in 0..doc.layers.len() {
            for fi in 0..doc.frames.len() {
                if doc.cels[li][fi].is_empty() {
                    continue;
                }
                let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::new(5));
                let packed = enc
                    .write_all(doc.cels[li][fi].data())
                    .and_then(|_| enc.finish())
                    .map_err(|e| PcError::invalid(format!("could not pack cel {li}/{fi}: {e}")))?;
                cels.push(json!({"layer": li, "frame": fi, "encoding": "zlib-base64", "data": base64().encode(packed)}));
            }
        }
        let obj = json!({
            "format": "openpixel", "version": 1, "name": doc.name,
            "size": [doc.sx(), doc.sy(), doc.sz()],
            "palette": doc.palette.iter().map(|c| if c.a == 0 { "transparent".to_string() } else { c.hex() }).collect::<Vec<_>>(),
            "layers": doc.layers.iter().map(|l| json!({"name": l.name, "visible": l.visible, "locked": l.locked})).collect::<Vec<_>>(),
            "frames": doc.frames.iter().map(|f| json!({"duration": f.duration})).collect::<Vec<_>>(),
            "cels": cels,
        });
        Ok(pretty_sorted_json(&obj).into_bytes())
    }

    pub fn decode(data: &[u8]) -> Result<Document, PcError> {
        let not_ours = || PcError::invalid("not a OpenPixel file");
        let data = data.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(data);
        let parsed: Json = serde_json::from_slice(data).map_err(|_| not_ours())?;
        let o = parsed.as_object().ok_or_else(not_ours)?;
        if o.get("format").and_then(Json::as_str) != Some("openpixel") {
            return Err(not_ours());
        }
        let size: Vec<i64> = o
            .get("size")
            .and_then(Json::as_array)
            .and_then(|a| a.iter().map(exact_int).collect::<Option<Vec<i64>>>())
            .ok_or_else(not_ours)?;
        if size.len() != 3 {
            return Err(not_ours());
        }
        Document::check_size(size[0], size[1], size[2])?;
        let name = o.get("name").and_then(Json::as_str).unwrap_or("Untitled");
        let mut doc = Document::new(name, size[0], size[1], size[2], None);
        // A palette is only read when every entry is text (as the Mac app's cast required).
        if let Some(pal) = o.get("palette").and_then(Json::as_array) {
            if let Some(texts) = pal.iter().map(Json::as_str).collect::<Option<Vec<&str>>>() {
                doc.palette = vec![Rgba::new(0, 0, 0, 0)];
                doc.palette.extend(texts.iter().skip(1).take(255).map(|s| Rgba::parse(s).unwrap_or(Rgba::rgb(0, 0, 0))));
            }
        }
        let objects = |key: &str| -> Option<Vec<&crate::JsonMap>> {
            o.get(key)?.as_array()?.iter().map(Json::as_object).collect()
        };
        let layers = objects("layers");
        let frames = objects("frames");
        let (layer_count, frame_count) = (layers.as_ref().map_or(1, Vec::len), frames.as_ref().map_or(1, Vec::len));
        // Every layer × frame holds a full grid, so a file can't ask for unbounded memory.
        if layer_count > Document::MAX_LAYERS
            || frame_count > Document::MAX_FRAMES
            || layer_count as u64 * frame_count as u64 * doc.count() as u64 > Document::MAX_CELLS as u64
        {
            return Err(PcError::invalid("file has too many layers or frames"));
        }
        doc.layers = match &layers {
            None => vec![Layer::new("Layer 1")],
            Some(list) => list
                .iter()
                .map(|l| {
                    let mut layer = Layer::new(l.get("name").and_then(Json::as_str).unwrap_or("Layer"));
                    layer.visible = l.get("visible").and_then(exact_bool).unwrap_or(true);
                    layer.locked = l.get("locked").and_then(exact_bool).unwrap_or(false);
                    layer
                })
                .collect(),
        };
        if doc.layers.is_empty() {
            doc.layers = vec![Layer::new("Layer 1")];
        }
        doc.frames = match &frames {
            None => vec![Frame::default()],
            Some(list) => list.iter().map(|f| Frame { duration: f.get("duration").and_then(exact_int).unwrap_or(100).max(1) }).collect(),
        };
        if doc.frames.is_empty() {
            doc.frames = vec![Frame::default()];
        }
        let count = doc.count();
        let empty = Grid::new(count);
        doc.cels = vec![vec![empty; doc.frames.len()]; doc.layers.len()];
        for c in objects("cels").unwrap_or_default() {
            let (Some(li), Some(fi)) = (c.get("layer").and_then(exact_int), c.get("frame").and_then(exact_int)) else { continue };
            if li < 0 || li >= doc.layers.len() as i64 || fi < 0 || fi >= doc.frames.len() as i64 {
                continue;
            }
            let Some(z) = c.get("data").and_then(Json::as_str).and_then(|b64| base64().decode(b64).ok()) else { continue };
            // Never unpack more than a grid (plus one byte, to notice a cel that is too long).
            let mut raw = Vec::with_capacity(count);
            flate2::read::DeflateDecoder::new(&z[..])
                .take(count as u64 + 1)
                .read_to_end(&mut raw)
                .map_err(|_| PcError::invalid(format!("cel {li}/{fi} is damaged")))?;
            if raw.len() != count {
                return Err(PcError::invalid(format!("cel {li}/{fi} has the wrong size")));
            }
            doc.cels[li as usize][fi as usize] = Grid::from_data(raw);
        }
        doc.drop_colours_outside_palette();
        Ok(doc)
    }
}

// MARK: - Pictures (PNG, GIF)

pub mod image_files {
    use super::*;

    /// The largest picture that is read (4096 × 4096 pixels).
    const MAX_DECODED_PIXELS: i64 = 1 << 24;

    /// PNG bytes of a picture (empty if it can't be encoded, as in the Mac app).
    pub fn png(p: &Picture) -> Vec<u8> {
        let mut out = Vec::new();
        let (Ok(w), Ok(h)) = (u32::try_from(p.width), u32::try_from(p.height)) else { return Vec::new() };
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let Ok(mut writer) = enc.write_header() else { return Vec::new() };
            if writer.write_image_data(&p.pixels).is_err() || writer.finish().is_err() {
                return Vec::new();
            }
        }
        out
    }

    /// Animated GIF; delays in milliseconds. Transparent pixels stay transparent.
    ///
    /// The colours are reduced the way the Mac app's GIF writer (ImageIO) did, so the pictures come out the
    /// same: colours whose red, green and blue share their top five bits become one colour, the average of the
    /// pixels that have them over all frames; the darkest group becomes pure black and the lightest pure white.
    /// Flat sprite colours pass through unchanged; the shades of a 3D render merge slightly.
    /// With more than 255 such groups (ImageIO's answer to that is not known) each frame is reduced on its own.
    pub fn gif(frames: &[Picture], delays: &[i64], looped: bool) -> Result<Vec<u8>, PcError> {
        let fail = |e: gif::EncodingError| PcError::invalid(format!("could not write the GIF: {e}"));
        let Some(first) = frames.first() else { return Err(PcError::invalid("a GIF needs at least one frame")) };
        let (Ok(w), Ok(h)) = (u16::try_from(first.width), u16::try_from(first.height)) else {
            return Err(PcError::invalid("a GIF is at most 65535 pixels per side; use a smaller scale"));
        };
        if frames.iter().any(|f| (f.width, f.height) != (first.width, first.height)) {
            return Err(PcError::invalid("every frame of a GIF must have the same size"));
        }
        let opaque = |a: u8| a >= 128;
        let group = |p: &Picture, i: usize| -> usize {
            ((p.pixels[i * 4] as usize >> 3) << 10) | ((p.pixels[i * 4 + 1] as usize >> 3) << 5) | (p.pixels[i * 4 + 2] as usize >> 3)
        };
        // Per group of colours: the sums of red, green and blue, and the number of pixels.
        let mut sums = vec![[0u64; 4]; 1 << 15];
        let mut any_transparent = false;
        for f in frames {
            for i in 0..f.width * f.height {
                if !opaque(f.pixels[i * 4 + 3]) {
                    any_transparent = true;
                    continue;
                }
                let s = &mut sums[group(f, i)];
                s[0] += f.pixels[i * 4] as u64;
                s[1] += f.pixels[i * 4 + 1] as u64;
                s[2] += f.pixels[i * 4 + 2] as u64;
                s[3] += 1;
            }
        }
        const NONE: u16 = u16::MAX;
        let mut index = vec![NONE; 1 << 15];
        let mut table: Vec<[u8; 3]> = Vec::new();
        for (g, s) in sums.iter().enumerate() {
            if s[3] == 0 {
                continue;
            }
            let mean = |sum: u64| ((sum * 2 + s[3]) / (2 * s[3])) as u8;
            let colour = match g {
                0 => [0, 0, 0],
                0x7fff => [255, 255, 255],
                _ => [mean(s[0]), mean(s[1]), mean(s[2])],
            };
            index[g] = table.len() as u16;
            table.push(colour);
        }
        let shared = table.len() + usize::from(any_transparent) <= 256;
        let flat = |pal: &[[u8; 3]]| -> Vec<u8> {
            let mut v: Vec<u8> = pal.iter().flatten().copied().collect();
            // A colour table needs at least two entries.
            while v.len() < 6 {
                v.extend([0, 0, 0]);
            }
            v
        };
        let mut out = Vec::new();
        {
            let global_table = if shared { flat(&table) } else { Vec::new() };
            let mut enc = gif::Encoder::new(&mut out, w, h, &global_table).map_err(fail)?;
            enc.set_repeat(if looped { gif::Repeat::Infinite } else { gif::Repeat::Finite(1) }).map_err(fail)?;
            for (fi, f) in frames.iter().enumerate() {
                let ms = delays.get(fi).copied().unwrap_or(100);
                let delay = ((ms as f64 / 10.0).round() as i64).clamp(0, 65535) as u16;
                let count = f.width * f.height;
                let mut frame;
                if shared {
                    let transparent = table.len() as u8;
                    let buffer: Vec<u8> =
                        (0..count).map(|i| if opaque(f.pixels[i * 4 + 3]) { index[group(f, i)] as u8 } else { transparent }).collect();
                    frame = gif::Frame { buffer: buffer.into(), ..gif::Frame::default() };
                    if any_transparent {
                        frame.transparent = Some(transparent);
                    }
                } else {
                    // Too many colours for one table: reduce this frame's (already merged) colours on its own.
                    let mut rgba = Vec::with_capacity(count * 4);
                    for i in 0..count {
                        if opaque(f.pixels[i * 4 + 3]) {
                            let c = table[index[group(f, i)] as usize];
                            rgba.extend([c[0], c[1], c[2], 255]);
                        } else {
                            rgba.extend([0, 0, 0, 0]);
                        }
                    }
                    frame = gif::Frame::from_rgba_speed(w, h, &mut rgba, 10);
                }
                frame.width = w;
                frame.height = h;
                frame.delay = delay;
                frame.dispose = gif::DisposalMethod::Background;
                enc.write_frame(&frame).map_err(fail)?;
            }
        }
        Ok(out)
    }

    /// Reads a PNG or GIF (its first frame) into RGBA pixels.
    ///
    /// The Mac app read any picture macOS understands through CoreGraphics, which stored half-transparent
    /// pixels premultiplied; the same rounding is applied here so colours come out alike.
    pub fn read(io: &dyn HostIo, path: &str) -> Result<Picture, PcError> {
        let fail = || PcError::invalid(format!("could not read image {path}"));
        let data = io.read(path).map_err(|_| fail())?;
        let mut p = read_bytes(&data).ok_or_else(fail)?;
        for px in p.pixels.chunks_exact_mut(4) {
            let a = px[3] as i64;
            if a == 0 {
                px[0] = 0;
                px[1] = 0;
                px[2] = 0;
            } else if a < 255 {
                for c in px.iter_mut().take(3) {
                    let premultiplied = (*c as i64 * a + 127) / 255;
                    *c = (premultiplied * 255 / a).min(255) as u8;
                }
            }
        }
        Ok(p)
    }

    /// Decodes PNG or GIF bytes to straight (not premultiplied) RGBA.
    pub fn read_bytes(data: &[u8]) -> Option<Picture> {
        if data.starts_with(b"\x89PNG\r\n\x1a\n") {
            read_png(data)
        } else if data.starts_with(b"GIF8") {
            read_gif(data)
        } else {
            None
        }
    }

    fn read_png(data: &[u8]) -> Option<Picture> {
        let mut decoder = png::Decoder::new(data);
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().ok()?;
        let (w, h) = (reader.info().width as i64, reader.info().height as i64);
        // A picture is unpacked whole before any of it is used: refuse ones that would need gigabytes.
        if w * h > MAX_DECODED_PIXELS {
            return None;
        }
        let mut pic = Picture::clear(w, h).ok()?;
        let mut buf = vec![0u8; reader.output_buffer_size()];
        let info = reader.next_frame(&mut buf).ok()?;
        let buf = &buf[..info.buffer_size()];
        let n = pic.width * pic.height;
        match info.color_type {
            png::ColorType::Rgba if buf.len() >= n * 4 => pic.pixels.copy_from_slice(&buf[..n * 4]),
            png::ColorType::Rgb if buf.len() >= n * 3 => {
                for i in 0..n {
                    pic.set_pixel(i, Rgba::rgb(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]));
                }
            }
            png::ColorType::Grayscale if buf.len() >= n => {
                for i in 0..n {
                    pic.set_pixel(i, Rgba::rgb(buf[i], buf[i], buf[i]));
                }
            }
            png::ColorType::GrayscaleAlpha if buf.len() >= n * 2 => {
                for i in 0..n {
                    pic.set_pixel(i, Rgba::new(buf[i * 2], buf[i * 2], buf[i * 2], buf[i * 2 + 1]));
                }
            }
            _ => return None,
        }
        Some(pic)
    }

    fn read_gif(data: &[u8]) -> Option<Picture> {
        let frames = read_gif_frames(data, 1)?;
        frames.into_iter().next().map(|(p, _)| p)
    }

    /// Every frame of a GIF as it is shown (earlier frames composed in, by each frame's disposal), with
    /// its delay in milliseconds. Stops after `limit` frames.
    pub fn read_gif_frames(data: &[u8], limit: usize) -> Option<Vec<(Picture, i64)>> {
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::RGBA);
        let mut decoder = options.read_info(data).ok()?;
        let (w, h) = (decoder.width() as i64, decoder.height() as i64);
        if w * h > MAX_DECODED_PIXELS {
            return None;
        }
        let mut canvas = Picture::clear(w, h).ok()?;
        let mut out = Vec::new();
        while out.len() < limit {
            let Some(frame) = decoder.read_next_frame().ok()? else { break };
            let before = canvas.clone();
            let (fw, fh) = (frame.width as usize, frame.height as usize);
            if frame.buffer.len() < fw * fh * 4 {
                return None;
            }
            for y in 0..fh {
                for x in 0..fw {
                    let (tx, ty) = (x + frame.left as usize, y + frame.top as usize);
                    if tx >= canvas.width || ty >= canvas.height {
                        continue;
                    }
                    let s = &frame.buffer[(y * fw + x) * 4..(y * fw + x) * 4 + 4];
                    if s[3] != 0 {
                        canvas.set_pixel(ty * canvas.width + tx, Rgba::new(s[0], s[1], s[2], s[3]));
                    }
                }
            }
            out.push((canvas.clone(), frame.delay as i64 * 10));
            match frame.dispose {
                gif::DisposalMethod::Background => {
                    for y in 0..fh {
                        for x in 0..fw {
                            let (tx, ty) = (x + frame.left as usize, y + frame.top as usize);
                            if tx < canvas.width && ty < canvas.height {
                                canvas.set_pixel(ty * canvas.width + tx, Rgba::new(0, 0, 0, 0));
                            }
                        }
                    }
                }
                gif::DisposalMethod::Previous => canvas = before,
                _ => {}
            }
        }
        if out.is_empty() {
            return None;
        }
        Some(out)
    }
}

// MARK: - MagicaVoxel .vox

/// MagicaVoxel uses z-up; OpenPixel uses y-up with z toward the front.
/// Mapping: vox.x = x, vox.y = (sz-1-z), vox.z = y.
pub mod vox_file {
    use super::*;

    pub fn encode(doc: &Document, frame: usize) -> Result<Vec<u8>, PcError> {
        if doc.sx() > 256 || doc.sy() > 256 || doc.sz() > 256 {
            return Err(PcError::invalid(".vox models are at most 256 per side"));
        }
        let grid = doc.composite(frame);
        let mut xyzi: Vec<u8> = Vec::new();
        let mut n: u32 = 0;
        for y in 0..doc.sy() {
            for z in 0..doc.sz() {
                for x in 0..doc.sx() {
                    let v = grid[doc.index(x, y, z)];
                    if v == 0 {
                        continue;
                    }
                    xyzi.extend([x as u8, (doc.sz() - 1 - z) as u8, y as u8, v]);
                    n += 1;
                }
            }
        }
        fn u32le(v: u32) -> [u8; 4] {
            v.to_le_bytes()
        }
        fn chunk(id: &str, content: &[u8]) -> Vec<u8> {
            let mut d = id.as_bytes().to_vec();
            d.extend(u32le(content.len() as u32));
            d.extend(u32le(0));
            d.extend(content);
            d
        }
        let mut size = Vec::new();
        size.extend(u32le(doc.sx() as u32));
        size.extend(u32le(doc.sz() as u32));
        size.extend(u32le(doc.sy() as u32));
        let mut rgba: Vec<u8> = Vec::with_capacity(1024);
        for i in 1..=256usize {
            let c = if i < doc.palette.len() { doc.palette[i] } else { Rgba::new(0, 0, 0, 255) };
            rgba.extend([c.r, c.g, c.b, 255]);
        }
        let mut cells = u32le(n).to_vec();
        cells.extend(xyzi);
        let mut children = chunk("SIZE", &size);
        children.extend(chunk("XYZI", &cells));
        children.extend(chunk("RGBA", &rgba));
        let mut out = b"VOX ".to_vec();
        out.extend(u32le(150));
        out.extend(b"MAIN");
        out.extend(u32le(0));
        out.extend(u32le(children.len() as u32));
        out.extend(children);
        Ok(out)
    }

    /// Reads a .vox file. Every read is bounds-checked: these files come from the internet, so a short or
    /// malformed file must fail with an error, never read or write outside the data.
    pub fn decode(b: &[u8], name: &str) -> Result<Document, PcError> {
        if b.len() < 8 || &b[0..4] != b"VOX " {
            return Err(PcError::invalid("not a .vox file"));
        }
        let bad = || PcError::invalid("damaged .vox file");
        let total = b.len() as i64;
        let u32at = |o: i64| -> Result<i64, PcError> {
            if o < 0 || o + 4 > total {
                return Err(bad());
            }
            let o = o as usize;
            Ok(u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) as i64)
        };
        let mut size: Option<(i64, i64, i64)> = None;
        let mut voxels: Vec<(i64, i64, i64, u8)> = Vec::new();
        let mut palette: Option<Vec<Rgba>> = None;
        let mut o: i64 = 8;
        while o + 12 <= total {
            let id = &b[o as usize..o as usize + 4];
            let (len, kids) = (u32at(o + 4)?, u32at(o + 8)?);
            let body = o + 12;
            // The chunk's own content must fit inside the file (children may be cut off; we stop there).
            if len > total - body {
                return Err(bad());
            }
            match id {
                b"MAIN" => {
                    o = body + len;
                    continue;
                }
                b"SIZE" => {
                    if len < 12 {
                        return Err(bad());
                    }
                    if size.is_none() {
                        size = Some((u32at(body)?, u32at(body + 4)?, u32at(body + 8)?));
                    }
                }
                b"XYZI" => {
                    if len < 4 {
                        return Err(bad());
                    }
                    if voxels.is_empty() {
                        let n = u32at(body)?.min((len - 4) / 4);
                        voxels.reserve(n as usize);
                        for i in 0..n {
                            let p = (body + 4 + i * 4) as usize;
                            let cell = b.get(p..p + 4).ok_or_else(bad)?;
                            voxels.push((cell[0] as i64, cell[1] as i64, cell[2] as i64, cell[3]));
                        }
                    }
                }
                b"RGBA" => {
                    if len < 1024 {
                        return Err(bad());
                    }
                    let mut pal = vec![Rgba::new(0, 0, 0, 0)];
                    for i in 0..255 {
                        let p = (body + i * 4) as usize;
                        let c = b.get(p..p + 4).ok_or_else(bad)?;
                        pal.push(Rgba::new(c[0], c[1], c[2], 255));
                    }
                    palette = Some(pal);
                }
                _ => {}
            }
            o = body + len + kids;
        }
        let Some(s) = size else { return Err(PcError::invalid(".vox file has no model")) };
        // MagicaVoxel's z is OpenPixel's y.
        Document::check_size(s.0, s.2, s.1)?;
        let mut doc = Document::new(name, s.0, s.2, s.1, None);
        doc.palette = match palette {
            Some(p) => trimmed_palette(&p, &voxels.iter().map(|v| v.3).collect()),
            None => palettes::named("db32").expect("db32 is built in"),
        };
        let sz = doc.sz();
        let mut grid = vec![0u8; doc.count()];
        for (x, vy, vz, c) in voxels {
            let (y, z) = (vz, sz - 1 - vy);
            if doc.in_bounds(x, y, z) {
                grid[doc.index(x, y, z)] = c;
            }
        }
        doc.cels[0][0] = Grid::from_data(grid);
        doc.drop_colours_outside_palette();
        Ok(doc)
    }

    /// Keep all 256 slots so indexes stay valid, but drop trailing unused black entries.
    fn trimmed_palette(p: &[Rgba], used: &HashSet<u8>) -> Vec<Rgba> {
        let mut last = 1;
        for (i, c) in p.iter().enumerate().skip(1) {
            if used.contains(&(i as u8)) || *c != Rgba::new(0, 0, 0, 255) {
                last = i;
            }
        }
        p[..=last].to_vec()
    }
}

// MARK: - Wavefront OBJ (one quad per visible face, one material per colour)

pub mod obj_file {
    use super::*;

    type Corner = (f64, f64, f64);
    const DIRS: [((i64, i64, i64), [Corner; 4]); 6] = [
        ((1, 0, 0), [(1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (1.0, 1.0, 1.0), (1.0, 0.0, 1.0)]),
        ((-1, 0, 0), [(0.0, 0.0, 1.0), (0.0, 1.0, 1.0), (0.0, 1.0, 0.0), (0.0, 0.0, 0.0)]),
        ((0, 1, 0), [(0.0, 1.0, 1.0), (1.0, 1.0, 1.0), (1.0, 1.0, 0.0), (0.0, 1.0, 0.0)]),
        ((0, -1, 0), [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, 1.0), (0.0, 0.0, 1.0)]),
        ((0, 0, 1), [(1.0, 0.0, 1.0), (1.0, 1.0, 1.0), (0.0, 1.0, 1.0), (0.0, 0.0, 1.0)]),
        ((0, 0, -1), [(0.0, 0.0, 0.0), (0.0, 1.0, 0.0), (1.0, 1.0, 0.0), (1.0, 0.0, 0.0)]),
    ];

    /// The mesh and its material file as text: (obj, mtl).
    pub fn encode(doc: &Document, frame: usize, mtl_name: &str) -> (String, String) {
        let g = doc.composite(frame);
        let mut obj = format!("# OpenPixel export\nmtllib {mtl_name}\n");
        let mut faces: BTreeMap<u8, Vec<String>> = BTreeMap::new();
        let mut verts = 0;
        let solid = |x: i64, y: i64, z: i64| -> bool { doc.in_bounds(x, y, z) && g[doc.index(x, y, z)] != 0 };
        for y in 0..doc.sy() {
            for z in 0..doc.sz() {
                for x in 0..doc.sx() {
                    let v = g[doc.index(x, y, z)];
                    if v == 0 {
                        continue;
                    }
                    for (n, quad) in DIRS.iter() {
                        if solid(x + n.0, y + n.1, z + n.2) {
                            continue;
                        }
                        for q in quad {
                            // Whole numbers print as "1.0", as Swift prints a Double.
                            obj.push_str(&format!("v {:.1} {:.1} {:.1}\n", x as f64 + q.0, y as f64 + q.1, z as f64 + q.2));
                        }
                        faces.entry(v).or_default().push(format!("f {} {} {} {}", verts + 1, verts + 2, verts + 3, verts + 4));
                        verts += 4;
                    }
                }
            }
        }
        let mut mtl = String::from("# OpenPixel palette\n");
        for (c, list) in &faces {
            obj.push_str(&format!("usemtl c{c}\n"));
            obj.push_str(&list.join("\n"));
            obj.push('\n');
            let col = if (*c as usize) < doc.palette.len() { doc.palette[*c as usize] } else { Rgba::new(0, 0, 0, 255) };
            mtl.push_str(&format!(
                "newmtl c{}\nKd {:.4} {:.4} {:.4}\n",
                c,
                col.r as f64 / 255.0,
                col.g as f64 / 255.0,
                col.b as f64 / 255.0
            ));
        }
        (obj, mtl)
    }
}

// MARK: - SVG and HTML

/// Pixel art as vector files: each run of same-coloured pixels in a row becomes one rectangle, so the
/// picture stays sharp at any size. HTML pages embed the SVGs inline (no outside files) and play animations.
pub mod web_files {
    use super::*;

    /// An SVG whose user units are picture pixels, displayed `zoom` times larger.
    pub fn svg(p: &Picture, zoom: i64, id: Option<&str>) -> String {
        let mut rects = String::with_capacity((p.width * p.height * 8).min(1 << 20));
        for y in 0..p.height {
            let mut x = 0;
            while x < p.width {
                let c = p.pixel(y * p.width + x);
                if c.a == 0 {
                    x += 1;
                    continue;
                }
                let mut end = x + 1;
                while end < p.width && p.pixel(y * p.width + end) == c {
                    end += 1;
                }
                rects.push_str(&format!("<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"1\" fill=\"{}\"", x, y, end - x, c.hex()));
                if c.a < 255 {
                    rects.push_str(&format!(" fill-opacity=\"{:.3}\"", c.a as f64 / 255.0));
                }
                rects.push_str("/>");
                x = end;
            }
        }
        let z = zoom.max(1);
        let id_attr = id.map(|i| format!(" id=\"{i}\"")).unwrap_or_default();
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\"{} width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\" shape-rendering=\"crispEdges\">{}</svg>",
            id_attr,
            (p.width as i64).saturating_mul(z),
            (p.height as i64).saturating_mul(z),
            p.width,
            p.height,
            rects
        )
    }

    /// A self-contained web page showing the frames (animated when there are several).
    pub fn html(title: &str, frames: &[Picture], delays: &[i64], zoom: i64) -> String {
        let safe = title.replace('&', "&amp;").replace('<', "&lt;");
        let svgs = frames
            .iter()
            .enumerate()
            .map(|(i, f)| format!("<div class=\"f\"{}>{}</div>", if i == 0 { "" } else { " hidden" }, svg(f, zoom, None)))
            .collect::<Vec<_>>()
            .join("\n");
        let player = if frames.len() < 2 {
            String::new()
        } else {
            let list = delays.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(", ");
            format!(
                "<script>\n\
                 const d = [{list}]; const f = [...document.querySelectorAll('.f')]; let i = 0;\n\
                 (function next() {{ f.forEach((e, k) => e.hidden = k !== i); setTimeout(() => {{ i = (i + 1) % f.length; next(); }}, d[i] || 100); }})();\n\
                 </script>"
            )
        };
        format!(
            "<!doctype html>\n\
             <html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
             <title>{safe}</title>\n\
             <style>\n\
             html,body{{margin:0;height:100%;background:#1e1e1e;color:#a0a0a0;font:12px -apple-system,BlinkMacSystemFont,sans-serif}}\n\
             main{{min-height:100%;display:grid;place-items:center;align-content:center;gap:14px}}\n\
             .f svg{{display:block;max-width:90vw;max-height:80vh;width:auto;height:auto}}\n\
             </style></head>\n\
             <body><main>\n\
             {svgs}\n\
             <div>{safe} · made with OpenPixel</div>\n\
             </main>\n\
             {player}\n\
             </body></html>"
        )
    }
}
