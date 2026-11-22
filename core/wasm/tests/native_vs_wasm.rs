//! The WebAssembly build must behave exactly like the native one. A scripted session (tests/session.json:
//! sprites and voxel models, a spread of drawing tools, undo and redo, layers and frames, reviews, ui_state,
//! every export written through HostIo, opening files, the samples, the update feed) runs natively here and in
//! Node through the generated package (tests/run-session.mjs). Every JSON answer, every picture a tool returns
//! and every file written must be the same, byte for byte.
//!
//! Needs `node`, the wasm32-unknown-unknown target and the wasm-bindgen command (the same version as the
//! crate). Set OPENPIXEL_SKIP_WASM_TEST=1 to skip it on a machine without them.
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use openpixel_core::{sample, tools, updates, Engine, HostIo, Json, JsonMap, PcError, StdIo, ToolOutput};
use serde_json::json;

/// What the canned feed says (run-session.mjs has the same text): Linux's file, as electron-builder writes it.
const FEED: &str = "version: 9.10.1\nfiles:\n  - url: OpenPixel.AppImage\n    sha512: c2hhNTEy\n    size: 1\n    blockMapSize: 1\npath: OpenPixel.AppImage\nsha512: c2hhNTEy\nreleaseDate: '2026-11-22T11:24:00.000Z'\n";

/// The host of the native run: real files, the same ticking clock and canned update feed as run-session.mjs.
struct TestIo {
    home: String,
    clock: Arc<AtomicU64>,
}

impl HostIo for TestIo {
    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        // The reason is the host's own wording; run-session.mjs says the same.
        if !StdIo.exists(path) {
            return Err("no such file".into());
        }
        StdIo.read(path)
    }
    fn write(&self, path: &str, data: &[u8]) -> Result<(), String> {
        StdIo.write(path, data)
    }
    fn exists(&self, path: &str) -> bool {
        StdIo.exists(path)
    }
    fn create_dir_all(&self, path: &str) -> Result<(), String> {
        StdIo.create_dir_all(path)
    }
    fn home_dir(&self) -> Option<String> {
        Some(self.home.clone())
    }
    fn now(&self) -> f64 {
        1700000000.5 + 1.25 * self.clock.fetch_add(1, Ordering::SeqCst) as f64
    }
    fn http_get(&self, url: &str) -> Result<Vec<u8>, String> {
        // Both runs read Linux's feed, whatever system this test runs on (run_native says so to the core).
        if url != updates::default_feed_for(updates::Os::Linux) {
            return Err(format!("unexpected address {url}"));
        }
        Ok(FEED.as_bytes().to_vec())
    }
}

fn place(v: &Json, out: &str) -> Json {
    match v {
        Json::String(s) => Json::String(s.replace("$OUT", out)),
        Json::Array(a) => Json::Array(a.iter().map(|x| place(x, out)).collect()),
        Json::Object(o) => Json::Object(o.iter().map(|(k, x)| (k.clone(), place(x, out))).collect()),
        other => other.clone(),
    }
}

/// The run's own folder taken out of the transcript, however it appears there: as it is, escaped once (inside a
/// JSON answer) and escaped again (by `one_line`). Only Windows paths have backslashes, so only there do the escaped
/// forms differ.
fn without_folder(text: &str, folder: &str) -> String {
    let once = folder.replace('\\', "\\\\");
    let twice = once.replace('\\', "\\\\");
    text.replace(&twice, "$OUT").replace(&once, "$OUT").replace(folder, "$OUT")
}

fn one_line(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\n', "\\n").replace('\r', "\\r")
}

/// What toolCatalog() answers in the JavaScript package.
fn catalog_json() -> String {
    let list: Vec<Json> = tools::catalog()
        .iter()
        .map(|t| {
            let mut o = t.mcp_json();
            o.insert("readOnly".into(), Json::Bool(t.read_only));
            o.insert("hidden".into(), Json::Bool(t.hidden));
            Json::Object(o)
        })
        .collect();
    serde_json::to_string(&list).expect("JSON")
}

struct Session {
    engine: Engine,
    changes: Arc<Mutex<Vec<String>>>,
}

