//! Model Context Protocol server (JSON-RPC 2.0, one message per line on stdin/stdout).
use crate::json::{self, COMPACT, PRETTY};
use crate::mcp_text;
use base64::Engine as _;
use openpixel_core::{craft, tools, Engine, Json, JsonMap, PcError, ToolOutput};
use serde_json::json;
use std::io::{BufRead, Write};
use std::sync::OnceLock;

/// Something that can run tools: the in-process engine, or the open OpenPixel window over its local socket.
pub trait ToolBackend {
    fn call(&mut self, tool: &str, args: &JsonMap) -> Result<ToolOutput, PcError>;
    fn label(&self) -> &'static str;
}

pub struct LocalBackend {
    pub engine: Engine,
}

impl LocalBackend {
    pub fn new(engine: Engine) -> Self {
        LocalBackend { engine }
    }
}

impl ToolBackend for LocalBackend {
    fn call(&mut self, tool: &str, args: &JsonMap) -> Result<ToolOutput, PcError> {
        self.engine.execute(tool, args, "agent")
    }
    fn label(&self) -> &'static str {
        "headless"
    }
}

pub const VERSION: &str = openpixel_core::VERSION;
const SUPPORTED_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// What every agent is told when it connects.
pub fn instructions() -> &'static str {
    static TEXT: OnceLock<String> = OnceLock::new();
    TEXT.get_or_init(|| {
        mcp_text::INSTRUCTIONS.replace("\\(ToolCatalog.conventions)", tools::CONVENTIONS).replace("\\(Craft.rules)", craft::RULES)
    })
}

/// A ready-made task prompt agents can offer (MCP prompts).
pub struct Prompt {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
}

pub const PROMPTS: [Prompt; 3] = [
    Prompt {
        name: "make_sprite",
        title: "Make a 2D pixel-art sprite",
        description: "Plan, draw, review and clean up a sprite following pixel-art practice.",
    },
    Prompt {
        name: "animate_sprite",
        title: "Animate a pixel-art sprite",
        description: "Turn the open sprite into a looping animation with key poses and timing.",
    },
    Prompt {
        name: "make_voxel_sprite",
        title: "Make a 3D pixel-art model",
        description: "Step-by-step guide to build, review and refine a voxel model.",
    },
];

impl Prompt {
    pub fn text(&self, subject: &str) -> String {
        match self.name {
            "make_sprite" => {
                mcp_text::MAKE_SPRITE.replace("\\(MCPServer.instructions)", instructions()).replacen("\\(subject)", subject, 1)
            }
            "animate_sprite" => mcp_text::ANIMATE_SPRITE.replacen("\\(subject)", subject, 1),
            _ => format!(
                "Make a 3D pixel-art voxel model of {subject} with OpenPixel.\n\n{}\nRead pixel_art_guide (topics voxel and color) first. After each major step call review_model, list what looks wrong, and fix it before moving on.",
                instructions()
            ),
        }
    }
}

/// -1, 0 or 1, comparing dotted version numbers ("1.10.0" is newer than "1.9.2").
pub fn compare_versions(a: &str, b: &str) -> i32 {
    fn parts(s: &str) -> Vec<u64> {
        s.split('.')
            .filter(|p| !p.is_empty())
            .map(|p| p.chars().take_while(|c| c.is_numeric()).collect::<String>().parse().unwrap_or(0))
            .collect()
    }
    let (x, y) = (parts(a), parts(b));
    for i in 0..x.len().max(y.len()) {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return if p < q { -1 } else { 1 };
        }
    }
    0
}

/// The version of OpenPixel installed on disk now, when it can differ from the one running. The Swift app read
/// its bundle's Info.plist; this build has no such record, so there is nothing to compare with.
pub fn installed_version() -> Option<String> {
    None
}

/// This MCP server is the agent's own process and keeps running across app updates. If the window or the
/// installed app is newer than it, the agent must reconnect to get the new version's tools.
pub fn add_connection_version(json: &mut JsonMap, installed: Option<&str>) {
    json.insert("agent_connection_version".into(), Json::from(VERSION));
    let running = json.get("running_version").and_then(Json::as_str).map(str::to_string);
    let mut newest: Option<String> = None;
    for v in [running, installed.map(str::to_string)].into_iter().flatten() {
        if compare_versions(&v, VERSION) <= 0 {
            continue;
        }
        // Of equals the later one wins, as Swift's `max(by:)` picks.
        if newest.as_deref().is_none_or(|n| compare_versions(n, &v) <= 0) {
            newest = Some(v);
        }
    }
    if let Some(v) = newest {
        json.insert(
            "reconnect_needed".into(),
            Json::from(format!("Your OpenPixel MCP connection runs {VERSION}, but OpenPixel {v} is installed. Restart or reconnect the OpenPixel MCP server in your agent (for Claude Code: /mcp, then reconnect openpixel) to work on the new version.")),
        );
    }
}

