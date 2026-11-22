//! JSON-RPC behaviour of the MCP server: what every agent relies on, byte for byte.
use openpixel::mcp::{self, McpServer};
use openpixel_core::{Engine, Json, JsonMap, PcError, ToolOutput};
use serde_json::json;

fn server() -> McpServer {
    McpServer::local(Engine::new())
}

fn parsed(line: Option<String>) -> Json {
    serde_json::from_str(&line.expect("a reply")).expect("JSON")
}

#[test]
fn initialize_answers_with_sorted_keys_and_the_asked_version() {
    let mut s = server();
    let out = s.handle(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"claude-code","version":"2.1"}}}"#).unwrap();
    assert!(out.starts_with(r#"{"id":1,"jsonrpc":"2.0","result":{"capabilities":{"prompts":{"listChanged":false},"tools":{"listChanged":false}},"instructions":"OpenPixel makes pixel art"#), "{out}");
    let v = parsed(Some(out));
    assert_eq!(v["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(v["result"]["serverInfo"], json!({"name": "openpixel", "title": "OpenPixel", "version": mcp::VERSION}));
    assert_eq!(s.client_info["name"], "claude-code");
    // A version this server does not know gets the newest one it does.
    let v = parsed(s.handle(r#"{"jsonrpc":"2.0","id":"a","method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#));
    assert_eq!(v["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(v["id"], "a");
}

#[test]
fn on_initialize_hears_the_client() {
    let mut s = server();
    let seen = std::sync::Arc::new(std::sync::Mutex::new(JsonMap::new()));
    let sink = seen.clone();
    s.on_initialize = Some(Box::new(move |info| *sink.lock().unwrap() = info.clone()));
    s.handle(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"cursor-vscode"}}}"#);
    assert_eq!(seen.lock().unwrap()["name"], "cursor-vscode");
}

#[test]
fn errors_and_small_methods() {
    let mut s = server();
    assert_eq!(s.handle("not json").unwrap(), r#"{"error":{"code":-32700,"message":"parse error"},"id":null,"jsonrpc":"2.0"}"#);
    assert_eq!(s.handle("[1,2]").unwrap(), r#"{"error":{"code":-32700,"message":"parse error"},"id":null,"jsonrpc":"2.0"}"#);
    assert_eq!(s.handle(""), None);
    assert_eq!(s.handle("  \t "), None);
    assert_eq!(s.handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), None);
    assert_eq!(s.handle(r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#).unwrap(), r#"{"id":2,"jsonrpc":"2.0","result":{}}"#);
    assert_eq!(s.handle(r#"{"jsonrpc":"2.0","id":3,"method":"resources/list"}"#).unwrap(), r#"{"id":3,"jsonrpc":"2.0","result":{"resources":[]}}"#);
    assert_eq!(
        s.handle(r#"{"jsonrpc":"2.0","id":4,"method":"nope"}"#).unwrap(),
        r#"{"error":{"code":-32601,"message":"method not found: nope"},"id":4,"jsonrpc":"2.0"}"#
    );
    assert_eq!(
        s.handle(r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"no_such_tool"}}"#).unwrap(),
        r#"{"error":{"code":-32602,"message":"unknown tool"},"id":5,"jsonrpc":"2.0"}"#
    );
    assert_eq!(
        s.handle(r#"{"jsonrpc":"2.0","id":6,"method":"prompts/get","params":{"name":"x"}}"#).unwrap(),
        r#"{"error":{"code":-32602,"message":"unknown prompt x"},"id":6,"jsonrpc":"2.0"}"#
    );
    // A null id is still a request.
    assert_eq!(s.handle(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#).unwrap(), r#"{"id":null,"jsonrpc":"2.0","result":{}}"#);
}

#[test]
fn prompts_carry_the_subject_and_the_instructions() {
    let mut s = server();
    let list = parsed(s.handle(r#"{"jsonrpc":"2.0","id":1,"method":"prompts/list"}"#));
    let names: Vec<&str> = list["result"]["prompts"].as_array().unwrap().iter().map(|p| p["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["make_sprite", "animate_sprite", "make_voxel_sprite"]);
    assert_eq!(list["result"]["prompts"][0]["arguments"], json!([{"name": "subject", "description": "What to make", "required": true}]));

    let text = |s: &mut McpServer, params: Json| {
        let v = parsed(s.handle(&json!({"jsonrpc": "2.0", "id": 2, "method": "prompts/get", "params": params}).to_string()));
        assert_eq!(v["result"]["messages"][0]["role"], "user");
        v["result"]["messages"][0]["content"]["text"].as_str().unwrap().to_string()
    };
    let sprite = text(&mut s, json!({"name": "make_sprite", "arguments": {"subject": "a fox"}}));
    assert!(sprite.starts_with("Make a 2D pixel-art sprite of a fox with OpenPixel.\n\n1. Call pixel_art_guide (topic all) and follow it.\n"));
    assert!(sprite.contains("\n   Read each edit's critique: if it introduced an issue, fix or undo it before moving on."));
    assert!(sprite.ends_with(mcp::instructions()));
    let anim = text(&mut s, json!({"name": "animate_sprite"}));
    assert!(anim.starts_with("Animate the open sprite: a small object.\n\n1. Call pixel_art_guide with topic animation."));
    assert!(anim.ends_with("6. Export with export_gif and export_sheet."));
    let voxel = text(&mut s, json!({}));
    assert!(voxel.starts_with("Make a 3D pixel-art voxel model of a small object with OpenPixel.\n\nOpenPixel makes pixel art"));
    assert!(voxel.ends_with("\nRead pixel_art_guide (topics voxel and color) first. After each major step call review_model, list what looks wrong, and fix it before moving on."));
}

#[test]
fn instructions_keep_their_words() {
    let text = mcp::instructions();
    assert!(text.starts_with("OpenPixel makes pixel art: flat 2D sprites and 3D voxel models that render to crisp sprites.\n"));
    assert!(text.contains("\n2D sprite workflow: pixel_art_guide → new_sprite at the final size (16-64) → make_color_ramp per material →\n"));
    assert!(text.contains("\n3D workflow:\n1. get_model_info (or new_model with a size that fits the subject, e.g. 16-48 per side).\n"));
    assert!(text.contains("\n3. Block out big shapes with fill_box / draw_sphere / draw_cylinder, or draw slices with paint_slice\n   (front views on axis z, top views on axis y; depth extrudes).\n"));
    assert!(text.ends_with("Use layers for parts (body, eyes, props) and frames for animation. If the OpenPixel window is open,\nedits appear there live and get_editor_screenshot shows what the person sees."));
    assert!(!text.contains("\\("));
}

#[test]
fn paths_go_through_the_policy() {
    let policy = |p: &str| if p.starts_with('/') { Err(PcError::invalid("outside")) } else { Ok(format!("/jail/{p}")) };
    let args = |v: Json| v.as_object().cloned().unwrap();
    let out = mcp::confine_paths("export_png", &args(json!({"path": "a.png", "save_path": null, "scale": 2})), &policy).unwrap();
    assert_eq!(Json::Object(out), json!({"path": "/jail/a.png", "save_path": null, "scale": 2}));
    let out = mcp::confine_paths("batch", &args(json!({"calls": [{"tool": "batch", "args": {"calls": [{"tool": "x", "args": {"paths": ["b"]}}]}}, 7]})), &policy).unwrap();
    assert_eq!(out["calls"][0]["args"]["calls"][0]["args"]["paths"][0], "/jail/b");
    assert_eq!(out["calls"][1], 7);
    let err = |v: Json| mcp::confine_paths("batch", &args(v), &policy).unwrap_err().to_string();
    assert_eq!(err(json!({"path": 5})), "path must be text");
    assert_eq!(err(json!({"paths": "a"})), "paths must be a list of text");
    assert_eq!(err(json!({"paths": ["a", 1]})), "paths must be a list of text");
    assert_eq!(err(json!({"calls": [{"tool": "x", "args": 3}]})), "each call's args must be an object");
    assert_eq!(err(json!({"calls": [{"tool": "x", "args": {"path": "/etc/passwd"}}]})), "outside");
    // Only batch looks inside `calls`.
    assert!(mcp::confine_paths("other", &args(json!({"calls": [{"args": {"path": "/x"}}]})), &policy).is_ok());
}

#[test]
fn connection_version_picks_the_newest() {
    let mut j = JsonMap::new();
    j.insert("running_version".into(), json!("98.0.0"));
    mcp::add_connection_version(&mut j, Some("99.1.0"));
    let note = j["reconnect_needed"].as_str().unwrap();
    assert_eq!(
        note,
        format!("Your OpenPixel MCP connection runs {v}, but OpenPixel 99.1.0 is installed. Restart or reconnect the OpenPixel MCP server in your agent (for Claude Code: /mcp, then reconnect openpixel) to work on the new version.", v = mcp::VERSION)
    );
    let mut old = JsonMap::new();
    old.insert("running_version".into(), json!("0.0.1"));
    mcp::add_connection_version(&mut old, None);
    assert!(!old.contains_key("reconnect_needed"));
    assert_eq!(old["agent_connection_version"], mcp::VERSION);
}

/// A backend that answers by itself, to see what tools/call makes of a result. It needs the tool catalogue
/// (tools/call refuses names the engine does not list), so it waits for the engine.
#[test]
fn tool_results_are_pretty_text_plus_pictures() {
    let mut s = McpServer::new(|tool, args| {
        if tool == "get_model_info" {
            let mut out = ToolOutput::default();
            out.json.insert("b".into(), json!([1, 2.0]));
            out.json.insert("a".into(), json!(args.len()));
            out.images.push(vec![1, 2, 3]);
            Ok(out)
        } else if tool == "check_for_updates" {
            let mut out = ToolOutput::default();
            out.json.insert("running_version".into(), json!("99.0.0"));
            Ok(out)
        } else {
            Err(PcError::invalid("bad colour"))
        }
    });
    let ok = parsed(s.handle(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_model_info","arguments":{}}}"#));
    assert_eq!(ok["result"]["content"][0], json!({"type": "text", "text": "{\n  \"a\" : 0,\n  \"b\" : [\n    1,\n    2\n  ]\n}"}));
    assert_eq!(ok["result"]["content"][1], json!({"type": "image", "data": "AQID", "mimeType": "image/png"}));
    assert_eq!(ok["result"]["isError"], false);
    let bad = s.handle(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"set_pixels","arguments":{}}}"#).unwrap();
    assert_eq!(bad, r#"{"id":2,"jsonrpc":"2.0","result":{"content":[{"text":"Error: bad colour","type":"text"}],"isError":true}}"#);
    // check_for_updates also says which version this connection runs, and to reconnect when the window is newer.
    let upd = parsed(s.handle(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_for_updates","arguments":{}}}"#));
    let text = upd["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains(&format!("\"agent_connection_version\" : \"{}\"", mcp::VERSION)) && text.contains("\"reconnect_needed\" : \"Your OpenPixel MCP connection runs"), "{text}");
}
