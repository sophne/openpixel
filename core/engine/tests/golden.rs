//! Golden files: the sources in web/artwork, exported with the same tools and arguments the art scripts used
//! (web/scripts/explore/common.py `publish`, site_art.py, make-feature-art.py, search_buddy.py), compared with
//! the files the Swift app exported into web/public. Pictures are compared pixel by pixel after decoding
//! (PNG, and every GIF frame with its delay); .vox files byte by byte; .html pages as text.
use std::path::{Path, PathBuf};

use openpixel_core::formats::{image_files, native_file};
use openpixel_core::render::Picture;
use openpixel_core::{Engine, Json, JsonMap};
use serde_json::json;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("the repository root")
}

fn out_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("openpixel-golden-{}-{}", name, std::process::id()));
    std::fs::create_dir_all(&dir).expect("a temporary folder");
    dir
}

fn call(e: &mut Engine, tool: &str, args: Json) -> JsonMap {
    let args = args.as_object().cloned().unwrap_or_default();
    match e.execute(tool, &args, "agent") {
        Ok(out) => out.json,
        Err(err) => panic!("{tool} {args:?}: {err}"),
    }
}

fn text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// What went wrong, collected so one run lists every mismatch.
#[derive(Default)]
struct Report {
    compared: std::collections::BTreeMap<&'static str, usize>,
    problems: Vec<String>,
}

impl Report {
    fn count(&mut self, kind: &'static str) {
        *self.compared.entry(kind).or_insert(0) += 1;
    }

    fn pictures(&mut self, what: &str, ours: &Picture, theirs: &Picture) -> bool {
        if (ours.width, ours.height) != (theirs.width, theirs.height) {
            self.problems.push(format!("{what}: size {}×{}, expected {}×{}", ours.width, ours.height, theirs.width, theirs.height));
            return false;
        }
        let mut wrong = 0usize;
        let mut first = None;
        for i in 0..ours.width * ours.height {
            let (a, b) = (ours.pixel(i), theirs.pixel(i));
            // Colour under a fully transparent pixel is not part of the picture.
            let same = if a.a == 0 && b.a == 0 { true } else { a == b };
            if !same {
                wrong += 1;
                first.get_or_insert((i % ours.width, i / ours.width, a, b));
            }
        }
        if wrong > 0 {
            self.problems.push(format!("{what}: {wrong} of {} pixels differ; first {:?}", ours.width * ours.height, first));
        }
        wrong == 0
    }

    fn png(&mut self, what: &str, ours: &Path, theirs: &Path) {
        self.count("png");
        let (Some(a), Some(b)) = (read_picture(ours), read_picture(theirs)) else {
            self.problems.push(format!("{what}: could not read {} or {}", ours.display(), theirs.display()));
            return;
        };
        self.pictures(what, &a, &b);
    }

    fn gif(&mut self, what: &str, ours: &Path, theirs: &Path) {
        self.count("gif");
        let frames = |p: &Path| std::fs::read(p).ok().and_then(|d| image_files::read_gif_frames(&d, usize::MAX));
        let (Some(a), Some(b)) = (frames(ours), frames(theirs)) else {
            self.problems.push(format!("{what}: could not read {} or {}", ours.display(), theirs.display()));
            return;
        };
        if a.len() != b.len() {
            self.problems.push(format!("{what}: {} frames, expected {}", a.len(), b.len()));
            return;
        }
        for (i, ((pa, da), (pb, db))) in a.iter().zip(&b).enumerate() {
            if da != db {
                self.problems.push(format!("{what} frame {i}: delay {da} ms, expected {db} ms"));
            }
            if !self.pictures(&format!("{what} frame {i}"), pa, pb) {
                break;
            }
        }
    }

    fn bytes(&mut self, kind: &'static str, what: &str, ours: &Path, theirs: &Path) {
        self.count(kind);
        let (Ok(a), Ok(b)) = (std::fs::read(ours), std::fs::read(theirs)) else {
            self.problems.push(format!("{what}: could not read {} or {}", ours.display(), theirs.display()));
            return;
        };
        if a != b {
            let at = a.iter().zip(&b).position(|(x, y)| x != y).unwrap_or(a.len().min(b.len()));
            let near = |d: &[u8]| String::from_utf8_lossy(&d[at.saturating_sub(40)..(at + 40).min(d.len())]).into_owned();
            self.problems.push(format!(
                "{what}: {} bytes, expected {}; first difference at byte {at}: ours …{:?}… theirs …{:?}…",
                a.len(),
                b.len(),
                near(&a),
                near(&b)
            ));
        }
    }

    fn finish(self, what: &str) {
        eprintln!("{what}: compared {:?}; {} problem(s)", self.compared, self.problems.len());
        for p in &self.problems {
            eprintln!("  {p}");
        }
        assert!(self.problems.is_empty(), "{} golden file(s) differ", self.problems.len());
    }
}

