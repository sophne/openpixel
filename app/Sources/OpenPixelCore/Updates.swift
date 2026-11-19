import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Whether a newer OpenPixel is out, read from the same appcast Sparkle uses, so agents can tell the person and
/// work on the newest version. Nothing is installed here: the window's Update button and Sparkle's dialog do that.
public enum Updates {
    static let defaultFeed = "https://github.com/sophne/openpixel/releases/latest/download/appcast.xml"

    /// The feed in the app's Info.plist (never one an agent chooses). Tests point it at a local file.
    public static var feedOverride: URL?
    static var feedURL: URL {
        if let o = feedOverride { return o }
        let s = Bundle.main.infoDictionary?["SUFeedURL"] as? String
        return URL(string: s ?? defaultFeed) ?? URL(string: defaultFeed)!
    }

    /// The version of OpenPixel installed on disk now. It differs from the running version when the app was
    /// updated while this process kept running (an agent's MCP server started before the update).
    public static func installedVersion() -> String? {
        let b = Bundle.main.bundleURL
        guard b.pathExtension == "app",
              let info = NSDictionary(contentsOf: b.appendingPathComponent("Contents/Info.plist")) else { return nil }
        return info["CFBundleShortVersionString"] as? String
    }

    /// -1, 0 or 1, comparing dotted version numbers ("1.10.0" is newer than "1.9.2").
    public static func compare(_ a: String, _ b: String) -> Int {
        let x = a.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        let y = b.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p < q ? -1 : 1 }
        }
        return 0
    }

    public struct Release { public let version: String; public let notes: String?; public let download: String? }

    /// The newest release listed in an appcast.
    public static func parse(_ xml: String) -> Release? {
        func first(_ pattern: String, in s: String) -> String? {
            guard let r = s.range(of: pattern, options: .regularExpression) else { return nil }
            let m = String(s[r])
            guard let open = m.firstIndex(of: ">"), let close = m.lastIndex(of: "<") ?? m.lastIndex(of: "\""), open < close else { return nil }
            return String(m[m.index(after: open)..<close]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var best: Release?
        for chunk in xml.components(separatedBy: "<item>").dropFirst() {
            let item = chunk.components(separatedBy: "</item>")[0]
            guard let v = first("<sparkle:shortVersionString>[^<]*</sparkle:shortVersionString>", in: item) else { continue }
            let notes = first("<sparkle:fullReleaseNotesLink>[^<]*</sparkle:fullReleaseNotesLink>", in: item)
            var download: String?
            if let r = item.range(of: "<enclosure[^>]*url=\"[^\"]*\"", options: .regularExpression) {
                let e = String(item[r])
                if let u = e.range(of: "url=\"") { download = String(e[u.upperBound...].dropLast()) }
            }
            if best == nil || compare(v, best!.version) > 0 { best = Release(version: v, notes: notes, download: download) }
        }
        return best
    }

    static let lock = NSLock()
    static var cached: (at: Date, release: Release)?
    static let cacheSeconds: TimeInterval = 600

    /// The newest release, from the feed (cached for 10 minutes).
    public static func latest(refresh: Bool = false) throws -> Release {
        lock.lock(); defer { lock.unlock() }
        if !refresh, let c = cached, Date().timeIntervalSince(c.at) < cacheSeconds { return c.release }
        let url = feedURL
        let data: Data
        if url.isFileURL { data = try Data(contentsOf: url) } else {
            var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
            req.setValue("OpenPixel/\(MCPServer.version)", forHTTPHeaderField: "User-Agent")
            let sem = DispatchSemaphore(value: 0)
            var got: Data?, failure: Error?
            URLSession.shared.dataTask(with: req) { d, resp, e in
                if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
                    failure = PCError.invalid("the update feed answered HTTP \(h.statusCode)")
                } else { got = d; failure = e }
                sem.signal()
            }.resume()
            if sem.wait(timeout: .now() + 12) == .timedOut { throw PCError.invalid("the update feed did not answer (offline?)") }
            if let failure { throw PCError.invalid("could not reach the update feed: \(failure.localizedDescription)") }
            data = got ?? Data()
        }
        guard let r = parse(String(decoding: data, as: UTF8.self)) else { throw PCError.invalid("the update feed lists no release") }
        cached = (Date(), r)
        return r
    }

    /// What check_for_updates answers for the program that runs it.
    public static func report(running: String = MCPServer.version, refresh: Bool = false) throws -> [String: Any] {
        let r = try latest(refresh: refresh)
        let newer = compare(r.version, running) > 0
        var o: [String: Any] = ["running_version": running, "latest_version": r.version, "update_available": newer]
        if let n = r.notes { o["release_notes"] = n }
        if let d = r.download { o["download"] = d }
        if let disk = installedVersion(), compare(disk, running) > 0 {
            o["installed_version"] = disk
            o["restart_needed"] = "OpenPixel \(disk) is installed but this program still runs \(running). Restart it to use the new version."
        }
        o["next"] = newer
            ? "Tell the person OpenPixel \(r.version) is out. check_for_updates install=true shows the update dialog in the OpenPixel window for them to confirm (or they click Update at the bottom of the sidebar). After it restarts, reconnect the OpenPixel MCP server so you get the new version's tools."
            : "OpenPixel is up to date."
        return o
    }
}
