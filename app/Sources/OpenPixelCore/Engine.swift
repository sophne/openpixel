import Foundation

/// What a tool call returns: a JSON object, plus PNG pictures for review tools.
public struct ToolOutput {
    public var json: [String: Any]
    public var images: [Data]
    public init(_ json: [String: Any] = [:], images: [Data] = []) { self.json = json; self.images = images }
}

/// The document, its undo history and every tool. The editor window and agents (MCP) both drive it,
/// so whatever an agent does shows up live on the canvas and can be undone by the person.
public final class Engine {
    public internal(set) var doc: Document
    public internal(set) var activeLayer = 0
    public internal(set) var activeFrame = 0
    public internal(set) var path: URL?
    public internal(set) var revision = 0
    public internal(set) var dirty = false
    var undoStack: [(doc: Document, label: String, layer: Int, frame: Int)] = []
    var redoStack: [(doc: Document, label: String, layer: Int, frame: Int)] = []
    var snapshots: [String: Document] = [:]
    public private(set) var activity: [[String: Any]] = []

    /// Undo depth kept in memory. Models are small and copy-on-write, so a generous fixed cap is used.
    public static let undoLimit = 500

    /// Called after any change (on the caller's thread).
    public var onChange: ((_ tool: String) -> Void)?
    /// Tools the host (the app window) answers, e.g. get_editor_screenshot.
    public var hostTools: [String: ([String: Any]) throws -> ToolOutput] = [:]

    /// The style every agent edit must follow (set_style). Kept across new canvases, so a set stays consistent.
    public internal(set) var style: StyleLock?
    /// Who is calling right now ("agent" or "person"): the style lock binds agents only.
    var source = "agent"
    /// set while a tool may replace the palette under a style lock (opening files, new canvases, set_style).
    var paletteLockBypass = false
    /// Automatic critique after each agent edit (set_feedback), and what the last one saw.
    var autoCritique = true
    var lastCritique: Critique?
    var critiqueRevision: Int?
    var critiques = 0
    var batchDepth = 0
    /// Above this many cells the automatic critique is skipped (analyze_model still works).
    static let critiqueCellLimit = 300_000

    public init(doc: Document = Document()) { self.doc = doc }

    // MARK: - entry point

    public func execute(_ name: String, _ raw: [String: Any], source: String = "agent") throws -> ToolOutput {
        let a = Args(raw)
        var out: ToolOutput
        let outer = self.source
        self.source = source
        defer { self.source = outer }
        do {
            out = try run(name, a)
            if source == "agent" { coach(name, &out) }
        } catch {
            log(name, source: source, ok: false, note: "\(error)")
            throw error
        }
        // The activity list shows every agent call, and the person's edits (not the editor's own reads).
        let spec = ToolCatalog.spec(name)
        if !(spec?.hidden ?? false) && (source == "agent" || !(spec?.readOnly ?? false)) {
            log(name, source: source, ok: true, note: nil)
        }
        return out
    }

    // MARK: - coaching agents

    /// What the agent's last review saw, so saves and exports can say when the work changed or still has open
    /// issues. Agents tend to review once and stop; this keeps the draw → review → fix loop going to the end.
    var reviewedRevision: Int?
    var reviewIssues = 0
    var reviews = 0
    var rampsMade = 0
    static let finishingTools: Set<String> = ["save_model", "export_png", "export_sheet", "export_gif", "export_svg",
                                              "export_html", "export_vox", "export_obj"]

    func coach(_ name: String, _ out: inout ToolOutput) {
        switch name {
        case "new_sprite", "new_model", "open_model":
            reviewedRevision = nil; reviewIssues = 0; reviews = 0; rampsMade = 0
            lastCritique = nil; critiques = 0; critiqueRevision = revision
            if let s = style { out.json["style"] = "\(s.name) (locked palette: \(s.lockPalette && s.palette != nil); see get_style)" }
            if name != "open_model" {
                out.json["next_steps"] = [
                    "pixel_art_guide once, if you have not read it",
                    "make_color_ramp base=<the material's middle colour> for each material (3-5 steps), plus a dark outline hue",
                    isSprite ? "paint_slice: silhouette, then flat colours" : "block out the big shapes",
                    "review_model, fix what it lists",
                    "shade, outline, details",
                    "review_model again and fix every issue before saving or exporting",
                ]
            }
        case "make_color_ramp":
            rampsMade += 1
        case "review_model", "analyze_model":
            reviewedRevision = revision
            reviews += 1
            let issues = out.json["issues"] as? [String] ?? []
            reviewIssues = issues.count
            var next: [String] = []
            if !issues.isEmpty { next.append("Fix the \(issues.count) issue(s) above, then call review_model again to confirm.") }
            let colourTrouble = issues.contains { $0.contains("almost identical colours") || $0.contains("colours; a sprite this size") }
            if colourTrouble && rampsMade == 0 {
                next.append("make_color_ramp base=<colour> gives each material evenly spaced shades; replace_color merges the near-duplicates into them.")
            }
            if issues.isEmpty && reviews == 1 { next.append("No issues. After further changes, review again before exporting.") }
            if !next.isEmpty { out.json["next"] = next }
            if let total = (out.json["score"] as? [String: Any])?["total"] as? Int {
                lastCritique = Critique(total: total, findings: Analysis.full(doc, frame: activeFrame, style: style).findings)
                critiqueRevision = revision
            }
        default:
            critique(name, &out)
            guard Engine.finishingTools.contains(name) else { return }
            if reviewedRevision == nil {
                out.json["review_reminder"] = "Saved without a review. Call review_model, fix what it lists, then save or export again."
            } else if let r = reviewedRevision, r != revision {
                out.json["review_reminder"] = "\(revision - r) edit(s) since the last review_model. Review again and fix what it lists before you finish."
            } else if reviewIssues > 0 {
                out.json["review_reminder"] = "The last review listed \(reviewIssues) issue(s). Fix them (or say why they are deliberate) and review again before you finish."
            }
        }
    }

    func log(_ name: String, source: String, ok: Bool, note: String?) {
        var e: [String: Any] = ["tool": name, "source": source, "ok": ok, "time": Date().timeIntervalSince1970]
        if let n = note { e["note"] = n }
        activity.append(e)
        if activity.count > 100 { activity.removeFirst(activity.count - 100) }
    }

    // MARK: - editing helpers

    /// Runs an edit as one undo step. Nothing is recorded when the document did not change.
    @discardableResult
    func edit(_ label: String, _ body: (inout Document) throws -> [String: Any]) throws -> ToolOutput {
        let before = doc
        var d = doc
        var res = try body(&d)
        if let s = style, s.lockPalette, s.palette != nil, source == "agent", !paletteLockBypass, d.palette != before.palette {
            try refuseOffPalette(before: before.palette, after: d.palette, style: s)
        }
        if d != before {
            undoStack.append((before, label, activeLayer, activeFrame))
            if undoStack.count > Engine.undoLimit { undoStack.removeFirst() }
            redoStack.removeAll()
            doc = d
            clampActive()
            revision += 1
            dirty = true
            onChange?(label)
        } else if res["changed"] == nil {
            res["changed"] = 0
        }
        res["revision"] = revision
        return ToolOutput(res)
    }

