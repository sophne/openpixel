//! The wasm-bindgen face of the engine (only compiled for WebAssembly).
use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Array, Function, Object, Reflect, Uint8Array};
use openpixel_core::{self as op, JsonMap, PcError, ToolOutput};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const TYPES: &'static str = r#"
/** Files, time and network for the core; every method is synchronous. A missing method means "not here". */
export interface HostIo {
  read?(path: string): Uint8Array;
  /** Writes the whole file or nothing. */
  write?(path: string, data: Uint8Array): void;
  exists?(path: string): boolean;
  createDirAll?(path: string): void;
  homeDir?(): string | undefined;
  /** Seconds since 1970 (default: the JavaScript clock). */
  now?(): number;
  /** The update feed. */
  httpGet?(url: string): Uint8Array;
}
/** What a tool answers: `json` is JSON text. */
export interface ToolResult { json: string; images: Uint8Array[]; }
/** A tool the host answers itself (e.g. get_editor_screenshot). `argsJson` is JSON text; throw an Error to fail. */
export type HostToolFn = (argsJson: string) => { json: string; images?: Uint8Array[] };
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "HostIo")]
    pub type HostIoObject;
    #[wasm_bindgen(typescript_type = "ToolResult")]
    pub type ToolResult;
    #[wasm_bindgen(typescript_type = "HostToolFn")]
    pub type HostToolFn;
    #[wasm_bindgen(typescript_type = "(tool: string) => void")]
    pub type ChangeListener;
    #[wasm_bindgen(typescript_type = "number[]")]
    pub type NumberArray;

    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str, detail: &JsValue);
}

/// The text of something JavaScript threw.
fn thrown_text(e: &JsValue) -> String {
    if let Some(s) = e.as_string() {
        return s;
    }
    if let Ok(message) = Reflect::get(e, &JsValue::from_str("message")) {
        if let Some(s) = message.as_string() {
            return s;
        }
    }
    js_sys::JSON::stringify(e).ok().and_then(|s| s.as_string()).unwrap_or_else(|| "unknown error".to_string())
}

fn to_js_error(e: PcError) -> JsError {
    JsError::new(&e.0)
}

// MARK: - HostIo from JavaScript

struct JsIo {
    io: JsValue,
}

impl JsIo {
    /// Calls `io.<method>(...args)`. `Ok(None)` when the host has no such method.
    fn call(&self, method: &str, args: &[JsValue]) -> Result<Option<JsValue>, String> {
        if self.io.is_undefined() || self.io.is_null() {
            return Ok(None);
        }
        let f = Reflect::get(&self.io, &JsValue::from_str(method)).map_err(|e| thrown_text(&e))?;
        let Some(f) = f.dyn_ref::<Function>() else { return Ok(None) };
        let list = Array::new();
        for a in args {
            list.push(a);
        }
        f.apply(&self.io, &list).map(Some).map_err(|e| thrown_text(&e))
    }

    fn bytes(value: JsValue, method: &str) -> Result<Vec<u8>, String> {
        if value.is_instance_of::<Uint8Array>() || value.is_instance_of::<js_sys::ArrayBuffer>() {
            Ok(Uint8Array::new(&value).to_vec())
        } else {
            Err(format!("the host's {method} did not return bytes"))
        }
    }
}

