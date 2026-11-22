//! OpenPixel's engine. This file is the public surface the rest of the program builds on; see
//! docs/desktop-architecture.md. (Skeleton: the bodies arrive with the port of app/Sources/OpenPixelCore.)
use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

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

/// A tool's error; its text is what the person or agent reads.
#[derive(Debug, Clone, PartialEq)]
pub struct PcError(pub String);
impl PcError {
    pub fn invalid(s: impl Into<String>) -> Self { PcError(s.into()) }
}
impl fmt::Display for PcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str(&self.0) }
}
impl std::error::Error for PcError {}

pub type HostTool = Box<dyn Fn(&JsonMap) -> Result<ToolOutput, PcError> + Send + Sync>;

/// The document, its undo history and every tool.
pub struct Engine {
    /// Called after any change with the tool's name (on the caller's thread).
    pub on_change: Option<Box<dyn FnMut(&str) + Send>>,
    /// Tools the host (the app window) answers, e.g. get_editor_screenshot.
    pub host_tools: HashMap<String, HostTool>,
}

impl Default for Engine {
    fn default() -> Self { Self::new() }
}

impl Engine {
    /// A 32×32×32 model called "Untitled" with the db32 palette.
    pub fn new() -> Self { Engine { on_change: None, host_tools: HashMap::new() } }
    /// Runs a tool. `source` is "agent", "person" or "sample".
    pub fn execute(&mut self, _name: &str, _args: &JsonMap, _source: &str) -> Result<ToolOutput, PcError> {
        Err(PcError::invalid("the engine is not ported yet"))
    }
    pub fn name(&self) -> &str { "Untitled" }
    pub fn path(&self) -> Option<&Path> { None }
    pub fn dirty(&self) -> bool { false }
    pub fn revision(&self) -> u64 { 0 }
    /// One voxel deep: a 2D sprite.
    pub fn is_sprite(&self) -> bool { true }
    /// (x, y, z)
    pub fn size(&self) -> (usize, usize, usize) { (32, 32, 1) }
    pub fn mark_clean(&mut self) {}
    /// Writes the document to `to` (or its own file) without logging a tool call; tells on_change "autosave".
    pub fn autosave(&mut self, _to: Option<&Path>) -> Result<(), PcError> { Err(PcError::invalid("no file to save to")) }
    /// The file moved to `to` (None: it has none yet) and is now called `name`; tells on_change "rename".
    pub fn rename(&mut self, _to: Option<PathBuf>, _name: &str) {}
}

/// The tool catalogue: what agents see in MCP `tools/list`.
pub mod tools {
    use super::JsonMap;
    pub struct ToolSpec {
        pub name: &'static str,
        pub description: String,
        pub properties: JsonMap,
        pub required: Vec<&'static str>,
        pub read_only: bool,
        /// Hidden tools are used by the editor only and never listed to agents.
        pub hidden: bool,
    }
    impl ToolSpec {
        pub fn input_schema(&self) -> JsonMap { JsonMap::new() }
        pub fn mcp_json(&self) -> JsonMap { JsonMap::new() }
    }
    pub fn catalog() -> &'static [ToolSpec] { &[] }
    pub fn spec(_name: &str) -> Option<&'static ToolSpec> { None }
    /// ToolCatalog.conventions in the Swift source.
    pub const CONVENTIONS: &str = "";
}

pub mod craft {
    /// Craft.rules in the Swift source.
    pub const RULES: &str = "";
}

pub mod sample {
    /// Builds the 2D mushroom or the 3D island sample into `engine`.
    pub fn build(_engine: &mut super::Engine, _three_d: bool) {}
}

pub mod updates {
    use super::{JsonMap, PcError};
    /// What check_for_updates answers (reads the release feed; cached unless `refresh`).
    pub fn report(_refresh: bool) -> Result<JsonMap, PcError> { Err(PcError::invalid("not ported yet")) }
}