    func clampActive() {
        activeLayer = min(max(activeLayer, 0), doc.layers.count - 1)
        activeFrame = min(max(activeFrame, 0), doc.frames.count - 1)
    }

    func layerIndex(_ a: Args, in d: Document? = nil) throws -> Int {
        let doc = d ?? self.doc
        if let i = a.int("layer") {
            guard i >= 0 && i < doc.layers.count else { throw PCError.invalid("layer \(i) does not exist (0-\(doc.layers.count - 1))") }
            return i
        }
        if let n = a.string("layer"), !n.isEmpty {
            guard let i = doc.layers.firstIndex(where: { $0.name.lowercased() == n.lowercased() }) else {
                throw PCError.invalid("no layer named \"\(n)\"")
            }
            return i
        }
        return activeLayer
    }

    func frameIndex(_ a: Args, key: String = "frame") throws -> Int {
        if let i = a.int(key) {
            guard i >= 0 && i < doc.frames.count else { throw PCError.invalid("frame \(i) does not exist (0-\(doc.frames.count - 1))") }
            return i
        }
        return activeFrame
    }

    func editableLayer(_ a: Args) throws -> Int {
        let l = try layerIndex(a)
        if doc.layers[l].locked { throw PCError.invalid("layer \"\(doc.layers[l].name)\" is locked; unlock it with set_layer") }
        return l
    }

    /// Resolves a colour argument to a palette index, adding new hex colours to the palette.
    static func color(_ v: Any?, _ d: inout Document) throws -> UInt8 {
        if let n = Args.number(v), !(v is String) {
            let i = Int(n)
            guard i >= 0 && i < d.palette.count else { throw PCError.invalid("palette index \(i) does not exist (1-\(d.palette.count - 1))") }
            return UInt8(i)
        }
        if let s = v as? String {
            if let i = Int(s) { return try color(i, &d) }
            guard let c = RGBA.parse(s) else { throw PCError.invalid("\"\(s)\" is not a colour; use a palette index or #rrggbb") }
            return addColor(c, &d)
        }
        throw PCError.invalid("missing colour")
    }

    static func addColor(_ c: RGBA, _ d: inout Document) -> UInt8 {
        if let i = d.palette.indices.dropFirst().first(where: { d.palette[$0].r == c.r && d.palette[$0].g == c.g && d.palette[$0].b == c.b }) {
            return UInt8(i)
        }
        if d.palette.count < Document.maxColors { d.palette.append(RGBA(c.r, c.g, c.b)); return UInt8(d.palette.count - 1) }
        return nearest(c, d.palette)
    }

    static func nearest(_ c: RGBA, _ pal: [RGBA]) -> UInt8 {
        var best = 1, bestD = Int.max
        for i in 1..<pal.count { let dd = pal[i].distance(to: c); if dd < bestD { bestD = dd; best = i } }
        return UInt8(best)
    }

    func pen(_ a: Args, _ d: inout Document, colorKey: String = "color", needColor: Bool = true) throws -> Pen {
        let layer = try editableLayer(a)
        let frame = try frameIndex(a)
        let mode = PaintMode(rawValue: a.string("mode") ?? "replace") ?? .replace
        var c: UInt8 = 0
        if mode != .erase {
            if a.has(colorKey) { c = try Engine.color(a.d[colorKey], &d) } else if needColor {
                throw PCError.invalid("missing colour '\(colorKey)'")
            }
        }
        return Pen(layer: layer, frame: frame, color: c, mode: mode, symmetry: Symmetry.parse(a.string("symmetry")))
    }

    func frames(_ a: Args) throws -> [Int] { a.bool("all_frames", false) ? Array(doc.frames.indices) : [try frameIndex(a)] }
    func layers(_ a: Args) throws -> [Int] {
        if a.bool("all_layers", false) { return doc.layers.indices.filter { !doc.layers[$0].locked } }
        return [try editableLayer(a)]
    }

    // MARK: - info helpers

    public func info() -> [String: Any] {
        let g = doc.composite(frame: activeFrame)
        return [
            "name": doc.name, "size": [doc.sx, doc.sy, doc.sz],
            "kind": isSprite ? "2d-sprite" : "3d-model",
            "palette_colors": doc.palette.count - 1,
            "layers": doc.layers.enumerated().map { ["index": $0.offset, "name": $0.element.name,
                                                      "visible": $0.element.visible, "locked": $0.element.locked] },
            "frames": doc.frames.enumerated().map { ["index": $0.offset, "duration_ms": $0.element.duration] },
            "active_layer": activeLayer, "active_frame": activeFrame,
            "voxels_in_active_frame": g.reduce(0) { $0 + ($1 == 0 ? 0 : 1) },
            "file": path?.path ?? NSNull(), "unsaved_changes": dirty,
            "undo_steps": undoStack.count, "redo_steps": redoStack.count, "revision": revision,
            "conventions": ToolCatalog.conventions,
        ]
    }

    static let slots = Array("123456789abcdefghijklmnopqrstuvwxyz")
    static let extraSlots = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ!@$%&*+=?<>^~")

    /// True for a 2D sprite: a model one voxel deep.
    public var isSprite: Bool { doc.sz == 1 }

    /// Render settings from tool arguments. 2D sprites default to the exact front view: palette colours,
    /// no outline or shading, the whole canvas (so a scale-1 export is the sprite pixel for pixel).
    func renderOptions(_ a: Args, defaultScale: Int) -> RenderOptions {
        var o = RenderOptions()
        if isSprite { (o.yaw, o.pitch) = (0, 0); o.padding = 0; o.showBounds = true }
        if let v = a.string("view"), let ang = ViewPreset.angles(v) { (o.yaw, o.pitch) = ang }
        if let y = a.double("yaw") { o.yaw = y }
        if let p = a.double("pitch") { o.pitch = p }
        o.scale = max(1, min(64, a.int("scale") ?? defaultScale))
        let flatView = isSprite && Int(o.pitch) == 0 && Int(o.yaw) % 180 == 0
        o.flat = a.bool("flat", flatView)
        o.outline = a.bool("outline", !flatView)
        o.edges = a.bool("edges", !flatView)
        if let bg = a.string("background"), let c = RGBA.parse(bg) { o.background = c }
        return o
    }

    func url(_ a: Args, _ ext: String? = nil) throws -> URL {
        var p = try a.reqString("path")
        if p.hasPrefix("~") { p = NSString(string: p).expandingTildeInPath }
        var u = URL(fileURLWithPath: p)
        if let e = ext, u.pathExtension.lowercased() != e { u.appendPathExtension(e) }
        try FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        return u
    }

