import AppKit
import WebKit
import OpenPixelCore
import UniformTypeIdentifiers
import Sparkle

/// The editor window: a native Mac window whose design canvas is HTML (WKWebView), backed by the
/// Swift engine. The same engine answers agents through the local bridge (see `OpenPixel --mcp`).
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, NSWindowDelegate, SPUUpdaterDelegate {
    /// One open file in the tab bar, with its own engine (document, undo history, activity).
    final class DocTab {
        let id: Int
        let engine: Engine
        /// A built-in sample or an imported .vox: it gets a file of its own only once it is changed.
        var saveOnEdit = false
        init(id: Int, engine: Engine) { self.id = id; self.engine = engine }
    }
    /// Where new files are saved: ~/Documents/OpenPixel (the folder agents over HTTP can reach too).
    lazy var filesFolder: URL = uiTestFolder.map { URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("Files", isDirectory: true) }
        ?? MCPHTTPServer.filesFolder
    var autosaveScheduled = false
    /// The open files, in tab-bar order.
    var tabs: [DocTab] = []
    var nextTabID = 1
    /// The engine the editor and agents work on: the active tab's, or a blank spare while no file is open
    /// (the spare becomes a tab as soon as an agent starts drawing in it).
    var engine = Engine()
    var pendingOpens: [String] = []
    var window: NSWindow!
    var web: WKWebView!
    var bridge: BridgeServer?
    let screenshotPath: String?
    let openPath: String?
    var refreshScheduled = false
    var lastTool = ""

    let uiTestFolder: String?
    /// Screenshot and UI-test runs never take focus, never open the agent bridge and never ask to save.
    var headless: Bool { screenshotPath != nil || uiTestFolder != nil }
    /// UI tests start from an empty library in their own folder, so every run sees the same home screen.
    /// Recents and the library. UI tests use their own folder; --screenshot uses a throwaway one, so taking a picture
    /// never adds the file to the person's Recents.
    lazy var recents = Recents(folder: uiTestFolder.map { URL(fileURLWithPath: $0, isDirectory: true) }
                                   ?? (screenshotPath != nil ? FileManager.default.temporaryDirectory.appendingPathComponent("OpenPixel-screenshot-\(UUID().uuidString)", isDirectory: true) : Recents.defaultFolder),
                               load: uiTestFolder == nil && screenshotPath == nil)

    init(screenshotPath: String?, openPath: String?, uiTestFolder: String? = nil) {
        self.screenshotPath = screenshotPath
        self.uiTestFolder = uiTestFolder
        self.openPath = openPath
    }

    // MARK: - launch

    func applicationDidFinishLaunching(_ note: Notification) { launchIfNeeded() }

    var launched = false
    /// Sets up the window once. Called when AppKit finishes launching, and also as soon as the event loop
    /// runs: a bundled app started directly from a terminal may never get the launch-finished signal.
    func launchIfNeeded() {
        if launched { return }
        launched = true
        trace("setting up")
        if headless { NSApp.setActivationPolicy(.accessory) }
        engine = makeSpare()
        if let p = openPath {
            let e = Engine()
            if (try? e.execute("open_model", ["path": p], source: "person")) != nil {
                wire(e)
                engine = e
                addTab(e)
                recents.touch(engine: e)
            }
        }
        trace("model ready")
        // Automatic updates run only in the real app bundle (not in checks, tests or the bare program).
        if !headless && Bundle.main.bundleURL.pathExtension == "app" {
            updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
            // Ask quietly on every open whether a newer version exists (no dialog, no download), so the Update
            // button can appear in the home and editor sidebars. Installing still goes through Sparkle's dialog.
            if let u = updater?.updater, u.canCheckForUpdates { u.checkForUpdateInformation() }
        }
        buildMenu()
        trace("menu ready")
        buildWindow()
        trace("window built")
        for p in pendingOpens { do { try openFile(p) } catch { showError(error) } }
        pendingOpens.removeAll()
        if let f = uiTestFolder {
            // The test drives real agent connections through a private socket in its own folder.
            setenv("OPENPIXEL_SOCKET", URL(fileURLWithPath: f).appendingPathComponent("op.sock").path, 1)
            // Files the last run saved would push new ones to "Name 2": each run starts with its own empty folder.
            if filesFolder.lastPathComponent == "Files", filesFolder.path.hasPrefix(URL(fileURLWithPath: f).standardizedFileURL.path) {
                try? FileManager.default.removeItem(at: filesFolder)
            }
            startBridge()
            window.orderFrontRegardless()
            DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in self?.finishUITest(["error": "timed out after 300 s"]) }
        } else if screenshotPath == nil {
            startBridge()
            NSApp.activate(ignoringOtherApps: true)
            if demoConfig != nil {
                // A demo recording: the size of the website's window shots, kept above other windows so WebKit never
                // stops drawing it while it is covered.
                window.setContentSize(NSSize(width: 1440, height: 855))
                window.center()
                window.level = .floating
            }
            window.makeKeyAndOrderFront(nil)
        } else {
            // Checks must never take focus from what the person is doing.
            window.orderFrontRegardless()
            trace("window shown")
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.saveScreenshotAndQuit() }
        }
        // Showing the window lays its title bar out again; put the window buttons back on the tab bar's centre line.
        placeWindowButtons()
        DispatchQueue.main.async { [weak self] in self?.placeWindowButtons() }
    }

    /// Progress notes on stderr while making a --screenshot picture.
    func trace(_ s: String) {
        if headless { FileHandle.standardError.write("[\(uiTestFolder != nil ? "ui-test" : "screenshot")] \(s)\n".data(using: .utf8)!) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    /// Files opened from Finder.
    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        // Files Finder hands over while the app is still starting open once the window exists.
        if window == nil { pendingOpens.append(filename); return true }
        do { try openFile(filename); return true } catch {
            if window != nil { showError(error) }
            return false
        }
    }

    func applicationWillTerminate(_ note: Notification) { bridge?.stop(); chatRunner?.stopAll() }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !headless else { return .terminateNow }
        autosaveAll()
        for tab in tabs where tab.engine.dirty {
            if !askToSave(tab) { return .terminateCancel }
        }
        return .terminateNow
    }

    /// Asks whether to save a tab's unsaved changes. False when the person cancels (or the save fails).
    func askToSave(_ tab: DocTab) -> Bool {
        if tab.engine !== engine { activate(tab) }
        let alert = NSAlert()
        alert.messageText = "Save changes to “\(tab.engine.doc.name)”?"
        alert.informativeText = "OpenPixel could not save them by itself. Your changes will be lost if you don't save them."
        alert.addButton(withTitle: "Save…")
        alert.addButton(withTitle: "Don't Save")
        alert.addButton(withTitle: "Cancel")
        switch alert.runModal() {
        case .alertFirstButtonReturn: return saveDocument(saveAs: false)
        case .alertSecondButtonReturn: return true
        default: return false
        }
    }

    // MARK: - tabs

    /// Engines tell the window when they change; only the active one redraws the page.
    func wire(_ e: Engine) {
        e.onChange = { [weak self, weak e] tool in
            guard let self, let e else { return }
            if tool == "open_model" || tool == "save_model" || tool == "autosave" { self.recents.touch(engine: e) }
            if e.dirty || (e.path == nil && tool != "autosave") { self.scheduleAutosave() }
            guard e === self.engine else { return }
            // An agent drawing while no file is open: what it makes becomes a tab.
            if !self.tabs.contains(where: { $0.engine === e }) { self.addTab(e) }
            self.scheduleRefresh(tool)
        }
        e.hostTools["get_editor_screenshot"] = { [weak self] _ in
            guard let self else { throw PCError.invalid("window closed") }
            return try self.editorScreenshotBlocking()
        }
    }

    /// A blank canvas for while no file is open.
    func makeSpare() -> Engine {
        let e = Engine()
        _ = try? e.execute("new_sprite", ["width": 32, "height": 32, "name": "Untitled"], source: "sample")
        e.markClean()
        wire(e)
        return e
    }

    @discardableResult
    func addTab(_ e: Engine) -> DocTab {
        let t = DocTab(id: nextTabID, engine: e)
        nextTabID += 1
        tabs.append(t)
        return t
    }

    func activate(_ tab: DocTab) {
        engine = tab.engine
        updateTitle()
    }

    /// Opens a new tab with a fresh engine and runs `setup` in it; the tab goes away again if that fails.
    func openInNewTab(_ setup: (Engine) throws -> Void) throws {
        let e = Engine()
        wire(e)
        let previous = engine
        let tab = addTab(e)
        engine = e
        do { try setup(e) } catch {
            tabs.removeAll { $0 === tab }
            engine = previous
            throw error
        }
        updateTitle()
        scheduleRefresh("open_model")
    }

    /// Opens a file, or switches to its tab when it is already open.
    func openFile(_ path: String) throws {
        let std = URL(fileURLWithPath: path).standardizedFileURL.path
        if let t = tabs.first(where: { $0.engine.path?.standardizedFileURL.path == std }) {
            activate(t)
            scheduleRefresh("open_model")
            return
        }
        try openInNewTab { e in _ = try e.execute("open_model", ["path": path], source: "person") }
        if let t = tabs.first(where: { $0.engine === engine }), t.engine.path == nil { t.saveOnEdit = true }
    }

    func openSampleTab(threeD: Bool) {
        try? openInNewTab { e in Sample.build(into: e, threeD: threeD) }
        if let t = tabs.first(where: { $0.engine === engine }), t.engine.path == nil { t.saveOnEdit = true }
    }

    // MARK: - autosave

    /// Changes are written to the file a moment after they happen (at most every 1.5 s while edits keep
    /// coming), so nothing is lost: a file that has none yet gets one in `filesFolder`.
    func scheduleAutosave() {
        guard screenshotPath == nil, !autosaveScheduled else { return }
        autosaveScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self else { return }
            self.autosaveScheduled = false
            self.autosaveAll()
        }
    }

    /// Saves every tab that needs it. False when one could not be saved.
    @discardableResult
    func autosaveAll() -> Bool {
        var saved = false, ok = true
        for tab in tabs where tab.engine.dirty || (tab.engine.path == nil && !tab.saveOnEdit) {
            if autosave(tab) { saved = true } else { ok = false }
        }
        if saved { scheduleRefresh("autosave") }
        return ok
    }

    @discardableResult
    func autosave(_ tab: DocTab) -> Bool {
        do {
            if tab.engine.path == nil { try tab.engine.autosave(to: newFileURL(tab.engine.doc.name)) } else { try tab.engine.autosave() }
            tab.saveOnEdit = false
            return true
        } catch {
            NSLog("OpenPixel could not autosave \(tab.engine.doc.name): \(error)")
            return false
        }
    }

    /// Renames a file (by its path, or the file open in a tab): on disk next to where it is, in Recents, and in its
    /// tab. A document without a file yet only changes its name; autosave then gives it a file by that name.
    /// True, or a message to show.
    func renameFile(path: String?, tabID: Int?, name: String) -> Any {
        let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !clean.hasPrefix(".") else { return "Give the file a name" }
        let std = path.map { URL(fileURLWithPath: $0).standardizedFileURL.path }
        let tab = tabID.flatMap { id in tabs.first { $0.id == id } }
            ?? std.flatMap { p in tabs.first { $0.engine.path?.standardizedFileURL.path == p } }
        guard let old = tab?.engine.path ?? path.map({ URL(fileURLWithPath: $0) }) else {
            guard let t = tab else { return "Could not find that file" }
            t.engine.rename(to: nil, name: clean)
            t.saveOnEdit = false
            scheduleRefresh("rename")
            return true
        }
        let ext = old.pathExtension.isEmpty ? "openpixel" : old.pathExtension
        let new = old.deletingLastPathComponent().appendingPathComponent(clean).appendingPathExtension(ext)
        let fm = FileManager.default
        if new.standardizedFileURL.path != old.standardizedFileURL.path {
            // Only the letter case changes: the Mac's disk sees the same name, so go through a temporary one.
            let caseOnly = new.path.lowercased() == old.path.lowercased()
            if !caseOnly, fm.fileExists(atPath: new.path) { return "There is already a file called “\(clean)” in that folder" }
            guard fm.fileExists(atPath: old.path) else { return "The file is not there any more" }
            do {
                if caseOnly {
                    let tmp = old.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString).\(ext)")
                    try fm.moveItem(at: old, to: tmp)
                    try fm.moveItem(at: tmp, to: new)
                } else {
                    try fm.moveItem(at: old, to: new)
                }
            } catch { return "Could not rename it: \(error.localizedDescription)" }
            recents.renamePath(old.path, to: new.path)
            // Its Agent Chat history follows the new name (on disk, and in the open page).
            chat().moveHistory(from: old.path, to: new.path)
            web?.evaluateJavaScript("window.PC && PC.chatMoved && PC.chatMoved(\(Self.jsString(old.path)), \(Self.jsString(new.path)))", completionHandler: nil)
        }
        if let t = tab { t.engine.rename(to: new, name: clean); autosave(t) }
        scheduleRefresh("rename")
        return true
    }

    /// A free name for a new file in `filesFolder`: "Name.openpixel", then "Name 2.openpixel" and so on.
    func newFileURL(_ name: String) throws -> URL {
        try FileManager.default.createDirectory(at: filesFolder, withIntermediateDirectories: true)
        var base = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty || base.hasPrefix(".") { base = "Untitled" + base }
        var u = filesFolder.appendingPathComponent(base + ".openpixel"), n = 2
        while FileManager.default.fileExists(atPath: u.path) || tabs.contains(where: { $0.engine.path?.standardizedFileURL == u.standardizedFileURL }) {
            u = filesFolder.appendingPathComponent("\(base) \(n).openpixel"); n += 1
        }
        return u
    }

    /// Closes a tab, asking about unsaved changes unless `force`. False when the person cancelled.
    @discardableResult
    func closeTab(_ id: Int, force: Bool = false) -> Bool {
        guard let i = tabs.firstIndex(where: { $0.id == id }) else { return true }
        let tab = tabs[i]
        if !force, tab.engine.dirty { autosave(tab) }
        if !force, tab.engine.dirty, !askToSave(tab) { return false }
        tabs.remove(at: i)
        if tab.engine === engine {
            if tabs.isEmpty { engine = makeSpare() } else { engine = tabs[min(i, tabs.count - 1)].engine }
            updateTitle()
        }
        return true
    }

    func tabsForPage() -> [String: Any] {
        let active = tabs.first { $0.engine === engine }?.id
        return ["tabs": tabs.map { t in
            ["id": t.id, "name": t.engine.path?.deletingPathExtension().lastPathComponent ?? t.engine.doc.name, "kind": t.engine.isSprite ? "2d" : "3d", "dirty": t.engine.dirty,
             "path": (t.engine.path?.path as Any?) ?? NSNull()] as [String: Any]
        }, "active": (active as Any?) ?? NSNull()]
    }

    @objc func closeTabMenu(_ sender: Any?) {
        web.evaluateJavaScript("window.PC && PC.closeActiveTab ? PC.closeActiveTab() : false") { [weak self] r, _ in
            if (r as? Bool) != true { self?.window.performClose(nil) }
        }
    }

    lazy var agents = AgentRegistry(folder: recents.folder)

    // MARK: - Chat panel (the person's own agents, run headless)

    var chatRunner: ChatRunner?
    func chat() -> ChatRunner {
        if let c = chatRunner { return c }
        let c = ChatRunner(mcpCommand: Bundle.main.executablePath ?? CommandLine.arguments[0],
                           workDir: recents.folder.appendingPathComponent("Chat", isDirectory: true)) { [weak self] e in
            guard let self, let web = self.web, let d = try? JSONSerialization.data(withJSONObject: Self.jsonSafe(e)) else { return }
            web.evaluateJavaScript("window.PC && PC.chatEvent && PC.chatEvent(\(String(decoding: d, as: UTF8.self)))", completionHandler: nil)
        }
        chatRunner = c
        return c
    }

    /// Chat messages from the page. Finding the tools runs a login shell and asks Cursor for its models, so it
    /// answers from a background queue; starting and stopping a run is quick.
    func handleChat(_ body: [String: Any], _ reply: @escaping (Any?, String?) -> Void) {
        guard uiTestFolder == nil || body["action"] as? String == "providers" else { reply(false, nil); return }
        let c = chat()
        switch body["action"] as? String ?? "" {
        case "providers":
            if uiTestFolder != nil { reply([], nil); return } // UI tests never look for or start the person's agents
            DispatchQueue.global(qos: .userInitiated).async {
                let list = c.providersForPage()
                DispatchQueue.main.async { reply(Self.jsonSafe(list), nil) }
            }
        case "send":
            DispatchQueue.global(qos: .userInitiated).async {
                let r = c.start(body)
                DispatchQueue.main.async { reply(r, nil) }
            }
        case "stop": c.stop(body["chat"] as? String ?? ""); reply(true, nil)
        case "skills":
            DispatchQueue.global(qos: .userInitiated).async {
                let list = c.skillsForPage(body["provider"] as? String ?? "")
                DispatchQueue.main.async { reply(Self.jsonSafe(list), nil) }
            }
        case "login": reply(c.login(body["provider"] as? String ?? ""), nil)
        case "history": reply(c.loadHistory(body["key"] as? String ?? ""), nil)
        case "saveHistory": reply(c.saveHistory(body["key"] as? String ?? "", body["data"]), nil)
        default: reply(nil, "unknown chat action")
        }
    }

    func startBridge() {
        let server = BridgeServer { [weak self] line, conn in
            guard let self else { return "{}" }
            // Each agent's MCP process first says who it is.
            if let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               let info = o["hello"] as? [String: Any] {
                self.agents.hello(conn, info)
                return "{\"ok\":true}"
            }
            // The editor screenshot needs the main thread to finish an async snapshot, so it waits here instead.
            if line.contains("\"get_editor_screenshot\"") {
                self.agents.called(conn, "get_editor_screenshot")
                return Bridge.response(for: line) { _, _ in try self.editorScreenshotBlocking() }
            }
            // The update check reads the feed over the network, so it runs here, off the main thread.
            if line.contains("\"check_for_updates\"") {
                self.agents.called(conn, "check_for_updates")
                return Bridge.response(for: line) { _, args in try self.checkForUpdatesForAgent(args) }
            }
            var out = ""
            DispatchQueue.main.sync {
                out = Bridge.response(for: line) { tool, args in
                    self.agents.called(conn, tool)
                    return try self.engine.execute(tool, args, source: "agent")
                }
            }
            return out
        }
        server.onOpen = { [weak self] id in self?.agents.opened(id) }
        server.onClose = { [weak self] id in self?.agents.closed(id) }
        do { try server.start(); bridge = server } catch {
            NSLog("OpenPixel: agent bridge unavailable: \(error)")
        }
    }

    func buildWindow() {
        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "pc")
        #if DEBUG
        // Web Inspector only in debug builds; release builds don't expose the page's internals.
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif
        var flags = "window.OPENPIXEL_START = \(Self.jsString(tabs.isEmpty ? "home" : "editor"));"
        if let f = uiTestFolder { flags += " window.OPENPIXEL_UITEST = { folder: \(Self.jsString(f)) };" }
        if let d = demoConfig { flags += " window.OPENPIXEL_DEMO = \(d);" }
        config.userContentController.addUserScript(WKUserScript(source: flags, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if screenshotPath != nil {
            // Pictures start from the app's defaults (sidebar open, panel widths), not from what the person set.
            config.websiteDataStore = .nonPersistent()
            // Tells the page to report when it has drawn its frames (no query string on the file address).
            config.userContentController.addUserScript(WKUserScript(source: "window.OPENPIXEL_SCREENSHOT = true;",
                                                                    injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        web = TitlebarWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        trace("web view made")

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, screen.width - 40), height: min(900, screen.height - 40))
        // The page's tab bar is the title bar (like Figma): the content runs under a transparent title bar
        // and the close, minimise and zoom buttons sit in the tab bar, centred in its height.
        window = NSWindow(contentRect: NSRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2,
                                              width: size.width, height: size.height),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 980, height: 620)
        // Liquid Glass: the window's chrome (tab bar, toolbar row, sidebars and panels) is one sheet of the system's
        // translucent sidebar glass, the desktop blurred through it; the page draws only the solid content sheets
        // (canvas, home pages) and floating glass on top. The app is dark, so the glass is too. With Reduce
        // Transparency on, macOS makes this glass opaque by itself.
        window.appearance = NSAppearance(named: .darkAqua)
        window.isOpaque = false
        window.backgroundColor = .clear
        let glass = NSVisualEffectView()
        glass.material = .sidebar
        glass.blendingMode = .behindWindow
        glass.state = .followsWindowActiveState
        web.autoresizingMask = [.width, .height]
        glass.addSubview(web)
        window.contentView = glass
        web.frame = glass.bounds
        window.delegate = self
        window.isReleasedWhenClosed = false
        placeWindowButtons()
        // Empty parts of the tab bar move the window (see TitlebarWebView).
        titlebarMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] e in
            guard let v = self?.web as? TitlebarWebView, v.handleTitlebarClick(e) else { return e }
            return nil
        }
        trace("window made")
        updateTitle()
        trace("title set")

        guard let dir = WebAssets.directory() else {
            web.loadHTMLString("<body style='background:#222;color:#ccc;font:14px sans-serif'>OpenPixel could not find its web folder.</body>", baseURL: nil)
            return
        }
        let folder = URL(fileURLWithPath: dir.path, isDirectory: true)
        webFolder = folder.standardizedFileURL.resolvingSymlinksInPath()
        let index = URL(fileURLWithPath: dir.appendingPathComponent("index.html").path, isDirectory: false)
        trace("loading \(index.path)")
        web.loadFileURL(index, allowingReadAccessTo: folder)
    }

    // MARK: - GitHub stars (tab bar)

    /// The repository's public star count for the tab bar. The page asks; the answer is the last known count (kept in
    /// the app's preferences), and at most once an hour the app asks GitHub's public API again in the background and
    /// sends the new count to the page. Only the repository's public data is read; nothing about the person is sent.
    static let starsAPI = URL(string: "https://api.github.com/repos/sophne/openpixel")!
    var starsFetching = false

    func githubStars() -> Any {
        let d = UserDefaults.standard
        let at = d.object(forKey: "githubStarsAt") as? Date
        // Checks and tests stay offline.
        if !headless, !starsFetching, at.map({ Date().timeIntervalSince($0) > 3600 }) ?? true { fetchGitHubStars() }
        return (d.object(forKey: "githubStars") as? Int as Any?) ?? NSNull()
    }

    func fetchGitHubStars() {
        starsFetching = true
        var req = URLRequest(url: Self.starsAPI, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("OpenPixel", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            let n = ok ? (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["stargazers_count"] as? Int : nil
            DispatchQueue.main.async {
                guard let self else { return }
                self.starsFetching = false
                guard let n, n >= 0 else { return } // offline or rate-limited: keep the last count, try again next time
                UserDefaults.standard.set(n, forKey: "githubStars")
                UserDefaults.standard.set(Date(), forKey: "githubStarsAt")
                self.web?.evaluateJavaScript("window.PC && PC.githubStars && PC.githubStars(\(n))", completionHandler: nil)
            }
        }.resume()
    }

    // MARK: - title bar

    /// Height of the page's tab bar (`--tabs-h` in style.css), which doubles as the window's title bar.
    static let tabBarHeight: CGFloat = 38
    var titlebarMonitor: Any?

    /// Left edge of the close button and the step to the next one; the page's tab bar leaves room up to 80px.
    static let windowButtonsX: CGFloat = 14, windowButtonsStep: CGFloat = 20
    var placingButtons = false, watchingButtons = false

    /// Puts the close, minimise and zoom buttons in the tab bar, centred on its middle line (19pt from the top),
    /// the same line as Home, the tabs and +. AppKit lays the title bar out again whenever it likes (showing the
    /// window, activation, resizes, full screen), so this also runs each time those buttons move.
    func placeWindowButtons() {
        guard !placingButtons, let w = window, let close = w.standardWindowButton(.closeButton),
              let titlebar = close.superview, let container = titlebar.superview else { return }
        placingButtons = true
        defer { placingButtons = false }
        let h = Self.tabBarHeight
        let bar = NSRect(x: container.frame.minX, y: w.frame.height - h, width: container.frame.width, height: h)
        if container.frame != bar { container.frame = bar }
        if titlebar.frame != container.bounds { titlebar.frame = container.bounds }
        for (i, kind) in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].enumerated() {
            guard let b = w.standardWindowButton(kind) else { continue }
            let origin = NSPoint(x: Self.windowButtonsX + CGFloat(i) * Self.windowButtonsStep, y: ((h - b.frame.height) / 2).rounded())
            if b.frame.origin != origin { b.setFrameOrigin(origin) }
        }
        if !watchingButtons {
            watchingButtons = true
            for v in [close, titlebar, container] {
                v.postsFrameChangedNotifications = true
                NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: v, queue: .main) { [weak self] _ in
                    self?.placeWindowButtons()
                }
            }
        }
    }

    func windowDidResize(_ notification: Notification) { placeWindowButtons() }
    func windowDidEndLiveResize(_ notification: Notification) { placeWindowButtons() }
    func windowDidBecomeKey(_ notification: Notification) { placeWindowButtons() }
    func windowDidResignKey(_ notification: Notification) { placeWindowButtons() }
    func windowDidEnterFullScreen(_ notification: Notification) {
        web?.evaluateJavaScript("window.PC && PC.fullScreen && PC.fullScreen(true)", completionHandler: nil)
    }
    func windowDidExitFullScreen(_ notification: Notification) {
        placeWindowButtons()
        web?.evaluateJavaScript("window.PC && PC.fullScreen && PC.fullScreen(false)", completionHandler: nil)
    }

    func updateTitle() {
        guard let window else { return }
        window.title = "OpenPixel — \(engine.doc.name)\(engine.dirty ? " •" : "")"
        window.representedURL = engine.path
        window.isDocumentEdited = engine.dirty
    }

    func scheduleRefresh(_ tool: String) {
        lastTool = tool
        if refreshScheduled { return }
        refreshScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.refreshScheduled = false
            self.updateTitle()
            self.web?.evaluateJavaScript("window.PC && PC.refresh(\(Self.jsString(self.lastTool)))", completionHandler: nil)
        }
    }

    static func jsString(_ s: String) -> String {
        let d = try? JSONSerialization.data(withJSONObject: [s])
        let arr = d.map { String(decoding: $0, as: UTF8.self) } ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }

    // MARK: - messages from the HTML canvas

    /// The bundled web folder the page was loaded from; the web view never leaves it.
    var webFolder: URL?

    /// The page holds the native bridge (`pc`), so it may only show OpenPixel's own bundled files: no web
    /// pages, no other local files, no new windows. Links the page itself opens go through `openURL`.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        if url?.absoluteString == "about:blank" { return decisionHandler(.allow) }
        guard let u = url, u.isFileURL, let root = webFolder,
              u.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(root.path + "/") else {
            NSLog("OpenPixel: blocked navigation to \(url?.absoluteString ?? "nil")")
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else {
            replyHandler(nil, "bad message"); return
        }
        switch kind {
        case "tool":
            let name = body["name"] as? String ?? ""
            let args = body["args"] as? [String: Any] ?? [:]
            do {
                let out = try engine.execute(name, args, source: "person")
                var json = out.json
                if !out.images.isEmpty { json["images"] = out.images.map { "data:image/png;base64," + $0.base64EncodedString() } }
                replyHandler(Self.jsonSafe(json), nil)
            } catch {
                replyHandler(nil, "\(error)")
            }
        case "native":
            replyHandler(runNative(body["action"] as? String ?? "", body), nil)
        case "chat":
            handleChat(body, replyHandler)
        case "snap":
            // UI test: save a picture of the window under a name, then answer.
            let name = (body["name"] as? String ?? "snap").replacingOccurrences(of: "/", with: "-")
            web.takeSnapshot(with: nil) { [weak self] img, _ in
                if let f = self?.uiTestFolder, let img, let d = Self.pngData(img) {
                    try? d.write(to: URL(fileURLWithPath: f).appendingPathComponent(name + ".png"))
                }
                replyHandler(true, nil)
            }
        case "resizeWindow":
            let w = body["width"] as? Double ?? 1440, h = body["height"] as? Double ?? 900
            window.setContentSize(NSSize(width: w, height: h))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { replyHandler(true, nil) }
        case "spawnAgent" where uiTestFolder != nil:
            // UI test: start `OpenPixel --mcp` like an agent would, introduce it as `client`, make one call.
            let p = Process()
            p.executableURL = URL(fileURLWithPath: Bundle.main.executablePath ?? CommandLine.arguments[0])
            p.arguments = ["--mcp"]
            let input = Pipe()
            p.standardInput = input
            p.standardOutput = FileHandle.nullDevice
            p.standardError = FileHandle.nullDevice
            do { try p.run() } catch { replyHandler(nil, "\(error)"); return }
            testAgents.append((p, input))
            let client = body["client"] as? String ?? "test-agent"
            var lines = [
                #"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"\#(client)","version":"1.0"}}}"#,
                #"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            ]
            // `call: false` starts an agent that connects but hasn't done anything yet.
            if body["call"] as? Bool ?? true {
                lines.append(#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_model_info","arguments":{}}}"#)
            }
            input.fileHandleForWriting.write((lines.joined(separator: "\n") + "\n").data(using: .utf8)!)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { replyHandler(true, nil) }
        case "stopAgents" where uiTestFolder != nil:
            for (p, input) in testAgents { try? input.fileHandleForWriting.close(); p.waitUntilExit() }
            testAgents.removeAll()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { replyHandler(true, nil) }
        case "uitestDone":
            for (p, _) in testAgents { p.terminate() }
            replyHandler(true, nil)
            finishUITest(body["report"] as? [String: Any] ?? [:])
        case "demo":
            demoMessage(body, replyHandler)
        case "frames":
            trace("page drew \(body["count"] ?? 0) frames")
            replyHandler(true, nil)
            if screenshotPath != nil { saveScreenshotAndQuit() }
        default:
            replyHandler(nil, "unknown message")
        }
    }

    /// WebKit replies must be property-list-like; NSNull is fine, but tuples/Data are not.
    static func jsonSafe(_ v: Any) -> Any {
        guard let d = try? JSONSerialization.data(withJSONObject: v),
              let o = try? JSONSerialization.jsonObject(with: d) else { return [:] }
        return o
    }

    func runNative(_ action: String, _ body: [String: Any]) -> Any {
        switch action {
        case "new": return true
        case "open": openDocument(); return true
        case "save": return saveDocument(saveAs: false)
        case "saveAs": return saveDocument(saveAs: true)
        case "export": exportDocument(body["format"] as? String ?? "png", options: body["options"] as? [String: Any] ?? [:]); return true
        case "copyText":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(body["text"] as? String ?? "", forType: .string)
            return true
        case "agents":
            var o = agents.snapshot(includeSetup: body["setup"] as? Bool ?? true)
            o["command"] = Bundle.main.executablePath ?? CommandLine.arguments[0]
            o["bridge"] = bridge != nil
            return o
        case "githubStars": return githubStars()
        case "openLink":
            // OpenPixel's own pages (sidebar links). The page names one; only these addresses can open.
            let links = ["website": "https://openpixel.dev", "github": "https://github.com/sophne/openpixel", "x": "https://x.com/eminvkc"]
            if let key = body["link"] as? String, let s = links[key], let u = URL(string: s) { return NSWorkspace.shared.open(u) }
            return false
        case "openURL":
            // Only app links the Agents page uses (Cursor's install link); never web pages.
            if let s = body["url"] as? String, s.hasPrefix("cursor://"), let u = URL(string: s) { return NSWorkspace.shared.open(u) }
            return false
        case "revealConfig":
            let p = NSString(string: body["path"] as? String ?? "").expandingTildeInPath
            if FileManager.default.fileExists(atPath: p) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]); return true }
            return false
        case "checkUpdates": checkForUpdates(nil); return true
        case "version":
            return ["version": MCPServer.version, "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "",
                    "updates": updater != nil, "automatic": updater?.updater.automaticallyChecksForUpdates ?? false,
                    "available": (availableUpdate as Any?) ?? NSNull()]
        case "library": return recents.listForPage()
        case "removeRecent": recents.remove(body["path"] as? String ?? ""); return true
        case "reveal":
            if let p = body["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) }
            return true
        case "openPath":
            do { try openFile(body["path"] as? String ?? ""); return true } catch {
                return "\(error)"
            }
        case "sample2d": openSampleTab(threeD: false); return true
        case "sample3d": openSampleTab(threeD: true); return true
        case "createFolder":
            return recents.createFolder(name: body["name"] as? String, parent: body["parent"] as? String) ?? false
        case "renameFolder": return recents.renameFolder(body["id"] as? String ?? "", body["name"] as? String)
        case "renameFile": return renameFile(path: body["path"] as? String, tabID: body["tab"] as? Int, name: body["name"] as? String ?? "")
        case "moveFolder": return recents.moveFolder(body["id"] as? String ?? "", to: body["parent"] as? String)
        case "deleteFolder": return recents.deleteFolder(body["id"] as? String ?? "")
        case "moveItem": return recents.moveItem(body["id"] as? String ?? "", to: body["folder"] as? String)
        case "archiveItem": return recents.setArchived(body["id"] as? String ?? "", body["archived"] as? Bool ?? true)
        case "deleteItem":
            let id = body["id"] as? String ?? ""
            // An open file is closed first; one with unsaved changes stays until the person deals with it.
            if let t = tabs.first(where: { $0.engine.path?.path == id }) {
                if t.engine.dirty { autosave(t) }
                if t.engine.dirty { return "“\(t.engine.doc.name)” is open with unsaved changes. Close its tab first." }
                closeTab(t.id, force: true)
                scheduleRefresh("close_tab")
            }
            if let why = recents.deleteForever(id) { return why }
            // A file deleted for good takes its Agent Chat history with it.
            if !Recents.sampleIDs.contains(id) { chat().deleteHistory(id) }
            return true
        case "tabs": return tabsForPage()
        case "switchTab":
            if let id = body["id"] as? Int, let t = tabs.first(where: { $0.id == id }) { activate(t) }
            return tabsForPage()
        case "closeTab":
            let ok = closeTab(body["id"] as? Int ?? -1)
            var o = tabsForPage(); o["closed"] = ok
            return o
        case "moveTab":
            if let id = body["id"] as? Int, let to = body["index"] as? Int, let i = tabs.firstIndex(where: { $0.id == id }) {
                let t = tabs.remove(at: i)
                tabs.insert(t, at: max(0, min(tabs.count, to)))
            }
            return tabsForPage()
        case "newDocument":
            let tool = body["tool"] as? String == "new_model" ? "new_model" : "new_sprite"
            do {
                try openInNewTab { e in _ = try e.execute(tool, body["args"] as? [String: Any] ?? [:], source: "person"); e.markClean() }
                if let t = tabs.first(where: { $0.engine === engine }) { autosave(t) }
                return tabsForPage()
            } catch { return "\(error)" }
        case "titlebar":
            // Where the page's tab bar has its own controls; the rest of the bar moves the window.
            if let v = web as? TitlebarWebView {
                v.holes = (body["holes"] as? [[Double]] ?? []).compactMap { $0.count == 2 && $0[0] <= $0[1] ? CGFloat($0[0])...CGFloat($0[1]) : nil }
                v.dragEnabled = body["drag"] as? Bool ?? true
            }
            return true
        case "haptic":
            NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
            return true
        case "mcpCommand": return Bundle.main.executablePath ?? CommandLine.arguments[0]
        case "socketPath": return Bridge.socketPath
        default: return false
        }
    }

    // MARK: - files

    @objc func newDocument(_ sender: Any?) { web.evaluateJavaScript("PC.showNewDialog()") }

    @objc func openDocument(_ sender: Any? = nil) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "openpixel") ?? .json, UTType(filenameExtension: "vox") ?? .data]
        panel.allowsOtherFileTypes = true
        panel.beginSheetModal(for: window) { [weak self] r in
            guard r == .OK, let u = panel.url, let self else { return }
            do { try self.openFile(u.path) } catch { self.showError(error) }
        }
    }

    @objc func saveMenu(_ sender: Any?) { _ = saveDocument(saveAs: false) }
    @objc func saveAsMenu(_ sender: Any?) { _ = saveDocument(saveAs: true) }

    @discardableResult
    func saveDocument(saveAs: Bool) -> Bool {
        if !saveAs, engine.path != nil {
            do { _ = try engine.execute("save_model", [:], source: "person"); return true } catch { showError(error); return false }
        }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "openpixel") ?? .json]
        panel.nameFieldStringValue = engine.doc.name + ".openpixel"
        guard panel.runModal() == .OK, let u = panel.url else { return false }
        do { _ = try engine.execute("save_model", ["path": u.path], source: "person"); return true } catch { showError(error); return false }
    }

    @objc func exportMenu(_ sender: NSMenuItem) { exportDocument(sender.representedObject as? String ?? "png", options: [:]) }

    func exportDocument(_ format: String, options: [String: Any]) {
        let ext: String, tool: String
        switch format {
        case "sheet": ext = "png"; tool = "export_sheet"
        case "gif": ext = "gif"; tool = "export_gif"
        case "vox": ext = "vox"; tool = "export_vox"
        case "obj": ext = "obj"; tool = "export_obj"
        case "svg": ext = "svg"; tool = "export_svg"
        case "html": ext = "html"; tool = "export_html"
        default: ext = "png"; tool = "export_png"
        }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        panel.nameFieldStringValue = engine.doc.name + (format == "sheet" ? "-sheet" : "") + "." + ext
        panel.beginSheetModal(for: window) { [weak self] r in
            guard r == .OK, let u = panel.url, let self else { return }
            var args = options
            args["path"] = u.path
            do { _ = try self.engine.execute(tool, args, source: "person") } catch { self.showError(error) }
        }
    }

    @objc func undoMenu(_ sender: Any?) { _ = try? engine.execute("undo", [:], source: "person") }
    @objc func redoMenu(_ sender: Any?) { _ = try? engine.execute("redo", [:], source: "person") }
    @objc func agentHelp(_ sender: Any?) { web.evaluateJavaScript("PC.showAgentHelp()") }
    @objc func open3DSample(_ sender: Any?) { openSampleTab(threeD: true) }
    @objc func open2DSample(_ sender: Any?) { openSampleTab(threeD: false) }
    @objc func jsCommand(_ sender: NSMenuItem) {
        if let cmd = sender.representedObject as? String { web.evaluateJavaScript("PC.command(\(Self.jsString(cmd)))") }
    }

    func showError(_ error: Error) {
        let a = NSAlert(); a.messageText = "OpenPixel"; a.informativeText = "\(error)"; a.runModal()
    }

    // MARK: - demo recordings (website hero)

    var recordFolder: String?
    var demoConfig: String?
    var recordTimer: Timer?
    var recordBusy = false
    var recordFrames: [[String: Any]] = []
    var recordMarks: [[String: Any]] = []
    var recordStart = Date()

    /// The page's demo script asks to record at a frame rate, to mark moments, and to stop (with a final picture).
    func demoMessage(_ body: [String: Any], _ reply: @escaping (Any?, String?) -> Void) {
        let ms = { Int(Date().timeIntervalSince(self.recordStart) * 1000) }
        switch body["action"] as? String ?? "" {
        case "record":
            guard let folder = recordFolder else { reply(false, nil); return }
            try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            if recordTimer == nil { recordStart = Date() }
            recordTimer?.invalidate()
            let fps = max(0.2, body["fps"] as? Double ?? 10)
            recordTimer = Timer.scheduledTimer(withTimeInterval: 1 / fps, repeats: true) { [weak self] _ in self?.recordFrame() }
            RunLoop.main.add(recordTimer!, forMode: .common)
            reply(true, nil)
        case "mark":
            recordMarks.append(["name": body["name"] as? String ?? "", "ms": ms(), "frame": recordFrames.count])
            reply(true, nil)
        case "stop":
            recordTimer?.invalidate(); recordTimer = nil
            recordMarks.append(["name": "stop", "ms": ms(), "frame": recordFrames.count])
            let folder = recordFolder ?? NSTemporaryDirectory()
            let manifest: [String: Any] = ["frames": recordFrames, "marks": recordMarks]
            if let d = try? JSONSerialization.data(withJSONObject: manifest, options: .prettyPrinted) {
                try? d.write(to: URL(fileURLWithPath: folder).appendingPathComponent("manifest.json"))
            }
            let final = body["screenshot"] as? String ?? URL(fileURLWithPath: folder).appendingPathComponent("final.png").path
            web.takeSnapshot(with: nil) { img, _ in
                if let img, let d = Self.pngData(img) { try? d.write(to: URL(fileURLWithPath: final)) }
                reply(true, nil)
                if body["quit"] as? Bool ?? true { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.terminate(nil) } }
            }
        default: reply(nil, "unknown demo action")
        }
    }

    /// One frame of the recording: the window's page at full resolution, written off the main thread.
    func recordFrame() {
        guard !recordBusy, let folder = recordFolder else { return }
        recordBusy = true
        let t = Int(Date().timeIntervalSince(recordStart) * 1000), n = recordFrames.count
        recordFrames.append(["n": n, "ms": t])
        web.takeSnapshot(with: nil) { [weak self] img, _ in
            guard let self else { return }
            guard let img, let tiff = img.tiffRepresentation else { self.recordBusy = false; return }
            DispatchQueue.global(qos: .userInitiated).async {
                if let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: folder).appendingPathComponent(String(format: "f%06d.png", n)))
                }
                DispatchQueue.main.async { self.recordBusy = false }
            }
        }
    }

    // MARK: - screenshots

    func editorScreenshotBlocking() throws -> ToolOutput {
        if Thread.isMainThread { throw PCError.invalid("get_editor_screenshot must come from an agent") }
        let sem = DispatchSemaphore(value: 0)
        var png: Data?
        DispatchQueue.main.async { [weak self] in
            guard let self, let web = self.web else { sem.signal(); return }
            web.takeSnapshot(with: nil) { img, _ in
                png = img.flatMap(Self.pngData)
                sem.signal()
            }
        }
        if sem.wait(timeout: .now() + 10) == .timedOut { throw PCError.invalid("the window did not answer") }
        guard let data = png else { throw PCError.invalid("could not capture the window") }
        return ToolOutput(["note": "The OpenPixel editor as the person sees it."], images: [data])
    }

    static func pngData(_ img: NSImage) -> Data? {
        guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }

    func finishUITest(_ report: [String: Any]) {
        guard let f = uiTestFolder, !uiTestDone else { return }
        uiTestDone = true
        if let d = try? JSONSerialization.data(withJSONObject: Self.jsonSafe(report), options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: URL(fileURLWithPath: f).appendingPathComponent("report.json"))
        }
        trace("report written")
        NSApp.terminate(nil)
    }
    var uiTestDone = false
    var testAgents: [(Process, Pipe)] = []

    var screenshotDone = false
    func saveScreenshotAndQuit() {
        guard let path = screenshotPath, !screenshotDone else { return }
        screenshotDone = true
        trace("snapshot requested")
        web.takeSnapshot(with: nil) { img, err in
            self.trace("snapshot answered")
            if let img, let data = Self.pngData(img) {
                let u = URL(fileURLWithPath: path)
                try? FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
                do { try data.write(to: u) } catch { FileHandle.standardError.write("could not write \(path): \(error)\n".data(using: .utf8)!) }
            } else {
                FileHandle.standardError.write("snapshot failed: \(String(describing: err))\n".data(using: .utf8)!)
            }
            NSApp.terminate(nil)
        }
    }

    // MARK: - menu

    var updater: SPUStandardUpdaterController?
    /// The newer version Sparkle found, shown as the Update button; nil when up to date or not checked yet.
    var availableUpdate: String?

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        availableUpdate = item.displayVersionString
        showUpdateButton()
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        availableUpdate = nil
        showUpdateButton()
    }

    /// check_for_updates from an agent (on the bridge's thread): the feed's answer, the Update button kept in step,
    /// and with install=true Sparkle's dialog, where the person confirms. Nothing installs without them.
    func checkForUpdatesForAgent(_ args: [String: Any]) throws -> ToolOutput {
        let a = Args(args)
        var o = try Updates.report(refresh: a.bool("refresh", false))
        let available = o["update_available"] as? Bool ?? false, latest = o["latest_version"] as? String
        let install = a.bool("install", false), canUpdate = updater != nil
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if canUpdate { self.availableUpdate = available ? latest : nil; self.showUpdateButton() }
            if install && available { self.checkForUpdates(nil) }
        }
        if install {
            o["install"] = !available ? "Nothing to install."
                : canUpdate ? "The update dialog is open in OpenPixel. The person confirms; OpenPixel then restarts with the new version. Reconnect the OpenPixel MCP server afterwards."
                : "This copy of OpenPixel is not the installed app and cannot update itself; the person can download the new version from the link."
        }
        return ToolOutput(o)
    }

    /// Tells the page; it also asks for availableUpdate itself when it loads, in case this came first.
    func showUpdateButton() {
        let v = availableUpdate.map { Self.jsString($0) } ?? "null"
        web?.evaluateJavaScript("window.PC && PC.updateAvailable && PC.updateAvailable(\(v))", completionHandler: nil)
    }

    @objc func checkForUpdates(_ sender: Any?) {
        if let u = updater { u.checkForUpdates(sender); return }
        let a = NSAlert()
        a.messageText = "Updates"
        a.informativeText = "Updates are checked by the installed OpenPixel app (in Applications). This copy was started on its own."
        a.runModal()
    }

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command,
                  object: Any? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.representedObject = object
            return i
        }
        func submenu(_ title: String, _ items: [NSMenuItem]) {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let m = NSMenu(title: title)
            items.forEach { m.addItem($0) }
            top.submenu = m
            main.addItem(top)
        }
        submenu("OpenPixel", [
            item("About OpenPixel", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            item("Check for Updates…", #selector(checkForUpdates(_:)), ""),
            .separator(),
            item("Hide OpenPixel", #selector(NSApplication.hide(_:)), "h"),
            item("Quit OpenPixel", #selector(NSApplication.terminate(_:)), "q"),
        ])
        let export = NSMenuItem(title: "Export", action: nil, keyEquivalent: "")
        let exportMenu = NSMenu(title: "Export")
        for (t, f, k) in [("PNG Picture…", "png", "e"), ("Sprite Sheet…", "sheet", ""), ("Animated GIF…", "gif", ""), ("SVG Vector…", "svg", ""), ("HTML Page…", "html", ""),
                          ("MagicaVoxel .vox…", "vox", ""), ("OBJ Mesh…", "obj", "")] {
            exportMenu.addItem(item(t, #selector(self.exportMenu(_:)), k, [.command, .shift], object: f))
        }
        export.submenu = exportMenu
        submenu("File", [
            item("New Model…", #selector(newDocument(_:)), "n"),
            item("Open…", #selector(openDocument(_:)), "o"),
            .separator(),
            item("Save", #selector(saveMenu(_:)), "s"),
            item("Save As…", #selector(saveAsMenu(_:)), "s", [.command, .shift]),
            export,
            .separator(),
            item("Close Tab", #selector(closeTabMenu(_:)), "w"),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w", [.command, .shift]),
        ])
        submenu("Edit", [
            item("Undo", #selector(undoMenu(_:)), "z"),
            item("Redo", #selector(redoMenu(_:)), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        // ⌫ as a key equivalent shows as ⌘⌫ in the menu.
        let backspace = String(UnicodeScalar(UInt8(8)))
        submenu("View", [
            item("2D Canvas", #selector(jsCommand(_:)), "1", object: "viewSlice"),
            item("3D View", #selector(jsCommand(_:)), "2", object: "view3d"),
            .separator(),
            item("Zoom In", #selector(jsCommand(_:)), "=", object: "zoomIn"),
            item("Zoom Out", #selector(jsCommand(_:)), "-", object: "zoomOut"),
            item("Fit / Reset View", #selector(jsCommand(_:)), "0", object: "resetCamera"),
            .separator(),
            item("Pixel Grid", #selector(jsCommand(_:)), "'", object: "pixelGrid"),
            item("Show or Hide Frames", #selector(jsCommand(_:)), "", object: "frames"),
            item("Show or Hide Sidebar", #selector(jsCommand(_:)), "\\", object: "sidebar"),
            .separator(),
            item("Review Model", #selector(jsCommand(_:)), "r", object: "review"),
        ])
        submenu("Layer", [
            item("New Layer", #selector(jsCommand(_:)), "n", [.command, .shift], object: "newLayer"),
            item("Duplicate Layer", #selector(jsCommand(_:)), "d", object: "duplicateLayer"),
            item("Merge Down", #selector(jsCommand(_:)), "e", object: "mergeDown"),
            .separator(),
            item("Delete Layer", #selector(jsCommand(_:)), backspace, object: "deleteLayer"),
        ])
        submenu("Frame", [
            item("New Frame", #selector(jsCommand(_:)), "n", [.command, .option], object: "newFrame"),
            item("Delete Frame", #selector(jsCommand(_:)), backspace, [.command, .option], object: "deleteFrame"),
            .separator(),
            item("Play / Stop", #selector(jsCommand(_:)), "", object: "playStop"),
            item("Onion Skin", #selector(jsCommand(_:)), "", object: "onion"),
        ])
        submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
        ])
        submenu("Help", [
            item("Keyboard Shortcuts", #selector(jsCommand(_:)), "/", object: "shortcuts"),
            item("Connect an AI Agent…", #selector(agentHelp(_:)), ""),
        ])
        NSApp.mainMenu = main
    }
}

/// The web view also draws the window's title bar: the page's tab bar sits where a title would be. Empty parts of
/// that bar move the window, and a double-click there zooms or minimises it, as set in System Settings. The page
/// reports where its tabs and buttons are (the `titlebar` message); clicks there go to the page as usual.
/// WebKit takes mouse events in its own inner views, so the app looks at each click first (`handleTitlebarClick`,
/// called from an event monitor) instead of overriding mouseDown.
final class TitlebarWebView: WKWebView {
    /// Horizontal ranges (page points) of the bar the page uses for its own controls.
    var holes: [ClosedRange<CGFloat>] = []
    /// Off while a dialog covers the bar, so its backdrop still closes it.
    var dragEnabled = true

    /// True when the click was on an empty part of the bar and moved (or zoomed) the window.
    func handleTitlebarClick(_ event: NSEvent) -> Bool {
        guard dragEnabled, let w = window, event.window === w else { return false }
        // The close, minimise and zoom buttons answer their own clicks.
        for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            if let b = w.standardWindowButton(kind), b.convert(b.bounds, to: nil).contains(event.locationInWindow) { return false }
        }
        let p = convert(event.locationInWindow, from: nil)
        let fromTop = isFlipped ? p.y : bounds.height - p.y
        guard fromTop >= 0, fromTop < AppDelegate.tabBarHeight, p.x >= 0, p.x <= bounds.width,
              !holes.contains(where: { $0.contains(p.x) }) else { return false }
        if event.clickCount == 2 {
            switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize" {
            case "Minimize": w.performMiniaturize(nil)
            case "None": break
            default: w.performZoom(nil)
            }
        } else {
            w.performDrag(with: event)
        }
        return true
    }
}

/// Finds the HTML/CSS/JS of the design canvas: inside the .app bundle, or next to the sources when run from SwiftPM.
enum WebAssets {
    static func directory() -> URL? {
        var candidates: [URL] = []
        if let r = Bundle.main.resourceURL { candidates.append(r.appendingPathComponent("web")) }
        let exe = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
        candidates.append(exe.appendingPathComponent("web"))
        candidates.append(exe.appendingPathComponent("../Resources/web"))
        // Running from `swift run` / .build: the web folder sits at the package root.
        var dir = exe
        for _ in 0..<5 { dir = dir.deletingLastPathComponent(); candidates.append(dir.appendingPathComponent("web")) }
        candidates.append(URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web"))
        return candidates.first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("index.html").path) }?.standardized
    }
}
