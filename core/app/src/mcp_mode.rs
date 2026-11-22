//! `openpixel --mcp`: forwards every tool call to the open window when there is one (so the person sees
//! the agent's work live), and otherwise runs it on an in-process model. Port of MCPMode.swift.
use crate::bridge::{self, RemoteBackend};
use crate::mcp::{self, LocalBackend, McpServer, ToolBackend};
use crate::mcp_http::{self, McpHttpServer};
use openpixel_core::{Engine, Json, JsonMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The link to the window. It is shared by tool calls and the watcher, so it sits behind a lock.
struct Link {
    remote: Option<RemoteBackend>,
    client_info: JsonMap,
    transport: &'static str,
    watching: bool,
}

impl Link {
    /// Every new link to the window starts by saying which agent this is, so the Agents page can show it.
    fn connect(&self) -> Option<RemoteBackend> {
        let mut r = RemoteBackend::connect(&bridge::socket_path())?;
        let mut info = self.client_info.clone();
        info.insert("pid".into(), Json::from(std::process::id()));
        info.insert("transport".into(), Json::from(self.transport));
        r.hello(&info);
        if r.broken() { None } else { Some(r) }
    }

    fn live_remote(&mut self) -> Option<&mut RemoteBackend> {
        if !self.remote.as_mut().is_some_and(|r| r.is_alive()) {
            self.remote = self.connect();
        }
        self.remote.as_mut()
    }
}

pub fn run(headless: bool, http_port: Option<u16>, http_token: Option<String>) -> ! {
    let mut local = LocalBackend::new(Engine::new());
    let link = Arc::new(Mutex::new(Link {
        remote: None,
        client_info: JsonMap::new(),
        // Agents reached over HTTP are told apart from stdio ones on the Agents page.
        transport: if http_port.is_some() { "http" } else { "stdio" },
        watching: false,
    }));

    let call_link = Arc::clone(&link);
    let mut server = McpServer::new(move |tool, args| {
        if headless {
            return local.call(tool, args);
        }
        let mut link = call_link.lock().unwrap_or_else(|e| e.into_inner());
        match link.live_remote() {
            Some(remote) => remote.call(tool, args),
            None => local.call(tool, args),
        }
    });

    let init_link = Arc::clone(&link);
    server.on_initialize = Some(Box::new(move |info| {
        let mut l = init_link.lock().unwrap_or_else(|e| e.into_inner());
        l.client_info = info.clone();
        if headless {
            return;
        }
        l.live_remote();
        // Keep looking for the window, so the agent shows as connected as soon as the window opens (and again after
        // it restarts), not only after the agent's next tool call.
        if l.watching {
            return;
        }
        l.watching = true;
        let watch_link = Arc::clone(&init_link);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            watch_link.lock().unwrap_or_else(|e| e.into_inner()).live_remote();
        });
    }));

    if let Some(port) = http_port {
        // A tunnel can make this reachable from anywhere: keep file access to OpenPixel's own folder.
        server.path_policy = Some(Box::new(mcp_http::confine));
        let http = Arc::new(McpHttpServer::new(Arc::new(Mutex::new(server)), port, http_token));
        if let Err(e) = http.start() {
            eprintln!("Could not listen on port {port}: {e}");
            std::process::exit(1);
        }
        println!(
            "OpenPixel MCP server {v} on this computer only:\n  {url}\nTo use it from ChatGPT, expose port {port} with a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:{port}`)\nand add  https://<your-tunnel-address>{path}  as a connector. Keep the address private: anyone with it can edit.\nAgents on this connection can only open and save files in {folder}.",
            v = mcp::VERSION,
            url = http.local_url(),
            path = http.path(),
            folder = McpHttpServer::files_folder().display(),
        );
        loop {
            std::thread::park();
        }
    }
    eprintln!("OpenPixel MCP server {} ready ({}).", mcp::VERSION, if headless { "headless" } else { "window when open, else headless" });
    server.run_stdio();
    std::process::exit(0)
}