    // MARK: - tools

    func run(_ name: String, _ a: Args) throws -> ToolOutput {
        switch name {
        case "new_model":
            let sx = a.int("size_x", 32), sy = a.int("size_y", 32), sz = a.int("size_z", 32)
            try Document.checkSize(sx, sy, sz)
            let presetName = a.string("palette") ?? "db32"
            guard var pal = Palettes.named(presetName) else { throw PCError.invalid("unknown palette \(presetName); use \(Palettes.names.joined(separator: ", "))") }
            if let locked = style?.palette { pal = locked }
            paletteLockBypass = true
            defer { paletteLockBypass = false }
            let out = try edit("New model") { d in
                d = Document(name: a.string("name") ?? "Untitled", sx: sx, sy: sy, sz: sz, palette: pal)
                return [:]
            }
            activeLayer = 0; activeFrame = 0; path = nil; dirty = false
            onChange?("new_model")
            return ToolOutput(info().merging(out.json) { x, _ in x })

        case "get_model_info":
            return ToolOutput(info())

        case "new_sprite":
            var args = a.d
            let styled = style?.size?.count == 2 ? style?.size : nil
            args["size_x"] = a.int("width", styled?[0] ?? 32)
            args["size_y"] = a.int("height", styled?[1] ?? 32)
            args["size_z"] = 1
            return try run("new_model", Args(args))

        case "set_pixels":
            guard let list = a.array("pixels") else { throw PCError.invalid("missing pixels") }
            let depth = a.int("depth", 0)
            return try edit("Draw pixels") { d in
                var p = try pen(a, &d, needColor: false)
                let base = p.color
                var n = 0
                for item in list {
                    guard let v = item as? [Any], v.count >= 2, let x = Args.number(v[0]), let y = Args.number(v[1]) else {
                        throw PCError.invalid("each pixel is [x, y] or [x, y, color], with y counted from the top row")
                    }
                    if v.count >= 3 { p.color = try Engine.color(v[2], &d) } else {
                        guard base != 0 || p.mode == .erase else { throw PCError.invalid("give `color` or [x, y, color]") }
                        p.color = base
                    }
                    n += d.put(Int(x), d.sy - 1 - Int(y), depth, p)
                }
                return ["changed": n]
            }

        case "extrude_to_3d":
            let depth = try a.req("depth")
            guard depth >= 1 && depth <= Document.maxSize else { throw PCError.invalid("depth must be 1-\(Document.maxSize)") }
            let from = a.int("from_slice", 0)
            guard from >= 0 && from < doc.sz else { throw PCError.invalid("from_slice must be 0-\(doc.sz - 1)") }
            return try edit("Extrude to 3D") { d in
                let old = d
                try d.resize(d.sx, d.sy, depth, anchor: "origin")
                for l in 0..<d.layers.count { for f in 0..<d.frames.count {
                    for y in 0..<d.sy { for x in 0..<d.sx {
                        let v = old.get(l, f, x, y, from)
                        for z in 0..<depth { d.set(l, f, x, y, z, v) }
                    } }
                } }
                return ["size": [d.sx, d.sy, d.sz]]
            }

        case "open_model":
            let u = URL(fileURLWithPath: NSString(string: try a.reqString("path")).expandingTildeInPath)
            let data = try Data(contentsOf: u)
            let loaded: Document
            if u.pathExtension.lowercased() == "vox" {
                loaded = try VoxFile.decode(data, name: u.deletingPathExtension().lastPathComponent)
            } else {
                loaded = try NativeFile.decode(data)
            }
            paletteLockBypass = true
            defer { paletteLockBypass = false }
            try edit("Open \(u.lastPathComponent)") { d in d = loaded; return [:] }
            activeLayer = 0; activeFrame = 0
            path = u.pathExtension.lowercased() == "vox" ? nil : u
            dirty = false
            onChange?("open_model")
            return ToolOutput(info())

        case "save_model":
            var u: URL
            if a.has("path") { u = try url(a, "openpixel") } else if let p = path { u = p } else {
                throw PCError.invalid("no file yet: give a path ending in .openpixel")
            }
            if u.pathExtension.isEmpty { u.appendPathExtension("openpixel") }
            try NativeFile.encode(doc).write(to: u, options: .atomic)
            path = u; dirty = false
            onChange?("save_model")
            return ToolOutput(["saved": u.path])

        case "resize_model":
            let nx = try a.req("size_x"), ny = try a.req("size_y"), nz = try a.req("size_z")
            return try edit("Resize to \(nx)×\(ny)×\(nz)") { d in
                try d.resize(nx, ny, nz, anchor: a.string("anchor") ?? "bottom-center")
                return ["size": [nx, ny, nz]]
            }

        // Palette
        case "get_palette":
            return ToolOutput(["colors": doc.palette.enumerated().dropFirst().map { ["index": $0.offset, "hex": $0.element.hex] },
                               "presets": Palettes.names])

        case "set_palette":
            var pal: [RGBA]
            if let p = a.string("preset") {
                guard let named = Palettes.named(p) else { throw PCError.invalid("unknown preset \(p)") }
                pal = named
            } else if let list = a.array("colors") {
                pal = [RGBA(0, 0, 0, 0)] + list.prefix(255).compactMap { ($0 as? String).flatMap(RGBA.parse) }
                guard pal.count > 1 else { throw PCError.invalid("give at least one hex colour") }
            } else { throw PCError.invalid("give a preset or colors") }
            return try edit("Set palette") { d in
                // Keep indexes valid: pad with the old colours when the new palette is shorter than what's used.
                var maxUsed = 0
                for layer in d.cels { for cel in layer { for v in cel.data where Int(v) > maxUsed { maxUsed = Int(v) } } }
                while pal.count <= maxUsed { pal.append(d.palette[pal.count]) }
                d.palette = pal
                var res: [String: Any] = ["palette_colors": pal.count - 1]
                if a.has("colors") {
                    let w = Craft.nearWarnings(Array(pal.dropFirst()))
                    if !w.isEmpty { res["warnings"] = w }
                }
                return res
            }

        case "set_palette_color":
            let i = try a.req("index")
            guard i >= 1 && i < Document.maxColors else { throw PCError.invalid("index must be 1-255") }
            guard let c = RGBA.parse(try a.reqString("color")) else { throw PCError.invalid("not a hex colour") }
            return try edit("Palette colour \(i)") { d in
                while d.palette.count <= i { d.palette.append(RGBA(0, 0, 0)) }
                d.palette[i] = RGBA(c.r, c.g, c.b)
                return ["index": i, "hex": c.hex]
            }

        case "add_colors":
            guard let list = a.array("colors") else { throw PCError.invalid("missing colors") }
            return try edit("Add colours") { d in
                let before = Array(d.palette.dropFirst())
                var idx: [Int] = []
                for v in list { idx.append(Int(try Engine.color(v, &d))) }
                var res: [String: Any] = ["indexes": idx]
                // Only colours this call really added are checked (reused ones were already in the palette).
                let fresh = Array(d.palette.dropFirst(before.count + 1))
                let w = Craft.nearWarnings(fresh, existing: before)
                if !w.isEmpty { res["warnings"] = w }
                return res
            }

        case "make_color_ramp":
            let steps = max(2, min(16, a.int("steps", a.has("base") ? 5 : 4)))
            let colors: [RGBA]
            if let b = a.string("base") {
                guard let base = RGBA.parse(b) else { throw PCError.invalid("base must be a hex colour") }
                colors = Craft.ramp(base: base, steps: steps, hueShift: a.double("hue_shift") ?? 12)
            } else {
                guard let f0 = a.string("from"), let t0 = a.string("to"), let c0 = RGBA.parse(f0), let c1 = RGBA.parse(t0) else {
                    throw PCError.invalid("give base (one hex colour), or from and to (hex colours)")
                }
                colors = Craft.ramp(from: c0, to: c1, steps: steps, hueShift: a.double("hue_shift") ?? 8)
            }
            return try edit("Colour ramp") { d in
                var idx: [Int] = []
                for c in colors { idx.append(Int(Engine.addColor(c, &d))) }
                return ["indexes": idx, "colors": colors.map { $0.hex }, "order": "darkest first"]
            }

        case "pixel_art_guide":
            let topic = a.string("topic") ?? "all"
            guard Craft.topics.contains(topic.lowercased()) else {
                throw PCError.invalid("topic must be one of \(Craft.topics.joined(separator: ", "))")
            }
            return ToolOutput(["topic": topic, "guide": Craft.guideText(topic)])

        case "pixel_perfect":
            let l = try editableLayer(a)
            let fs = try frames(a)
            let depth = a.int("depth", 0)
            guard depth >= 0 && depth < doc.sz else { throw PCError.invalid("depth must be 0-\(doc.sz - 1)") }
            return try edit("Pixel-perfect lines") { d in
                let only: UInt8? = a.has("color") ? try Engine.color(a.d["color"], &d) : nil
                var cells: [[String: Any]] = []
                for f in fs {
                    for c in Craft.pixelPerfect(&d, layer: l, frame: f, depth: depth, only: only) {
                        cells.append(["frame": f, "x": c[0], "row": c[1]])
                    }
                }
                return ["changed": cells.count, "cells": Array(cells.prefix(60)),
                        "note": cells.isEmpty ? "no doubled corners found" : "each removed pixel took the colour around it; review_model to check"]
            }

        // Layers & frames
        case "add_layer":
            let name = a.string("name") ?? "Layer \(doc.layers.count + 1)"
            var newIndex = 0
            let out = try edit("Add layer \(name)") { d in newIndex = d.addLayer(name: name, at: activeLayer + 1); return [:] }
            activeLayer = newIndex
            onChange?("add_layer")
            return ToolOutput(["layer": newIndex, "name": name, "revision": out.json["revision"] ?? revision])

        case "delete_layer":
            let l = try layerIndex(a)
            return try edit("Delete layer") { d in try d.removeLayer(l); return ["deleted": l] }

        case "set_layer":
            let l = try layerIndex(a)
            return try edit("Layer settings") { d in
                if let n = a.string("name") { d.layers[l].name = n }
                if a.has("visible") { d.layers[l].visible = a.bool("visible", true) }
                if a.has("locked") { d.layers[l].locked = a.bool("locked", false) }
                return ["layer": l, "name": d.layers[l].name, "visible": d.layers[l].visible, "locked": d.layers[l].locked]
            }

        case "duplicate_layer":
            let l = try layerIndex(a)
            let out = try edit("Duplicate layer") { d in
                let i = d.addLayer(name: d.layers[l].name + " copy", at: l + 1)
                d.cels[i] = d.cels[l]
                return ["layer": i]
            }
            activeLayer = l + 1
            return out

        case "merge_layer_down":
            let l = try layerIndex(a)
            guard l > 0 else { throw PCError.invalid("the bottom layer has nothing below it") }
            let out = try edit("Merge layer down") { d in
                for f in 0..<d.frames.count {
                    for i in 0..<d.count where d.cels[l][f].data[i] != 0 { d.cels[l - 1][f].data[i] = d.cels[l][f].data[i] }
                }
                try d.removeLayer(l)
                return ["merged_into": l - 1]
            }
            activeLayer = l - 1
            return out

        case "set_active":
            if a.has("layer") { activeLayer = try layerIndex(a) }
            if a.has("frame") { activeFrame = try frameIndex(a) }
            onChange?("set_active")
            return ToolOutput(["active_layer": activeLayer, "active_frame": activeFrame])

        case "add_frame":
            let after = try frameIndex(a, key: "after")
            var i = 0
            let out = try edit("Add frame") { d in i = d.addFrame(after: after, copy: a.bool("copy", true)); return [:] }
            activeFrame = i
            onChange?("add_frame")
            return ToolOutput(["frame": i, "frames": doc.frames.count, "revision": out.json["revision"] ?? revision])

        case "delete_frame":
            let f = try frameIndex(a)
            return try edit("Delete frame") { d in try d.removeFrame(f); return ["deleted": f] }

        case "set_frame_duration":
            let ms = max(1, try a.req("duration_ms"))
            let list = try frames(a)
            return try edit("Frame duration") { d in for f in list { d.frames[f].duration = ms }; return ["frames": list, "duration_ms": ms] }

        // Drawing
        case "set_voxels":
            guard let list = a.array("voxels") else { throw PCError.invalid("missing voxels") }
            return try edit("Place voxels") { d in
                var p = try pen(a, &d, needColor: false)
                let base = p.color
                var n = 0
                for item in list {
                    guard let v = item as? [Any], v.count >= 3, let pt = Args.point(Array(v.prefix(3))) else {
                        throw PCError.invalid("each voxel is [x, y, z] or [x, y, z, color]")
                    }
                    if v.count >= 4 { p.color = try Engine.color(v[3], &d) } else {
                        guard base != 0 || p.mode == .erase else { throw PCError.invalid("give `color` or [x,y,z,color]") }
                        p.color = base
                    }
                    n += d.put(Int(pt.0), Int(pt.1), Int(pt.2), p)
                }
                return ["changed": n]
            }

        case "erase_voxels":
            guard let list = a.array("voxels") else { throw PCError.invalid("missing voxels") }
            return try edit("Erase voxels") { d in
                let p = Pen(layer: try editableLayer(a), frame: try frameIndex(a), color: 0, mode: .erase,
                            symmetry: Symmetry.parse(a.string("symmetry")))
                var n = 0
                for item in list {
                    guard let pt = Args.point(item) else { throw PCError.invalid("each voxel is [x, y, z]") }
                    n += d.put(Int(pt.0), Int(pt.1), Int(pt.2), p)
                }
                return ["changed": n]
            }

        case "fill_box":
            let p0 = try a.reqPoint("from"), p1 = try a.reqPoint("to")
            return try edit("Box") { d in
                ["changed": d.box(p0, p1, hollow: a.bool("hollow", false), try pen(a, &d))]
            }

        case "draw_sphere":
            guard let c = a.point("center") else { throw PCError.invalid("missing center") }
            let r: (Double, Double, Double)
            if let rr = Args.number(a.d["radius"]) { r = (rr, rr, rr) } else if let rr = Args.point(a.d["radius"]) { r = rr } else {
                throw PCError.invalid("radius is a number or [rx, ry, rz]")
            }
            return try edit("Sphere") { d in
                ["changed": d.ellipsoid(center: c, radii: r, hollow: a.bool("hollow", false), try pen(a, &d))]
            }

        case "draw_cylinder":
            guard let b = a.point("base"), let r = a.double("radius") else { throw PCError.invalid("missing base or radius") }
            return try edit("Cylinder") { d in
                ["changed": d.cylinder(base: b, radius: r, length: try a.req("length"), axis: a.string("axis") ?? "y",
                                       hollow: a.bool("hollow", false), try pen(a, &d))]
            }

        case "draw_line":
            let p0 = try a.reqPoint("from"), p1 = try a.reqPoint("to")
            return try edit("Line") { d in
                ["changed": d.line(p0, p1, radius: max(0, a.int("radius", 0)), try pen(a, &d))]
            }

        case "flood_fill":
            let s = try a.reqPoint("at")
            return try edit("Fill") { d in
                ["changed": d.floodFill(s, volume: a.bool("volume", false), try pen(a, &d))]
            }

        case "paint_slice":
            return try paintSlice(a)

        case "replace_color":
            let ls = try layers(a), fs = try frames(a)
            return try edit("Replace colour") { d in
                let from = try Engine.color(a.d["from"], &d), to = try Engine.color(a.d["to"], &d)
                var n = 0
                for l in ls { for f in fs { n += d.replaceColor(layer: l, frame: f, from: from, to: to) } }
                return ["changed": n]
            }

        case "apply_gradient":
            guard let list = a.array("colors"), !list.isEmpty else { throw PCError.invalid("missing colors") }
            let l = try editableLayer(a), f = try frameIndex(a)
            return try edit("Gradient") { d in
                let ramp = try list.map { try Engine.color($0, &d) }
                let only = a.has("only_color") ? try Engine.color(a.d["only_color"], &d) : nil
                return ["changed": d.gradient(layer: l, frame: f, axis: a.string("axis") ?? "y", ramp: ramp, onlyColor: only)]
            }

        case "transform":
            let op = try a.reqString("op")
            let ls = try layers(a), fs = try frames(a)
            let axis = a.string("axis") ?? "y"
            return try edit("Transform: \(op)") { d in
                for l in ls { for f in fs {
                    switch op {
                    case "move": d.translate(layer: l, frame: f, dx: a.int("dx", 0), dy: a.int("dy", 0), dz: a.int("dz", 0), wrap: a.bool("wrap", false))
                    case "flip": d.flip(layer: l, frame: f, axis: axis)
                    case "rotate": d.rotate(layer: l, frame: f, axis: axis, turns: a.int("turns", 1))
                    case "mirror": d.mirror(layer: l, frame: f, axis: a.string("axis") ?? "x", keep: a.string("keep") ?? "low")
                    default: throw PCError.invalid("op is move, flip, rotate or mirror")
                    }
                } }
                return ["op": op, "layers": ls, "frames": fs]
            }

        case "clear":
            let l = try editableLayer(a), f = try frameIndex(a)
            return try edit("Clear") { d in d.cels[l][f] = Grid(count: d.count); return ["cleared_layer": l, "frame": f] }

        case "import_image":
            return try importImage(a)

        // Review
        case "get_voxel":
            let p = try a.reqPoint("at"), f = try frameIndex(a)
            guard doc.inBounds(p.0, p.1, p.2) else { throw PCError.invalid("cell is outside the model (size \(doc.sx)×\(doc.sy)×\(doc.sz))") }
            for l in stride(from: doc.layers.count - 1, through: 0, by: -1) where doc.layers[l].visible {
                let v = doc.get(l, f, p.0, p.1, p.2)
                if v != 0 { return ToolOutput(["at": [p.0, p.1, p.2], "index": Int(v), "hex": doc.palette[Int(v)].hex, "layer": l]) }
            }
            return ToolOutput(["at": [p.0, p.1, p.2], "index": 0, "empty": true])

        case "get_slice":
            return try getSlice(a)

        case "view_as_text":
            return try viewAsText(a)
        case "set_style":
            return try setStyle(a)
        case "get_style":
            return ToolOutput(style.map { ["style": $0.json] } ?? ["style": NSNull(), "note": "no style set; set_style locks one"])
        case "set_feedback":
            if a.has("auto_critique") { autoCritique = a.bool("auto_critique", true) }
            return ToolOutput(["auto_critique": autoCritique, "cell_limit": Engine.critiqueCellLimit])
        case "batch":
            return try batch(a)
        case "review_set":
            return try reviewSet(a)

        case "find_voxels":
            let f = try frameIndex(a)
            let merged = !a.has("layer")
            let g = merged ? doc.composite(frame: f) : doc.cels[try layerIndex(a)][f].data
            var d2 = doc
            let only: UInt8? = a.has("color") ? try Engine.color(a.d["color"], &d2) : nil
            let lo = a.point("from").map { (Int($0.0), Int($0.1), Int($0.2)) } ?? (0, 0, 0)
            let hi = a.point("to").map { (Int($0.0), Int($0.1), Int($0.2)) } ?? (doc.sx - 1, doc.sy - 1, doc.sz - 1)
            let limit = max(1, a.int("limit", 500))
            var cells: [[Int]] = [], total = 0
            for y in max(0, min(lo.1, hi.1))...min(doc.sy - 1, max(lo.1, hi.1)) {
                for z in max(0, min(lo.2, hi.2))...min(doc.sz - 1, max(lo.2, hi.2)) {
                    for x in max(0, min(lo.0, hi.0))...min(doc.sx - 1, max(lo.0, hi.0)) {
                        let v = g[doc.index(x, y, z)]
                        if v == 0 || (only != nil && v != only!) { continue }
                        total += 1
                        if cells.count < limit { cells.append([x, y, z, Int(v)]) }
                    }
                }
            }
            return ToolOutput(["total": total, "returned": cells.count, "voxels": cells, "format": "[x, y, z, palette index]"])

        case "analyze_model":
            var json = Analysis.analyze(doc, frame: try frameIndex(a), style: style)
            if let s = style, !s.notes.isEmpty { json["style_notes"] = s.notes }
            return ToolOutput(json)

        case "render_view":
            let f = try frameIndex(a)
            let o = renderOptions(a, defaultScale: Renderer.autoScale(doc, target: 384))
            let pic = Renderer.render(doc, frame: f, o)
            return ToolOutput(["width": pic.width, "height": pic.height, "yaw": o.yaw, "pitch": o.pitch, "scale": o.scale, "frame": f],
                              images: [ImageFiles.png(pic)])

        case "review_model":
            let f = try frameIndex(a)
            if isSprite {
                // A 2D sprite: enlarged with a pixel grid and as values, then silhouette and real sizes.
                let (images, layout) = Craft.spriteReview(doc, frame: f, scale: a.int("scale"))
                var json = Analysis.analyze(doc, frame: f, style: style)
                if let s = style, !s.notes.isEmpty { json["style_notes"] = s.notes }
                json["picture_layout"] = layout
                return ToolOutput(json, images: images)
            }
            let scale = a.int("scale") ?? Renderer.autoScale(doc, target: 200)
            let views = ["iso", "iso-front-left", "iso-back-right", "iso-back-left", "front", "right", "top"]
            let pics = views.map { v -> Picture in
                var o = RenderOptions(); (o.yaw, o.pitch) = ViewPreset.angles(v)!; o.scale = scale; return Renderer.render(doc, frame: f, o)
            }
            let (sheet, _) = Renderer.sheet(pics, columns: 4, gap: 6, background: RGBA(44, 44, 48))
            var json = Analysis.analyze(doc, frame: f, style: style)
            if let s = style, !s.notes.isEmpty { json["style_notes"] = s.notes }
            json["picture_layout"] = "Row 1: iso (front-right), iso-front-left, iso-back-right, iso-back-left. Row 2: front, right, top."
            return ToolOutput(json, images: [ImageFiles.png(sheet)])

        case "take_snapshot":
            let n = a.string("name") ?? "last"
            snapshots[n] = doc
            return ToolOutput(["snapshot": n, "revision": revision])

        case "compare_snapshot":
            let n = a.string("name") ?? "last"
            guard let old = snapshots[n] else { throw PCError.invalid("no snapshot named \(n); call take_snapshot first") }
            guard old.sx == doc.sx && old.sy == doc.sy && old.sz == doc.sz else {
                return ToolOutput(["note": "the model was resized since the snapshot", "before_size": [old.sx, old.sy, old.sz]])
            }
            let f = min(activeFrame, old.frames.count - 1)
            var json = Analysis.diff(old.composite(frame: f), doc.composite(frame: activeFrame), doc: doc)
            var o = renderOptions(a, defaultScale: Renderer.autoScale(doc, target: 260))
            if a.string("view") == nil { (o.yaw, o.pitch) = (45, 30) }
            let (sheet, _) = Renderer.sheet([Renderer.render(old, frame: f, o), Renderer.render(doc, frame: activeFrame, o)],
                                            columns: 2, gap: 6, background: RGBA(44, 44, 48))
            json["picture_layout"] = "Left: snapshot \"\(n)\". Right: now."
            return ToolOutput(json, images: [ImageFiles.png(sheet)])

        case "undo", "redo":
            let steps = max(1, a.int("steps", 1))
            var done: [String] = []
            for _ in 0..<steps {
                if name == "undo" {
                    guard let e = undoStack.popLast() else { break }
                    redoStack.append((doc, e.label, activeLayer, activeFrame))
                    doc = e.doc; activeLayer = e.layer; activeFrame = e.frame
                    done.append(e.label)
                } else {
                    guard let e = redoStack.popLast() else { break }
                    undoStack.append((doc, e.label, activeLayer, activeFrame))
                    doc = e.doc; activeLayer = e.layer; activeFrame = e.frame
                    done.append(e.label)
                }
            }
            clampActive()
            if !done.isEmpty { revision += 1; dirty = true; onChange?(name) }
            return ToolOutput([name == "undo" ? "undone" : "redone": done, "undo_steps": undoStack.count,
                               "redo_steps": redoStack.count, "revision": revision])

        case "get_history":
            return ToolOutput(["undo": undoStack.map { $0.label }, "redo": redoStack.reversed().map { $0.label }])

        // Export
        case "export_png":
            let u = try url(a, "png")
            let o = renderOptions(a, defaultScale: isSprite ? 1 : 8)
            let pic = Renderer.render(doc, frame: try frameIndex(a), o)
            try ImageFiles.png(pic).write(to: u, options: .atomic)
            return ToolOutput(["saved": u.path, "width": pic.width, "height": pic.height])

        case "export_sheet":
            return try exportSheet(a)

        case "export_gif":
            let u = try url(a, "gif")
            let kind = a.string("kind") ?? (doc.frames.count > 1 || isSprite ? "animation" : "turntable")
            var o = renderOptions(a, defaultScale: isSprite ? 4 : 6)
            var pics: [Picture] = [], delays: [Int] = []
            if kind == "turntable" {
                let steps = max(2, min(64, a.int("steps", 16)))
                for k in 0..<steps {
                    o.yaw = 45 + 360 * Double(k) / Double(steps)
                    pics.append(Renderer.render(doc, frame: activeFrame, o)); delays.append(80)
                }
            } else {
                for f in doc.frames.indices { pics.append(Renderer.render(doc, frame: f, o)); delays.append(doc.frames[f].duration) }
            }
            // Same canvas size for every frame.
            let w = pics.map { $0.width }.max() ?? 1, h = pics.map { $0.height }.max() ?? 1
            let framed = pics.map { p -> Picture in var c = Picture(width: w, height: h, fill: o.background); c.blit(p, at: (w - p.width) / 2, (h - p.height) / 2); return c }
            try ImageFiles.gif(framed, delays: delays).write(to: u, options: .atomic)
            return ToolOutput(["saved": u.path, "frames": framed.count, "kind": kind])

        case "export_svg":
            let u = try url(a, "svg")
            // 2D sprites: one SVG unit per sprite pixel. 3D: the rendered picture's pixels.
            let o = renderOptions(a, defaultScale: isSprite ? 1 : 4)
            let pic = Renderer.render(doc, frame: try frameIndex(a), o)
            let zoom = max(1, a.int("zoom", isSprite ? 8 : 2))
            try WebFiles.svg(pic, zoom: zoom).write(to: u, atomically: true, encoding: .utf8)
            return ToolOutput(["saved": u.path, "width": pic.width * zoom, "height": pic.height * zoom, "pixels": [pic.width, pic.height]])

        case "export_html":
            let u = try url(a, "html")
            let kind = a.string("kind") ?? (doc.frames.count > 1 || isSprite ? "animation" : "turntable")
            var o = renderOptions(a, defaultScale: isSprite ? 1 : 4)
            var pics: [Picture] = [], delays: [Int] = []
            if kind == "turntable" {
                let steps = max(2, min(32, a.int("steps", 8)))
                for k in 0..<steps {
                    o.yaw = 45 + 360 * Double(k) / Double(steps)
                    pics.append(Renderer.render(doc, frame: activeFrame, o)); delays.append(150)
                }
            } else {
                for f in doc.frames.indices { pics.append(Renderer.render(doc, frame: f, o)); delays.append(doc.frames[f].duration) }
            }
            let w = pics.map { $0.width }.max() ?? 1, h = pics.map { $0.height }.max() ?? 1
            let framed = pics.map { p -> Picture in var c = Picture(width: w, height: h, fill: o.background); c.blit(p, at: (w - p.width) / 2, (h - p.height) / 2); return c }
            let zoom = max(1, a.int("zoom", isSprite ? 8 : 2))
            try WebFiles.html(title: doc.name, frames: framed, delays: delays, zoom: zoom).write(to: u, atomically: true, encoding: .utf8)
            return ToolOutput(["saved": u.path, "frames": framed.count, "kind": kind])

        case "export_vox":
            let u = try url(a, "vox")
            try VoxFile.encode(doc, frame: try frameIndex(a)).write(to: u, options: .atomic)
            return ToolOutput(["saved": u.path])

        case "export_obj":
            let u = try url(a, "obj")
            let mtl = u.deletingPathExtension().appendingPathExtension("mtl")
            let (obj, m) = ObjFile.encode(doc, frame: try frameIndex(a), mtlName: mtl.lastPathComponent)
            try obj.write(to: u, atomically: true, encoding: .utf8)
            try m.write(to: mtl, atomically: true, encoding: .utf8)
            return ToolOutput(["saved": u.path, "materials": mtl.path])

        case "ui_state":
            return ToolOutput(uiState(onion: a.bool("onion", false)))

        case "ui_activity":
            return ToolOutput(["activity": activity.suffix(30).map { $0 }])

        default:
            if let h = hostTools[name] { return try h(a.d) }
            if name == "get_editor_screenshot" {
                throw PCError.invalid("the OpenPixel window is not open; use render_view or review_model instead")
            }
            throw PCError.invalid("unknown tool \(name)")
        }
    }

