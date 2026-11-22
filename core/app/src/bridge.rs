//! The MCP program's end of the local link to the open OpenPixel window: an owner-only Unix socket in the person's
//! data folder (on Windows the named pipe `\\.\pipe\openpixel-<user>`), no network port. One JSON request per line:
//! {"tool": name, "args": {...}} → {"ok": true, "json": {...}, "images": [base64 PNG]} or {"ok": false, "error": ".."}.
//! Port of the client side of Bridge.swift; the window's side is desktop/host/node/bridge.ts.
use crate::json;
use crate::mcp::ToolBackend;
use base64::Engine as _;
use openpixel_core::{Json, JsonMap, PcError, ToolOutput};
use serde_json::json;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

/// Where the window listens: `OPENPIXEL_SOCKET` when set, else `openpixel.sock` in the data folder
/// (on Windows the pipe named after the person).
pub fn socket_path() -> PathBuf {
    if let Some(p) = std::env::var_os("OPENPIXEL_SOCKET").filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    default_socket_path()
}

#[cfg(not(windows))]
fn default_socket_path() -> PathBuf {
    crate::paths::data_folder().join("openpixel.sock")
}

#[cfg(windows)]
fn default_socket_path() -> PathBuf {
    PathBuf::from(pipe_name(&std::env::var("USERNAME").unwrap_or_default()))
}

/// The Windows pipe for a person: `\\.\pipe\openpixel-<user>`, with anything but letters, digits, `.`, `_` and `-`
/// in the name written as `_` (desktop/host/node/platform-node.ts makes the same name).
pub fn pipe_name(user: &str) -> String {
    let clean: String = user.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' }).collect();
    format!(r"\\.\pipe\openpixel-{}", if clean.is_empty() { "user" } else { &clean })
}

/// The connection itself. On macOS and Linux a Unix socket; on Windows the pipe, opened like a file (no window
/// listening, or all its places taken, both read as "no window").
#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;
#[cfg(not(unix))]
type Stream = std::fs::File;

#[cfg(unix)]
fn open(path: &Path) -> Option<Stream> {
    Stream::connect(path).ok()
}

#[cfg(not(unix))]
fn open(path: &Path) -> Option<Stream> {
    std::fs::OpenOptions::new().read(true).write(true).open(path).ok()
}

/// True when the other end has closed. It never waits: between calls nothing is due from the window, so a read
/// that would block means the link is fine. (A byte that does arrive is kept.)
#[cfg(unix)]
fn closed_by_peer(stream: &mut Stream, pending: &mut Vec<u8>) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return true;
    }
    let mut byte = [0u8; 1];
    let closed = match stream.read(&mut byte) {
        Ok(0) => true,
        Ok(_) => {
            pending.push(byte[0]);
            false
        }
        Err(e) => !matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted),
    };
    stream.set_nonblocking(false).is_err() || closed
}

/// A pipe opened as a file cannot be looked at without reading: a window that went away shows on the next call.
#[cfg(not(unix))]
fn closed_by_peer(_stream: &mut Stream, _pending: &mut Vec<u8>) -> bool {
    false
}

fn read_line(stream: &mut Stream, pending: &mut Vec<u8>) -> Option<String> {
    let mut chunk = vec![0u8; 65536];
    loop {
        if let Some(nl) = pending.iter().position(|b| *b == b'\n') {
            let line = String::from_utf8_lossy(&pending[..nl]).into_owned();
            pending.drain(..=nl);
            return Some(line);
        }
        match stream.read(&mut chunk) {
            Ok(0) => return None,
            Ok(n) => pending.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(_) => return None,
        }
    }
}

fn write_all(stream: &mut Stream, s: &str) -> bool {
    let mut line = Vec::with_capacity(s.len() + 1);
    line.extend_from_slice(s.as_bytes());
    line.push(b'\n');
    stream.write_all(&line).and_then(|_| stream.flush()).is_ok()
}

fn encode(v: Json) -> String {
    json::write(&v, json::Style::default())
}

/// Talks to the open window from the MCP process.
pub struct RemoteBackend {
    stream: Stream,
    pending: Vec<u8>,
    broken: bool,
}

impl RemoteBackend {
    /// None when no window is listening at `path`.
    pub fn connect(path: &Path) -> Option<Self> {
        Some(RemoteBackend { stream: open(path)?, pending: Vec::new(), broken: false })
    }

    pub fn broken(&self) -> bool {
        self.broken
    }

    /// Tells the window which agent is on this connection (from the MCP initialize handshake).
    pub fn hello(&mut self, info: &JsonMap) {
        if !write_all(&mut self.stream, &encode(json!({"hello": info}))) || read_line(&mut self.stream, &mut self.pending).is_none() {
            self.broken = true;
        }
    }

    /// False once the window has closed its end (it quit or restarted). Doesn't wait for anything.
    pub fn is_alive(&mut self) -> bool {
        if !self.broken && closed_by_peer(&mut self.stream, &mut self.pending) {
            self.broken = true;
        }
        !self.broken
    }
}

impl ToolBackend for RemoteBackend {
    fn label(&self) -> &'static str {
        "window"
    }

    fn call(&mut self, tool: &str, args: &JsonMap) -> Result<ToolOutput, PcError> {
        let sent = write_all(&mut self.stream, &encode(json!({"tool": tool, "args": args})));
        let res = if sent { read_line(&mut self.stream, &mut self.pending).and_then(|l| json::parse_object(&l)) } else { None };
        let Some(res) = res else {
            self.broken = true;
            return Err(PcError::invalid("lost the connection to the OpenPixel window"));
        };
        if json::bool_of(res.get("ok")) == Some(true) {
            let images = json::str_list(res.get("images"))
                .unwrap_or_default()
                .into_iter()
                .filter_map(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
                .collect();
            return Ok(ToolOutput { json: res.get("json").and_then(Json::as_object).cloned().unwrap_or_default(), images });
        }
        Err(PcError::invalid(res.get("error").and_then(Json::as_str).unwrap_or("failed")))
    }
}
