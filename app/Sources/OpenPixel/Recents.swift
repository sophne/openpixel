import Foundation
import AppKit
import OpenPixelCore

/// The home screen's library: recently opened or saved files (path, name, size and a small preview picture),
/// the folders the person sorts them into, what they archived, and the built-in samples. Folders and the archive
/// only organise this list; files stay where they are on disk until they are deleted forever (then they go to the
/// Trash). Kept in Application Support/OpenPixel (recents.json, library.json and thumbs/). Nothing leaves this computer.
final class Recents {
    struct Entry: Codable {
        var path: String
        var name: String
        var kind: String
        var size: [Int]
        var touched: Double
        var thumb: String?
        /// The library folder it sits in (nil: top level).
        var folder: String?
        var archived: Bool?
    }

    struct Folder: Codable {
        var id: String
        var name: String
        var parent: String?
        var created: Double
    }

    /// Where a built-in sample sits in the library, and whether it was archived or deleted.
    struct SampleState: Codable {
        var folder: String?
        var archived: Bool?
        var deleted: Bool?
    }

    struct Library: Codable {
        var folders: [Folder] = []
        var samples: [String: SampleState] = [:]
    }

    let folder: URL
    private(set) var entries: [Entry] = []
    private(set) var library = Library()
    /// Loose files kept in Recents; files in folders or in the archive are never dropped.
    static let limit = 40
    static let sampleIDs = ["sample2d", "sample3d"]

    init(folder: URL, load: Bool = true) {
        self.folder = folder
        try? FileManager.default.createDirectory(at: folder.appendingPathComponent("thumbs"), withIntermediateDirectories: true)
        if load, let d = try? Data(contentsOf: folder.appendingPathComponent("recents.json")),
           let list = try? JSONDecoder().decode([Entry].self, from: d) {
            entries = list
        }
        if load, let d = try? Data(contentsOf: folder.appendingPathComponent("library.json")),
           let lib = try? JSONDecoder().decode(Library.self, from: d) {
            library = lib
        }
    }