fn run_native(session: &Path, out_dir: &Path) {
    let out = out_dir.to_string_lossy().into_owned();
    std::fs::create_dir_all(out_dir.join("images")).expect("the output folder");
    let steps: Vec<Json> = serde_json::from_slice(&std::fs::read(session).expect("session.json")).expect("the session is JSON");
    let clock = Arc::new(AtomicU64::new(0));
    // As run-session.mjs tells the WebAssembly core: this session reads Linux's feed on every system.
    updates::set_os(Some(updates::Os::Linux));
    let mut engines: HashMap<String, Session> = HashMap::new();
    let mut lines: Vec<String> = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        let text_of = |k: &str| step.get(k).and_then(Json::as_str);
        let name = text_of("e").or(text_of("new")).unwrap_or("").to_string();
        let mut images: Vec<Vec<u8>> = Vec::new();
        let result: Result<String, String> = (|| {
            if let Some(n) = text_of("new") {
                let mut engine = Engine::with_io(Box::new(TestIo { home: out.clone(), clock: clock.clone() }));
                let changes: Arc<Mutex<Vec<String>>> = Arc::default();
                let sink = changes.clone();
                engine.on_change = Some(Box::new(move |tool: &str| sink.lock().expect("lock").push(tool.to_string())));
                engines.insert(n.to_string(), Session { engine, changes });
                return Ok(String::new());
            }
            if step.get("catalog").is_some() {
                return Ok(catalog_json());
            }
            if let Some(a) = step.get("updateReport").and_then(Json::as_array) {
                let running = a[1].as_str().unwrap_or(openpixel_core::VERSION);
                let report = updates::report_from_feed(a[0].as_str().unwrap_or(""), running, a[2].as_str()).map_err(|e| e.0)?;
                return Ok(serde_json::to_string(&report).expect("JSON"));
            }
            let e = &mut engines.get_mut(&name).expect("a known engine").engine;
            if let Some(tool) = text_of("tool") {
                let args = place(step.get("args").unwrap_or(&json!({})), &out);
                let o = e.execute(tool, args.as_object().expect("args"), text_of("source").unwrap_or("agent")).map_err(|e| e.0)?;
                images = o.images;
                return Ok(serde_json::to_string(&o.json).expect("JSON"));
            }
            if let Some(three_d) = step.get("sample").and_then(Json::as_bool) {
                sample::build(e, three_d);
            } else if step.get("open3d").is_some() {
                sample::open_3d(e);
            } else if step.get("markClean").is_some() {
                e.mark_clean();
            } else if let Some(to) = step.get("autosave") {
                e.autosave_to(to.as_str().map(|p| p.replace("$OUT", &out)).as_deref()).map_err(|e| e.0)?;
            } else if let Some(r) = step.get("rename").and_then(Json::as_array) {
                e.rename_to(r[0].as_str().map(|p| p.replace("$OUT", &out)).as_deref(), r[1].as_str().unwrap_or(""));
            } else if let Some(tool) = text_of("hostTool") {
                e.host_tools.insert(
                    tool.to_string(),
                    Box::new(|args: &JsonMap| -> Result<ToolOutput, PcError> {
                        let json = json!({"host": true, "args": args});
                        Ok(ToolOutput::with_images(json.as_object().cloned().unwrap_or_default(), vec![vec![1, 2, 3]]))
                    }),
                );
            } else if let Some(tool) = text_of("dropHostTool") {
                e.host_tools.remove(tool);
            } else {
                panic!("unknown step {step}");
            }
            Ok(String::new())
        })();
        for (k, bytes) in images.iter().enumerate() {
            std::fs::write(out_dir.join("images").join(format!("{i}-{k}.bin")), bytes).expect("writes a picture");
        }
        let (mut state, mut seen) = ("-".to_string(), Vec::new());
        if let Some(s) = engines.get(&name) {
            let e = &s.engine;
            let (x, y, z) = e.size();
            state = format!("{}|{}|{}|{}|{}|{}x{}x{}", e.name(), e.path_str().unwrap_or("-"), e.dirty(), e.revision(), e.is_sprite(), x, y, z);
            seen = s.changes.lock().expect("lock").drain(..).collect();
        }
        let (ok, text) = match &result {
            Ok(t) => ("ok", t),
            Err(t) => ("err", t),
        };
        lines.push(format!("#{} {} images={} changes={} state={}", i, ok, images.len(), seen.join(","), one_line(&state)));
        lines.push(one_line(text));
    }
    std::fs::write(out_dir.join("transcript.txt"), without_folder(&lines.join("\n"), &out) + "\n").expect("writes the transcript");
}

fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, into: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).expect("a folder").flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(root, &p, into);
            } else {
                let rel = p.strip_prefix(root).expect("inside").to_string_lossy().replace('\\', "/");
                into.insert(rel, std::fs::read(&p).expect("a file"));
            }
        }
    }
    let mut files = BTreeMap::new();
    walk(dir, dir, &mut files);
    files
}

fn run(command: &mut Command, what: &str) {
    let status = command.status().unwrap_or_else(|e| panic!("could not start {what}: {e}"));
    assert!(status.success(), "{what} failed ({status})");
}

#[test]
fn the_wasm_build_answers_like_the_native_one() {
    if std::env::var_os("OPENPIXEL_SKIP_WASM_TEST").is_some() {
        eprintln!("skipped: OPENPIXEL_SKIP_WASM_TEST is set");
        return;
    }
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo = here.join("../..");
    let session = here.join("tests/session.json");
    let work = std::env::temp_dir().join(format!("openpixel-wasm-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    let (pkg, native, wasm) = (work.join("pkg"), work.join("native"), work.join("wasm"));

    run_native(&session, &native);

    run(
        Command::new("node")
            .arg(repo.join("desktop/scripts/build-core.mjs"))
            .arg("--out")
            .arg(&pkg)
            .env("CARGO", env!("CARGO"))
            .env_remove("CARGO_TARGET_DIR"),
        "desktop/scripts/build-core.mjs (needs node, the wasm32-unknown-unknown target and wasm-bindgen)",
    );
    run(Command::new("node").arg(here.join("tests/run-session.mjs")).arg(&pkg).arg(&session).arg(&wasm), "tests/run-session.mjs");

    let (a, b) = (tree(&native), tree(&wasm));
    let text = |t: &BTreeMap<String, Vec<u8>>| String::from_utf8_lossy(&t["transcript.txt"]).into_owned();
    let (ta, tb) = (text(&a), text(&b));
    let (la, lb): (Vec<&str>, Vec<&str>) = (ta.lines().collect(), tb.lines().collect());
    assert_eq!(la.len(), lb.len(), "the transcripts have different lengths");
    let mut errors = 0;
    for (k, (x, y)) in la.iter().zip(&lb).enumerate() {
        if k % 2 == 0 && x.contains(" err ") {
            errors += 1;
        }
        if x != y {
            let at = x.chars().zip(y.chars()).position(|(p, q)| p != q).unwrap_or(0);
            let cut = |s: &str| s.chars().skip(at.saturating_sub(60)).take(200).collect::<String>();
            panic!("transcript line {} differs (step header: {})\n native: …{}\n wasm:   …{}", k + 1, la[k - k % 2], cut(x), cut(y));
        }
    }
    let names = |t: &BTreeMap<String, Vec<u8>>| t.keys().cloned().collect::<Vec<_>>();
    assert_eq!(names(&a), names(&b), "the two runs wrote different files");
    for (name, bytes) in &a {
        assert!(bytes == &b[name], "{name} differs between the native and the WebAssembly run");
    }
    let wasm_size = std::fs::metadata(pkg.join("openpixel_wasm_bg.wasm")).map(|m| m.len()).unwrap_or(0);
    eprintln!(
        "native and WebAssembly agree: {} steps ({} of them refusals), {} files of {} bytes in total; the .wasm is {} bytes",
        la.len() / 2,
        errors,
        a.len(),
        a.values().map(Vec::len).sum::<usize>(),
        wasm_size
    );
    assert!(la.len() / 2 >= 150 && a.len() >= 40, "the session ran short");
    // OPENPIXEL_KEEP_WASM_TEST=1 keeps both runs' folders for a look.
    if std::env::var_os("OPENPIXEL_KEEP_WASM_TEST").is_some() {
        eprintln!("kept {}", work.display());
    } else {
        let _ = std::fs::remove_dir_all(&work);
    }
}