impl op::HostIo for JsIo {
    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        match self.call("read", &[JsValue::from_str(path)])? {
            Some(v) => JsIo::bytes(v, "read"),
            None => op::NoIo.read(path),
        }
    }
    fn write(&self, path: &str, data: &[u8]) -> Result<(), String> {
        match self.call("write", &[JsValue::from_str(path), Uint8Array::from(data).into()])? {
            Some(_) => Ok(()),
            None => op::NoIo.write(path, data),
        }
    }
    fn exists(&self, path: &str) -> bool {
        matches!(self.call("exists", &[JsValue::from_str(path)]), Ok(Some(v)) if v.is_truthy())
    }
    fn create_dir_all(&self, path: &str) -> Result<(), String> {
        match self.call("createDirAll", &[JsValue::from_str(path)])? {
            Some(_) => Ok(()),
            None => op::NoIo.create_dir_all(path),
        }
    }
    fn home_dir(&self) -> Option<String> {
        self.call("homeDir", &[]).ok().flatten().and_then(|v| v.as_string())
    }
    fn now(&self) -> f64 {
        match self.call("now", &[]) {
            Ok(Some(v)) => v.as_f64().unwrap_or(0.0),
            _ => js_sys::Date::now() / 1000.0,
        }
    }
    fn http_get(&self, url: &str) -> Result<Vec<u8>, String> {
        match self.call("httpGet", &[JsValue::from_str(url)])? {
            Some(v) => JsIo::bytes(v, "httpGet"),
            None => op::NoIo.http_get(url),
        }
    }
}

// MARK: - the engine

/// The document, its undo history and every tool.
#[wasm_bindgen]
pub struct Engine {
    inner: Rc<RefCell<op::Engine>>,
    /// Changes the engine reported during the current call; handed to the listener once the call is over,
    /// so the listener may read (or drive) the engine.
    changes: Rc<RefCell<Vec<String>>>,
    listener: Rc<RefCell<Option<Function>>>,
}

const BUSY: &str = "the engine is busy: it cannot be used from inside one of its own host tools";

impl Engine {
    fn with<T>(&self, f: impl FnOnce(&op::Engine) -> T) -> Result<T, JsError> {
        self.inner.try_borrow().map(|e| f(&e)).map_err(|_| JsError::new(BUSY))
    }

    fn with_mut<T>(&self, f: impl FnOnce(&mut op::Engine) -> T) -> Result<T, JsError> {
        let result = self.inner.try_borrow_mut().map(|mut e| f(&mut e)).map_err(|_| JsError::new(BUSY));
        self.tell_listener();
        result
    }

    fn tell_listener(&self) {
        let pending: Vec<String> = match self.changes.try_borrow_mut() {
            Ok(mut c) => c.drain(..).collect(),
            Err(_) => return,
        };
        let listener = self.listener.borrow().clone();
        let Some(listener) = listener else { return };
        for tool in pending {
            if let Err(e) = listener.call1(&JsValue::NULL, &JsValue::from_str(&tool)) {
                console_error("OpenPixel: the onChange listener failed:", &e);
            }
        }
    }
}

#[wasm_bindgen]
impl Engine {
    /// A 32×32×32 model called "Untitled" with the db32 palette. Without `io` the engine has no files or
    /// network (tools that need them fail) and uses the JavaScript clock.
    #[wasm_bindgen(constructor)]
    pub fn new(io: Option<HostIoObject>) -> Engine {
        let io: JsValue = io.map(JsValue::from).unwrap_or(JsValue::UNDEFINED);
        let mut engine = op::Engine::with_io(Box::new(JsIo { io }));
        let changes: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
        let sink = changes.clone();
        engine.on_change = Some(Box::new(move |tool: &str| sink.borrow_mut().push(tool.to_string())));
        Engine { inner: Rc::new(RefCell::new(engine)), changes, listener: Rc::new(RefCell::new(None)) }
    }

