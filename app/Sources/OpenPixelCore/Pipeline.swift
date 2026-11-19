import Foundation

/// Tools for production pipelines: automatic critique after edits, text views, the style lock, batches of
/// calls and reviewing a set of files together.
extension Engine {

    // MARK: - automatic critique

    /// After an agent edit, the score and what the edit introduced, made worse or resolved.
    func critique(_ name: String, _ out: inout ToolOutput) {
        guard autoCritique, batchDepth == 0, let spec = ToolCatalog.spec(name), !spec.readOnly,
              revision != critiqueRevision else { return }
        guard doc.count <= Engine.critiqueCellLimit else {
            if critiques == 0 { out.json["critique"] = ["skipped": "model too large for the automatic critique; analyze_model still works"] }
            critiques += 1
            critiqueRevision = revision
            return
        }
        let (_, findings, total) = Analysis.full(doc, frame: activeFrame, style: style)
        let now = Critique(total: total, findings: findings)
        var c = now.compared(to: lastCritique)
        if critiques == 0 {
            c["about"] = "Automatic after each edit: the score (0-100) from the checks and what this edit changed. review_model shows the pictures; set_feedback auto_critique=false turns this off."
        }
        out.json["critique"] = c
        lastCritique = now
        critiqueRevision = revision
        critiques += 1
    }

    // MARK: - style lock

    func refuseOffPalette(before: [RGBA], after: [RGBA], style s: StyleLock) throws {
        let fresh = after.enumerated().dropFirst().filter { i, c in i >= before.count || before[i] != c }.map { $0.element }
        // Locked colours may come back (after an undo, or into a canvas opened with another palette); others may not.
        guard let c = fresh.first(where: { !s.contains($0) }) else { return }
        throw PCError.invalid("the \"\(s.name)\" style locks the palette and \(c.hex) is not in it. Closest locked colours: "
                              + s.nearest(c).joined(separator: ", ")
                              + ". Use those indexes (get_palette lists them), or set_style lock_palette=false to unlock.")
    }

