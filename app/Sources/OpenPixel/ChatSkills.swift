import Foundation

/// Skills in Agent Chat: the ones each agent already has on this Mac, offered when the person types "/".
///   Claude Code   ~/.claude/skills (personal and synced), ~/.claude/commands, and its enabled plugins' skills and
///                 commands. Claude reports what it loaded when a chat starts (its init event); that list is kept
///                 (claude-init.json) and decides which plugin skills are on. A picked skill is sent as "/name …",
///                 which Claude runs itself.
///   Codex         ~/.codex/skills, ~/.agents/skills
///   Cursor        ~/.cursor/skills, ~/.cursor/skills-cursor, ~/.cursor/commands, ~/.agents/skills
///   Gemini CLI    ~/.gemini/skills, ~/.gemini/commands (Markdown)
/// For every agent but Claude, a picked skill's own instructions go in front of the message (with its folder, so
/// the files it mentions can be found).
extension ChatRunner {
    struct Skill {
        let name: String         // what follows the "/" (Claude's plugin skills are "plugin:skill")
        let description: String
        let path: String         // its SKILL.md or command file
        let source: String       // "Personal", or the plugin's name
        let command: Bool
    }

    private static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }

    /// The name, description and body of a SKILL.md or command file (YAML front matter between --- lines).
    static func readSkillFile(_ path: String) -> (name: String?, description: String, body: String)? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: path), let size = attrs[.size] as? Int, size < 512_000,
              let text = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        var name: String?, desc = "", body = text
        if text.hasPrefix("---") {
            let lines = text.components(separatedBy: "\n")
            if let end = lines.dropFirst().firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "---" }) {
                var key = ""
                for line in lines[1..<end] {
                    if let r = line.range(of: #"^([A-Za-z_-]+):\s*(.*)$"#, options: .regularExpression) {
                        let parts = String(line[r]).split(separator: ":", maxSplits: 1).map { String($0).trimmingCharacters(in: .whitespaces) }
                        key = parts[0]
                        let value = parts.count > 1 ? parts[1].trimmingCharacters(in: CharacterSet(charactersIn: "\"'")) : ""
                        if key == "name" { name = value }
                        if key == "description", value != "|", value != ">" { desc = value }
                    } else if key == "description", line.hasPrefix(" ") {
                        desc += (desc.isEmpty ? "" : " ") + line.trimmingCharacters(in: .whitespaces)
                    }
                }
                body = lines[(end + 1)...].joined(separator: "\n")
            }
        }
        return (name, desc, body.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// Every SKILL.md under `dir` (a few levels down, for synced folders), and every .md in `commands`.
    private static func scan(skills dir: String?, commands: String? = nil, plugin: String? = nil, depth: Int = 1) -> [Skill] {
        let fm = FileManager.default
        var out: [Skill] = []
        func walk(_ d: String, _ level: Int) {
            guard let items = try? fm.contentsOfDirectory(atPath: d) else { return }
            for item in items.sorted() where !item.hasPrefix(".") {
                let sub = "\(d)/\(item)"
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: sub, isDirectory: &isDir), isDir.boolValue else { continue }
                let file = "\(sub)/SKILL.md"
                if fm.fileExists(atPath: file), let s = readSkillFile(file) {
                    let base = (s.name?.isEmpty == false ? s.name! : item)
                    out.append(Skill(name: plugin.map { "\($0):\(base)" } ?? base, description: s.description, path: file,
                                     source: plugin ?? "Personal", command: false))
                } else if level < depth {
                    walk(sub, level + 1)
                }
            }
        }
        if let dir { walk(dir, 1) }
        if let commands, let items = try? fm.contentsOfDirectory(atPath: commands) {
            for item in items.sorted() where item.hasSuffix(".md") {
                let file = "\(commands)/\(item)"
                guard let s = readSkillFile(file) else { continue }
                let base = String(item.dropLast(3))
                let desc = s.description.isEmpty ? (s.body.split(whereSeparator: \.isNewline).first.map(String.init) ?? "") : s.description
                out.append(Skill(name: plugin.map { "\($0):\(base)" } ?? base, description: String(desc.prefix(240)), path: file,
                                 source: plugin ?? "Personal", command: true))
            }
        }
        return out
    }

    /// Gemini's custom commands: ~/.gemini/commands/**/*.toml; git/commit.toml is "/git:commit". They run in headless mode.
    private static func geminiCommands(_ dir: String) -> [Skill] {
        guard let e = FileManager.default.enumerator(atPath: dir) else { return [] }
        var out: [Skill] = []
        while let f = e.nextObject() as? String {
            guard f.hasSuffix(".toml"), let text = try? String(contentsOfFile: "\(dir)/\(f)", encoding: .utf8) else { continue }
            let name = String(f.dropLast(5)).replacingOccurrences(of: "/", with: ":")
            var desc = ""
            if let r = text.range(of: #"(?m)^\s*description\s*=\s*"([^"]*)""#, options: .regularExpression) {
                desc = String(text[r]).components(separatedBy: "\"").dropFirst().first ?? ""
            }
            out.append(Skill(name: name, description: desc, path: "\(dir)/\(f)", source: "Personal", command: true))
        }
        return out
    }

    private var claudeInitURL: URL { workDir.appendingPathComponent("claude-init.json") }

    /// Keeps what Claude Code says it loaded (its slash commands and plugins), from a chat's init event.
    func rememberClaudeInit(_ o: [String: Any]) {
        var keep: [String: Any] = [:]
        if let s = o["slash_commands"] as? [String] { keep["slash_commands"] = s }
        if let p = o["plugins"] as? [[String: Any]] {
            keep["plugins"] = p.compactMap { x -> [String: String]? in
                guard let n = x["name"] as? String, let path = x["path"] as? String else { return nil }
                return ["name": n, "path": path]
            }
        }
        if !keep.isEmpty, let d = try? JSONSerialization.data(withJSONObject: keep) { try? d.write(to: claudeInitURL, options: .atomic) }
    }

    private func claudeSkills() -> [Skill] {
        let h = Self.home
        var out = Self.scan(skills: "\(h)/.claude/skills", commands: "\(h)/.claude/commands", depth: 3)
        let saved = (try? Data(contentsOf: claudeInitURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        var plugins = (saved?["plugins"] as? [[String: String]] ?? []).compactMap { p -> (String, String)? in
            guard let n = p["name"], let path = p["path"] else { return nil }
            return (n, path)
        }
        if plugins.isEmpty {
            // Before the first chat: the plugins on disk (synced ones, and the installed ones Claude lists).
            let fm = FileManager.default
            var dirs: [String] = []
            if let e = fm.enumerator(atPath: "\(h)/.claude/plugins/synced") {
                while let f = e.nextObject() as? String {
                    if e.level > 4 { e.skipDescendants(); continue }
                    if f.hasSuffix(".claude-plugin/plugin.json") { dirs.append("\(h)/.claude/plugins/synced/\(f)") }
                }
            }
            for dir in dirs {
                guard let d = try? Data(contentsOf: URL(fileURLWithPath: dir)), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                      let n = o["name"] as? String else { continue }
                plugins.append((n, URL(fileURLWithPath: dir).deletingLastPathComponent().deletingLastPathComponent().path))
            }
        }
        for (name, path) in plugins { out += Self.scan(skills: "\(path)/skills", commands: "\(path)/commands", plugin: name) }
        // Only what Claude has switched on, when it has told us.
        if let on = saved?["slash_commands"] as? [String] {
            let set = Set(on)
            // Synced skills sit in ~/.claude/skills but Claude names them "<namespace>:<skill>" (anthropic-skills:pdf):
            // take Claude's own name, so the "/" we send is one it knows.
            var bySuffix: [String: String] = [:]
            for n in on { if let i = n.lastIndex(of: ":") { bySuffix[String(n[n.index(after: i)...])] = bySuffix[String(n[n.index(after: i)...])] ?? n } }
            out = out.compactMap { s in
                if set.contains(s.name) { return s }
                guard !s.name.contains(":"), let full = bySuffix[s.name] else { return nil }
                return Skill(name: full, description: s.description, path: s.path, source: String(full.split(separator: ":")[0]), command: s.command)
            }
        }
        return out
    }

    /// The skills an agent offers, by name, for the "/" menu.
    func skills(for provider: String) -> [Skill] {
        let h = Self.home
        var list: [Skill]
        switch provider {
        case "claude-code": list = claudeSkills()
        case "codex": list = Self.scan(skills: "\(h)/.codex/skills", commands: "\(h)/.codex/prompts") + Self.scan(skills: "\(h)/.agents/skills")
        case "cursor":
            list = Self.scan(skills: "\(h)/.cursor/skills", commands: "\(h)/.cursor/commands") + Self.scan(skills: "\(h)/.cursor/skills-cursor")
                + Self.scan(skills: "\(h)/.agents/skills")
        case "gemini-cli": list = Self.scan(skills: "\(h)/.gemini/skills") + Self.geminiCommands("\(h)/.gemini/commands") + Self.scan(skills: "\(h)/.agents/skills")
        case "copilot": list = Self.scan(skills: "\(h)/.copilot/skills") + Self.scan(skills: "\(h)/.agents/skills")
        case "opencode":
            list = Self.scan(skills: "\(h)/.config/opencode/skills", commands: "\(h)/.config/opencode/commands") + Self.scan(skills: "\(h)/.agents/skills")
        case "kiro": list = Self.scan(skills: "\(h)/.kiro/skills", commands: "\(h)/.kiro/prompts")
        case "goose": list = Self.scan(skills: "\(h)/.agents/skills") + Self.scan(skills: "\(h)/.config/goose/skills")
        case "cline": list = Self.scan(skills: "\(h)/.cline/skills")
        case "hermes": list = Self.scan(skills: "\(h)/.hermes/skills", depth: 2)
        default: list = []
        }
        var seen = Set<String>()
        return list.filter { seen.insert($0.name).inserted }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func skillsForPage(_ provider: String) -> [[String: Any]] {
        skills(for: provider).map { ["name": $0.name, "description": $0.description, "source": $0.source, "command": $0.command] }
    }

    /// The message for a picked skill: Claude runs "/name" itself; the others get the skill's instructions first.
    func promptWithSkill(_ provider: String, name: String, prompt: String, native: Bool) -> String? {
        guard let s = skills(for: provider).first(where: { $0.name == name }) else { return nil }
        // Claude runs its skills and commands itself, Gemini its custom commands: they get "/name …".
        if native && (provider == "claude-code" || (provider == "gemini-cli" && s.path.hasSuffix(".toml"))) {
            return "/\(s.name)\(prompt.isEmpty ? "" : " \(prompt)")"
        }
        guard let file = Self.readSkillFile(s.path) else { return nil }
        let folder = URL(fileURLWithPath: s.path).deletingLastPathComponent().path
        return """
        Use the skill “\(s.name)” for this request. Its instructions follow (from \(s.path)); files it mentions are in \(folder).
        <skill name="\(s.name)">
        \(file.body)
        </skill>

        \(prompt.isEmpty ? "(No further request: begin as the skill says.)" : prompt)
        """
    }
}
