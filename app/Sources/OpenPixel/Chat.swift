import Foundation
import CryptoKit

/// The editor's Chat panel. It talks to the agents the person already uses, on their own subscriptions: each message
/// runs the agent's command-line tool headless (Claude Code, Codex, Cursor's agent, Gemini CLI) with OpenPixel's MCP
/// server attached, reads its JSON event stream, and passes the page one simple stream of events:
///   session (the agent's conversation id, used to continue it), text and think (deltas), tool (a call started),
///   tool_input (its arguments), tool_done (its result), error, done.
/// Nothing here holds API keys: each tool signs in the way it always does.
final class ChatRunner {
    struct Model {
        let id: String
        let label: String
        /// The model's own effort levels, when they differ from the agent's (Codex lists them per model).
        var efforts: [String]? = nil
        var defaultEffort: String? = nil
    }
    struct Provider {
        let id: String            // matches the Agents page's ids (logos, set-up state)
        let name: String
        let plan: String          // whose subscription it uses
        let binaries: [String]
        /// Where the tool lives when it ships inside an app instead of on the PATH (from the home folder when relative).
        var bundled: [String] = []
        let models: [Model]
        let efforts: [String]     // empty: the tool has no effort setting
        let defaultEffort: String
        /// OpenPixel can be attached on the command line; the others need it in their own MCP settings.
        let injectsMCP: Bool
        /// The agent can continue its own session by id; otherwise each message carries a transcript instead.
        var resumes: Bool = true
    }

