//! OpenPixel's engine: the document, its undo history, every tool, rendering, file formats and reviews.
//! A port of the Mac app's `app/Sources/OpenPixelCore` (see docs/desktop-architecture.md).
//!
//! The engine never touches the operating system itself: files, the clock and the network go through
//! [`HostIo`], so the same code runs natively and as WebAssembly.
use std::fmt;

pub mod analysis;
pub mod args;
pub mod craft;
pub mod engine;
pub mod formats;
pub mod io;
pub mod model;
pub mod observe;
pub mod ops;
pub mod palettes;
mod pipeline;
pub mod render;
pub mod sample;
pub mod style;
pub mod tools;
pub mod updates;

pub use engine::Engine;
#[cfg(not(target_arch = "wasm32"))]
pub use io::StdIo;
pub use io::{BoxedIo, HostIo, NoIo};
pub use model::{Document, Frame, Grid, Layer, Rgba};

pub type Json = serde_json::Value;
pub type JsonMap = serde_json::Map<String, Json>;

/// The app's version (app/VERSION, Cargo's workspace version).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// What a tool call returns: a JSON object, plus PNG pictures for review tools.
#[derive(Debug, Clone, Default)]
pub struct ToolOutput {
    pub json: JsonMap,
    pub images: Vec<Vec<u8>>,
}

impl ToolOutput {
    pub fn new(json: JsonMap) -> Self {
        ToolOutput { json, images: Vec::new() }
    }
    pub fn with_images(json: JsonMap, images: Vec<Vec<u8>>) -> Self {
        ToolOutput { json, images }
    }
}

/// A tool's error; its text is what the person or agent reads.
#[derive(Debug, Clone, PartialEq)]
pub struct PcError(pub String);
impl PcError {
    pub fn invalid(s: impl Into<String>) -> Self {
        PcError(s.into())
    }
}
impl fmt::Display for PcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for PcError {}

/// A tool the host (the app window) answers, e.g. get_editor_screenshot. Natively it must be `Send + Sync`
/// (the engine moves between threads); under WebAssembly it may hold JavaScript values.
#[cfg(not(target_arch = "wasm32"))]
pub type HostTool = Box<dyn Fn(&JsonMap) -> Result<ToolOutput, PcError> + Send + Sync>;
#[cfg(target_arch = "wasm32")]
pub type HostTool = Box<dyn Fn(&JsonMap) -> Result<ToolOutput, PcError>>;

/// Called after any change with the tool's name (or an edit's label).
#[cfg(not(target_arch = "wasm32"))]
pub type ChangeFn = Box<dyn FnMut(&str) + Send>;
#[cfg(target_arch = "wasm32")]
pub type ChangeFn = Box<dyn FnMut(&str)>;

/// A decimal for JSON, written the way the Mac app's JSON writer did: whole values without a fraction
/// ("45", not "45.0").
pub fn num(v: f64) -> Json {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 9.0e15 {
        Json::from(v as i64)
    } else {
        serde_json::Number::from_f64(v).map(Json::Number).unwrap_or(Json::Null)
    }
}

/// A JSON object built with `json!({...})`, as a map.
pub(crate) fn obj(v: Json) -> JsonMap {
    match v {
        Json::Object(m) => m,
        _ => JsonMap::new(),
    }
}
