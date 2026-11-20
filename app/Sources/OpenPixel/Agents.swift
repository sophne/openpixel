import Foundation

/// What the Agents page shows: live connections to this window (each `OpenPixel --mcp` process introduces
/// itself with the agent's name from the MCP handshake) and, per known agent app, whether it is installed
/// and whether its settings already mention OpenPixel. Settings files are only read, never changed.
final class AgentRegistry {
    struct Session {
        var id: Int
        var client = "unknown"
        var version = ""
        var transport = "stdio"
        var pid = 0
        var connected = Date()
        var lastCall: Date?
        var lastTool = ""
        var calls = 0
        var open = true
        var closed: Date?
    }

    private let lock = NSLock()
    private var sessions: [Int: Session] = [:]
    /// Last time each agent was seen, kept between launches.
    private var lastSeen: [String: Double] = [:]
    let store: URL

    init(folder: URL) {
        store = folder.appendingPathComponent("agents.json")
        if let d = try? Data(contentsOf: store), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Double] { lastSeen = o }
    }

    func opened(_ id: Int) { lock.lock(); sessions[id] = Session(id: id); lock.unlock() }

    func closed(_ id: Int) {
        lock.lock()
        sessions[id]?.open = false
        sessions[id]?.closed = Date()
        if let s = sessions[id] { seen(s.client) }
        // Keep the 20 most recent closed sessions.
        let old = sessions.values.filter { !$0.open }.sorted { ($0.closed ?? .distantPast) > ($1.closed ?? .distantPast) }.dropFirst(20)
        for s in old { sessions[s.id] = nil }
        lock.unlock()
    }

    func hello(_ id: Int, _ info: [String: Any]) {
        lock.lock()
        sessions[id]?.client = (info["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "unknown"
        sessions[id]?.version = info["version"] as? String ?? ""
        sessions[id]?.transport = info["transport"] as? String ?? "stdio"
        sessions[id]?.pid = info["pid"] as? Int ?? 0
        if let s = sessions[id] { seen(s.client) }
        lock.unlock()
    }

    func called(_ id: Int, _ tool: String) {
        lock.lock()
        sessions[id]?.calls += 1
        sessions[id]?.lastCall = Date()
        sessions[id]?.lastTool = tool
        if let s = sessions[id] { seen(s.client) }
        lock.unlock()
    }

    /// Must hold the lock.
    private func seen(_ client: String) {
        guard client != "unknown" else { return }
        lastSeen[AgentRegistry.agentID(for: client) ?? client] = Date().timeIntervalSince1970
        if let d = try? JSONSerialization.data(withJSONObject: lastSeen) { try? d.write(to: store, options: .atomic) }
    }

    /// Which known agent a client name belongs to.
    static func agentID(for client: String) -> String? {
        let c = client.lowercased()
        if c.contains("claude-code") || c.contains("claude code") { return "claude-code" }
        if c.contains("claude") { return "claude" }
        if c.contains("cursor") { return "cursor" }
        if c.contains("codex") { return "codex" }
        if c.contains("openclaw") || c.contains("mcporter") || c.contains("clawd") { return "openclaw" }
        if c.contains("hermes") { return "hermes" }
        if c.contains("cline") { return "cline" }
        if c.contains("windsurf") || c.contains("codeium") { return "windsurf" }
        if c.contains("gemini") { return "gemini-cli" }
        if c.contains("kiro") { return "kiro" }
        if c.contains("opencode") { return "opencode" }
        if c.contains("goose") { return "goose" }
        if c.contains("lm studio") || c.contains("lmstudio") { return "lm-studio" }
        if c.contains("visual studio code") || c.contains("vscode") || c.contains("copilot") { return "copilot" }
        if c.contains("openai") || c.contains("chatgpt") { return "chatgpt" }
        return nil
    }

    func snapshot(includeSetup: Bool = true) -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let list = sessions.values.sorted { $0.connected > $1.connected }.map { s -> [String: Any] in
            var o: [String: Any] = ["id": s.id, "client": s.client, "version": s.version, "transport": s.transport, "pid": s.pid,
                                    "agent": AgentRegistry.agentID(for: s.client) ?? NSNull(), "connected": s.connected.timeIntervalSince1970,
                                    "calls": s.calls, "last_tool": s.lastTool, "open": s.open]
            if let l = s.lastCall { o["last_call"] = l.timeIntervalSince1970 }
            if let c = s.closed { o["closed"] = c.timeIntervalSince1970 }
            return o
        }
        var out: [String: Any] = ["sessions": list, "last_seen": lastSeen]
        if includeSetup { out["setup"] = AgentRegistry.detectSetup() }
        return out
    }

    // MARK: - set-up detection (read-only)

    static let home = FileManager.default.homeDirectoryForCurrentUser

    /// Where each agent keeps its MCP settings, and how to tell it is installed.
    static let known: [(id: String, configs: [String], apps: [String], tools: [String], folders: [String])] = [
        ("chatgpt", [], ["ChatGPT.app"], [], []),
        ("codex", [".codex/config.toml"], ["Codex.app"], ["codex"], [".codex"]),
        ("claude", ["Library/Application Support/Claude/claude_desktop_config.json"], ["Claude.app"], [], []),
        ("claude-code", [".claude.json", ".claude/settings.json"], [], ["claude"], [".claude"]),
        ("cursor", [".cursor/mcp.json"], ["Cursor.app"], ["cursor"], [".cursor"]),
        ("openclaw", [".openclaw/openclaw.json", ".mcporter/mcporter.json", ".openclaw/mcp.json"], [], ["openclaw", "mcporter"], [".openclaw"]),
        ("hermes", [".hermes/config.yaml"], [], ["hermes"], [".hermes"]),
        ("copilot", ["Library/Application Support/Code/User/mcp.json", "Library/Application Support/Code/User/settings.json"],
         ["Visual Studio Code.app"], ["code"], []),
        ("windsurf", [".codeium/windsurf/mcp_config.json"], ["Windsurf.app"], ["windsurf"], [".codeium/windsurf"]),
        ("gemini-cli", [".gemini/settings.json"], [], ["gemini"], [".gemini"]),
        ("cline", ["Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"], [], [],
         ["Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev"]),
        ("kiro", [".kiro/settings/mcp.json"], ["Kiro.app"], ["kiro"], [".kiro"]),
        ("opencode", [".config/opencode/opencode.json", ".config/opencode/config.json"], [], ["opencode"], [".config/opencode"]),
        ("goose", [".config/goose/config.yaml"], ["Goose.app"], ["goose"], [".config/goose"]),
        ("lm-studio", [".lmstudio/mcp.json"], ["LM Studio.app"], [], [".lmstudio"]),
    ]

    static func detectSetup() -> [String: Any] {
        let fm = FileManager.default
        let binDirs = ["/opt/homebrew/bin", "/usr/local/bin", home.appendingPathComponent(".local/bin").path,
                       home.appendingPathComponent(".npm-global/bin").path, home.appendingPathComponent(".bun/bin").path,
                       home.appendingPathComponent(".claude/local").path, home.appendingPathComponent(".cargo/bin").path]
        var out: [String: Any] = [:]
        for a in known {
            let configPaths = a.configs.map { home.appendingPathComponent($0).path }
            var configured = false, configFile: String?
            for p in configPaths where fm.fileExists(atPath: p) {
                configFile = configFile ?? p
                // Large files are read in full only up to 8 MB.
                if let attrs = try? fm.attributesOfItem(atPath: p), let size = attrs[.size] as? Int, size > 8 << 20 { continue }
                if let text = try? String(contentsOfFile: p, encoding: .utf8), text.lowercased().contains("openpixel") {
                    configured = true; configFile = p; break
                }
            }
            let installed = a.apps.contains { fm.fileExists(atPath: "/Applications/\($0)") || fm.fileExists(atPath: home.appendingPathComponent("Applications/\($0)").path) }
                || a.tools.contains { t in binDirs.contains { fm.isExecutableFile(atPath: "\($0)/\(t)") } }
                || a.folders.contains { fm.fileExists(atPath: home.appendingPathComponent($0).path) }
            out[a.id] = ["installed": installed, "configured": configured,
                         "config_file": (configFile ?? configPaths.first).map { $0.replacingOccurrences(of: home.path, with: "~") } ?? NSNull(),
                         "config_exists": configFile != nil]
        }
        return out
    }
}