    static let providers: [Provider] = baseProviders + moreProviders
    static let baseProviders: [Provider] = [
        // Claude: the Claude Code command-line tool, or the copy the Claude desktop app keeps (see claudeAppBinary).
        Provider(id: "claude-code", name: "Claude", plan: "Claude subscription", binaries: ["claude"],
                 models: [Model(id: "opus", label: "Opus 5.5"), Model(id: "sonnet", label: "Sonnet 5.5"),
                          Model(id: "fable", label: "Fable 5.2"), Model(id: "haiku", label: "Haiku 5.5")],
                 efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium", injectsMCP: true),
        // Codex ships inside the ChatGPT app (and the older Codex app); its models come from its own cache (see codexModels).
        Provider(id: "codex", name: "Codex", plan: "ChatGPT subscription", binaries: ["codex"],
                 bundled: ["/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", "Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
                           "/Applications/Codex.app/Contents/Resources/codex", "Applications/Codex.app/Contents/Resources/codex"],
                 models: [Model(id: "", label: "Default model")],
                 efforts: ["low", "medium", "high"], defaultEffort: "medium", injectsMCP: true),
        // Cursor's agent runs in the chat's own folder, whose .cursor/mcp.json adds OpenPixel and whose .cursor/cli.json
        // allows only OpenPixel's tools (see prepareCursorFolder): it needs nothing in the person's own settings.
        Provider(id: "cursor", name: "Cursor", plan: "Cursor plan", binaries: ["cursor-agent", "agent"],
                 models: [Model(id: "", label: "Auto")], efforts: [], defaultEffort: "", injectsMCP: true),
        // Gemini CLI reads OpenPixel from the chat folder's .gemini/settings.json (the folder is trusted for the run) and
        // --allowed-mcp-server-names approves only OpenPixel's tools (see prepareGeminiFolder).
        Provider(id: "gemini-cli", name: "Gemini CLI", plan: "Google account", binaries: ["gemini"],
                 models: [Model(id: "", label: "Default model")], efforts: [], defaultEffort: "", injectsMCP: true),
    ]

    /// Sends one event object to the page (on the main thread).
    let emit: ([String: Any]) -> Void
    let mcpCommand: String
    let workDir: URL
    private var runs: [String: Run] = [:]
    private var searchPath: String?
    var cursorModels: [Model]?
    var cursorDefault = ""
    /// Cursor's newer builds want --trust to work in a folder without asking; older ones don't know the flag.
    lazy var cursorTrustFlag: Bool = {
        guard let p = Self.providers.first(where: { $0.id == "cursor" }), let exe = find(p) else { return false }
        return Self.capture(exe, ["--help"], env: env, timeout: 6)?.contains("--trust") ?? false
    }()
    private let lock = NSLock()

    init(mcpCommand: String, workDir: URL, background: Bool = true, emit: @escaping ([String: Any]) -> Void) {
        self.mcpCommand = mcpCommand
        self.workDir = workDir
        self.emit = emit
        try? FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
        // Apps opened from the Finder don't get the shell's PATH, where these tools usually live. Ask a login shell once.
        if background { DispatchQueue.global(qos: .utility).async { [weak self] in _ = self?.path(); self?.pruneHistory() } }
    }

    // MARK: - finding the tools

    private func path() -> String {
        lock.lock(); if let p = searchPath { lock.unlock(); return p }; lock.unlock()
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var dirs = ["\(home)/.local/bin", "\(home)/.claude/local", "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.npm-global/bin",
                    "\(home)/.bun/bin", "\(home)/.cargo/bin", "\(home)/.volta/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
        if let out = Self.capture(shell, ["-lc", "printf %s \"$PATH\""], timeout: 4) {
            dirs = out.split(separator: ":").map(String.init).filter { !$0.isEmpty } + dirs
        }
        var seen = Set<String>()
        let joined = dirs.filter { seen.insert($0).inserted }.joined(separator: ":")
        lock.lock(); searchPath = joined; lock.unlock()
        return joined
    }

    func find(_ p: Provider) -> String? {
        if let exe = find(p.binaries) { return exe }
        if p.id == "claude-code", let exe = Self.claudeAppBinary() { return exe }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return p.bundled.map { $0.hasPrefix("/") ? $0 : "\(home)/\($0)" }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// The Claude desktop app runs Claude Code from its own copy:
    /// ~/Library/Application Support/Claude/claude-code/<version>/<build>/claude.app/Contents/MacOS/claude (newest version wins).
    static func claudeAppBinary() -> String? {
        let fm = FileManager.default
        let root = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Claude/claude-code").path
        let versions = ((try? fm.contentsOfDirectory(atPath: root)) ?? []).filter { $0.first?.isNumber == true }
            .sorted { $0.compare($1, options: .numeric) == .orderedDescending }
        for v in versions {
            for build in (try? fm.contentsOfDirectory(atPath: "\(root)/\(v)")) ?? [] {
                let exe = "\(root)/\(v)/\(build)/claude.app/Contents/MacOS/claude"
                if fm.isExecutableFile(atPath: exe) { return exe }
            }
            if fm.isExecutableFile(atPath: "\(root)/\(v)/claude") { return "\(root)/\(v)/claude" }
        }
        return nil
    }

    private func find(_ names: [String]) -> String? {
        let fm = FileManager.default
        for dir in path().split(separator: ":") {
            for n in names where fm.isExecutableFile(atPath: "\(dir)/\(n)") { return "\(dir)/\(n)" }
        }
        return nil
    }

    /// Runs a short command and returns what it printed (nil when it fails or takes too long).
    static func capture(_ exe: String, _ args: [String], env: [String: String]? = nil, timeout: TimeInterval) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        if let env { p.environment = env }
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let timer = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        timer.cancel()
        return p.terminationStatus == 0 ? String(decoding: data, as: UTF8.self) : nil
    }

    var env: [String: String] {
        var e = ProcessInfo.processInfo.environment
        e["PATH"] = path()
        e["NO_COLOR"] = "1"
        e["TERM"] = "dumb"
        e["FORCE_COLOR"] = "0"
        return e
    }

    /// Cursor lists the models the person's plan offers.
    /// Whether Cursor's command-line agent is signed in (it keeps its own login, apart from the Cursor editor).
    private func cursorSignedIn(_ exe: String) -> Bool {
        guard let out = Self.capture(exe, ["about"], env: env, timeout: 8) else { return false }
        let clean = out.replacingOccurrences(of: "\u{1B}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression)
        guard let line = clean.split(whereSeparator: \.isNewline).first(where: { $0.contains("User Email") }) else { return false }
        return !line.localizedCaseInsensitiveContains("not logged in")
    }

    private func listCursorModels(_ exe: String) -> [Model] {
        if let m = cursorModels, m.count > 1 { return m }
        var models = [Model(id: "", label: "Auto")]
        if let out = Self.capture(exe, ["models"], env: env, timeout: 8) {
            let clean = out.replacingOccurrences(of: "\u{1B}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression)
            for line in clean.split(whereSeparator: \.isNewline) {
                let s = line.trimmingCharacters(in: .whitespaces)
                // "<id> - <name>" or "<id> - <name>  (current, default)"; headings and the "Tip:" line have no " - ".
                guard s.range(of: #"^[A-Za-z0-9][\w.\-]* - \S"#, options: .regularExpression) != nil else { continue }
                let parts = s.components(separatedBy: " - ")
                let id = parts[0].trimmingCharacters(in: .whitespaces)
                if id.lowercased() == "auto" { continue }
                let rest = parts.dropFirst().joined(separator: " - ")
                let label = rest.replacingOccurrences(of: #"\s*\([^)]*\)\s*$"#, with: "", options: .regularExpression)
                if rest.contains("default)") || rest.contains("(default") { cursorDefault = id }
                if !models.contains(where: { $0.id == id }) { models.append(Model(id: id, label: label)) }
            }
        }
        cursorModels = models
        return models
    }

    /// The models the person's ChatGPT plan offers in Codex, as Codex itself last fetched them
    /// (~/.codex/models_cache.json: the ones it shows in its own picker, in its order, each with its effort levels),
    /// and the model their Codex settings choose.
    static func codexModels() -> ([Model], String) {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex")
        var models: [Model] = []
        if let d = try? Data(contentsOf: dir.appendingPathComponent("models_cache.json")),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let list = o["models"] as? [[String: Any]] {
            let shown = list.filter { ($0["visibility"] as? String ?? "list") != "hide" }
                .sorted { ($0["priority"] as? Int ?? 999) < ($1["priority"] as? Int ?? 999) }
            for m in shown {
                guard let slug = m["slug"] as? String, !slug.isEmpty else { continue }
                let efforts = (m["supported_reasoning_levels"] as? [[String: Any]] ?? []).compactMap { $0["effort"] as? String }
                models.append(Model(id: slug, label: m["display_name"] as? String ?? slug,
                                    efforts: efforts.isEmpty ? nil : efforts, defaultEffort: m["default_reasoning_level"] as? String))
            }
        }
        var chosen = ""
        if let toml = try? String(contentsOf: dir.appendingPathComponent("config.toml"), encoding: .utf8) {
            // Only the top-level `model = "…"` (before the first [table]).
            for line in toml.split(whereSeparator: \.isNewline) {
                let t = line.trimmingCharacters(in: .whitespaces)
                if t.hasPrefix("[") { break }
                if let r = t.range(of: #"^model\s*=\s*"([^"]+)""#, options: .regularExpression) {
                    chosen = String(t[r]).components(separatedBy: "\"")[1]
                }
            }
        }
        if models.isEmpty { models = [Model(id: "", label: "Default model")] }
        return (models, chosen)
    }

    /// What the model menu offers: every known agent, whether its tool is on this Mac, and whether it can reach
    /// OpenPixel (attached by us, or already in its own MCP settings).
    func providersForPage() -> [[String: Any]] {
        let setup = AgentRegistry.detectSetup()
        return Self.providers.map { p in
            let exe = find(p)
            let more = Self.moreProviders.contains { $0.id == p.id }
            let configured = more ? (exe != nil && moreProviderConfigured(p.id)) : ((setup[p.id] as? [String: Any])?["configured"] as? Bool) ?? false
            var models = p.models, defaultModel = ""
            // Cursor's agent has its own sign-in: connected but signed out, it offers to sign in instead of models.
            let signedIn: Bool
            switch p.id {
            case "cursor": signedIn = exe != nil && cursorSignedIn(exe!)
            case "gemini-cli": signedIn = Self.geminiSignedIn()
            case "copilot": signedIn = Self.copilotSignedIn()
            default: signedIn = true
            }
            if exe != nil && p.id == "cursor" && signedIn { models = listCursorModels(exe!); defaultModel = cursorDefault }
            if exe != nil && p.id == "codex" { (models, defaultModel) = Self.codexModels() }
            if exe != nil && p.id == "gemini-cli" && signedIn { models = geminiModels(exe!) }
            if exe != nil && more { models = moreModels(p.id, exe!) }
            return ["id": p.id, "name": p.name, "plan": p.plan, "installed": exe != nil,
                    "ready": exe != nil && (more ? configured : (p.injectsMCP || configured)) && signedIn,
                    "needs_setup": exe != nil && (more ? !configured : (!p.injectsMCP && !configured)),
                    // Only agents whose sign-in can start from here (Cursor, Copilot open the browser) offer it.
                    "needs_login": exe != nil && (p.injectsMCP || configured) && !signedIn && ["cursor", "copilot"].contains(p.id),
                    "models": models.map { m -> [String: Any] in
                        var o: [String: Any] = ["id": m.id, "label": m.label]
                        if let e = m.efforts { o["efforts"] = e }
                        if let d = m.defaultEffort { o["default_effort"] = d }
                        return o
                    },
                    "default_model": defaultModel,
                    "efforts": p.efforts, "default_effort": p.defaultEffort]
        }
    }

    // MARK: - history (each file's chats, kept next to the app's other data)

    /// One JSON file per document, named after a hash of its path, so chats survive restarts and follow the file.
    private func historyURL(_ key: String) -> URL {
        let h = SHA256.hash(data: Data(key.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
        return workDir.appendingPathComponent("History", isDirectory: true).appendingPathComponent("\(h).json")
    }

    func loadHistory(_ key: String) -> Any {
        guard !key.isEmpty, let d = try? Data(contentsOf: historyURL(key)), let o = try? JSONSerialization.jsonObject(with: d) else { return NSNull() }
        return o
    }

    func saveHistory(_ key: String, _ data: Any?) -> Bool {
        guard !key.isEmpty, var data = data as? [String: Any] else { return false }
        data["key"] = key // which file it belongs to, so chats of files that are gone can be cleared
        guard JSONSerialization.isValidJSONObject(data), let d = try? JSONSerialization.data(withJSONObject: data) else { return false }
        let u = historyURL(key)
        try? FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        return (try? d.write(to: u, options: .atomic)) != nil
    }

    /// A file deleted from OpenPixel takes its chats with it.
    func deleteHistory(_ key: String) {
        guard !key.isEmpty else { return }
        try? FileManager.default.removeItem(at: historyURL(key))
    }

    /// A renamed file keeps its chats.
    func moveHistory(from old: String, to new: String) {
        let a = historyURL(old), b = historyURL(new)
        guard old != new, FileManager.default.fileExists(atPath: a.path) else { return }
        try? FileManager.default.removeItem(at: b)
        try? FileManager.default.moveItem(at: a, to: b)
        if let d = try? Data(contentsOf: b), var o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            o["key"] = new
            if let out = try? JSONSerialization.data(withJSONObject: o) { try? out.write(to: b, options: .atomic) }
        }
    }

    /// At launch: clears the chats of files that no longer exist (deleted or moved away in the Finder) and of
    /// never-saved files. A file whose folder is missing too (a disconnected drive) keeps its chats.
    func pruneHistory() {
        let fm = FileManager.default
        let dir = workDir.appendingPathComponent("History", isDirectory: true)
        for u in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where u.pathExtension == "json" {
            guard let d = try? Data(contentsOf: u), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let key = o["key"] as? String else { continue }
            if key.hasPrefix("untitled:") { try? fm.removeItem(at: u); continue }
            let file = URL(fileURLWithPath: key)
            if !fm.fileExists(atPath: file.path), fm.fileExists(atPath: file.deletingLastPathComponent().path) { try? fm.removeItem(at: u) }
        }
    }

    // MARK: - running a message

    final class Run {
        let id: String
        let provider: String
        let process = Process()
        var buffer = Data()
        var stderr = Data()
        var finished = false
        var gotResult = false
        var stopped = false
        var segment = ""                 // the reply text of the current block (Cursor repeats it at the end)
        var tools: [String: String] = [:] // id -> name
        var session: String?             // the agent's session, once it said
        var sentText = false             // some reply text arrived (Kiro: else its final text is used)
        var reportedError = false        // an error was already shown (no second one from stderr)
        var input: FileHandle?           // ACP agents (Hermes) talk over stdin
        var prompt = ""
        init(id: String, provider: String) { self.id = id; self.provider = provider }
    }

    func start(_ body: [String: Any]) -> Any {
        let chat = body["chat"] as? String ?? UUID().uuidString
        let pid = body["provider"] as? String ?? ""
        guard let p = Self.providers.first(where: { $0.id == pid }) else { return "Unknown agent" }
        guard let exe = find(p) else { return "\(p.name) isn't installed on this Mac." }
        let typed = body["prompt"] as? String ?? ""
        let model = body["model"] as? String ?? ""
        let effort = body["effort"] as? String ?? ""
        let resume = (body["resume"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let system = body["system"] as? String ?? ""
        var prompt = typed
        if let skill = body["skill"] as? String, !skill.isEmpty {
            // Claude runs "/skill" itself, unless a transcript from another agent has to come first.
            guard let p2 = promptWithSkill(p.id, name: skill, prompt: prompt, native: !(body["transcript"] as? Bool ?? false)) else {
                return "\(p.name) has no skill called “\(skill)”."
            }
            prompt = p2
        }
        stop(chat)

        let run = Run(id: chat, provider: p.id)
        let proc = run.process
        proc.executableURL = URL(fileURLWithPath: exe)
        let more = Self.moreProviders.contains { $0.id == p.id }
        proc.arguments = more ? moreArguments(p, prompt: prompt, model: model, effort: effort, resume: p.resumes ? resume : nil, system: system, chat: chat)
            : arguments(p, prompt: prompt, model: model, effort: effort, resume: resume, system: system)
        proc.currentDirectoryURL = workDir
        // Gemini: trust the chat folder (so its settings load) and never open a browser mid-run (a signed-out run would
        // otherwise print a consent question into the JSON stream).
        let geminiEnv = p.id == "gemini-cli" ? ["GEMINI_CLI_TRUST_WORKSPACE": "true", "NO_BROWSER": "true"] : [:]
        proc.environment = env.merging(more ? moreEnvironment(p) : geminiEnv) { $1 }
        if p.id == "hermes" {
            // ACP: requests go in over stdin; the prompt is sent once the session exists.
            let input = Pipe()
            proc.standardInput = input
            run.input = input.fileHandleForWriting
            run.prompt = system.isEmpty ? prompt : "\(system)\n\n\(prompt)"
        } else {
            proc.standardInput = FileHandle.nullDevice
        }
        let out = Pipe(), err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        out.fileHandleForReading.readabilityHandler = { [weak self, weak run] h in
            let d = h.availableData
            guard let self, let run else { return }
            if d.isEmpty { h.readabilityHandler = nil; return }
            self.consume(run, d)
        }
        err.fileHandleForReading.readabilityHandler = { [weak run] h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; return }
            if let run, run.stderr.count < 64_000 { run.stderr.append(d) }
        }
        proc.terminationHandler = { [weak self, weak run] p in
            guard let self, let run else { return }
            // Let the last bytes of output arrive before closing the run.
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.15) {
                let rest = out.fileHandleForReading.readDataToEndOfFile()
                if !rest.isEmpty { self.consume(run, rest) }
                if !run.buffer.isEmpty { self.line(run, run.buffer); run.buffer.removeAll() }
                self.finish(run, status: p.terminationStatus)
            }
        }
        do { try proc.run() } catch { return "Couldn't start \(p.name): \(error.localizedDescription)" }
        lock.lock(); runs[chat] = run; lock.unlock()
        if p.id == "hermes" { acpBegin(run) }
        return true
    }

    /// Starts an agent's own sign-in (Cursor's opens the browser). The page hears when it ends and looks again.
    func login(_ provider: String) -> Any {
        guard ["cursor", "copilot"].contains(provider), let p = Self.providers.first(where: { $0.id == provider }), let exe = find(p) else { return "Nothing to sign in to." }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: exe)
        proc.arguments = ["login"]
        var e = env; e.removeValue(forKey: "NO_OPEN_BROWSER")
        proc.environment = e
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        proc.terminationHandler = { [weak self] _ in
            self?.cursorModels = nil
            DispatchQueue.main.async { self?.emit(["t": "providers"]) }
        }
        do { try proc.run() } catch { return "Couldn't start \(p.name)'s sign-in: \(error.localizedDescription)" }
        return true
    }

    func stop(_ chat: String) {
        lock.lock(); let run = runs[chat]; lock.unlock()
        guard let run, run.process.isRunning else { return }
        run.stopped = true
        run.process.interrupt()
        DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { if run.process.isRunning { run.process.terminate() } }
    }

    func stopAll() {
        lock.lock(); let all = Array(runs.values); lock.unlock()
        for r in all where r.process.isRunning { r.process.terminate() }
    }

    /// The chat's folder as a Gemini workspace with OpenPixel's server (trusted through GEMINI_CLI_TRUST_WORKSPACE).
    func prepareGeminiFolder() {
        let dir = workDir.appendingPathComponent(".gemini", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let o: [String: Any] = ["mcpServers": ["openpixel": ["command": mcpCommand, "args": ["--mcp"]]]]
        if let d = try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .withoutEscapingSlashes]) {
            try? d.write(to: dir.appendingPathComponent("settings.json"), options: .atomic)
        }
    }

    /// The chat's folder as a Cursor project: OpenPixel's server, and permission for its tools only.
    func prepareCursorFolder() {
        let dir = workDir.appendingPathComponent(".cursor", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let mcp: [String: Any] = ["mcpServers": ["openpixel": ["command": mcpCommand, "args": ["--mcp"]]]]
        let cli: [String: Any] = ["permissions": ["allow": ["Mcp(openpixel:*)"], "deny": []]]
        for (name, o) in [("mcp.json", mcp), ("cli.json", cli)] {
            if let d = try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .withoutEscapingSlashes]) {
                try? d.write(to: dir.appendingPathComponent(name), options: .atomic)
            }
        }
    }

    private func arguments(_ p: Provider, prompt: String, model: String, effort: String, resume: String?, system: String) -> [String] {
        let mcpJSON = (try? JSONSerialization.data(withJSONObject: ["mcpServers": ["openpixel": ["command": mcpCommand, "args": ["--mcp"]]]]))
            .map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        switch p.id {
        case "claude-code":
            // OpenPixel's tools, plus Skill and Read so Claude can use the person's skills (and read their files):
            // no shell, no file edits, no other MCP servers; nothing waits for a permission prompt.
            var a = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                     "--mcp-config", mcpJSON, "--strict-mcp-config", "--tools", "Skill", "Read",
                     "--allowedTools", "mcp__openpixel", "Skill", "Read", "--permission-prompts", "none"]
            if !model.isEmpty { a += ["--model", model] }
            if p.efforts.contains(effort) { a += ["--effort", effort] }
            if !system.isEmpty { a += ["--append-system-prompt", system] }
            if let r = resume { a += ["--resume", r] }
            return a
        case "codex":
            // `codex exec resume` takes its own flags and has no --sandbox, so the sandbox goes in as a setting.
            // mcp_servers is replaced as a whole: only OpenPixel, none of the person's other servers (like Claude's
            // --strict-mcp-config). Values are TOML, so the path is written as a TOML string.
            var a = ["exec"] + (resume.map { ["resume", $0] } ?? []) + ["--json", "--skip-git-repo-check",
                     "-c", "sandbox_mode=\"read-only\"", "-c", "approval_policy=\"never\"",
                     "-c", "mcp_servers={openpixel={command=\(Self.tomlString(mcpCommand)),args=[\"--mcp\"]}}"]
            if !model.isEmpty { a += ["-m", model] }
            // Each Codex model has its own levels (up to ultra), so any plain level name the menu offered goes through.
            if effort.range(of: #"^[a-z]+$"#, options: .regularExpression) != nil { a += ["-c", "model_reasoning_effort=\"\(effort)\""] }
            let text = resume == nil && !system.isEmpty ? "\(system)\n\n\(prompt)" : prompt
            a.append(text)
            return a
        case "cursor":
            prepareCursorFolder()
            // --approve-mcps loads the folder's OpenPixel server; its cli.json allows OpenPixel's tools (and nothing else).
            var a = ["-p", "--output-format", "stream-json", "--stream-partial-output", "--approve-mcps"]
            if cursorTrustFlag { a.append("--trust") }
            if !model.isEmpty { a += ["--model", model] }
            if let r = resume { a += ["--resume", r] }
            a.append(resume == nil && !system.isEmpty ? "\(system)\n\n\(prompt)" : prompt)
            return a
        default: // gemini-cli
            prepareGeminiFolder()
            // Headless Gemini denies anything not allowed (shell, writes); this allows OpenPixel's server only.
            var a = ["-p", resume == nil && !system.isEmpty ? "\(system)\n\n\(prompt)" : prompt, "--output-format", "stream-json",
                     "--allowed-mcp-server-names", "openpixel"]
            if !model.isEmpty { a += ["-m", model] }
            if let r = resume { a += ["--resume", r] }
            return a
        }
    }

    // MARK: - reading the event stream

    private func consume(_ run: Run, _ data: Data) {
        lock.lock()
        run.buffer.append(data)
        var lines: [Data] = []
        while let nl = run.buffer.firstIndex(of: 0x0A) {
            lines.append(run.buffer.subdata(in: run.buffer.startIndex..<nl))
            run.buffer.removeSubrange(run.buffer.startIndex...nl)
        }
        lock.unlock()
        for l in lines { line(run, l) }
    }

    /// Self-tests read events back at once instead of on the main thread.
    var synchronousEvents = false

    func send(_ run: Run, _ e: [String: Any]) {
        // Agents that can't continue a session by id don't report one: the next message brings a transcript instead.
        if e["t"] as? String == "session", Self.providers.first(where: { $0.id == run.provider })?.resumes == false { return }
        if e["t"] as? String == "error" { run.reportedError = true }
        var e = e
        e["chat"] = run.id
        if synchronousEvents { emit(e) } else { DispatchQueue.main.async { self.emit(e) } }
    }

    /// For the self-test: what the page would hear for these lines of an agent's output.
    static func replay(_ provider: String, _ lines: [String], exitStatus: Int32 = 0, stderr: String = "") -> [[String: Any]] {
        var out: [[String: Any]] = []
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("openpixel-chat-replay-\(getpid())")
        let r = ChatRunner(mcpCommand: "/bin/true", workDir: dir, background: false) { out.append($0) }
        r.synchronousEvents = true
        let run = Run(id: "t", provider: provider)
        for l in lines { r.line(run, Data(l.utf8)) }
        run.stderr = Data(stderr.utf8)
        r.finish(run, status: exitStatus)
        return out
    }

    /// Cursor's results: MCP content items are {"text": {"text": …}}; other cases carry error / reason / content fields.
    static func cursorText(_ v: Any?) -> String {
        guard let o = v as? [String: Any] else { return text(of: v) }
        if let items = o["content"] as? [[String: Any]] {
            return items.compactMap { ($0["text"] as? [String: Any])?["text"] as? String ?? ($0["text"] as? String) ?? ($0["image"] != nil ? "[image]" : nil) }.joined(separator: "\n")
        }
        for k in ["error", "reason", "content", "stderr", "stdout"] { if let s = o[k] as? String, !s.isEmpty { return s } }
        return text(of: o)
    }

    /// JSON null arrives as NSNull, which is not nil: these treat it as missing.
    static func set(_ v: Any?) -> Bool { v != nil && !(v is NSNull) }
    static func first(_ vs: Any?...) -> Any? { vs.first { set($0) } ?? nil }

    /// A TOML basic string (JSON's encoder would write "/" as "\/", which TOML rejects).
    static func tomlString(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\t": out += "\\t"
            case "\r": out += "\\r"
            default: out += u.value < 0x20 || u.value == 0x7F ? String(format: "\\u%04X", u.value) : String(u)
            }
        }
        return out + "\""
    }

    static func short(_ s: String, _ n: Int = 4000) -> String { s.count > n ? String(s.prefix(n)) + "…" : s }
    static func toolName(_ s: String) -> String {
        // How each agent names OpenPixel's tools: Claude mcp__openpixel__x, Goose openpixel__x, opencode openpixel_x,
        // Cursor openpixel-x, Kiro @openpixel/x.
        for prefix in ["mcp__openpixel__", "mcp_openpixel_", "openpixel__", "@openpixel/", "openpixel/", "openpixel.", "openpixel_", "openpixel-"] where s.hasPrefix(prefix) {
            return String(s.dropFirst(prefix.count))
        }
        return s
    }
    static func text(of content: Any?) -> String {
        if let s = content as? String { return s }
        if let o = content as? [String: Any], let inner = o["content"] { return text(of: inner) } // MCP results: {content: [...]}
        if let arr = content as? [[String: Any]] { return arr.compactMap { $0["text"] as? String ?? ($0["type"] as? String == "image" ? "[image]" : nil) }.joined(separator: "\n") }
        if let o = content, JSONSerialization.isValidJSONObject(o), let d = try? JSONSerialization.data(withJSONObject: o) { return String(decoding: d, as: UTF8.self) }
        return ""
    }

    func line(_ run: Run, _ data: Data) {
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        switch run.provider {
        case "claude-code": claude(run, o)
        case "codex": codex(run, o)
        case "cursor": cursor(run, o)
        case "copilot", "opencode", "kiro", "goose", "cline", "hermes": moreLine(run, o)
        default: gemini(run, o)
        }
    }

    private func claude(_ run: Run, _ o: [String: Any]) {
        switch o["type"] as? String {
        case "system":
            if o["subtype"] as? String == "init" {
                rememberClaudeInit(o) // what Claude loaded: which skills the "/" menu offers
                if let s = o["session_id"] as? String { send(run, ["t": "session", "session": s, "model": o["model"] ?? ""]) }
            }
        case "stream_event":
            guard let e = o["event"] as? [String: Any] else { return }
            if e["type"] as? String == "content_block_start", let b = e["content_block"] as? [String: Any], b["type"] as? String == "tool_use" {
                let id = b["id"] as? String ?? UUID().uuidString, name = Self.toolName(b["name"] as? String ?? "tool")
                run.tools[id] = name
                send(run, ["t": "tool", "id": id, "name": name])
            } else if e["type"] as? String == "content_block_delta", let d = e["delta"] as? [String: Any] {
                if d["type"] as? String == "text_delta", let t = d["text"] as? String { send(run, ["t": "text", "d": t]) }
                if d["type"] as? String == "thinking_delta", let t = d["thinking"] as? String { send(run, ["t": "think", "d": t]) }
            }
        case "assistant":
            for c in ((o["message"] as? [String: Any])?["content"] as? [[String: Any]]) ?? [] where c["type"] as? String == "tool_use" {
                if let id = c["id"] as? String { send(run, ["t": "tool_input", "id": id, "input": c["input"] ?? [:]]) }
            }
        case "user":
            for c in ((o["message"] as? [String: Any])?["content"] as? [[String: Any]]) ?? [] where c["type"] as? String == "tool_result" {
                send(run, ["t": "tool_done", "id": c["tool_use_id"] as? String ?? "", "ok": !(c["is_error"] as? Bool ?? false),
                           "out": Self.short(Self.text(of: c["content"]))])
            }
        case "result":
            run.gotResult = true
            let bad = o["is_error"] as? Bool ?? false
            if bad {
                // Claude's error subtypes, in words (its own message wins when there is one).
                let words = ["error_max_turns": "It stopped after the most steps one message may take.",
                             "error_max_budget_usd": "It stopped at its spending limit.",
                             "error_during_execution": "Claude stopped with an error."]
                let sub = o["subtype"] as? String ?? ""
                send(run, ["t": "error", "message": (o["result"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? words[sub] ?? "Claude stopped with an error."])
            }
            send(run, ["t": "done", "ok": !bad, "session": o["session_id"] ?? NSNull()])
        default: break
        }
    }

    private func codex(_ run: Run, _ o: [String: Any]) {
        // `codex exec --json`: thread / turn / item events.
        if let type = o["type"] as? String {
            let item = o["item"] as? [String: Any] ?? [:]
            let kind = item["type"] as? String ?? item["item_type"] as? String ?? ""
            let id = item["id"] as? String ?? UUID().uuidString
            switch type {
            case "thread.started": if let s = o["thread_id"] as? String { send(run, ["t": "session", "session": s]) }
            case "item.started", "item.updated":
                if kind == "mcp_tool_call" || kind == "command_execution", run.tools[id] == nil {
                    let name = kind == "command_execution" ? "shell" : Self.toolName(item["tool"] as? String ?? "tool")
                    run.tools[id] = name
                    send(run, ["t": "tool", "id": id, "name": name])
                    if let args = item["arguments"] ?? item["command"] { send(run, ["t": "tool_input", "id": id, "input": args]) }
                }
            case "item.completed":
                switch kind {
                case "agent_message", "assistant_message": send(run, ["t": "text", "d": (item["text"] as? String ?? "") + "\n\n", "whole": true])
                case "reasoning":
                    let t = (item["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty { send(run, ["t": "think", "d": t + "\n"]) }
                case "mcp_tool_call", "command_execution":
                    if run.tools[id] == nil {
                        let name = kind == "command_execution" ? "shell" : Self.toolName(item["tool"] as? String ?? "tool")
                        run.tools[id] = name
                        send(run, ["t": "tool", "id": id, "name": name])
                        if let args = item["arguments"] ?? item["command"] { send(run, ["t": "tool_input", "id": id, "input": args]) }
                    }
                    // A successful call still carries "error": null, so only a real value counts as a failure.
                    let failed = (item["status"] as? String) == "failed" || Self.set(item["error"])
                        || (kind == "command_execution" && (item["exit_code"] as? Int).map { $0 != 0 } == true)
                    let out = Self.text(of: Self.first(item["result"], item["aggregated_output"], item["error"]))
                    send(run, ["t": "tool_done", "id": id, "ok": !failed, "out": Self.short(out)])
                default: break
                }
            case "turn.completed": run.gotResult = true; send(run, ["t": "done", "ok": true])
            case "turn.failed":
                run.gotResult = true
                send(run, ["t": "error", "message": ((o["error"] as? [String: Any])?["message"] as? String) ?? "The turn failed."])
                send(run, ["t": "done", "ok": false])
            case "error": send(run, ["t": "error", "message": o["message"] as? String ?? "Error"])
            default: break
            }
            return
        }
        // Older Codex: {"id": …, "msg": {"type": …}}.
        guard let m = o["msg"] as? [String: Any], let type = m["type"] as? String else { return }
        switch type {
        case "session_configured": if let s = m["session_id"] as? String { send(run, ["t": "session", "session": s]) }
        case "agent_message_delta": send(run, ["t": "text", "d": m["delta"] as? String ?? ""])
        case "agent_reasoning_delta": send(run, ["t": "think", "d": m["delta"] as? String ?? ""])
        case "mcp_tool_call_begin":
            let id = m["call_id"] as? String ?? UUID().uuidString
            let inv = m["invocation"] as? [String: Any] ?? [:]
            send(run, ["t": "tool", "id": id, "name": Self.toolName(inv["tool"] as? String ?? "tool")])
            send(run, ["t": "tool_input", "id": id, "input": inv["arguments"] ?? [:]])
        case "mcp_tool_call_end":
            let r = m["result"] as? [String: Any]
            send(run, ["t": "tool_done", "id": m["call_id"] as? String ?? "", "ok": r?["Err"] == nil, "out": Self.short(Self.text(of: r?["Ok"] ?? r?["Err"]))])
        case "task_complete": run.gotResult = true; send(run, ["t": "done", "ok": true])
        case "error": send(run, ["t": "error", "message": m["message"] as? String ?? "Error"])
        default: break
        }
    }

    private func cursor(_ run: Run, _ o: [String: Any]) {
        switch o["type"] as? String {
        case "system": if let s = o["session_id"] as? String { send(run, ["t": "session", "session": s]) }
        case "thinking": if let t = o["text"] as? String, !t.isEmpty { send(run, ["t": "think", "d": t]) }
        case "assistant":
            let t = ((o["message"] as? [String: Any])?["content"] as? [[String: Any]] ?? []).compactMap { $0["text"] as? String }.joined()
            // With partial output the pieces arrive as deltas; before each tool call, question and the result Cursor
            // repeats the text since the last tool call (tagged model_call_id, or equal to what we have). Skip those.
            if t.isEmpty || o["model_call_id"] != nil || t == run.segment { return }
            run.segment += t
            send(run, ["t": "text", "d": t])
        case "interaction_query": run.segment = ""
        case "tool_call":
            let id = o["call_id"] as? String ?? UUID().uuidString
            let call = o["tool_call"] as? [String: Any] ?? [:]
            let (key, val) = call.first.map { ($0.key, $0.value as? [String: Any] ?? [:]) } ?? ("tool", [:])
            let args = val["args"] as? [String: Any] ?? [:]
            var name = key.replacingOccurrences(of: "ToolCall", with: "")
            // MCP: args.toolName is the tool, args.providerIdentifier the server ("name" is "<server>-<tool>").
            if key == "mcpToolCall" { name = Self.toolName((args["toolName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? args["name"] as? String ?? "tool") }
            if o["subtype"] as? String == "started" {
                run.segment = ""
                run.tools[id] = name
                send(run, ["t": "tool", "id": id, "name": name])
                send(run, ["t": "tool_input", "id": id, "input": args["args"] ?? args])
            } else {
                // A result holds exactly one case: only "success" (and, for MCP, not isError) means it worked; error,
                // rejected, permissionDenied, toolNotFound, failure, timeout, spawnError all mean it didn't.
                let r = val["result"] as? [String: Any] ?? [:]
                let success = r["success"] as? [String: Any]
                let ok = success != nil && (success?["isError"] as? Bool) != true
                send(run, ["t": "tool_done", "id": id, "ok": ok, "out": Self.short(Self.cursorText(success ?? r.values.first))])
            }
        case "result":
            run.gotResult = true
            let bad = o["is_error"] as? Bool ?? false
            if bad { send(run, ["t": "error", "message": o["result"] as? String ?? "The agent stopped with an error."]) }
            send(run, ["t": "done", "ok": !bad, "session": o["session_id"] ?? NSNull()])
        default: break
        }
    }

    private func gemini(_ run: Run, _ o: [String: Any]) {
        switch o["type"] as? String {
        case "init": if let s = o["session_id"] as? String { send(run, ["t": "session", "session": s]) }
        case "message":
            if o["role"] as? String == "assistant", let t = o["content"] as? String { send(run, ["t": "text", "d": t]) }
        case "tool_use":
            let id = o["tool_id"] as? String ?? UUID().uuidString
            send(run, ["t": "tool", "id": id, "name": Self.toolName(o["tool_name"] as? String ?? "tool")])
            send(run, ["t": "tool_input", "id": id, "input": o["parameters"] ?? [:]])
        case "tool_result":
            // status is the signal; on success "error" is absent, on failure it is {type, message}.
            let ok = (o["status"] as? String ?? "success") == "success"
            let err = (o["error"] as? [String: Any])?["message"]
            send(run, ["t": "tool_done", "id": o["tool_id"] as? String ?? "", "ok": ok, "out": Self.short(Self.text(of: Self.first(o["output"], err)))])
        case "error":
            // Warnings (a loop it stopped, say) are not failures; errors are.
            if (o["severity"] as? String ?? "error") == "error" { send(run, ["t": "error", "message": o["message"] as? String ?? "Gemini stopped with an error."]) }
        case "result":
            run.gotResult = true
            let ok = (o["status"] as? String ?? "success") == "success"
            if !ok && !run.reportedError { send(run, ["t": "error", "message": ((o["error"] as? [String: Any])?["message"] as? String) ?? "Gemini stopped with an error."]) }
            send(run, ["t": "done", "ok": ok])
        default: break
        }
    }

    func finish(_ run: Run, status: Int32) {
        lock.lock()
        if run.finished { lock.unlock(); return }
        run.finished = true
        if runs[run.id] === run { runs[run.id] = nil }
        lock.unlock()
        if run.gotResult { return }
        if run.stopped { send(run, ["t": "done", "ok": false, "stopped": true]); return }
        try? run.input?.close()
        if status != 0 && !run.reportedError { // an error the stream already reported isn't repeated from stderr
            let err = String(decoding: run.stderr, as: UTF8.self)
                .replacingOccurrences(of: "\u{1B}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let lines = err.split(whereSeparator: \.isNewline).map(String.init)
            var last = lines.suffix(6).joined(separator: "\n")
            // Some agents (Cline) write their error to stderr as JSON: {"type":"error","message":…}.
            if let json = lines.last(where: { $0.hasPrefix("{") }), let o = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
               let m = (o["message"] as? String) ?? ((o["error"] as? [String: Any])?["message"] as? String) {
                last = m
            }
            if run.provider == "cursor" && last.contains("Authentication required") {
                last = "Cursor's agent isn't signed in. Choose Sign in to Cursor… in the agent menu, then send again."
            }
            send(run, ["t": "error", "message": last.isEmpty ? "The agent quit (exit code \(status))." : Self.short(last, 1200)])
        }
        send(run, ["t": "done", "ok": status == 0])
    }
}