    /// Runs a tool. `args` is JSON text (an object); the answer's `json` is JSON text. Throws `Error(text)`.
    /// `source`: "person" | "agent" | "sample" | "home".
    pub fn execute(&self, name: &str, args: &str, source: &str) -> Result<ToolResult, JsError> {
        let args: JsonMap = if args.trim().is_empty() {
            JsonMap::new()
        } else {
            match serde_json::from_str::<op::Json>(args) {
                Ok(op::Json::Object(o)) => o,
                _ => return Err(JsError::new("the tool's arguments must be a JSON object")),
            }
        };
        let out = self.with_mut(|e| e.execute(name, &args, source))?.map_err(to_js_error)?;
        Ok(tool_result(&out).unchecked_into())
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> Result<String, JsError> {
        self.with(|e| e.name().to_string())
    }

    /// The file the document was opened from or saved to.
    #[wasm_bindgen(getter)]
    pub fn path(&self) -> Result<Option<String>, JsError> {
        self.with(|e| e.path_str().map(String::from))
    }

    #[wasm_bindgen(getter)]
    pub fn dirty(&self) -> Result<bool, JsError> {
        self.with(|e| e.dirty())
    }

    #[wasm_bindgen(getter)]
    pub fn revision(&self) -> Result<f64, JsError> {
        self.with(|e| e.revision() as f64)
    }

    /// One voxel deep: a 2D sprite.
    #[wasm_bindgen(getter, js_name = isSprite)]
    pub fn is_sprite(&self) -> Result<bool, JsError> {
        self.with(|e| e.is_sprite())
    }

    /// [x, y, z]
    #[wasm_bindgen(getter)]
    pub fn size(&self) -> Result<NumberArray, JsError> {
        let (x, y, z) = self.with(|e| e.size())?;
        let list = Array::new();
        for v in [x, y, z] {
            list.push(&JsValue::from_f64(v as f64));
        }
        Ok(list.unchecked_into())
    }

    /// Forget history and the unsaved flag.
    #[wasm_bindgen(js_name = markClean)]
    pub fn mark_clean(&self) -> Result<(), JsError> {
        self.with_mut(|e| e.mark_clean())
    }

    /// Writes the document to `to` (or its own file) without logging a tool call; tells onChange "autosave".
    pub fn autosave(&self, to: Option<String>) -> Result<(), JsError> {
        self.with_mut(|e| e.autosave_to(to.as_deref()))?.map_err(to_js_error)
    }

    /// The file moved to `to` (undefined: it has none yet) and is now called `name`; tells onChange "rename".
    pub fn rename(&self, to: Option<String>, name: &str) -> Result<(), JsError> {
        self.with_mut(|e| e.rename_to(to.as_deref(), name))
    }

    /// `fn(tool)` is called after any change, once the call that made it is over (so it may use the engine).
    /// Pass undefined to stop.
    #[wasm_bindgen(js_name = onChange)]
    pub fn on_change(&self, listener: Option<ChangeListener>) {
        *self.listener.borrow_mut() = listener.map(JsValue::from).and_then(|f| f.dyn_into::<Function>().ok());
    }

    /// A tool the host answers itself, e.g. get_editor_screenshot or check_for_updates. `fn(argsJson)` returns
    /// `{ json, images? }` or throws. Pass undefined to remove it. It runs while the engine is busy with the
    /// call, so it must not use this engine.
    #[wasm_bindgen(js_name = setHostTool)]
    pub fn set_host_tool(&self, name: &str, tool: Option<HostToolFn>) -> Result<(), JsError> {
        let tool = tool.map(JsValue::from).and_then(|f| f.dyn_into::<Function>().ok());
        self.with_mut(|e| match tool {
            None => {
                e.host_tools.remove(name);
            }
            Some(f) => {
                e.host_tools.insert(name.to_string(), Box::new(move |args: &JsonMap| call_host_tool(&f, args)));
            }
        })
    }
}

fn tool_result(out: &ToolOutput) -> JsValue {
    let o = Object::new();
    let json = serde_json::to_string(&out.json).unwrap_or_else(|_| "{}".to_string());
    let images = Array::new();
    for image in &out.images {
        images.push(&Uint8Array::from(image.as_slice()));
    }
    let _ = Reflect::set(&o, &JsValue::from_str("json"), &JsValue::from_str(&json));
    let _ = Reflect::set(&o, &JsValue::from_str("images"), &images);
    o.into()
}

fn call_host_tool(f: &Function, args: &JsonMap) -> Result<ToolOutput, PcError> {
    let text = serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string());
    let answer = f.call1(&JsValue::NULL, &JsValue::from_str(&text)).map_err(|e| PcError::invalid(thrown_text(&e)))?;
    let bad = || PcError::invalid("the host's tool did not answer { json, images? }");
    let json_text = Reflect::get(&answer, &JsValue::from_str("json")).ok().and_then(|v| v.as_string()).ok_or_else(bad)?;
    let json = match serde_json::from_str::<op::Json>(&json_text) {
        Ok(op::Json::Object(o)) => o,
        _ => return Err(bad()),
    };
    let mut images = Vec::new();
    if let Ok(list) = Reflect::get(&answer, &JsValue::from_str("images")) {
        if Array::is_array(&list) {
            for image in Array::from(&list).iter() {
                images.push(JsIo::bytes(image, "tool").map_err(|_| bad())?);
            }
        }
    }
    Ok(ToolOutput::with_images(json, images))
}

