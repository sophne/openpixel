import Foundation

/// Agent Chat: the agents beyond Claude, Codex, Cursor and Gemini. Each one runs on the person's own sign-in or
/// settings, gets OpenPixel's server for the run (none of them need it in their own settings), and its output is read
/// into the same events (see ChatRunner). Formats come from each tool's own source and docs; ChatSelfTest replays them.
///   opencode   `opencode run --format json` (V1 and V2 lines differ: V2 needs --standalone); OpenPixel and a
///              permission rule allowing only its tools go in OPENCODE_CONFIG_CONTENT.
///   Kiro       `kiro-cli chat --no-interactive --v2 --output-format stream-json`: ACP session updates in an envelope;
///              OpenPixel comes from the chat folder's .kiro/settings/mcp.json, trusted with --trust-tools=@openpixel.
///   Goose      `goose run --output-format stream-json --with-extension …`; sessions are named after the chat, since the
///              stream never says its id.
///   Cline      `cline --json`, with CLINE_MCP_SETTINGS_PATH pointing at a file that holds only OpenPixel.
///   Hermes     `hermes acp`: the Agent Client Protocol over stdin/stdout (its other headless mode prints only the final
///              answer). OpenPixel is passed in session/new; permission requests are declined (MCP calls need none).
extension ChatRunner {
    static let moreProviders: [Provider] = [
        // GitHub Copilot CLI: OpenPixel added for the run (--additional-mcp-config), only its tools allowed.
        Provider(id: "copilot", name: "GitHub Copilot", plan: "Copilot subscription", binaries: ["copilot"],
                 models: [Model(id: "", label: "Default model")],
                 efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium", injectsMCP: true, resumes: true),
        Provider(id: "opencode", name: "opencode", plan: "your opencode providers", binaries: ["opencode"],
                 bundled: [".opencode/bin/opencode"], models: [Model(id: "", label: "Default model")],
                 efforts: [], defaultEffort: "", injectsMCP: true, resumes: true),
        Provider(id: "kiro", name: "Kiro", plan: "Kiro subscription", binaries: ["kiro-cli"],
                 bundled: [".local/bin/kiro-cli"], models: [Model(id: "", label: "Default model")],
                 efforts: [], defaultEffort: "", injectsMCP: true, resumes: true),
        Provider(id: "goose", name: "Goose", plan: "your Goose provider", binaries: ["goose"],
                 models: [Model(id: "", label: "Default model")], efforts: [], defaultEffort: "", injectsMCP: true, resumes: true),
        Provider(id: "cline", name: "Cline", plan: "your Cline account", binaries: ["cline"],
                 models: [Model(id: "", label: "Default model")], efforts: [], defaultEffort: "", injectsMCP: true, resumes: false),
        Provider(id: "hermes", name: "Hermes Agent", plan: "your Hermes provider", binaries: ["hermes"],
                 models: [Model(id: "", label: "Default model")], efforts: [], defaultEffort: "", injectsMCP: true, resumes: false),
    ]

    private static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }
    private static func read(_ path: String) -> String? { try? String(contentsOfFile: "\(home)/\(path)", encoding: .utf8) }

    /// Whether the agent itself is set up (a provider chosen): installed but unset agents stay off the menu.
    func moreProviderConfigured(_ id: String) -> Bool {
        let fm = FileManager.default
        switch id {
        case "goose": return Self.read(".config/goose/config.yaml")?.contains("GOOSE_PROVIDER") ?? false
        case "cline": return fm.fileExists(atPath: "\(Self.home)/.cline/data/settings/providers.json")
        case "hermes": return Self.hermesModel() != nil
        default: return true
        }
    }

    /// Gemini CLI signs in interactively; it is ready with cached Google credentials, a chosen auth type or an API key.
    static func geminiSignedIn() -> Bool {
        let e = ProcessInfo.processInfo.environment
        if !(e["GEMINI_API_KEY"] ?? "").isEmpty || !(e["GOOGLE_API_KEY"] ?? "").isEmpty { return true }
        if FileManager.default.fileExists(atPath: "\(home)/.gemini/oauth_creds.json") { return true }
        return read(".gemini/settings.json")?.contains("selectedType") ?? false
    }