    // MARK: - bigger tools

    func paintSlice(_ a: Args) throws -> ToolOutput {
        let axis = a.string("axis") ?? "z"
        let start = a.int("index", 0)
        var slices: [[String]] = []
        if let s = a.array("slices") { slices = s.compactMap { ($0 as? [Any])?.compactMap { $0 as? String } } }
        if let r = a.array("rows") { slices.insert(r.compactMap { $0 as? String }, at: 0) }
        guard !slices.isEmpty else { throw PCError.invalid("give rows (one slice) or slices (several)") }
        let depth = max(1, a.int("depth", 1))
        let merge = a.string("mode") == "merge"
        let off = (a.array("offset") ?? []).compactMap { Args.number($0) }.map { Int($0) }
        let oc = off.count > 0 ? off[0] : 0, or = off.count > 1 ? off[1] : 0
        let l = try editableLayer(a), f = try frameIndex(a)
        return try edit("Paint \(axis) slice") { d in
            var legend: [Character: UInt8] = [:]
            if let lg = a.d["legend"] as? [String: Any] {
                for (k, v) in lg { if let ch = k.first { legend[ch] = try Engine.color(v, &d) } }
            }
            let (cols, rows, depthMax) = d.sliceSize(axis: axis)
            var n = 0, unknown = Set<Character>(), clipped = false
            for (si, slice) in slices.enumerated() {
                for rep in 0..<depth {
                    let k = start + si * depth + rep
                    guard k >= 0 && k < depthMax else { clipped = true; continue }
                    if !merge {
                        // Replace mode clears the slice region the text covers.
                        for (ri, row) in slice.enumerated() { for ci in 0..<row.count {
                            let c = ci + oc, r = ri + or
                            guard c >= 0, r >= 0, c < cols, r < rows else { continue }
                            let (x, y, z) = d.sliceCell(axis: axis, index: k, col: c, row: r)
                            d.set(l, f, x, y, z, 0)
                        } }
                    }
                    for (ri, row) in slice.enumerated() {
                        for (ci, ch) in row.enumerated() {
                            if ch == "." || ch == " " { continue }
                            let c = ci + oc, r = ri + or
                            guard c >= 0, r >= 0, c < cols, r < rows else { clipped = true; continue }
                            var v: UInt8? = legend[ch]
                            if v == nil, let i = Engine.slots.firstIndex(of: ch), i + 1 < d.palette.count { v = UInt8(i + 1) }
                            guard let color = v else { unknown.insert(ch); continue }
                            let (x, y, z) = d.sliceCell(axis: axis, index: k, col: c, row: r)
                            if d.get(l, f, x, y, z) != color { d.set(l, f, x, y, z, color); n += 1 }
                        }
                    }
                }
            }
            var res: [String: Any] = ["changed": n, "axis": axis, "slice_size": ["columns": cols, "rows": rows]]
            var warn: [String] = []
            if !unknown.isEmpty { warn.append("characters with no colour (add them to legend): \(String(unknown.sorted()))") }
            if clipped { warn.append("some text fell outside the model and was skipped") }
            for (si, slice) in slices.enumerated() {
                let lengths = Set(slice.map { $0.count })
                if !merge, lengths.count > 1, let lo = lengths.min(), let hi = lengths.max() {
                    warn.append("slice \(si): rows have different lengths (\(lo)-\(hi) characters), so columns may be misaligned; pad rows with '.' to the same width")
                }
            }
            if !warn.isEmpty { res["warnings"] = warn }
            return res
        }
    }