// MARK: - free functions

/// The app's version.
#[wasm_bindgen]
pub fn version() -> String {
    op::VERSION.to_string()
}

/// JSON text: every tool as MCP `tools/list` shows it (name, description, inputSchema, annotations), plus
/// `readOnly` and `hidden` (hidden tools are for the editor only and never listed to agents).
#[wasm_bindgen(js_name = toolCatalog)]
pub fn tool_catalog() -> String {
    let list: Vec<op::Json> = op::tools::catalog()
        .iter()
        .map(|t| {
            let mut o = t.mcp_json();
            o.insert("readOnly".into(), op::Json::Bool(t.read_only));
            o.insert("hidden".into(), op::Json::Bool(t.hidden));
            op::Json::Object(o)
        })
        .collect();
    serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string())
}

/// Builds the 2D mushroom (threeD false) or the 3D island into `engine`, with no history and nothing unsaved.
#[wasm_bindgen(js_name = buildSample)]
pub fn build_sample(engine: &Engine, three_d: bool) -> Result<(), JsError> {
    engine.with_mut(|e| op::sample::build(e, three_d))
}

/// Runs the 3D island as normal, undoable edits (the Help menu's sample).
#[wasm_bindgen(js_name = openSample3d)]
pub fn open_sample_3d(engine: &Engine) -> Result<(), JsError> {
    engine.with_mut(op::sample::open_3d)
}

// MARK: - small pure helpers for the app's logic

/// Where the release feed lives.
#[wasm_bindgen(js_name = updateFeedUrl)]
pub fn update_feed_url() -> String {
    op::updates::DEFAULT_FEED.to_string()
}

/// What check_for_updates answers, as JSON text, from feed text the host fetched itself: for a program
/// running version `running` (default: this core's), when `installed` is the version on disk, if known.
/// Throws when the feed lists no release.
#[wasm_bindgen(js_name = updateReport)]
pub fn update_report(feed_xml: &str, running: Option<String>, installed: Option<String>) -> Result<String, JsError> {
    let running = running.unwrap_or_else(|| op::VERSION.to_string());
    let report = op::updates::report_from_feed(feed_xml, &running, installed.as_deref()).map_err(to_js_error)?;
    Ok(serde_json::to_string(&report).unwrap_or_else(|_| "{}".to_string()))
}

/// -1, 0 or 1, comparing dotted version numbers ("1.10.0" is newer than "1.9.2").
#[wasm_bindgen(js_name = compareVersions)]
pub fn compare_versions(a: &str, b: &str) -> i32 {
    op::updates::compare(a, b)
}

/// The conventions every tool follows (coordinates, colours), as the MCP instructions give them.
#[wasm_bindgen]
pub fn conventions() -> String {
    op::tools::CONVENTIONS.to_string()
}

/// The short pixel-art rules that go into the MCP instructions.
#[wasm_bindgen(js_name = craftRules)]
pub fn craft_rules() -> String {
    op::craft::RULES.to_string()
}
