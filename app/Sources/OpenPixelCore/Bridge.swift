import Foundation
import Darwin

/// Local link between `OpenPixel --mcp` and the open OpenPixel window: a Unix domain socket in the
/// user's Application Support folder (owner-only permissions, no network port). One JSON request per line:
/// {"tool": name, "args": {...}} → {"ok": true, "json": {...}, "images": [base64 PNG]} or {"ok": false, "error": ".."}.
public enum Bridge {
    public static var socketPath: String {
        if let p = ProcessInfo.processInfo.environment["OPENPIXEL_SOCKET"], !p.isEmpty { return p }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OpenPixel", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        return dir.appendingPathComponent("openpixel.sock").path
    }

    static func address(_ path: String) -> sockaddr_un? {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { return nil }
        withUnsafeMutableBytes(of: &addr.sun_path) { buf in
            for (i, b) in bytes.enumerated() { buf[i] = b }
            buf[bytes.count] = 0
        }
        return addr
    }

    static func readLine(_ fd: Int32, _ pending: inout [UInt8]) -> String? {
        var chunk = [UInt8](repeating: 0, count: 65536)
        while true {
            if let nl = pending.firstIndex(of: 10) {
                let line = String(decoding: pending[0..<nl], as: UTF8.self)
                pending.removeSubrange(0...nl)
                return line
            }
            let n = Darwin.read(fd, &chunk, chunk.count)
            if n <= 0 { return nil }
            pending.append(contentsOf: chunk[0..<n])
        }
    }

    static func writeAll(_ fd: Int32, _ s: String) -> Bool {
        let bytes = Array((s + "\n").utf8)
        let total = bytes.count
        var off = 0
        while off < total {
            let n = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress! + off, total - off) }
            if n <= 0 { return false }
            off += n
        }
        return true
    }

    static func encode(_ obj: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: obj)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }

    public static func response(for line: String, run: (String, [String: Any]) throws -> ToolOutput) -> String {
        guard let d = line.data(using: .utf8), let req = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let tool = req["tool"] as? String else { return encode(["ok": false, "error": "bad request"]) }
        do {
            let out = try run(tool, req["args"] as? [String: Any] ?? [:])
            return encode(["ok": true, "json": out.json, "images": out.images.map { $0.base64EncodedString() }])
        } catch {
            return encode(["ok": false, "error": "\(error)"])
        }
    }
}

/// Listens on the socket inside the app. `handler` is called on a background thread.
public final class BridgeServer {
    let path: String
    var fd: Int32 = -1
    /// (request line, connection id) -> response line.
    let handler: (String, Int) -> String
    /// Called on a background thread when an agent's connection opens or closes.
    public var onOpen: ((Int) -> Void)?
    public var onClose: ((Int) -> Void)?
    var nextID = 0

    public init(path: String = Bridge.socketPath, handler: @escaping (String, Int) -> String) {
        self.path = path; self.handler = handler
    }

    public func start() throws {
        unlink(path)
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0, var addr = Bridge.address(path) else { throw PCError.invalid("cannot create socket") }
        let ok = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard ok == 0 else { throw PCError.invalid("cannot bind \(path)") }
        chmod(path, 0o600)
        listen(fd, 8)
        let t = Thread { [weak self] in self?.acceptLoop() }
        t.name = "OpenPixel bridge"
        t.start()
    }

    func acceptLoop() {
        while fd >= 0 {
            let client = accept(fd, nil, nil)
            if client < 0 { if fd < 0 { return } else { continue } }
            nextID += 1
            let id = nextID
            onOpen?(id)
            let t = Thread { [handler, weak self] in
                var pending: [UInt8] = []
                while let line = Bridge.readLine(client, &pending) {
                    if !Bridge.writeAll(client, handler(line, id)) { break }
                }
                close(client)
                self?.onClose?(id)
            }
            t.start()
        }
    }

    public func stop() {
        if fd >= 0 { close(fd); fd = -1 }
        unlink(path)
    }
}

/// Talks to the open window from the MCP process.
public final class RemoteBackend: ToolBackend {
    let fd: Int32
    var pending: [UInt8] = []

    public init?(path: String = Bridge.socketPath) {
        let s = socket(AF_UNIX, SOCK_STREAM, 0)
        guard s >= 0, var addr = Bridge.address(path) else { return nil }
        let ok = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(s, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        if ok != 0 { close(s); return nil }
        var one: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        fd = s
    }

    deinit { close(fd) }

    public var label: String { "window" }

    /// Tells the window which agent is on this connection (from the MCP initialize handshake).
    public func hello(_ info: [String: Any]) {
        guard Bridge.writeAll(fd, Bridge.encode(["hello": info])), Bridge.readLine(fd, &pending) != nil else { broken = true; return }
    }
    public private(set) var broken = false

    /// False once the window has closed its end (it quit or restarted). Doesn't read anything: it only peeks.
    public func isAlive() -> Bool {
        if broken { return false }
        var byte: UInt8 = 0
        let n = recv(fd, &byte, 1, MSG_PEEK | MSG_DONTWAIT)
        if n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK) { broken = true; return false }
        return true
    }

    public func call(_ tool: String, _ args: [String: Any]) throws -> ToolOutput {
        guard Bridge.writeAll(fd, Bridge.encode(["tool": tool, "args": args])), let line = Bridge.readLine(fd, &pending),
              let d = line.data(using: .utf8), let res = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            broken = true
            throw PCError.invalid("lost the connection to the OpenPixel window")
        }
        if res["ok"] as? Bool == true {
            let imgs = (res["images"] as? [String] ?? []).compactMap { Data(base64Encoded: $0) }
            return ToolOutput(res["json"] as? [String: Any] ?? [:], images: imgs)
        }
        throw PCError.invalid(res["error"] as? String ?? "failed")
    }
}