    func getSlice(_ a: Args) throws -> ToolOutput {
        let axis = a.string("axis") ?? "z"
        let f = try frameIndex(a)
        let g = a.bool("merged", true) && !a.has("layer") ? doc.composite(frame: f) : doc.cels[try layerIndex(a)][f].data
        let (cols, rows, depth) = doc.sliceSize(axis: axis)
        let k = a.int("index", 0)
        guard k >= 0 && k < depth else { throw PCError.invalid("index must be 0-\(depth - 1) for axis \(axis)") }
        var legend: [String: Any] = [:]
        var extra = 0
        var custom: [UInt8: Character] = [:]
        var lines: [String] = []
        for r in 0..<rows {
            var line = ""
            for c in 0..<cols {
                let (x, y, z) = doc.sliceCell(axis: axis, index: k, col: c, row: r)
                let v = g[doc.index(x, y, z)]
                if v == 0 { line.append("."); continue }
                let ch: Character
                if Int(v) <= Engine.slots.count { ch = Engine.slots[Int(v) - 1] } else if let cch = custom[v] { ch = cch } else {
                    ch = extra < Engine.extraSlots.count ? Engine.extraSlots[extra] : "#"; extra += 1; custom[v] = ch
                }
                legend[String(ch)] = ["index": Int(v), "hex": doc.palette[Int(v)].hex]
                line.append(ch)
            }
            lines.append(line)
        }
        let layout: String
        switch axis {
        case "y": layout = "top view of y=\(k): columns x=0→\(cols - 1), rows z=0 (back) → \(rows - 1) (front)"
        case "x": layout = "side view of x=\(k): columns z=0 (back) → \(cols - 1) (front), rows y=\(rows - 1) (top) → 0"
        default: layout = "front view of z=\(k): columns x=0→\(cols - 1), rows y=\(rows - 1) (top) → 0"
        }
        return ToolOutput(["axis": axis, "index": k, "layout": layout, "rows": lines, "legend": legend])
    }