    /// Copilot's token: an environment variable, its keychain item ("copilot-cli"), or the GitHub CLI's login.
    static func copilotSignedIn() -> Bool {
        let e = ProcessInfo.processInfo.environment
        if ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"].contains(where: { !(e[$0] ?? "").isEmpty }) { return true }
        // Only asks whether the item exists (no -w: the token itself is never read).
        if capture("/usr/bin/security", ["find-generic-password", "-s", "copilot-cli"], timeout: 4) != nil { return true }
        return read(".copilot/config.json")?.contains("\"token") ?? false
    }

    /// `gemini --list-models --output-format json` (0.67+): a JSON array of {modelId|id, displayName|name}; makes no model call.
    func geminiModels(_ exe: String) -> [Model] {
        var e = env; e["NO_BROWSER"] = "true"
        guard let out = Self.capture(exe, ["--list-models", "--output-format", "json"], env: e, timeout: 15),
              let start = out.firstIndex(of: "["), let d = String(out[start...]).data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] else { return [Model(id: "", label: "Default model")] }
        let models = list.compactMap { m -> Model? in
            guard let id = (m["modelId"] ?? m["id"]) as? String, !id.isEmpty else { return nil }
            return Model(id: id, label: (m["displayName"] ?? m["name"]) as? String ?? id)
        }
        return [Model(id: "", label: "Default model")] + models
    }

    /// Hermes' model from ~/.hermes/config.yaml (model: default: …), for the menu's label.
    static func hermesModel() -> String? {
        guard let yaml = read(".hermes/config.yaml") else { return nil }
        var inModel = false
        for line in yaml.components(separatedBy: "\n") {
            if !line.hasPrefix(" ") && !line.hasPrefix("\t") { inModel = line.hasPrefix("model:") }
            else if inModel, let r = line.range(of: ##"^\s+default:\s*['"]?([^'"#]+)"##, options: .regularExpression) {
                let v = line[r].split(separator: ":", maxSplits: 1).last.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " '\"")) }
                if let v, !v.isEmpty { return v }
            }
        }
        return nil
    }

    func moreModels(_ id: String, _ exe: String) -> [Model] {
        switch id {
        case "opencode":
            // `opencode models`: one provider/model per line (only providers the person can use, and the free ones).
            guard let out = Self.capture(exe, ["models"], env: env, timeout: 12) else { break }
            let ids = out.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { $0.range(of: #"^[\w.-]+/[\w.:@/-]+$"#, options: .regularExpression) != nil }
            if !ids.isEmpty { return [Model(id: "", label: "Default model")] + ids.prefix(120).map { Model(id: $0, label: $0) } }
        case "kiro":
            // `kiro-cli chat --list-models --format json`: read loosely (a list of ids, or objects with an id/name).
            guard let out = Self.capture(exe, ["chat", "--list-models", "--format", "json"], env: env, timeout: 12),
                  let d = out.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) else { break }
            let list = (o as? [Any]) ?? ((o as? [String: Any])?["models"] as? [Any]) ?? []
            let models = list.compactMap { x -> Model? in
                if let s = x as? String { return Model(id: s, label: s) }
                guard let m = x as? [String: Any], let id = (m["modelId"] ?? m["id"] ?? m["model_id"] ?? m["name"]) as? String else { return nil }
                return Model(id: id, label: (m["modelName"] ?? m["name"] ?? m["displayName"]) as? String ?? id)
            }
            if !models.isEmpty { return [Model(id: "", label: "Default model")] + models }
        case "hermes":
            if let m = Self.hermesModel() { return [Model(id: "", label: m)] }
        default: break
        }
        return [Model(id: "", label: "Default model")]
    }

    // MARK: - arguments and environment

    /// opencode's two lines: 2.x is the new one (needs --standalone, mcp.servers, ordered permission rules).
    var opencodeV2: Bool {
        guard let p = Self.providers.first(where: { $0.id == "opencode" }), let exe = find(p),
              let v = Self.capture(exe, ["--version"], env: env, timeout: 6) else { return true }
        let major = v.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ".").first.flatMap { Int($0.filter(\.isNumber)) }
        return (major ?? 2) >= 2
    }

    func moreArguments(_ p: Provider, prompt: String, model: String, effort: String, resume: String?, system: String, chat: String) -> [String] {
        let text = resume == nil && !system.isEmpty ? "\(system)\n\n\(prompt)" : prompt
        switch p.id {
        case "copilot":
            let file = workDir.appendingPathComponent("copilot-mcp.json")
            let o: [String: Any] = ["mcpServers": ["openpixel": ["type": "local", "command": mcpCommand, "args": ["--mcp"], "tools": ["*"]]]]
            if let d = try? JSONSerialization.data(withJSONObject: o, options: .withoutEscapingSlashes) { try? d.write(to: file, options: .atomic) }
            // Non-interactive runs deny anything not allowed; --allow-tool=openpixel allows OpenPixel's server only.
            var a = ["-p", text, "--output-format", "json", "--no-auto-update", "--no-color", "--no-ask-user",
                     "--additional-mcp-config", "@\(file.path)", "--allow-tool=openpixel", "--disable-builtin-mcps"]
            if !model.isEmpty { a += ["--model", model] }
            if p.efforts.contains(effort) { a += ["--effort", effort] }
            if let r = resume { a.append("--resume=\(r)") }
            return a
        case "opencode":
            var a = ["run"] + (opencodeV2 ? ["--standalone"] : []) + ["--format", "json", "--thinking"]
            if !model.isEmpty { a += ["-m", model] }
            if let r = resume { a += ["-s", r] }
            return a + [text]
        case "kiro":
            prepareKiroFolder()
            var a = ["chat", "--no-interactive", "--v2", "--output-format", "stream-json", "--trust-tools=@openpixel"]
            if !model.isEmpty { a += ["--model", model] }
            if let r = resume { a += ["--resume-id", r] }
            return a + [text]
        case "goose":
            // The extension string is a command line: quote the path in case it has spaces.
            var a = ["run", "-t", text, "--output-format", "stream-json", "--with-extension", "\"\(mcpCommand)\" --mcp"]
            a += resume.map { ["--resume", "--name", $0] } ?? ["--name", chat]
            return a
        case "cline":
            return ["--json"] + (model.isEmpty ? [] : ["-m", model]) + [text]
        default: // hermes: the prompt goes in over ACP
            return ["acp"]
        }
    }

    func moreEnvironment(_ p: Provider) -> [String: String] {
        switch p.id {
        case "opencode":
            let cmd: [String] = [mcpCommand, "--mcp"]
            // Only OpenPixel's tools (and skills): no shell, edits or web; explicit denies hold even when auto-approving.
            let config: [String: Any] = opencodeV2
                ? ["mcp": ["servers": ["openpixel": ["type": "local", "command": cmd, "codemode": false]]],
                   "permissions": [["action": "*", "resource": "*", "effect": "deny"],
                                   ["action": "openpixel_*", "resource": "*", "effect": "allow"],
                                   ["action": "skill", "resource": "*", "effect": "allow"]]]
                : ["mcp": ["openpixel": ["type": "local", "command": cmd, "enabled": true]],
                   "permission": ["*": "deny", "openpixel_*": "allow", "skill": "allow"]]
            let json = (try? JSONSerialization.data(withJSONObject: config, options: .withoutEscapingSlashes)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
            return ["OPENCODE_CONFIG_CONTENT": json]
        case "goose": return ["GOOSE_MODE": "auto"] // headless runs in approve modes abort
        case "cline":
            let file = workDir.appendingPathComponent("cline-mcp.json")
            let o: [String: Any] = ["mcpServers": ["openpixel": ["type": "stdio", "command": mcpCommand, "args": ["--mcp"]]]]
            if let d = try? JSONSerialization.data(withJSONObject: o, options: .withoutEscapingSlashes) { try? d.write(to: file, options: .atomic) }
            return ["CLINE_MCP_SETTINGS_PATH": file.path]
        case "hermes": return ["HERMES_ACP_SKIP_CONFIGURED_MCP": "1"] // only the OpenPixel server we pass
        default: return [:]
        }
    }

    /// The chat folder as a Kiro workspace whose MCP settings hold OpenPixel.
    func prepareKiroFolder() {
        let dir = workDir.appendingPathComponent(".kiro/settings", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let o: [String: Any] = ["mcpServers": ["openpixel": ["command": mcpCommand, "args": ["--mcp"]]]]
        if let d = try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .withoutEscapingSlashes]) {
            try? d.write(to: dir.appendingPathComponent("mcp.json"), options: .atomic)
        }
    }

    // MARK: - reading their output

    func moreLine(_ run: Run, _ o: [String: Any]) {
        switch run.provider {
        case "copilot": copilot(run, o)
        case "opencode": opencode(run, o)
        case "kiro": kiro(run, o)
        case "goose": goose(run, o)
        case "cline": cline(run, o)
        case "hermes": acp(run, o)
        default: break
        }
    }

    private func once(_ run: Run, session s: String?) {
        guard let s, !s.isEmpty, run.session == nil else { return }
        run.session = s
        send(run, ["t": "session", "session": s])
    }

    /// Copilot: session events ({type, data}); text and reasoning stream as deltas and arrive whole once more (skipped
    /// when the deltas came); tool.execution_complete's "success" is the signal; a synthetic "result" ends the run.
    private func copilot(_ run: Run, _ o: [String: Any]) {
        let d = o["data"] as? [String: Any] ?? [:]
        switch o["type"] as? String {
        case "session.start": once(run, session: d["sessionId"] as? String)
        case "assistant.message_delta":
            guard let t = d["deltaContent"] as? String, !t.isEmpty else { return }
            let mid = d["messageId"] as? String ?? ""
            let gap = !run.segment.isEmpty && run.segment != mid ? "\n\n" : ""
            run.segment = mid; run.tools["msg:" + mid] = "streamed"
            send(run, ["t": "text", "d": gap + t])
        case "assistant.message":
            let mid = d["messageId"] as? String ?? ""
            if run.tools["msg:" + mid] == nil, let t = d["content"] as? String, !t.isEmpty {
                let gap = !run.segment.isEmpty && run.segment != mid ? "\n\n" : ""
                run.segment = mid
                send(run, ["t": "text", "d": gap + t])
            }
        case "assistant.reasoning_delta":
            if let t = d["deltaContent"] as? String, !t.isEmpty { run.tools["rsn:" + (d["reasoningId"] as? String ?? "")] = "streamed"; send(run, ["t": "think", "d": t]) }
        case "assistant.reasoning":
            if run.tools["rsn:" + (d["reasoningId"] as? String ?? "")] == nil, let t = d["content"] as? String, !t.isEmpty { send(run, ["t": "think", "d": t]) }
        case "tool.execution_start":
            let id = d["toolCallId"] as? String ?? UUID().uuidString
            let name = Self.toolName((d["mcpToolName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? d["toolName"] as? String ?? "tool")
            run.tools[id] = name
            send(run, ["t": "tool", "id": id, "name": name])
            if let args = d["arguments"], Self.set(args) { send(run, ["t": "tool_input", "id": id, "input": args]) }
        case "tool.execution_complete":
            let ok = d["success"] as? Bool ?? false
            let result = d["result"] as? [String: Any]
            let out = ok ? Self.text(of: result?["content"]) : ((d["error"] as? [String: Any])?["message"] as? String ?? Self.text(of: result?["content"]))
            send(run, ["t": "tool_done", "id": d["toolCallId"] as? String ?? "", "ok": ok, "out": Self.short(out)])
        case "session.error":
            let signIn = (d["remediation"] as? String) == "sign_in" || (d["errorType"] as? String) == "authentication"
            send(run, ["t": "error", "message": signIn ? "GitHub Copilot isn't signed in. Choose Sign in to GitHub Copilot… in the agent menu, then send again."
                                                       : (d["message"] as? String ?? "Copilot stopped with an error.")])
        case "result":
            run.gotResult = true
            once(run, session: o["sessionId"] as? String)
            let code = o["exitCode"] as? Int ?? 0
            if code != 0 && !run.reportedError { send(run, ["t": "error", "message": "Copilot stopped (exit code \(code))."]) }
            send(run, ["t": "done", "ok": code == 0, "session": run.session ?? NSNull()])
        default: break
        }
    }

    /// opencode: text arrives once per finished block, tools only when finished (completed / error).
    private func opencode(_ run: Run, _ o: [String: Any]) {
        once(run, session: o["sessionID"] as? String)
        let part = o["part"] as? [String: Any] ?? [:]
        switch o["type"] as? String {
        case "text":
            if let t = part["text"] as? String, !t.isEmpty { send(run, ["t": "text", "d": t + "\n\n", "whole": true]) }
        case "reasoning":
            if let t = part["text"] as? String, !t.isEmpty { send(run, ["t": "think", "d": t + "\n"]) }
        case "tool_use":
            let id = part["callID"] as? String ?? part["id"] as? String ?? UUID().uuidString
            let state = part["state"] as? [String: Any] ?? [:]
            let name = Self.toolName(part["tool"] as? String ?? "tool")
            send(run, ["t": "tool", "id": id, "name": name])
            if let input = state["input"] { send(run, ["t": "tool_input", "id": id, "input": input]) }
            let ok = (state["status"] as? String) == "completed"
            send(run, ["t": "tool_done", "id": id, "ok": ok, "out": Self.short(Self.text(of: ok ? state["output"] : state["error"]))])
        case "error":
            let e = o["error"] as? [String: Any] ?? [:]
            let msg = (e["message"] as? String) ?? ((e["data"] as? [String: Any])?["message"] as? String) ?? (e["name"] as? String) ?? "opencode stopped with an error."
            send(run, ["t": "error", "message": msg])
        default: break
        }
    }

    /// Kiro: an envelope around ACP session updates, ending in runFinished or runError.
    private func kiro(_ run: Run, _ o: [String: Any]) {
        let data = o["data"] as? [String: Any] ?? [:]
        switch o["type"] as? String {
        case "metadata": once(run, session: data["sessionId"] as? String)
        case "sessionUpdate":
            once(run, session: data["sessionId"] as? String)
            if let u = data["update"] as? [String: Any] { acpUpdate(run, u) }
        case "runFinished":
            run.gotResult = true
            if !run.sentText, data["finalTextTruncated"] as? Bool != true, let t = data["finalText"] as? String, !t.isEmpty { send(run, ["t": "text", "d": t]) }
            let ok = (data["status"] as? String ?? "success") == "success"
            if !ok { send(run, ["t": "error", "message": "Kiro stopped (\(data["stopReason"] as? String ?? data["status"] as? String ?? "error"))."]) }
            send(run, ["t": "done", "ok": ok, "session": run.session ?? NSNull()])
        case "runError":
            run.gotResult = true
            send(run, ["t": "error", "message": data["message"] as? String ?? "Kiro stopped with an error."])
            send(run, ["t": "done", "ok": false])
        default: break
        }
    }

    /// One ACP session update (Kiro's stream, Hermes over ACP): text, thinking, tool calls and their updates.
    func acpUpdate(_ run: Run, _ u: [String: Any]) {
        let content = u["content"]
        switch u["sessionUpdate"] as? String {
        case "agent_message_chunk":
            if let t = (content as? [String: Any])?["text"] as? String, !t.isEmpty { run.sentText = true; send(run, ["t": "text", "d": t]) }
        case "agent_thought_chunk":
            if let t = (content as? [String: Any])?["text"] as? String, !t.isEmpty { send(run, ["t": "think", "d": t]) }
        case "tool_call", "tool_call_update":
            let id = u["toolCallId"] as? String ?? UUID().uuidString
            if run.tools[id] == nil {
                let kiroName = ((u["_meta"] as? [String: Any])?["kiro"] as? [String: Any])?["toolName"] as? String
                let name = Self.toolName(kiroName ?? (u["title"] as? String) ?? "tool")
                run.tools[id] = name
                send(run, ["t": "tool", "id": id, "name": name])
            }
            if let input = u["rawInput"], Self.set(input) { send(run, ["t": "tool_input", "id": id, "input": input]) }
            let status = u["status"] as? String ?? ""
            guard status == "completed" || status == "failed" else { return }
            let out = Self.acpText(content) ?? Self.text(of: u["rawOutput"])
            // Hermes reports an MCP tool's error as a completed call whose output is {"error": …}.
            let looksFailed = run.provider == "hermes" && out.trimmingCharacters(in: .whitespaces).hasPrefix("{\"error\"")
            send(run, ["t": "tool_done", "id": id, "ok": status == "completed" && !looksFailed, "out": Self.short(out)])
        default: break // plans, command lists, usage and session info
        }
    }

    /// ACP tool-call content: [{"type":"content","content":{"type":"text","text":…}}, {"type":"diff",…}].
    static func acpText(_ v: Any?) -> String? {
        guard let items = v as? [[String: Any]] else { return nil }
        let texts = items.compactMap { item -> String? in
            if let c = item["content"] as? [String: Any] { return c["text"] as? String }
            return item["text"] as? String
        }
        return texts.isEmpty ? nil : texts.joined(separator: "\n")
    }

    /// Goose: messages whose content items are text, thinking, toolRequest and toolResponse.
    private func goose(_ run: Run, _ o: [String: Any]) {
        once(run, session: run.id) // Goose's stream never names its session: it is the chat's own name (--name)
        switch o["type"] as? String {
        case "message":
            let m = o["message"] as? [String: Any] ?? [:]
            let assistant = (m["role"] as? String ?? "assistant") == "assistant"
            for item in m["content"] as? [[String: Any]] ?? [] {
                switch item["type"] as? String {
                case "text": if assistant, let t = item["text"] as? String, !t.isEmpty { send(run, ["t": "text", "d": t]) }
                case "thinking": if let t = item["thinking"] as? String, !t.isEmpty { send(run, ["t": "think", "d": t]) }
                case "toolRequest":
                    let id = item["id"] as? String ?? UUID().uuidString
                    let call = item["toolCall"] as? [String: Any] ?? [:]
                    let value = call["value"] as? [String: Any] ?? [:]
                    let name = Self.toolName(value["name"] as? String ?? "tool")
                    run.tools[id] = name
                    send(run, ["t": "tool", "id": id, "name": name])
                    if let args = value["arguments"] { send(run, ["t": "tool_input", "id": id, "input": args]) }
                    if (call["status"] as? String) == "error" {
                        send(run, ["t": "tool_done", "id": id, "ok": false, "out": Self.text(of: call["error"])])
                    }
                case "toolResponse":
                    let id = item["id"] as? String ?? ""
                    let r = item["toolResult"] as? [String: Any] ?? [:]
                    let value = r["value"] as? [String: Any]
                    // Two ways to fail: the call itself errored, or the tool answered with isError.
                    let ok = (r["status"] as? String) == "success" && (value?["isError"] as? Bool) != true
                    let out = Self.text(of: value?["content"] ?? r["error"])
                    send(run, ["t": "tool_done", "id": id, "ok": ok, "out": Self.short(out)])
                default: break
                }
            }
        case "error":
            run.gotResult = true
            send(run, ["t": "error", "message": o["error"] as? String ?? "Goose stopped with an error."])
            send(run, ["t": "done", "ok": false])
        case "complete":
            run.gotResult = true
            send(run, ["t": "done", "ok": true, "session": run.session ?? NSNull()])
        default: break
        }
    }

    /// Cline: agent events (content_start per text delta, content_end closes a tool; its "error" key appears only on
    /// failure), then run_result or run_aborted.
    private func cline(_ run: Run, _ o: [String: Any]) {
        switch o["type"] as? String {
        case "agent_event":
            let e = o["event"] as? [String: Any] ?? [:]
            let kind = e["contentType"] as? String
            switch e["type"] as? String {
            case "content_start":
                if kind == "text", let t = e["text"] as? String, !t.isEmpty { send(run, ["t": "text", "d": t]) }
                if kind == "reasoning", let t = e["reasoning"] as? String, !t.isEmpty { send(run, ["t": "think", "d": t]) }
                if kind == "tool" {
                    let id = e["toolCallId"] as? String ?? UUID().uuidString
                    let name = Self.toolName(e["toolName"] as? String ?? "tool")
                    run.tools[id] = name
                    send(run, ["t": "tool", "id": id, "name": name])
                    if let input = e["input"] { send(run, ["t": "tool_input", "id": id, "input": input]) }
                }
            case "content_end":
                if kind == "tool" {
                    let failed = Self.set(e["error"])
                    send(run, ["t": "tool_done", "id": e["toolCallId"] as? String ?? "", "ok": !failed,
                               "out": Self.short(Self.text(of: failed ? e["error"] : e["output"]))])
                }
            case "error":
                if e["recoverable"] as? Bool != true {
                    let err = e["error"] as? [String: Any]
                    send(run, ["t": "error", "message": err?["message"] as? String ?? Self.text(of: e["error"])])
                }
            default: break
            }
        case "run_result":
            run.gotResult = true
            let reason = o["finishReason"] as? String ?? "completed"
            let ok = !["error", "aborted", "failed"].contains(reason)
            if !ok && !run.reportedError { send(run, ["t": "error", "message": "Cline stopped (\(reason))."]) }
            send(run, ["t": "done", "ok": ok])
        case "run_aborted":
            run.gotResult = true
            send(run, ["t": "done", "ok": false, "stopped": true])
        default: break
        }
    }

    // MARK: - Hermes over ACP (JSON-RPC 2.0 over stdin/stdout)

    func acpBegin(_ run: Run) {
        acpSend(run, ["jsonrpc": "2.0", "id": 1, "method": "initialize",
                      "params": ["protocolVersion": 1, "clientCapabilities": ["fs": ["readTextFile": false, "writeTextFile": false], "terminal": false]]])
    }

    private func acpSend(_ run: Run, _ o: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: .withoutEscapingSlashes) else { return }
        run.input?.write(d + Data([0x0A]))
    }

    private func acpEnd(_ run: Run) {
        try? run.input?.close()
        run.input = nil
    }

    private func acp(_ run: Run, _ o: [String: Any]) {
        if let method = o["method"] as? String {
            let params = o["params"] as? [String: Any] ?? [:]
            if method == "session/update", let u = params["update"] as? [String: Any] { acpUpdate(run, u); return }
            guard let id = o["id"] else { return } // other notifications
            if method == "session/request_permission" {
                // OpenPixel's tools need no permission; anything that asks (a shell command, say) is declined.
                let options = params["options"] as? [[String: Any]] ?? []
                let reject = options.first { ($0["kind"] as? String ?? "").hasPrefix("reject") }?["optionId"]
                let outcome: [String: Any] = reject.map { ["outcome": "selected", "optionId": $0] } ?? ["outcome": "cancelled"]
                acpSend(run, ["jsonrpc": "2.0", "id": id, "result": ["outcome": outcome]])
            } else {
                acpSend(run, ["jsonrpc": "2.0", "id": id, "error": ["code": -32601, "message": "Not supported by OpenPixel"]])
            }
            return
        }
        guard let id = o["id"] as? Int else { return }
        if let e = o["error"] as? [String: Any] {
            run.gotResult = true
            send(run, ["t": "error", "message": e["message"] as? String ?? "Hermes stopped with an error."])
            send(run, ["t": "done", "ok": false])
            acpEnd(run)
            return
        }
        let result = o["result"] as? [String: Any] ?? [:]
        switch id {
        case 1:
            acpSend(run, ["jsonrpc": "2.0", "id": 2, "method": "session/new",
                          "params": ["cwd": workDir.path, "mcpServers": [["name": "openpixel", "command": mcpCommand, "args": ["--mcp"], "env": []]]]])
        case 2:
            guard let sid = result["sessionId"] as? String else {
                run.gotResult = true
                send(run, ["t": "error", "message": "Hermes didn't start a session."]); send(run, ["t": "done", "ok": false]); acpEnd(run); return
            }
            run.session = sid
            acpSend(run, ["jsonrpc": "2.0", "id": 3, "method": "session/prompt",
                          "params": ["sessionId": sid, "prompt": [["type": "text", "text": run.prompt]]]])
        case 3:
            run.gotResult = true
            let reason = result["stopReason"] as? String ?? "end_turn"
            switch reason {
            case "end_turn": send(run, ["t": "done", "ok": true])
            case "cancelled": send(run, ["t": "done", "ok": false, "stopped": true])
            default:
                send(run, ["t": "error", "message": reason == "refusal" ? "Hermes declined this request." : "Hermes stopped (\(reason))."])
                send(run, ["t": "done", "ok": false])
            }
            acpEnd(run)
        default: break
        }
    }
}
