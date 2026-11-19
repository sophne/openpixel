import Foundation
import OpenPixelCore

/// `OpenPixel --mcp`: forwards every tool call to the open window when there is one (so the person sees
/// the agent's work live), and otherwise runs it on an in-process model.
enum MCPMode {
    static func run(headless: Bool, httpPort: UInt16? = nil, httpToken: String? = nil) {
        // Keep stdout for protocol messages only.
        setvbuf(stdout, nil, _IOLBF, 0)
        let local = LocalBackend(engine: Engine(doc: Document(name: "Untitled")))
        var remote: RemoteBackend?
        var server: MCPServer!
        var transport = "stdio"
        // Every new link to the window starts by saying which agent this is, so the Agents page can show it.
        func connect() -> RemoteBackend? {
            guard !headless, let r = RemoteBackend() else { return nil }
            var info = server.clientInfo
            info["pid"] = Int(getpid()); info["transport"] = transport
            r.hello(info)
            return r.broken ? nil : r
        }
        // The link to the window is shared by tool calls and the watcher below, so it is guarded by a lock.
        let linkLock = NSLock()
        func liveRemote() -> RemoteBackend? { // hold linkLock
            if let r = remote, r.isAlive() { return r }
            remote = connect()
            return remote
        }
        server = MCPServer {
            if headless { return local }
            linkLock.lock(); defer { linkLock.unlock() }
            return liveRemote() ?? local
        }
        var watching = false
        server.onInitialize = { _ in
            guard !headless else { return }
            linkLock.lock(); _ = liveRemote(); linkLock.unlock()
            // Keep looking for the window, so the agent shows as connected as soon as the window opens (and again after
            // it restarts), not only after the agent's next tool call.
            if watching { return }
            watching = true
            Thread {
                while true {
                    Thread.sleep(forTimeInterval: 2)
                    linkLock.lock(); _ = liveRemote(); linkLock.unlock()
                }
            }.start()
        }
        if let port = httpPort {
            let http = MCPHTTPServer(server: server, port: port, token: httpToken)
            // A tunnel can make this reachable from anywhere: keep file access to OpenPixel's own folder.
            server.pathPolicy = { try MCPHTTPServer.confine($0) }
            do { try http.start() } catch {
                FileHandle.standardError.write("Could not listen on port \(port): \(error)\n".data(using: .utf8)!)
                exit(1)
            }
            // Agents reached over HTTP are told apart from stdio ones on the Agents page.
            transport = "http"
            print("""
            OpenPixel MCP server \(MCPServer.version) on this computer only:
              \(http.localURL)
            To use it from ChatGPT, expose port \(port) with a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:\(port)`)
            and add  https://<your-tunnel-address>\(http.path)  as a connector. Keep the address private: anyone with it can edit.
            Agents on this connection can only open and save files in \(MCPHTTPServer.filesFolder.path).
            """)
            dispatchMain()
        }
        FileHandle.standardError.write("OpenPixel MCP server \(MCPServer.version) ready (\(headless ? "headless" : "window when open, else headless")).\n".data(using: .utf8)!)
        server.runStdio()
    }
}
