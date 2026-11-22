//! The link to the window, against a throwaway socket server that plays the window's part.
#![cfg(unix)]
use openpixel::bridge::RemoteBackend;
use openpixel::mcp::ToolBackend;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn socket(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("op-bridge-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("op.sock")
}

/// The window's part, with a way to hang up on everyone (as when the window quits).
struct Window {
    lines: Receiver<(usize, Value)>,
    connections: Arc<Mutex<Vec<UnixStream>>>,
}

impl Window {
    fn next(&self) -> (usize, Value) {
        self.lines.recv_timeout(Duration::from_secs(10)).expect("a line from the program")
    }
    fn hang_up(&self) {
        for c in self.connections.lock().unwrap().drain(..) {
            let _ = c.shutdown(std::net::Shutdown::Both);
        }
    }
}

/// Answers like the window: hello → ok, `get_model_info` → a result with a picture, `quit` → hangs up, the rest → an error.
/// Every line it receives is passed on, tagged with the connection's number.
fn window(path: &PathBuf) -> Window {
    let listener = UnixListener::bind(path).unwrap();
    let (tx, rx) = channel();
    let connections = Arc::new(Mutex::new(Vec::new()));
    let kept = connections.clone();
    std::thread::spawn(move || {
        for (n, client) in listener.incoming().enumerate() {
            let Ok(client) = client else { break };
            kept.lock().unwrap().push(client.try_clone().unwrap());
            let tx: Sender<(usize, Value)> = tx.clone();
            std::thread::spawn(move || serve(n, client, tx));
        }
    });
    Window { lines: rx, connections }
}

fn serve(n: usize, client: UnixStream, tx: Sender<(usize, Value)>) {
    let mut out = client.try_clone().unwrap();
    for line in BufReader::new(client).lines() {
        let Ok(line) = line else { break };
        let req: Value = serde_json::from_str(&line).unwrap();
        let _ = tx.send((n, req.clone()));
        let reply = if req.get("hello").is_some() {
            json!({"ok": true})
        } else if req["tool"] == "get_model_info" {
            json!({"ok": true, "json": {"name": "Untitled", "args": req["args"]}, "images": ["AQID", "not base64!"]})
        } else if req["tool"] == "quit" {
            let _ = out.shutdown(std::net::Shutdown::Both);
            break;
        } else {
            json!({"ok": false, "error": "colour 99 is not in the palette"})
        };
        if writeln!(out, "{reply}").is_err() {
            break;
        }
    }
}

#[test]
fn no_window_means_no_backend() {
    assert!(RemoteBackend::connect(&socket("none")).is_none());
}

#[test]
fn hello_call_and_errors() {
    let path = socket("calls");
    let w = window(&path);
    let mut r = RemoteBackend::connect(&path).expect("connects");
    assert_eq!(r.label(), "window");
    r.hello(json!({"name": "claude-code", "pid": 7}).as_object().unwrap());
    assert!(!r.broken());
    assert_eq!(w.next().1, json!({"hello": {"name": "claude-code", "pid": 7}}));
    assert!(r.is_alive());

    let args = json!({"path": "/tmp/a b.openpixel"});
    let out = r.call("get_model_info", args.as_object().unwrap()).unwrap();
    assert_eq!(Value::Object(out.json), json!({"name": "Untitled", "args": args}));
    assert_eq!(out.images, vec![vec![1u8, 2, 3]]);
    assert_eq!(w.next().1, json!({"tool": "get_model_info", "args": args}));

    let err = r.call("set_pixels", &Default::default()).unwrap_err();
    assert_eq!(err.to_string(), "colour 99 is not in the palette");
    assert!(r.is_alive(), "a tool's error leaves the link up");
}

#[test]
fn a_window_that_went_away_is_noticed() {
    let path = socket("gone");
    let w = window(&path);
    let mut r = RemoteBackend::connect(&path).unwrap();
    r.hello(&Default::default());
    assert!(r.is_alive());
    let err = r.call("quit", &Default::default()).unwrap_err();
    assert_eq!(err.to_string(), "lost the connection to the OpenPixel window");
    assert!(r.broken());
    assert!(!r.is_alive());

    // Closed between calls: seen without sending anything.
    let mut r = RemoteBackend::connect(&path).unwrap();
    r.hello(&Default::default());
    assert!(r.is_alive());
    w.hang_up();
    assert!(!r.is_alive());
    assert!(r.broken());

    std::fs::remove_file(&path).unwrap();
    assert!(RemoteBackend::connect(&path).is_none());
}

/// The real program: `openpixel --mcp` introduces itself to the window on initialize and comes back by itself
/// after the window restarts.
#[test]
fn the_mcp_program_says_hello_and_reconnects() {
    let path = socket("program");
    let w = window(&path);
    let mut child = Command::new(env!("CARGO_BIN_EXE_openpixel"))
        .arg("--mcp")
        .env("OPENPIXEL_SOCKET", &path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    writeln!(input, r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"2025-06-18","clientInfo":{{"name":"test-agent","version":"1.0"}}}}}}"#).unwrap();
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    assert!(line.contains("\"serverInfo\""), "{line}");

    let (first, hello) = w.next();
    assert_eq!(hello["hello"]["name"], "test-agent");
    assert_eq!(hello["hello"]["version"], "1.0");
    assert_eq!(hello["hello"]["transport"], "stdio");
    assert_eq!(hello["hello"]["pid"], child.id());

    // The window drops the connection (as when it restarts): within a few seconds the program is back and says
    // who it is again, without the agent doing anything.
    w.hang_up();
    let (second, hello) = w.next();
    assert_ne!(first, second);
    assert_eq!(hello["hello"]["name"], "test-agent");

    drop(input);
    assert!(child.wait().unwrap().success());
}

/// Forwarding a tool call needs the tool catalogue: tools/call refuses names the engine does not list.
#[test]
fn the_mcp_program_forwards_tool_calls_to_the_window() {
    let path = socket("forward");
    let w = window(&path);
    let mut child = Command::new(env!("CARGO_BIN_EXE_openpixel"))
        .arg("--mcp")
        .env("OPENPIXEL_SOCKET", &path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    writeln!(input, r#"{{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{{"name":"get_model_info","arguments":{{}}}}}}"#).unwrap();
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    let reply: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(reply["result"]["isError"], false);
    assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("\"name\" : \"Untitled\""));
    assert_eq!(reply["result"]["content"][1]["data"], "AQID");
    // Before initialize the hello carries only what the program knows itself.
    assert_eq!(w.next().1["hello"]["transport"], "stdio");
    assert_eq!(w.next().1["tool"], "get_model_info");
    drop(input);
    child.wait().unwrap();
}
