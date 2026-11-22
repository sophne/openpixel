//! `openpixel --selftest`: the MCP program's built-in checks, without a window: the MCP protocol and the HTTP
//! mode's path rules (the engine's own checks live with the engine).
use crate::mcp::{self, McpServer};
use crate::mcp_http;
use openpixel_core::{tools, Engine, Json, JsonMap, PcError};
use serde_json::json;
use std::path::{Path, PathBuf};

/// Collects results; each one is printed as it is made.
pub struct Checks {
    pub failed: Vec<String>,
    pub count: usize,
    print: bool,
}

impl Checks {
    pub fn new(print: bool) -> Self {
        Checks { failed: Vec::new(), count: 0, print }
    }

    pub fn check(&mut self, cond: bool, what: &str) {
        if self.print {
            println!("{}{what}", if cond { "ok   " } else { "FAIL " });
        }
        self.count += 1;
        if !cond {
            self.failed.push(what.to_string());
        }
    }

    pub fn ok(&self) -> bool {
        self.failed.is_empty()
    }
}

fn args(v: Json) -> JsonMap {
    match v {
        Json::Object(m) => m,
        _ => JsonMap::new(),
    }
}

fn scratch(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("openpixel-selftest-{}-{name}", std::process::id()))
}

/// Over HTTP, every file argument is confined, including inside batches, style files and sets.
pub fn http_path_checks(c: &mut Checks) {
    let tmp = scratch("paths");
    let jail = tmp.join("jail");
    let _ = std::fs::create_dir_all(&jail);
    let policy = |p: &str| mcp_http::confine_in(p, &jail);
    let policy: &dyn Fn(&str) -> Result<String, PcError> = &policy;
    let inside = |p: &str| Path::new(p).ends_with(Path::new("jail").join("a.png"));

    let nested_out = mcp::confine_paths("batch", &args(json!({"calls": [{"tool": "export_png", "args": {"path": "/etc/x.png"}}]})), policy);
    let nested_in = mcp::confine_paths("batch", &args(json!({"calls": [{"tool": "export_png", "args": {"path": "a.png"}}]})), policy);
    let inner_path = nested_in.ok().and_then(|o| o["calls"][0]["args"]["path"].as_str().map(str::to_string));
    c.check(
        nested_out.is_err()
            && inner_path.is_some_and(|p| inside(&p))
            && mcp::confine_paths("set_style", &args(json!({"save_path": "/tmp/style.json"})), policy).is_err()
            && mcp::confine_paths("set_style", &args(json!({"path": "../style.json"})), policy).is_err()
            && mcp::confine_paths("review_set", &args(json!({"paths": ["a.openpixel", "/etc/hosts"]})), policy).is_err()
            && mcp::confine_paths("export_png", &args(json!({"path": 5})), policy).is_err(),
        "HTTP paths: batch calls, style files and review_set lists are confined like path",
    );

    // Agents over HTTP only reach ~/Documents/OpenPixel (here: a test folder).
    c.check(mcp_http::confine_in("a.png", &jail).is_ok_and(|p| inside(&p)), "HTTP paths: relative names land in the folder");
    // Through a link that points out of the folder (where links can be made without special rights).
    #[cfg(unix)]
    let through_link: &[&str] = if std::os::unix::fs::symlink(std::env::temp_dir(), jail.join("out")).is_ok() { &["out/x.png", "out"] } else { &[] };
    #[cfg(not(unix))]
    let through_link: &[&str] = &[];
    for escape in ["/etc/hosts", "../escape.png", "~/x.png", "sub/../../x.png"].iter().chain(through_link) {
        c.check(mcp_http::confine_in(escape, &jail).is_err(), &format!("HTTP paths: {escape} is refused"));
    }
    let _ = std::fs::remove_dir_all(&tmp);
}

/// What the protocol answers whatever the engine holds.
pub fn protocol_checks(c: &mut Checks) {
    c.check(
        mcp::compare_versions("1.10.0", "1.9.2") == 1 && mcp::compare_versions("1.0", "1.0.0") == 0 && mcp::compare_versions("1.99.99", "2.0.0") == -1,
        "updates: versions compare by number, not as text",
    );
    let mut behind = args(json!({"running_version": "99.0.0"}));
    let mut same = args(json!({"running_version": mcp::VERSION}));
    mcp::add_connection_version(&mut behind, None);
    mcp::add_connection_version(&mut same, Some(mcp::VERSION));
    c.check(
        behind["agent_connection_version"] == mcp::VERSION
            && behind.get("reconnect_needed").and_then(Json::as_str).is_some_and(|s| s.contains("99.0.0"))
            && !same.contains_key("reconnect_needed"),
        "updates: over MCP the agent hears its own connection's version, and to reconnect when the app is newer",
    );

    let mut server = McpServer::local(Engine::new());
    let init = server.handle(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#).unwrap_or_default();
    c.check(init.contains("\"openpixel\""), "MCP initialize");
    c.check(server.handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none(), "MCP ignores notifications");
    let prompts = server.handle(r#"{"jsonrpc":"2.0","id":5,"method":"prompts/list"}"#).unwrap_or_default();
    let sprite_prompt =
        server.handle(r#"{"jsonrpc":"2.0","id":6,"method":"prompts/get","params":{"name":"make_sprite","arguments":{"subject":"a fox"}}}"#).unwrap_or_default();
    c.check(prompts.contains("make_sprite") && prompts.contains("animate_sprite") && sprite_prompt.contains("a fox"), "MCP prompts for sprites and animation");
}

/// The parts that need the engine's tools (skipped while the engine is only a skeleton).
pub fn tool_checks(c: &mut Checks) {
    let mut server = McpServer::local(Engine::new());
    let list = server.handle(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).unwrap_or_default();
    c.check(list.contains("paint_slice") && !list.contains("ui_state"), "MCP tools/list hides editor-only tools");
    let parsed: Json = serde_json::from_str(&list).unwrap_or(Json::Null);
    let listed: Vec<&Json> = parsed["result"]["tools"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let has = |n: &str| listed.iter().any(|t| t["name"] == n);
    let read_only = |n: &str| listed.iter().find(|t| t["name"] == n).and_then(|t| t["annotations"]["readOnlyHint"].as_bool());
    c.check(
        ["view_as_text", "set_style", "get_style", "set_feedback", "batch", "review_set", "check_for_updates"].iter().all(|n| has(n))
            && read_only("view_as_text") == Some(true)
            && read_only("review_set") == Some(true)
            && read_only("batch") == Some(false),
        "MCP lists the observation and pipeline tools with the right read-only hints",
    );
    let call = server.handle(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"render_view","arguments":{"view":"front"}}}"#).unwrap_or_default();
    c.check(call.contains("image/png"), "MCP tools/call returns an image");
    let bad = server.handle(r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"fill_box","arguments":{"from":[0,0,0]}}}"#).unwrap_or_default();
    c.check(bad.contains("\"isError\":true"), "MCP reports tool errors");
}

/// Runs every check and prints each result. True when all passed.
pub fn run() -> bool {
    let mut c = Checks::new(true);
    protocol_checks(&mut c);
    http_path_checks(&mut c);
    if tools::catalog().is_empty() {
        println!("skip The tool checks need the engine, which this build does not have yet");
    } else {
        tool_checks(&mut c);
    }
    println!("{}", if c.ok() { "All checks passed." } else { "Some checks failed." });
    c.ok()
}
