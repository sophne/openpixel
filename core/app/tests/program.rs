//! The program's modes, as agents and people start it.
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};

fn run(args: &[&str]) -> (String, Option<i32>) {
    let out = Command::new(env!("CARGO_BIN_EXE_openpixel")).args(args).stdin(Stdio::null()).output().unwrap();
    (String::from_utf8_lossy(&out.stdout).into_owned(), out.status.code())
}

#[test]
fn version_help_and_selftest() {
    assert_eq!(run(&["--version"]), (format!("OpenPixel {}\n", openpixel::mcp::VERSION), Some(0)));
    let (help, code) = run(&["--help"]);
    assert_eq!(code, Some(0));
    assert!(help.starts_with(&format!("OpenPixel {} — 3D pixel art editor with a built-in MCP server.\n\n  openpixel --mcp  ", openpixel::mcp::VERSION)), "{help}");
    assert!(help.contains("\n  openpixel --mcp-http [port]    MCP over HTTP on 127.0.0.1 (default 8765) for ChatGPT via a tunnel;\n"));
    assert_eq!(run(&["--mcp", "-h"]).0, help);
    assert_eq!(run(&[]).0, help);
    assert_eq!(run(&["--no-such-mode"]).1, Some(2));
    let (checks, code) = run(&["--selftest"]);
    assert_eq!(code, Some(0), "{checks}");
    assert!(checks.contains("ok   MCP initialize\n") && checks.ends_with("All checks passed.\n") && !checks.contains("FAIL"), "{checks}");
}

#[test]
fn headless_stdio_answers_line_by_line_and_ends_with_its_input() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_openpixel"))
        .args(["--mcp", "--headless"])
        // A window that happens to be open must not be reached.
        .env("OPENPIXEL_SOCKET", "/nonexistent/op.sock")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let mut ask = |line: &str| {
        writeln!(input, "{line}").unwrap();
        let mut reply = String::new();
        output.read_line(&mut reply).unwrap();
        reply
    };
    assert!(ask(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}"#).contains(r#""protocolVersion":"2024-11-05""#));
    // Notifications and blank lines get no answer: the next reply belongs to the next request.
    assert_eq!(ask("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\r"), "{\"id\":2,\"jsonrpc\":\"2.0\",\"result\":{}}\n");
    assert_eq!(ask("oops"), "{\"error\":{\"code\":-32700,\"message\":\"parse error\"},\"id\":null,\"jsonrpc\":\"2.0\"}\n");
    drop(input);
    assert!(child.wait().unwrap().success());
    let mut log = String::new();
    child.stderr.take().unwrap().read_to_string(&mut log).unwrap();
    assert_eq!(log, format!("OpenPixel MCP server {} ready (headless).\n", openpixel::mcp::VERSION));
}

#[test]
fn http_mode_prints_its_address_and_refuses_a_taken_port() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port().to_string();
    let out = Command::new(env!("CARGO_BIN_EXE_openpixel")).args(["--mcp-http", &port, "--token", "abc"]).stdin(Stdio::null()).output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).starts_with(&format!("Could not listen on port {port}: ")));
    drop(taken);

    let mut child = Command::new(env!("CARGO_BIN_EXE_openpixel"))
        .args(["--mcp-http", &port, "--token", "abc", "--headless"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut next = || lines.next().unwrap().unwrap();
    assert_eq!(next(), format!("OpenPixel MCP server {} on this computer only:", openpixel::mcp::VERSION));
    assert_eq!(next(), format!("  http://127.0.0.1:{port}/mcp/abc"));
    assert_eq!(next(), format!("To use it from ChatGPT, expose port {port} with a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:{port}`)"));
    assert_eq!(next(), "and add  https://<your-tunnel-address>/mcp/abc  as a connector. Keep the address private: anyone with it can edit.");
    assert!(next().starts_with("Agents on this connection can only open and save files in "));

    let mut s = std::net::TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    write!(s, "POST /mcp/abc HTTP/1.1\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut reply = String::new();
    s.read_to_string(&mut reply).unwrap();
    assert!(reply.starts_with("HTTP/1.1 200 OK\r\n") && reply.ends_with(r#"{"id":1,"jsonrpc":"2.0","result":{}}"#), "{reply}");
    child.kill().unwrap();
    let _ = child.wait();
}