    func importImage(_ a: Args) throws -> ToolOutput {
        let u = URL(fileURLWithPath: NSString(string: try a.reqString("path")).expandingTildeInPath)
        let pic = try ImageFiles.read(u)
        let axis = a.string("axis") ?? "z"
        let start = a.int("index", 0), depth = max(1, a.int("depth", 1))
        let l = try editableLayer(a), f = try frameIndex(a)
        return try edit("Import \(u.lastPathComponent)") { d in
            var (cols, rows, dmax) = d.sliceSize(axis: axis)
            if (pic.width > cols || pic.height > rows || start + depth > dmax) && a.bool("grow", true) {
                let need = (max(cols, pic.width), max(rows, pic.height), max(dmax, start + depth))
                switch axis {
                case "y": try d.resize(min(256, need.0), min(256, need.2), min(256, need.1), anchor: "origin")
                case "x": try d.resize(min(256, need.2), min(256, need.1), min(256, need.0), anchor: "origin")
                default: try d.resize(min(256, need.0), min(256, need.1), min(256, need.2), anchor: "origin")
                }
                (cols, rows, dmax) = d.sliceSize(axis: axis)
            }
            var cache: [RGBA: UInt8] = [:]
            var n = 0
            for py in 0..<min(pic.height, rows) {
                for px in 0..<min(pic.width, cols) {
                    let c = pic.pixel(py * pic.width + px)
                    if c.a < 128 { continue }
                    let key = RGBA(c.r, c.g, c.b)
                    let v: UInt8
                    if let cached = cache[key] { v = cached } else {
                        v = a.bool("add_colors", false) ? Engine.addColor(key, &d) : Engine.nearest(key, d.palette)
                        cache[key] = v
                    }
                    for k in start..<min(start + depth, dmax) {
                        let (x, y, z) = d.sliceCell(axis: axis, index: k, col: px, row: py)
                        d.set(l, f, x, y, z, v); n += 1
                    }
                }
            }
            return ["changed": n, "picture": [pic.width, pic.height], "size": [d.sx, d.sy, d.sz]]
        }
    }