    func setStyle(_ a: Args) throws -> ToolOutput {
        if a.bool("clear", false) {
            style = nil
            return ToolOutput(["style": NSNull(), "cleared": true])
        }
        var base = style ?? StyleLock()
        if let p = a.string("path") {
            let u = URL(fileURLWithPath: NSString(string: p).expandingTildeInPath)
            guard let o = try JSONSerialization.jsonObject(with: Data(contentsOf: u)) as? [String: Any] else {
                throw PCError.invalid("\(u.path) is not a style file (a JSON object)")
            }
            base = try StyleLock.from(o)
        }
        var s = try StyleLock.from(a.d, base: base)
        // Locking without naming colours locks the palette the canvas has now.
        if s.lockPalette && s.palette == nil { s.palette = doc.palette.map { RGBA($0.r, $0.g, $0.b, $0.a) } }
        var res: [String: Any] = [:]
        // Bring the open canvas into the style: the locked palette, with drawn colours moved to the closest
        // locked colour (exact matches keep their colour). One undo step.
        if let pal = s.palette, doc.palette.count != pal.count || zip(doc.palette, pal).contains(where: { !StyleLock.sameRGB($0, $1) }) {
            paletteLockBypass = true
            defer { paletteLockBypass = false }
            var moved = 0
            let edited = try edit("Apply style \(s.name)") { d in
                var map = [UInt8](repeating: 0, count: 256)
                for i in 1..<d.palette.count {
                    map[i] = Engine.nearest(d.palette[i], pal)
                }
                var usedChanged = Set<Int>()
                for l in d.cels.indices { for f in d.cels[l].indices {
                    var g = d.cels[l][f].data
                    for k in g.indices where g[k] != 0 {
                        let v = Int(g[k])
                        if v < d.palette.count, !StyleLock.sameRGB(pal[Int(map[v])], d.palette[v]) { usedChanged.insert(v) }
                        g[k] = v < d.palette.count ? map[v] : 0
                    }
                    d.cels[l][f].data = g
                } }
                d.palette = pal
                moved = usedChanged.count
                return [:]
            }
            res["applied_to_canvas"] = ["palette_colors": pal.count - 1, "drawn_colours_moved_to_closest": moved,
                                        "revision": edited.json["revision"] ?? revision]
        }
        style = s
        if let p = a.string("save_path") {
            var u = URL(fileURLWithPath: NSString(string: p).expandingTildeInPath)
            if u.pathExtension.isEmpty { u.appendPathExtension("json") }
            try FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: s.json, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: u, options: .atomic)
            res["saved"] = u.path
        }
        res["style"] = s.json
        res["effect"] = [
            s.lockPalette && s.palette != nil ? "agent edits can only use the \(s.palette!.count - 1) locked colours (hex colours must match one; palette tools are refused)" : "palette not locked",
            "new_sprite/new_model start with this palette" + (s.size.map { " and size \($0.map(String.init).joined(separator: "×"))" } ?? ""),
            "analyze_model, review_model, review_set and the automatic critique check the style (category \"style\")",
        ]
        return ToolOutput(res)
    }

    // MARK: - text views

    func viewAsText(_ a: Args) throws -> ToolOutput {
        let f = try frameIndex(a)
        let view = a.string("view") ?? "front"
        guard TextView.views.contains(view) else { throw PCError.invalid("view must be one of \(TextView.views.joined(separator: ", "))") }
        var maps = (a.array("maps") as? [String]) ?? ["pixels", "values", "silhouette"]
        if let bad = maps.first(where: { !TextView.maps.contains($0) }) {
            throw PCError.invalid("unknown map \(bad); use \(TextView.maps.joined(separator: ", "))")
        }
        var compare: Int?
        if a.has("compare_frame") {
            let c = try frameIndex(a, key: "compare_frame")
            compare = c
            if !maps.contains("diff") { maps.append("diff") }
        } else if maps.contains("diff") {
            guard doc.frames.count > 1 else { throw PCError.invalid("diff needs two frames; add_frame first or give compare_frame") }
            compare = (f - 1 + doc.frames.count) % doc.frames.count
        }
        let region = (a.array("region") ?? []).compactMap { Args.number($0).map { Int($0) } }
        if a.has("region") && region.count != 4 { throw PCError.invalid("region is [col0, row0, col1, row1] in the view's coordinates") }
        return ToolOutput(TextView.render(doc, frame: f, view: view, maps: maps, compare: compare, region: region.isEmpty ? nil : region))
    }

    // MARK: - batch

    static let batchLimit = 200

    func batch(_ a: Args) throws -> ToolOutput {
        guard batchDepth == 0 else { throw PCError.invalid("batch cannot contain another batch") }
        guard let calls = a.array("calls"), !calls.isEmpty else { throw PCError.invalid("calls must be a list of {\"tool\": name, \"args\": {...}}") }
        guard calls.count <= Engine.batchLimit else { throw PCError.invalid("at most \(Engine.batchLimit) calls per batch") }
        // Check every call before running any, so a typo doesn't leave half a batch done.
        var plan: [(String, [String: Any])] = []
        for (i, c) in calls.enumerated() {
            guard let o = c as? [String: Any], let tool = o["tool"] as? String else { throw PCError.invalid("call \(i) needs a \"tool\" name") }
            guard let spec = ToolCatalog.spec(tool), !spec.hidden, tool != "batch" else { throw PCError.invalid("call \(i): unknown tool \(tool)") }
            plan.append((tool, o["args"] as? [String: Any] ?? [:]))
        }
        let stop = a.bool("stop_on_error", true), atomic = a.bool("atomic", false)
        let saved = (doc, undoStack, redoStack, activeLayer, activeFrame, dirty, path)
        var results: [[String: Any]] = [], images: [Data] = [], failed = 0
        batchDepth += 1
        defer { batchDepth -= 1 }
        for (i, (tool, args)) in plan.enumerated() {
            do {
                let out = try execute(tool, args, source: source)
                var r: [String: Any] = ["call": i, "tool": tool, "ok": true]
                var json = out.json
                json["conventions"] = nil
                if !json.isEmpty { r["result"] = json }
                results.append(r)
                images += out.images
            } catch {
                failed += 1
                results.append(["call": i, "tool": tool, "ok": false, "error": "\(error)"])
                if stop || atomic { break }
            }
        }
        var res: [String: Any] = ["calls": plan.count, "ran": results.count, "failed": failed, "results": results]
        if failed > 0 && atomic {
            (doc, undoStack, redoStack, activeLayer, activeFrame, dirty, path) = saved
            revision += 1
            onChange?("batch")
            res["rolled_back"] = true
        }
        res["revision"] = revision
        return ToolOutput(res, images: images)
    }

    // MARK: - reviewing a set

    static let setLimit = 24

    func reviewSet(_ a: Args) throws -> ToolOutput {
        let paths = (a.array("paths") ?? []).compactMap { $0 as? String }
        guard !paths.isEmpty else { throw PCError.invalid("paths: the .openpixel or .vox files of the set") }
        guard paths.count <= Engine.setLimit else { throw PCError.invalid("at most \(Engine.setLimit) files") }
        var docs: [(String, Document)] = []
        for p in paths {
            let u = URL(fileURLWithPath: NSString(string: p).expandingTildeInPath)
            let data = try Data(contentsOf: u)
            let d = u.pathExtension.lowercased() == "vox"
                ? try VoxFile.decode(data, name: u.deletingPathExtension().lastPathComponent)
                : try NativeFile.decode(data)
            docs.append((u.path, d))
        }
        let frameArg = a.int("frame", 0)
        var items: [[String: Any]] = [], pics: [Picture] = []
        var lights: [String: [Int]] = [:], usage: [RGBA: Set<Int>] = [:], outlines: [Double] = []
        let tallest = docs.map { max($0.1.sy, $0.1.sz == 1 ? 0 : $0.1.sz) }.max() ?? 32
        for (k, (p, d)) in docs.enumerated() {
            let f = min(max(0, frameArg), d.frames.count - 1)
            let (json, _, total) = Analysis.full(d, frame: f, style: style)
            let issues = json["issues"] as? [String] ?? []
            var item: [String: Any] = ["file": p, "size": [d.sx, d.sy, d.sz], "score": total, "issues": issues.count]
            if !issues.isEmpty { item["top_issues"] = Array(issues.prefix(3)) }
            let art = json["pixel_art"] as? [String: Any]
            if let l = (art?["light"] as? [String: Any])?["brightest_toward"] as? String {
                item["light"] = l
                if l != "no clear side" { lights[l, default: []].append(k) }
            }
            if let o = art?["outline_dark_share"] as? Double { outlines.append(o); item["outline_dark_share"] = o }
            let g = d.composite(frame: f)
            var used = Set<UInt8>()
            for v in g where v != 0 { used.insert(v) }
            item["colors_used"] = used.count
            for v in used { usage[RGBA(d.palette[Int(v)].r, d.palette[Int(v)].g, d.palette[Int(v)].b), default: []].insert(k) }
            items.append(item)
            var o = RenderOptions()
            if d.sz == 1 { (o.yaw, o.pitch) = (0, 0); o.padding = 0; o.showBounds = true; o.flat = true; o.outline = false; o.edges = false }
            else { (o.yaw, o.pitch) = (45, 30) }
            o.scale = a.int("scale") ?? max(1, min(8, 96 / max(1, tallest)))
            o.background = RGBA(44, 44, 48)
            pics.append(Renderer.render(d, frame: f, o))
        }
        // Set-level consistency.
        var f = Findings()
        let sizes = Set(docs.map { "\($0.1.sx)×\($0.1.sy)" + ($0.1.sz == 1 ? "" : "×\($0.1.sz)") })
        if sizes.count > 1 { f.tip("set_sizes", "shape", 3, "The files have different sizes (\(sizes.sorted().joined(separator: ", "))); a set usually shares one canvas size.") }
        if lights.count > 1 {
            let desc = lights.sorted { $0.value.count > $1.value.count }.map { "\($0.key): files \($0.value.map(String.init).joined(separator: ","))" }
            f.issue("set_light", "shading", 10, "The light comes from different sides across the set (\(desc.joined(separator: "; "))). Use one light direction for every file.")
        }
        if docs.count >= 3 {
            let lone = usage.filter { $0.value.count == 1 }
            if lone.count > max(2, usage.count / 4) {
                let byFile = Dictionary(grouping: lone, by: { $0.value.first! }).map { "file \($0.key): \($0.value.count)" }.sorted()
                f.tip("set_palette_drift", "color", 6, "\(lone.count) of \(usage.count) colours appear in only one file (\(byFile.joined(separator: ", "))): the set's palettes drift apart. set_style locks one palette for all of them.")
            }
        }
        if let lo = outlines.min(), let hi = outlines.max(), hi - lo > 0.4 {
            f.tip("set_outline", "shape", 4, "Outline darkness varies a lot between files (\(Int(lo * 100))%-\(Int(hi * 100))% of the edge dark); outline the whole set the same way.")
        }
        let scores = items.compactMap { $0["score"] as? Int }
        let weakest = scores.indices.min { scores[$0] < scores[$1] } ?? 0
        let (sheet, _) = Renderer.sheet(pics, columns: min(6, pics.count), gap: 6, background: RGBA(70, 70, 76))
        let distinct = usage.count
        return ToolOutput([
            "files": items,
            "set": ["issues": f.issues, "tips": f.tips, "score": f.score(categories: ["shape", "color", "shading"])["total"] ?? 100,
                    "average_file_score": scores.isEmpty ? 0 : scores.reduce(0, +) / scores.count, "weakest_file": weakest,
                    "distinct_colors": distinct, "colors_in_two_or_more_files": usage.filter { $0.value.count >= 2 }.count],
            "picture_layout": "The files in the order given, left to right then down (\(min(6, pics.count)) per row), at the same scale.",
        ], images: [ImageFiles.png(sheet)])
    }
}
