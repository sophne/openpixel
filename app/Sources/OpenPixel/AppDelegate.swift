import AppKit
import WebKit
import OpenPixelCore
import UniformTypeIdentifiers
import Sparkle

/// The editor window: a native Mac window whose design canvas is HTML (WKWebView), backed by the
/// Swift engine. The same engine answers agents through the local bridge (see `OpenPixel --mcp`).
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, NSWindowDelegate, SPUUpdaterDelegate {
    let engine = Engine()
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
    lazy var recents = Recents(folder: uiTestFolder.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? Recents.defaultFolder)

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
        if let p = openPath, (try? engine.execute("open_model", ["path": p], source: "person")) != nil {
        } else {
            Sample.build(into: engine, threeD: false)
        }
        trace("model ready")
        engine.onChange = { [weak self] tool in
            guard let self else { return }
            if tool == "open_model" || tool == "save_model" { self.recents.touch(engine: self.engine) }
            self.scheduleRefresh(tool)
        }
        engine.hostTools["get_editor_screenshot"] = { [weak self] _ in
            guard let self else { throw PCError.invalid("window closed") }
            return try self.editorScreenshotBlocking()
        }
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
        if let f = uiTestFolder {
            // The test drives real agent connections through a private socket in its own folder.
            setenv("OPENPIXEL_SOCKET", URL(fileURLWithPath: f).appendingPathComponent("op.sock").path, 1)
            startBridge()
            window.orderFrontRegardless()
            DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in self?.finishUITest(["error": "timed out after 300 s"]) }
        } else if screenshotPath == nil {
            startBridge()
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        } else {
            // Checks must never take focus from what the person is doing.
            window.orderFrontRegardless()
            trace("window shown")
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.saveScreenshotAndQuit() }
        }
    }

    /// Progress notes on stderr while making a --screenshot picture.
    func trace(_ s: String) {
        if headless { FileHandle.standardError.write("[\(uiTestFolder != nil ? "ui-test" : "screenshot")] \(s)\n".data(using: .utf8)!) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    /// Files opened from Finder.
    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        do { _ = try engine.execute("open_model", ["path": filename], source: "person"); return true } catch {
            if window != nil { showError(error) }
            return false
        }
    }

    func applicationWillTerminate(_ note: Notification) { bridge?.stop() }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !headless, engine.dirty else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "Save changes to “\(engine.doc.name)”?"
        alert.informativeText = "Your changes will be lost if you don't save them."
        alert.addButton(withTitle: "Save…")
        alert.addButton(withTitle: "Don't Save")
        alert.addButton(withTitle: "Cancel")
        switch alert.runModal() {
        case .alertFirstButtonReturn: return saveDocument(saveAs: false) ? .terminateNow : .terminateCancel
        case .alertSecondButtonReturn: return .terminateNow
        default: return .terminateCancel
        }
    }

    lazy var agents = AgentRegistry(folder: recents.folder)

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
        var flags = "window.OPENPIXEL_START = \(Self.jsString(openPath == nil ? "home" : "editor"));"
        if let f = uiTestFolder { flags += " window.OPENPIXEL_UITEST = { folder: \(Self.jsString(f)) };" }
        config.userContentController.addUserScript(WKUserScript(source: flags, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if screenshotPath != nil {
            // Tells the page to report when it has drawn its frames (no query string on the file address).
            config.userContentController.addUserScript(WKUserScript(source: "window.OPENPIXEL_SCREENSHOT = true;",
                                                                    injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        trace("web view made")

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, screen.width - 40), height: min(900, screen.height - 40))
        window = NSWindow(contentRect: NSRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2,
                                              width: size.width, height: size.height),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.minSize = NSSize(width: 980, height: 620)
        window.backgroundColor = NSColor(red: 0x2c / 255, green: 0x2c / 255, blue: 0x2c / 255, alpha: 1)
        window.contentView = web
        window.delegate = self
        window.isReleasedWhenClosed = false
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
        case "recents": return recents.listForPage()
        case "samples": return Recents.samplePreviews()
        case "removeRecent": recents.remove(body["path"] as? String ?? ""); return true
        case "reveal":
            if let p = body["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) }
            return true
        case "openPath":
            do { _ = try engine.execute("open_model", ["path": body["path"] as? String ?? ""], source: "person"); return true } catch {
                return "\(error)"
            }
        case "sample2d": open2DSample(nil); return true
        case "sample3d": open3DSample(nil); return true
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
            do { _ = try self.engine.execute("open_model", ["path": u.path], source: "person") } catch { self.showError(error) }
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
    @objc func open3DSample(_ sender: Any?) { Sample.open3D(in: engine) }
    @objc func open2DSample(_ sender: Any?) {
        for (tool, args) in Sample.sprite { _ = try? engine.execute(tool, args, source: "sample") }
    }
    @objc func jsCommand(_ sender: NSMenuItem) {
        if let cmd = sender.representedObject as? String { web.evaluateJavaScript("PC.command(\(Self.jsString(cmd)))") }
    }

    func showError(_ error: Error) {
        let a = NSAlert(); a.messageText = "OpenPixel"; a.informativeText = "\(error)"; a.runModal()
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
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
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
            .separator(),
            item("Open the 2D Sample Sprite", #selector(open2DSample(_:)), ""),
            item("Open the 3D Sample Model", #selector(open3DSample(_:)), ""),
        ])
        NSApp.mainMenu = main
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