    func exportSheet(_ a: Args) throws -> ToolOutput {
        let u = try url(a, "png")
        var views = (a.array("views") ?? []).compactMap { $0 as? String }
        let pitch = a.double("pitch") ?? 30
        var angles: [(String, Double, Double)] = []
        if views.isEmpty { views = [isSprite ? "front" : "turnaround8"] }
        if isSprite && views == ["front"] {
            // Classic sprite strip: one row, one cell per animation frame, real pixels.
            let o = renderOptions(Args(["scale": a.int("scale") ?? 1]), defaultScale: 1)
            let pics = doc.frames.indices.map { Renderer.render(doc, frame: $0, o) }
            var sheet = Picture(width: pics.reduce(0) { $0 + $1.width }, height: pics.map { $0.height }.max() ?? 1)
            var x = 0
            for p in pics { sheet.blit(p, at: x, 0); x += p.width }
            try ImageFiles.png(sheet).write(to: u, options: .atomic)
            return ToolOutput(["saved": u.path, "cell_width": pics.first?.width ?? 0, "cell_height": pics.first?.height ?? 0,
                               "columns": doc.frames.count, "rows": 1, "frame_durations_ms": doc.frames.map { $0.duration }])
        }
        for v in views {
            if v == "turnaround8" || v == "turnaround4" {
                let n = v == "turnaround8" ? 8 : 4
                for k in 0..<n { let yaw = 45.0 * Double(k * 8 / n) ; angles.append(("yaw \(Int(yaw))", yaw, pitch)) }
            } else if let ang = ViewPreset.angles(v) { angles.append((v, ang.yaw, ang.pitch)) } else {
                throw PCError.invalid("unknown view \(v)")
            }
        }
        var o = RenderOptions(); o.scale = max(1, a.int("scale", 4))
        var pics: [Picture] = []
        for f in doc.frames.indices { for (_, y, p) in angles { o.yaw = y; o.pitch = p; pics.append(Renderer.render(doc, frame: f, o)) } }
        // Uniform cells so game engines can slice the sheet by a fixed size.
        let cw = pics.map { $0.width }.max() ?? 1, ch = pics.map { $0.height }.max() ?? 1
        var sheet = Picture(width: cw * angles.count, height: ch * doc.frames.count)
        for (i, p) in pics.enumerated() {
            sheet.blit(p, at: (i % angles.count) * cw + (cw - p.width) / 2, (i / angles.count) * ch + (ch - p.height) / 2)
        }
        try ImageFiles.png(sheet).write(to: u, options: .atomic)
        return ToolOutput(["saved": u.path, "cell_width": cw, "cell_height": ch, "columns": angles.map { $0.0 },
                           "rows": doc.frames.count, "frame_durations_ms": doc.frames.map { $0.duration }])
    }

    /// Compact state for the HTML canvas: merged grid of the active frame (+ active layer, onion frames).
    func uiState(onion: Bool) -> [String: Any] {
        func b64(_ g: [UInt8]) -> String { Data(g).base64EncodedString() }
        var s = info()
        s["palette"] = doc.palette.map { $0.a == 0 ? "transparent" : $0.hex }
        s["composite"] = b64(doc.composite(frame: activeFrame))
        s["active_cel"] = b64(doc.cels[activeLayer][activeFrame].data)
        s["cels_filled"] = doc.cels.map { row in row.map { !$0.isEmpty } }
        if onion && doc.frames.count > 1 {
            // Onion skin: 1 frame each side, opacity 68 (then 28 less per further frame).
            var o: [[String: Any]] = []
            for df in [-1, 1] {
                let f = activeFrame + df
                if f >= 0 && f < doc.frames.count { o.append(["frame": f, "opacity": 68, "data": b64(doc.composite(frame: f))]) }
            }
            s["onion"] = o
        }
        return s
    }
}
