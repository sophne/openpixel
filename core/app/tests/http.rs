//! MCP over HTTP: the address is the secret, only POST and DELETE do anything, and it listens on this computer only.
use openpixel::mcp::McpServer;
use openpixel::mcp_http::{self, McpHttpServer};
use openpixel_core::Engine;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};

struct Reply {
    status: u16,
    head: String,
    body: String,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.head.lines().find_map(|l| l.strip_prefix(&format!("{name}: ")))
    }
}

fn request(port: u16, method: &str, path: &str, body: &str) -> Reply {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    // In two pieces, as a slow client would send it.
    write!(s, "{method} {path} HTTP/1.1\r\nHost: localhost\r\ncontent-length: {}\r\n\r\n", body.len()).unwrap();
    s.flush().unwrap();
    s.write_all(body.as_bytes()).unwrap();
    let mut text = String::new();
    s.read_to_string(&mut text).unwrap();
    let (head, body) = text.split_once("\r\n\r\n").unwrap();
    Reply { status: head.split(' ').nth(1).unwrap().parse().unwrap(), head: head.to_string(), body: body.to_string() }
}

fn start(token: Option<&str>) -> (Arc<McpHttpServer>, u16) {
    let server = Arc::new(McpHttpServer::new(Arc::new(Mutex::new(McpServer::local(Engine::new()))), 0, token.map(str::to_string)));
    let port = server.start().unwrap();
    (server, port)
}

#[test]
fn post_answers_and_everything_else_is_refused() {
    let (server, port) = start(Some("s3cret"));
    assert_eq!(server.path(), "/mcp/s3cret");
    let ping = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;

    let ok = request(port, "POST", "/mcp/s3cret?x=1", ping);
    assert_eq!((ok.status, ok.body.as_str()), (200, r#"{"id":1,"jsonrpc":"2.0","result":{}}"#));
    assert_eq!(ok.header("Content-Type"), Some("application/json"));
    assert_eq!(ok.header("Connection"), Some("close"));
    assert_eq!(ok.header("Content-Length"), Some("36"));
    let session = ok.header("Mcp-Session-Id").unwrap().to_string();
    assert_eq!(session.len(), 36);

    for wrong in ["/mcp/s3cres", "/mcp/s3cret/", "/mcp", "/"] {
        let r = request(port, "POST", wrong, ping);
        assert_eq!((r.status, r.body.as_str()), (404, r#"{"error":"not found"}"#), "{wrong}");
    }
    let get = request(port, "GET", "/mcp/s3cret", "");
    assert_eq!((get.status, get.body.as_str()), (405, r#"{"error":"use POST"}"#));
    assert_eq!(get.header("Allow"), Some("POST, DELETE"));

    // A notification has no answer; a batch answers each request in it.
    let note = request(port, "POST", "/mcp/s3cret", r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
    assert_eq!((note.status, note.body.as_str()), (202, ""));
    assert_eq!(note.header("Content-Type"), None);
    let batch = request(port, "POST", "/mcp/s3cret", &format!(" [{ping},{{\"jsonrpc\":\"2.0\",\"method\":\"x\"}},{}]", ping.replace("1,", "2,")));
    assert_eq!(batch.body, r#"[{"id":1,"jsonrpc":"2.0","result":{}},{"id":2,"jsonrpc":"2.0","result":{}}]"#);
    assert_eq!(request(port, "POST", "/mcp/s3cret", "[]").status, 202);

    // DELETE ends the session: later replies carry a new id.
    assert_eq!(request(port, "POST", "/mcp/s3cret", ping).header("Mcp-Session-Id"), Some(session.as_str()));
    assert_eq!(request(port, "DELETE", "/mcp/s3cret", "").status, 200);
    assert_ne!(request(port, "POST", "/mcp/s3cret", ping).header("Mcp-Session-Id"), Some(session.as_str()));
}

#[test]
fn the_secret_is_random_and_compared_whole() {
    let (a, _) = start(None);
    let (b, _) = start(None);
    assert_eq!(a.token.len(), 24);
    assert!(a.token.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(a.token, b.token);
    assert!(a.local_url().starts_with("http://127.0.0.1:"));
    assert!(mcp_http::same_secret("/mcp/abc", "/mcp/abc"));
    assert!(!mcp_http::same_secret("/mcp/abc", "/mcp/abd"));
    assert!(!mcp_http::same_secret("/mcp/abc", "/mcp/abcd"));
}

#[test]
fn requests_are_read_whole() {
    assert!(mcp_http::parse(b"POST / HTTP/1.1\r\nContent-Length: 5\r\n").is_none());
    let (head, body, complete) = mcp_http::parse(b"POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\nab").unwrap();
    assert_eq!((head.as_str(), body.as_slice(), complete), ("POST / HTTP/1.1\r\nContent-Length: 5", &b"ab"[..], false));
    let (_, body, complete) = mcp_http::parse(b"POST / HTTP/1.1\r\nCONTENT-LENGTH:  5 \r\n\r\nabcdefg").unwrap();
    assert_eq!((body.as_slice(), complete), (&b"abcde"[..], true));
    let (_, body, complete) = mcp_http::parse(b"GET / HTTP/1.1\r\n\r\n").unwrap();
    assert_eq!((body.len(), complete), (0, true));
}