/// Runs every file argument of a call through `policy`: `path`, `save_path`, the `paths` list, and the
/// same inside each call of a batch, so no tool or nesting reaches a file the policy refuses.
pub fn confine_paths(tool: &str, args: &JsonMap, policy: &dyn Fn(&str) -> Result<String, PcError>) -> Result<JsonMap, PcError> {
    let mut out = args.clone();
    for key in ["path", "save_path"] {
        match out.get(key) {
            None | Some(Json::Null) => {}
            Some(Json::String(p)) => {
                let confined = policy(p)?;
                out.insert(key.into(), Json::from(confined));
            }
            Some(_) => return Err(PcError::invalid(format!("{key} must be text"))),
        }
    }
    if let Some(list) = out.get("paths") {
        let bad = || PcError::invalid("paths must be a list of text");
        let items = list.as_array().ok_or_else(bad)?;
        let mut confined = Vec::with_capacity(items.len());
        for v in items {
            confined.push(Json::from(policy(v.as_str().ok_or_else(bad)?)?));
        }
        out.insert("paths".into(), Json::Array(confined));
    }
    if tool == "batch" {
        if let Some(Json::Array(calls)) = out.get("calls") {
            let mut confined = Vec::with_capacity(calls.len());
            for c in calls {
                let Json::Object(o) = c else {
                    confined.push(c.clone());
                    continue;
                };
                let mut o = o.clone();
                let name = o.get("tool").and_then(Json::as_str).unwrap_or("").to_string();
                if let Some(inner) = o.get("args") {
                    let ia = inner.as_object().ok_or_else(|| PcError::invalid("each call's args must be an object"))?;
                    let ia = confine_paths(&name, ia, policy)?;
                    o.insert("args".into(), Json::Object(ia));
                }
                confined.push(Json::Object(o));
            }
            out.insert("calls".into(), Json::Array(confined));
        }
    }
    Ok(out)
}

pub type PathPolicy = Box<dyn Fn(&str) -> Result<String, PcError> + Send>;
/// Runs one tool call (on the window or on this process's own engine).
pub type Backend = Box<dyn FnMut(&str, &JsonMap) -> Result<ToolOutput, PcError> + Send>;
pub type InitializeHook = Box<dyn FnMut(&JsonMap) + Send>;

pub struct McpServer {
    backend: Backend,
    /// The connecting app's name and version from `initialize` (e.g. "claude-code", "cursor-vscode").
    pub client_info: JsonMap,
    pub on_initialize: Option<InitializeHook>,
    /// Checks (and may rewrite) every `path` argument before a tool runs. Set for agents reached over
    /// HTTP, which can be on another computer, so they only see OpenPixel's own folder.
    pub path_policy: Option<PathPolicy>,
}

impl McpServer {
    /// `backend` runs one tool call (on the window or on this process's own engine).
    pub fn new(backend: impl FnMut(&str, &JsonMap) -> Result<ToolOutput, PcError> + Send + 'static) -> Self {
        McpServer { backend: Box::new(backend), client_info: JsonMap::new(), on_initialize: None, path_policy: None }
    }

    /// A server that works on its own engine and never looks for a window.
    pub fn local(engine: Engine) -> Self {
        let mut backend = LocalBackend::new(engine);
        McpServer::new(move |tool, args| backend.call(tool, args))
    }

