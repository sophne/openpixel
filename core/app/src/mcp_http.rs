//! MCP over HTTP ("streamable HTTP" with plain JSON replies) for agents that can't start a local program,
//! such as ChatGPT connectors. It listens on this computer only (127.0.0.1); to reach it from the internet
//! the person runs a tunnel of their choice. The endpoint path holds a random secret, so only someone who has
//! the full address can use it. Port of MCPHTTP.swift.
use crate::json;
use crate::mcp::McpServer;
use crate::paths;
use openpixel_core::{Json, PcError};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct McpHttpServer {
    mcp: Arc<Mutex<McpServer>>,
    pub port: u16,
    pub token: String,
    session_id: Mutex<String>,
}

/// The largest request that is read (headers and body).
const MAX_REQUEST: usize = 32 << 20;

impl McpHttpServer {
    pub fn new(server: Arc<Mutex<McpServer>>, port: u16, token: Option<String>) -> Self {
        McpHttpServer { mcp: server, port, token: token.unwrap_or_else(random_token), session_id: Mutex::new(paths::new_uuid()) }
    }

    pub fn path(&self) -> String {
        format!("/mcp/{}", self.token)
    }

    pub fn local_url(&self) -> String {
        format!("http://127.0.0.1:{}{}", self.port, self.path())
    }

    /// The only folder HTTP agents may read or write: ~/Documents/OpenPixel.
    pub fn files_folder() -> PathBuf {
        paths::files_folder()
    }

    /// Starts listening (this computer only) and answers on background threads. Returns the port in use,
    /// which differs from the one asked for only when that was 0.
    pub fn start(self: &Arc<Self>) -> Result<u16, PcError> {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, self.port)).map_err(|e| PcError::invalid(e.to_string()))?;
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(self.port);
        let server = Arc::clone(self);
        std::thread::Builder::new()
            .name("OpenPixel MCP HTTP".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { continue };
                    let server = Arc::clone(&server);
                    std::thread::spawn(move || server.serve(stream));
                }
            })
            .map_err(|e| PcError::invalid(e.to_string()))?;
        Ok(port)
    }

    fn serve(&self, mut stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));
        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = vec![0u8; 65536];
        loop {
            if let Some((head, body, true)) = parse(&buf) {
                self.respond(&mut stream, &head, &body);
                return;
            }
            if buf.len() > MAX_REQUEST {
                return;
            }
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => return,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
            }
        }
    }

    fn respond(&self, stream: &mut TcpStream, head: &str, body: &[u8]) {
        let first = head.split("\r\n").find(|l| !l.is_empty()).unwrap_or("");
        let mut parts = first.split(' ').filter(|p| !p.is_empty());
        let method = parts.next().unwrap_or("");
        let target = parts.next().map(|t| t.split('?').next().unwrap_or("")).unwrap_or("");
        if !same_secret(target, &self.path()) {
            return self.send(stream, 404, "{\"error\":\"not found\"}", "");
        }
        match method {
            "POST" => {
                let text = String::from_utf8_lossy(body);
                if text.trim_start_matches([' ', '\t']).starts_with('[') {
                    // A batch: answer each request in it.
                    let items = match serde_json::from_slice::<Json>(body) {
                        Ok(Json::Array(items)) => items,
                        _ => Vec::new(),
                    };
                    let mut replies: Vec<String> = Vec::new();
                    for item in items {
                        let line = json::write(&item, json::Style::default());
                        if let Some(r) = self.handle(&line) {
                            replies.push(r);
                        }
                    }
                    if replies.is_empty() {
                        return self.send(stream, 202, "", "");
                    }
                    return self.send(stream, 200, &format!("[{}]", replies.join(",")), "");
                }
                match self.handle(&text) {
                    Some(r) => self.send(stream, 200, &r, ""),
                    None => self.send(stream, 202, "", ""),
                }
            }
            "DELETE" => {
                *self.session_id.lock().unwrap_or_else(|e| e.into_inner()) = paths::new_uuid();
                self.send(stream, 200, "", "");
            }
            _ => self.send(stream, 405, "{\"error\":\"use POST\"}", "Allow: POST, DELETE\r\n"),
        }
    }

    fn handle(&self, line: &str) -> Option<String> {
        self.mcp.lock().unwrap_or_else(|e| e.into_inner()).handle(line)
    }

    fn send(&self, stream: &mut TcpStream, status: u16, body: &str, extra: &str) {
        let reason = match status {
            202 => "Accepted",
            404 => "Not Found",
            405 => "Method Not Allowed",
            _ => "OK",
        };
        let session = self.session_id.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let mut head = format!("HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\nMcp-Session-Id: {session}\r\n{extra}", body.len());
        if !body.is_empty() {
            head.push_str("Content-Type: application/json\r\n");
        }
        head.push_str("\r\n");
        let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body.as_bytes())).and_then(|_| stream.flush());
        let _ = stream.shutdown(std::net::Shutdown::Write);
    }
}

/// Three random 32-bit numbers in hex: the secret part of the address.
fn random_token() -> String {
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();
    // The first six bytes of a random UUID carry no fixed bits.
    a.as_bytes()[..6].iter().chain(&b.as_bytes()[..6]).map(|x| format!("{x:02x}")).collect()
}

/// Maps a path from an HTTP agent into the files folder (relative paths are taken from there) and refuses
/// anything that ends up outside it, including through `..` or symbolic links.
pub fn confine(raw: &str) -> Result<String, PcError> {
    confine_in(raw, &McpHttpServer::files_folder())
}

pub fn confine_in(raw: &str, folder: &Path) -> Result<String, PcError> {
    std::fs::create_dir_all(folder).map_err(|e| PcError::invalid(e.to_string()))?;
    let root = paths::resolve_symlinks(folder);
    let refused = || PcError::invalid(format!("over HTTP, files must be inside {} (got {raw})", paths::text(&root)));
    let expanded = paths::expand_tilde(raw);
    let asked = Path::new(&expanded);
    let u = paths::standardize(&if asked.is_absolute() { asked.to_path_buf() } else { root.join(asked) });
    let (Some(parent), Some(name)) = (u.parent(), u.file_name()) else { return Err(refused()) };
    let resolved = paths::resolve_symlinks(parent).join(name);
    let is_link = std::fs::symlink_metadata(&resolved).map(|m| m.file_type().is_symlink()).unwrap_or(false);
    if resolved == root || !resolved.starts_with(&root) || is_link {
        return Err(refused());
    }
    Ok(paths::text(&resolved))
}

/// Compares without stopping at the first difference, so response timing doesn't reveal the token.
pub fn same_secret(a: &str, b: &str) -> bool {
    let (x, y) = (a.as_bytes(), b.as_bytes());
    if x.len() != y.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..x.len() {
        diff |= x[i] ^ y[i];
    }
    diff == 0
}

/// Splits a request into its head and body; the flag says whether the whole body has arrived.
pub fn parse(buf: &[u8]) -> Option<(String, Vec<u8>, bool)> {
    let at = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&buf[..at]).into_owned();
    let body = &buf[at + 4..];
    let mut length = 0usize;
    for line in head.split("\r\n") {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim_matches([' ', '\t']).parse().unwrap_or(0);
            }
        }
    }
    Some((head, body[..length.min(body.len())].to_vec(), body.len() >= length))
}