fn read_picture(p: &Path) -> Option<Picture> {
    image_files::read_bytes(&std::fs::read(p).ok()?)
}

/// `_scale` in common.py.
fn scale_for(longest: i64, target: i64, lo: i64, hi: i64) -> i64 {
    (target / longest.max(1)).min(hi).max(lo)
}

struct Entry {
    slug: String,
    kind: String,
    collection: String,
    script: String,
}

fn manifest() -> Vec<Entry> {
    let dir = repo().join("web/scripts/explore/manifest");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).expect("the manifests").filter_map(|e| e.ok().map(|e| e.path())).collect();
    files.sort();
    let mut out = Vec::new();
    for f in files {
        let script = f.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let list: Json = serde_json::from_slice(&std::fs::read(&f).expect("a manifest")).expect("manifest JSON");
        for e in list.as_array().expect("a list") {
            let field = |k: &str| e[k].as_str().unwrap_or_default().to_string();
            out.push(Entry { slug: field("slug"), kind: field("kind"), collection: field("collection"), script: script.clone() });
        }
    }
    out
}

/// Every piece on the Explore page: opened from its saved source and exported as `publish` did.
#[test]
fn explore_exports_match_the_swift_app() {
    let root = repo();
    let public = root.join("web/public/explore");
    let tmp = out_dir("explore");
    let mut report = Report::default();
    let entries = manifest();
    assert!(entries.len() >= 70, "expected the whole Explore manifest, found {}", entries.len());
    for entry in &entries {
        let slug = entry.slug.as_str();
        let mut e = Engine::new();
        let info = call(&mut e, "open_model", json!({"path": text(&root.join(format!("web/artwork/explore/{slug}.openpixel")))}));
        let size: Vec<i64> = info["size"].as_array().expect("size").iter().filter_map(Json::as_i64).collect();
        let (sx, sy, sz) = (size[0], size[1], size[2]);
        let ours = |ext: &str| tmp.join(format!("{slug}{ext}"));
        let theirs = |ext: &str| public.join(format!("{slug}{ext}"));
        match entry.kind.as_str() {
            "sprite" => {
                call(&mut e, "export_png", json!({"path": text(&ours(".png")), "scale": 1}));
                call(&mut e, "export_html", json!({"path": text(&ours(".html")), "zoom": scale_for(sx.max(sy), 512, 2, 16)}));
                report.png(&format!("{slug}.png"), &ours(".png"), &theirs(".png"));
                report.bytes("html", &format!("{slug}.html"), &ours(".html"), &theirs(".html"));
            }
            "animation" => {
                // site_art.py publishes with gif_scale=12.
                let s = if entry.script == "site_art" { 12 } else { scale_for(sx.max(sy), 512, 2, 16) };
                call(&mut e, "export_sheet", json!({"path": text(&ours(".png")), "scale": 1}));
                call(&mut e, "export_gif", json!({"path": text(&ours(".gif")), "scale": s, "kind": "animation"}));
                call(&mut e, "export_html", json!({"path": text(&ours(".html")), "kind": "animation", "zoom": s}));
                report.png(&format!("{slug}.png"), &ours(".png"), &theirs(".png"));
                report.gif(&format!("{slug}.gif"), &ours(".gif"), &theirs(".gif"));
                report.bytes("html", &format!("{slug}.html"), &ours(".html"), &theirs(".html"));
            }
            "voxel" => {
                let s = scale_for(sx.max(sy).max(sz), 224, 3, 12);
                call(&mut e, "export_png", json!({"path": text(&ours(".png")), "view": "iso", "scale": s}));
                call(&mut e, "export_gif", json!({"path": text(&ours(".gif")), "kind": "turntable", "scale": s, "steps": 16}));
                call(&mut e, "export_html", json!({"path": text(&ours(".html")), "kind": "turntable", "steps": 8}));
                call(&mut e, "export_vox", json!({"path": text(&ours(".vox"))}));
                // The page's own render: the largest scale that fits its card.
                let card = if entry.collection == "scenes" { (520, 292) } else { (208, 176) };
                for v in (2..=s).rev() {
                    let r = call(&mut e, "export_png", json!({"path": text(&ours("-view.png")), "view": "iso", "scale": v}));
                    if r["width"].as_i64().unwrap_or(0) <= card.0 && r["height"].as_i64().unwrap_or(0) <= card.1 {
                        break;
                    }
                }
                report.png(&format!("{slug}.png"), &ours(".png"), &theirs(".png"));
                report.png(&format!("{slug}-view.png"), &ours("-view.png"), &theirs("-view.png"));
                report.gif(&format!("{slug}.gif"), &ours(".gif"), &theirs(".gif"));
                report.bytes("html", &format!("{slug}.html"), &ours(".html"), &theirs(".html"));
                report.bytes("vox", &format!("{slug}.vox"), &ours(".vox"), &theirs(".vox"));
            }
            other => panic!("{slug}: unknown kind {other}"),
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    report.finish("explore");
}

/// The pictures drawn for the website (make-feature-art.py) and the search buddy: export_sheet at scale 1.
#[test]
fn feature_sheets_match_the_swift_app() {
    let root = repo();
    let tmp = out_dir("features");
    let mut report = Report::default();
    let mut sources: Vec<PathBuf> =
        std::fs::read_dir(root.join("web/artwork/features")).expect("the feature art").filter_map(|e| e.ok().map(|e| e.path())).collect();
    sources.sort();
    assert!(sources.len() >= 25, "expected the feature art, found {}", sources.len());
    let mut pairs: Vec<(PathBuf, PathBuf)> = sources
        .into_iter()
        .map(|src| {
            let name = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            (src, root.join(format!("web/public/art/features/{name}.png")))
        })
        .collect();
    pairs.push((root.join("web/artwork/explore/search-buddy.openpixel"), root.join("web/public/explore/search/buddy.png")));
    for (src, golden) in pairs {
        let name = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let mut e = Engine::new();
        call(&mut e, "open_model", json!({"path": text(&src)}));
        let ours = tmp.join(format!("{name}.png"));
        call(&mut e, "export_sheet", json!({"path": text(&ours), "scale": 1}));
        report.png(&format!("{name}.png"), &ours, &golden);
    }
    let _ = std::fs::remove_dir_all(&tmp);
    report.finish("features");
}

/// Every .openpixel file the Swift app saved opens, and saving it again gives the same text: same keys, order
/// and layout. Only the packed cel data may differ byte for byte (another DEFLATE encoder), so that is compared
/// unpacked.
#[test]
fn native_files_round_trip_as_the_swift_app_wrote_them() {
    let root = repo();
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in ["web/artwork/explore", "web/artwork/features", "web/scripts"] {
        files.extend(
            std::fs::read_dir(root.join(dir))
                .expect("a folder of sources")
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.extension().is_some_and(|x| x == "openpixel")),
        );
    }
    files.sort();
    assert!(files.len() >= 100, "expected every source, found {}", files.len());
    // The text with every cel's data blanked.
    fn without_data(text: &str) -> String {
        text.lines().map(|l| if l.trim_start().starts_with("\"data\" : ") { "<data>" } else { l }).collect::<Vec<_>>().join("\n")
    }
    let mut problems = Vec::new();
    for f in &files {
        let original = std::fs::read(f).expect("a source");
        let doc = match native_file::decode(&original) {
            Ok(d) => d,
            Err(e) => {
                problems.push(format!("{}: {e}", f.display()));
                continue;
            }
        };
        let again = native_file::encode(&doc).expect("encodes");
        if without_data(&String::from_utf8_lossy(&original)) != without_data(&String::from_utf8_lossy(&again)) {
            problems.push(format!("{}: saved text differs", f.display()));
        }
        match native_file::decode(&again) {
            Ok(d2) if d2 == doc => {}
            _ => problems.push(format!("{}: does not read back the same", f.display())),
        }
    }
    eprintln!("native files: {} round-tripped; {} problem(s)", files.len(), problems.len());
    for p in &problems {
        eprintln!("  {p}");
    }
    assert!(problems.is_empty());
}

/// The website's showcase pictures that have a saved model (make-art.py): the treasure chest sprite, the same
/// made 3D with extrude_to_3d, and the mushroom house; each as a turnaround sheet and an isometric still.
#[test]
fn showcase_art_matches_the_swift_app() {
    let root = repo();
    let art = root.join("web/public/art");
    let tmp = out_dir("art");
    let mut report = Report::default();
    let turntable = |e: &mut Engine, name: &str, scale: i64, report: &mut Report| {
        let (sheet, still) = (tmp.join(format!("{name}.png")), tmp.join(format!("{name}-iso.png")));
        call(e, "export_sheet", json!({"path": text(&sheet), "views": ["turnaround8"], "scale": scale}));
        call(e, "export_png", json!({"path": text(&still), "view": "iso", "scale": scale * 2}));
        report.png(&format!("art/{name}.png"), &sheet, &art.join(format!("{name}.png")));
        report.png(&format!("art/{name}-iso.png"), &still, &art.join(format!("{name}-iso.png")));
    };
    let mut e = Engine::new();
    call(&mut e, "open_model", json!({"path": text(&root.join("web/scripts/treasure-chest.openpixel"))}));
    let flat = tmp.join("chest.png");
    call(&mut e, "export_png", json!({"path": text(&flat), "view": "front", "scale": 1}));
    report.png("art/chest.png", &flat, &art.join("chest.png"));
    call(&mut e, "extrude_to_3d", json!({"depth": 6}));
    turntable(&mut e, "chest3d", 3, &mut report);
    let mut e = Engine::new();
    call(&mut e, "open_model", json!({"path": text(&root.join("web/scripts/mushroom-house.openpixel"))}));
    turntable(&mut e, "mushroom", 4, &mut report);
    let _ = std::fs::remove_dir_all(&tmp);
    report.finish("showcase art");
}