    /// Handles one JSON-RPC message; returns the response line, or None for notifications.
    pub fn handle(&mut self, line: &str) -> Option<String> {
        if line.trim_matches(|c| c == ' ' || c == '\t').is_empty() {
            return None;
        }
        let Some(msg) = json::parse_object(line) else {
            return Some(encode(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "parse error"}})));
        };
        // A message without an id is a notification (e.g. notifications/initialized).
        let id = msg.get("id")?.clone();
        let method = msg.get("method").and_then(Json::as_str).unwrap_or("");
        let empty = JsonMap::new();
        let params = msg.get("params").and_then(Json::as_object).unwrap_or(&empty);

        let reply = |result: Json| Some(encode(json!({"jsonrpc": "2.0", "id": id, "result": result})));
        let fail = |code: i64, m: &str| Some(encode(json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": m}})));

        match method {
            "initialize" => {
                self.client_info = params.get("clientInfo").and_then(Json::as_object).cloned().unwrap_or_default();
                if let Some(f) = self.on_initialize.as_mut() {
                    f(&self.client_info);
                }
                let asked = params.get("protocolVersion").and_then(Json::as_str).unwrap_or(SUPPORTED_VERSIONS[0]);
                let v = if SUPPORTED_VERSIONS.contains(&asked) { asked } else { SUPPORTED_VERSIONS[0] };
                reply(json!({
                    "protocolVersion": v,
                    "capabilities": {"tools": {"listChanged": false}, "prompts": {"listChanged": false}},
                    "serverInfo": {"name": "openpixel", "title": "OpenPixel", "version": VERSION},
                    "instructions": instructions(),
                }))
            }
            "ping" => reply(json!({})),
            "tools/list" => {
                let list: Vec<Json> = tools::catalog().iter().filter(|t| !t.hidden).map(|t| Json::Object(t.mcp_json())).collect();
                reply(json!({"tools": list}))
            }
            "tools/call" => {
                let name = params.get("name").and_then(Json::as_str).unwrap_or("");
                if !tools::spec(name).is_some_and(|s| !s.hidden) {
                    return fail(-32602, "unknown tool");
                }
                let args = params.get("arguments").and_then(Json::as_object).cloned().unwrap_or_default();
                match self.call(name, args) {
                    Ok(out) => {
                        let mut result = out.json;
                        if name == "check_for_updates" {
                            add_connection_version(&mut result, installed_version().as_deref());
                        }
                        let mut content = vec![json!({"type": "text", "text": json::write_map(&result, PRETTY)})];
                        for img in &out.images {
                            content.push(json!({"type": "image", "data": base64::engine::general_purpose::STANDARD.encode(img), "mimeType": "image/png"}));
                        }
                        reply(json!({"content": content, "isError": false}))
                    }
                    Err(e) => reply(json!({"content": [{"type": "text", "text": format!("Error: {e}")}], "isError": true})),
                }
            }
            "prompts/list" => {
                let list: Vec<Json> = PROMPTS
                    .iter()
                    .map(|p| {
                        json!({"name": p.name, "title": p.title, "description": p.description,
                               "arguments": [{"name": "subject", "description": "What to make", "required": true}]})
                    })
                    .collect();
                reply(json!({"prompts": list}))
            }
            "prompts/get" => {
                let name = params.get("name").and_then(Json::as_str).unwrap_or("make_voxel_sprite");
                let Some(p) = PROMPTS.iter().find(|p| p.name == name) else {
                    return fail(-32602, &format!("unknown prompt {name}"));
                };
                let subject = params.get("arguments").and_then(Json::as_object).and_then(|a| a.get("subject")).and_then(Json::as_str).unwrap_or("a small object");
                reply(json!({"description": p.description, "messages": [{"role": "user", "content": {"type": "text", "text": p.text(subject)}}]}))
            }
            "resources/list" => reply(json!({"resources": []})),
            other => fail(-32601, &format!("method not found: {other}")),
        }
    }

    fn call(&mut self, name: &str, args: JsonMap) -> Result<ToolOutput, PcError> {
        let args = match &self.path_policy {
            Some(policy) => confine_paths(name, &args, policy.as_ref())?,
            None => args,
        };
        (self.backend)(name, &args)
    }

    /// Reads stdin until it closes. Each response goes out on one stdout line.
    pub fn run_stdio(&mut self) {
        let stdin = std::io::stdin();
        let stdout = std::io::stdout();
        let mut line = String::new();
        let mut input = stdin.lock();
        loop {
            line.clear();
            match input.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = line.strip_suffix('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).unwrap_or(&line);
            if let Some(out) = self.handle(text) {
                let mut o = stdout.lock();
                if o.write_all(out.as_bytes()).and_then(|_| o.write_all(b"\n")).and_then(|_| o.flush()).is_err() {
                    break;
                }
            }
        }
    }
}

fn encode(v: Json) -> String {
    json::write(&v, COMPACT)
}