    static var defaultFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("OpenPixel", isDirectory: true)
    }

    func save() {
        if let d = try? JSONEncoder().encode(entries) { try? d.write(to: folder.appendingPathComponent("recents.json"), options: .atomic) }
        if let d = try? JSONEncoder().encode(library) { try? d.write(to: folder.appendingPathComponent("library.json"), options: .atomic) }
    }

    static func thumbName(_ path: String) -> String {
        // Stable name per path (FNV-1a; Swift's hashValue changes between launches).
        var h: UInt64 = 0xcbf29ce484222325
        for b in path.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return String(format: "%016llx.png", h)
    }

    /// Records an engine's file (after an open or a save) with a fresh preview. Opening an archived file brings it back.
    func touch(engine: Engine) {
        guard let url = engine.path else { return }
        let doc = engine.doc
        let thumbName = Self.thumbName(url.path)
        let args: [String: Any] = ["frame": 0, "scale": engine.isSprite ? max(1, 128 / max(doc.sx, doc.sy)) : max(1, 160 / (max(doc.sx, doc.sy, doc.sz) * 2))]
        if let png = (try? engine.execute("render_view", args, source: "home"))?.images.first {
            try? png.write(to: folder.appendingPathComponent("thumbs").appendingPathComponent(thumbName), options: .atomic)
        }
        let old = entries.first { $0.path == url.path }
        entries.removeAll { $0.path == url.path }
        entries.insert(Entry(path: url.path, name: url.deletingPathExtension().lastPathComponent,
                             kind: engine.isSprite ? "2d" : "3d", size: [doc.sx, doc.sy, doc.sz],
                             touched: Date().timeIntervalSince1970, thumb: thumbName,
                             folder: old?.folder.flatMap { id in library.folders.contains { $0.id == id } ? id : nil },
                             archived: old?.archived), at: 0)
        var loose = 0
        entries.removeAll { e in
            guard e.folder == nil, e.archived != true else { return false }
            loose += 1
            return loose > Recents.limit
        }
        save()
    }

    func remove(_ path: String) {
        entries.removeAll { $0.path == path }
        save()
    }

    // MARK: - folders

    func folderExists(_ id: String?) -> Bool { id == nil || library.folders.contains { $0.id == id } }

    /// The folder and every folder inside it, at any depth.
    func subtree(_ id: String) -> Set<String> {
        var out: Set<String> = [id]
        var grew = true
        while grew {
            grew = false
            for f in library.folders where !out.contains(f.id) && f.parent.map(out.contains) == true { out.insert(f.id); grew = true }
        }
        return out
    }

    static func cleanName(_ s: String?, _ fallback: String) -> String {
        let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? fallback : String(t.prefix(120))
    }

    func createFolder(name: String?, parent: String?) -> String? {
        guard folderExists(parent) else { return nil }
        let id = UUID().uuidString.lowercased()
        library.folders.append(Folder(id: id, name: Self.cleanName(name, "New folder"), parent: parent, created: Date().timeIntervalSince1970))
        save()
        return id
    }

    /// A file was renamed on disk: its entry (folder, archive, preview) moves with it.
    func renamePath(_ old: String, to new: String) {
        guard let i = entries.firstIndex(where: { $0.path == old }) else { return }
        let thumbs = folder.appendingPathComponent("thumbs")
        let newThumb = Self.thumbName(new)
        if let t = entries[i].thumb { try? FileManager.default.moveItem(at: thumbs.appendingPathComponent(t), to: thumbs.appendingPathComponent(newThumb)) }
        entries[i].path = new
        entries[i].name = URL(fileURLWithPath: new).deletingPathExtension().lastPathComponent
        entries[i].thumb = newThumb
        save()
    }

    func renameFolder(_ id: String, _ name: String?) -> Bool {
        guard let i = library.folders.firstIndex(where: { $0.id == id }) else { return false }
        library.folders[i].name = Self.cleanName(name, library.folders[i].name)
        save()
        return true
    }

    /// Moves a folder into another one (nil: top level). A folder can't go inside itself.
    func moveFolder(_ id: String, to parent: String?) -> Bool {
        guard let i = library.folders.firstIndex(where: { $0.id == id }), folderExists(parent) else { return false }
        if let p = parent, subtree(id).contains(p) { return false }
        library.folders[i].parent = parent
        save()
        return true
    }

    /// Deletes a folder and the folders inside it. Their files go to the archive (at the top level when restored).
    func deleteFolder(_ id: String) -> Bool {
        guard library.folders.contains(where: { $0.id == id }) else { return false }
        let gone = subtree(id)
        library.folders.removeAll { gone.contains($0.id) }
        for i in entries.indices where entries[i].folder.map(gone.contains) == true {
            entries[i].folder = nil; entries[i].archived = true
        }
        for (k, s) in library.samples where s.folder.map(gone.contains) == true {
            library.samples[k] = SampleState(folder: nil, archived: true, deleted: s.deleted)
        }
        save()
        return true
    }

    // MARK: - files and samples (an item is a file path or a sample id)

    func moveItem(_ id: String, to folderID: String?) -> Bool {
        guard folderExists(folderID) else { return false }
        if Self.sampleIDs.contains(id) {
            var s = library.samples[id] ?? SampleState()
            s.folder = folderID; s.archived = nil
            library.samples[id] = s
        } else if let i = entries.firstIndex(where: { $0.path == id }) {
            entries[i].folder = folderID; entries[i].archived = nil
        } else { return false }
        save()
        return true
    }

    func setArchived(_ id: String, _ archived: Bool) -> Bool {
        if Self.sampleIDs.contains(id) {
            var s = library.samples[id] ?? SampleState()
            s.archived = archived ? true : nil
            if !archived, !folderExists(s.folder) { s.folder = nil }
            library.samples[id] = s
        } else if let i = entries.firstIndex(where: { $0.path == id }) {
            entries[i].archived = archived ? true : nil
            if !archived, !folderExists(entries[i].folder) { entries[i].folder = nil }
            if !archived { entries[i].touched = max(entries[i].touched, Date().timeIntervalSince1970 - 1) }
        } else { return false }
        save()
        return true
    }

    /// Deletes an item for good: a sample disappears from the library, a file goes to the Trash.
    /// Returns nil when done, or why it couldn't be.
    func deleteForever(_ id: String) -> String? {
        if Self.sampleIDs.contains(id) {
            var s = library.samples[id] ?? SampleState()
            s.deleted = true; s.archived = nil; s.folder = nil
            library.samples[id] = s
            save()
            return nil
        }
        guard let e = entries.first(where: { $0.path == id }) else { return "That file is no longer in the library." }
        let url = URL(fileURLWithPath: e.path)
        if FileManager.default.fileExists(atPath: e.path) {
            do { try FileManager.default.trashItem(at: url, resultingItemURL: nil) } catch {
                return "Could not move “\(e.name)” to the Trash: \(error.localizedDescription)"
            }
        }
        if let t = e.thumb { try? FileManager.default.removeItem(at: folder.appendingPathComponent("thumbs").appendingPathComponent(t)) }
        entries.removeAll { $0.path == id }
        save()
        return nil
    }

    // MARK: - for the home screen

    /// Everything the home screen shows: files (with previews inlined and whether each still exists),
    /// samples (unless deleted) and folders.
    func listForPage() -> [String: Any] {
        var files: [[String: Any]] = entries.map { e in
            var o: [String: Any] = ["id": e.path, "path": e.path, "name": e.name, "kind": e.kind, "size": e.size, "touched": e.touched,
                                    "dir": (e.path as NSString).deletingLastPathComponent.replacingOccurrences(of: NSHomeDirectory(), with: "~"),
                                    "exists": FileManager.default.fileExists(atPath: e.path),
                                    "folder": (e.folder.flatMap { folderExists($0) ? $0 : nil } as Any?) ?? NSNull(),
                                    "archived": e.archived == true]
            if let t = e.thumb, let d = try? Data(contentsOf: folder.appendingPathComponent("thumbs").appendingPathComponent(t)) {
                o["thumb"] = "data:image/png;base64," + d.base64EncodedString()
            }
            return o
        }
        for var s in Self.samplePreviews() {
            let id = s["id"] as? String ?? ""
            let st = library.samples[id] ?? SampleState()
            if st.deleted == true { continue }
            s["sample"] = true
            s["exists"] = true
            s["touched"] = 0
            s["folder"] = (st.folder.flatMap { folderExists($0) ? $0 : nil } as Any?) ?? NSNull()
            s["archived"] = st.archived == true
            files.append(s)
        }
        let folders: [[String: Any]] = library.folders.map {
            ["id": $0.id, "name": $0.name, "parent": ($0.parent as Any?) ?? NSNull(), "created": $0.created]
        }
        return ["files": files, "folders": folders]
    }

    private static var sampleCache: [[String: Any]]?
    /// Previews of the two built-in samples, made once.
    static func samplePreviews() -> [[String: Any]] {
        if let c = sampleCache { return c }
        var out: [[String: Any]] = []
        for (id, threeD) in [("sample2d", false), ("sample3d", true)] {
            let e = Engine()
            Sample.build(into: e, threeD: threeD)
            let args: [String: Any] = threeD ? ["scale": 3] : ["scale": 4]
            let png = (try? e.execute("render_view", args, source: "home"))?.images.first
            out.append(["id": id, "name": threeD ? "Island (3D sample)" : "Mushroom (2D sample)",
                        "kind": threeD ? "3d" : "2d", "size": [e.doc.sx, e.doc.sy, e.doc.sz],
                        "thumb": png.map { "data:image/png;base64," + $0.base64EncodedString() } ?? NSNull()])
        }
        sampleCache = out
        return out
    }
}
