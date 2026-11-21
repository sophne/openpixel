import Foundation
import OpenPixelCore

/// `OpenPixel --selftest`: exercises the engine and the MCP protocol without a window.
enum SelfTest {
    static func run() -> Bool {
        var ok = true
        func check(_ cond: Bool, _ what: String) {
            print((cond ? "ok   " : "FAIL ") + what)
            if !cond { ok = false }
        }
        let engine = Engine()
        Sample.build(into: engine)
        let info = (try? engine.execute("get_model_info", [:]))?.json ?? [:]
        check((info["voxels_in_active_frame"] as? Int ?? 0) > 500, "sample model has voxels (\(info["voxels_in_active_frame"] ?? 0))")
        check((info["layers"] as? [Any])?.count == 3, "sample has 3 layers")

        _ = try? engine.execute("new_model", ["size_x": 8, "size_y": 8, "size_z": 8])
        let r = try? engine.execute("paint_slice", ["axis": "z", "index": 2, "rows": ["..11..", ".1221.", "112211"], "depth": 2])
        check((r?.json["changed"] as? Int) == 24, "paint_slice extrudes 12 cells × 2 (got \(r?.json["changed"] ?? "nil"))")
        let s = try? engine.execute("get_slice", ["axis": "z", "index": 3])
        let rows = s?.json["rows"] as? [String] ?? []
        check(rows.count == 8 && rows[0] == "..11....", "get_slice reads back the same rows (\(rows.first ?? "-"))")
        _ = try? engine.execute("undo", [:])
        let after = (try? engine.execute("get_model_info", [:]))?.json["voxels_in_active_frame"] as? Int
        check(after == 0, "undo removes the slice")
        _ = try? engine.execute("redo", [:])
        _ = try? engine.execute("fill_box", ["from": [0, 0, 0], "to": [7, 0, 7], "color": "#ff0000"])
        _ = try? engine.execute("draw_sphere", ["center": [4, 5, 4], "radius": 2, "color": 5, "symmetry": "x"])
        let render = try? engine.execute("render_view", ["view": "iso", "scale": 4])
        check((render?.images.first?.count ?? 0) > 100, "render_view returns a PNG")
        let review = try? engine.execute("review_model", [:])
        check(review?.images.count == 1 && review?.json["issues"] != nil, "review_model returns a sheet and checks")
        _ = try? engine.execute("take_snapshot", [:])
        _ = try? engine.execute("set_voxels", ["voxels": [[0, 1, 0, 3]]])
        let diff = try? engine.execute("compare_snapshot", [:])
        check((diff?.json["added"] as? Int) == 1, "compare_snapshot sees one added voxel")

        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("openpixel-selftest-\(getpid())")
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let file = tmp.appendingPathComponent("t.openpixel").path
        _ = try? engine.execute("save_model", ["path": file])
        let before = (try? engine.execute("get_model_info", [:]))?.json["voxels_in_active_frame"] as? Int
        _ = try? engine.execute("open_model", ["path": file])
        let reopened = (try? engine.execute("get_model_info", [:]))?.json["voxels_in_active_frame"] as? Int
        check(before != nil && before == reopened, "save and open keep every voxel (\(before ?? -1) = \(reopened ?? -1))")
        let vox = tmp.appendingPathComponent("t.vox").path
        _ = try? engine.execute("export_vox", ["path": vox])
        _ = try? engine.execute("open_model", ["path": vox])
        let fromVox = (try? engine.execute("get_model_info", [:]))?.json["voxels_in_active_frame"] as? Int
        check(fromVox == before, ".vox export and import round-trip (\(fromVox ?? -1))")
        for (tool, ext) in [("export_png", "png"), ("export_sheet", "png"), ("export_gif", "gif"), ("export_obj", "obj"), ("export_svg", "svg"), ("export_html", "html")] {
            let p = tmp.appendingPathComponent("out-\(tool).\(ext)").path
            _ = try? engine.execute(tool, ["path": p])
            check(FileManager.default.fileExists(atPath: p), "\(tool) writes a file")
        }

        // 2D sprites
        let sprite = Engine()
        Sample.build(into: sprite, threeD: false)
        let sInfo = (try? sprite.execute("get_model_info", [:]))?.json ?? [:]
        check(sInfo["kind"] as? String == "2d-sprite" && (sInfo["frames"] as? [Any])?.count == 2, "welcome sprite is 2D with 2 frames")
        _ = try? sprite.execute("set_pixels", ["pixels": [[0, 0, "#ff00ff"]]])
        let top = (try? sprite.execute("get_voxel", ["at": [0, 31, 0]]))?.json["hex"] as? String
        check(top == "#ff00ff", "set_pixels counts y from the top row")
        let png = tmp.appendingPathComponent("sprite.png").path
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let exp = try? sprite.execute("export_png", ["path": png])
        check((exp?.json["width"] as? Int) == 32 && (exp?.json["height"] as? Int) == 32, "2D export_png is the sprite pixel for pixel (32×32)")
        if let pic = try? ImageFiles.read(URL(fileURLWithPath: png)) {
            check(pic.pixel(0) == RGBA(255, 0, 255), "exported pixel keeps its exact colour")
        }
        _ = try? sprite.execute("extrude_to_3d", ["depth": 4])
        let ext = (try? sprite.execute("get_model_info", [:]))?.json["size"] as? [Int]
        check(ext == [32, 32, 4], "extrude_to_3d makes the sprite 4 voxels deep")
        try? FileManager.default.removeItem(at: tmp)

        // Pixel-art craft: ramps, line cleanup, checks and review pictures.
        let craft = Engine()
        _ = try? craft.execute("new_sprite", ["width": 16, "height": 16])
        let ramp = (try? craft.execute("make_color_ramp", ["base": "#c0503c"]))?.json["colors"] as? [String] ?? []
        let lumas = ramp.compactMap(RGBA.parse).map { 0.299 * Double($0.r) + 0.587 * Double($0.g) + 0.114 * Double($0.b) }
        check(ramp.count == 5 && lumas == lumas.sorted() && ramp[2] == "#c0503c", "make_color_ramp base: 5 colours, darkest first, base in the middle (\(ramp))")
        if let dark = RGBA.parse(ramp.first ?? ""), let lit = RGBA.parse(ramp.last ?? "") {
            check(Int(dark.b) - Int(dark.r) > Int(0x3c) - Int(0xc0) && Int(lit.g) > Int(lit.b), "ramp shadows lean cool, highlights warm")
        }
        // A 1:1 diagonal drawn with doubled corners, next to a box outline whose corners must stay.
        _ = try? craft.execute("paint_slice", ["rows": [
            "1...............", "11..............", ".11.............", "..11............", "...1............",
            "................", "..........1111..", "..........1..1..", "..........1..1..", "..........1111..",
        ], "legend": ["1": "#222034"]])
        let lint = (try? craft.execute("analyze_model", [:]))?.json ?? [:]
        let doubled = ((lint["pixel_art"] as? [String: Any])?["doubled_corners"] as? [String: Any])?["count"] as? Int ?? 0
        check(doubled > 0, "analyze_model finds doubled corners in a staircase line (\(doubled))")
        let pp = (try? craft.execute("pixel_perfect", [:]))?.json["changed"] as? Int ?? 0
        let boxRow = ((try? craft.execute("get_slice", ["axis": "z", "index": 0]))?.json["rows"] as? [String] ?? [])
            .map { String($0.map { (ch: Character) -> Character in ch == "." ? "." : "#" }) }
        check(pp >= 2 && boxRow.count == 16 && boxRow[4] == "...#............" && boxRow[6].hasSuffix("####..") && boxRow[9].hasSuffix("####.."),
              "pixel_perfect cleans the diagonal and keeps the box corners (\(pp) removed)")
        let again = ((try? craft.execute("analyze_model", [:]))?.json["pixel_art"] as? [String: Any])?["doubled_corners"]
        check(again == nil, "no doubled corners left after pixel_perfect")
        // Pillow shading: a disc that gets lighter toward its middle in rings, versus one lit from the top-left.
        func disc(_ lightFromTopLeft: Bool) -> [String] {
            (0..<24).map { r in String((0..<24).map { c -> Character in
                let dx = Double(c) - 11.5, dy = Double(r) - 11.5, d = (dx * dx + dy * dy).squareRoot()
                if d > 10 { return "." }
                if d > 9 { return "1" }
                if lightFromTopLeft { let t = (dx + dy) / 20; return t < -0.3 ? "4" : t < 0.1 ? "3" : "2" }
                return d < 4 ? "4" : d < 7 ? "3" : "2"
            }) }
        }
        var pillow = false, lit = false
        for (rows, isLit) in [(disc(false), false), (disc(true), true)] {
            _ = try? craft.execute("new_sprite", ["width": 24, "height": 24])
            _ = try? craft.execute("paint_slice", ["rows": rows, "legend": ["1": "#222034", "2": "#45283c", "3": "#ac3232", "4": "#d95763"]])
            let issues = (try? craft.execute("analyze_model", [:]))?.json["issues"] as? [String] ?? []
            let flagged = issues.contains { $0.contains("pillow") }
            if isLit { lit = !flagged } else { pillow = flagged }
        }
        check(pillow && lit, "pillow shading is flagged, top-left lighting is not")
        let ragged = (try? craft.execute("paint_slice", ["rows": ["111", "11", "1111"], "color": 1]))?.json["warnings"] as? [String] ?? []
        check(ragged.contains { $0.contains("different lengths") }, "paint_slice warns about rows of different widths")
        _ = try? craft.execute("add_frame", [:])
        let rev = try? craft.execute("review_model", [:])
        check(rev?.images.count == 3 && (rev?.json["pixel_art"] as? [String: Any]) != nil && rev?.json["tips"] != nil,
              "sprite review: grid/value, silhouette/sizes and frame pictures, plus pixel-art report")
        let guide = (try? craft.execute("pixel_art_guide", ["topic": "shading"]))?.json["guide"] as? String ?? ""
        check(guide.contains("PILLOW"), "pixel_art_guide returns a section")

        // A full-frame background: a sky of flat hard-edged stripes over a ground band.
        func sky(dithered: Bool) -> [String] {
            let bands: [(Character, Int)] = [("1", 7), ("2", 6), ("3", 5), ("4", 4)]
            var rows: [String] = []
            for (k, (ch, h)) in bands.enumerated() {
                for r in 0..<h {
                    if dithered && r == h - 1 && k < bands.count - 1 {
                        // The last row of each band mixes with the next colour in a checkerboard.
                        rows.append(String((0..<48).map { $0 % 2 == 0 ? ch : bands[k + 1].0 }))
                    } else { rows.append(String(repeating: ch, count: 48)) }
                }
            }
            while rows.count < 24 { rows.append(String(repeating: "5", count: 48)) }
            return rows
        }
        var stripeTip = false, ditherTip = true, quiet = false
        for dithered in [false, true] {
            _ = try? craft.execute("new_sprite", ["width": 48, "height": 24])
            _ = try? craft.execute("paint_slice", ["rows": sky(dithered: dithered),
                                                    "legend": ["1": "#1e1a3f", "2": "#2e2459", "3": "#473575", "4": "#6e4585", "5": "#243b2c"]])
            let r = (try? craft.execute("analyze_model", [:]))?.json ?? [:]
            let tips = r["tips"] as? [String] ?? [], issues = r["issues"] as? [String] ?? []
            let striped = tips.contains { $0.contains("flat full-width stripes") }
            if dithered { ditherTip = striped } else {
                stripeTip = striped
                quiet = r["kind"] as? String == "full-frame background or scene"
                    && !issues.contains { $0.contains("canvas edge") || $0.contains("pillow") } && !tips.contains { $0.contains("silhouette edge") || $0.contains("light direction") || $0.contains("brightest pixels") }
            }
        }
        check(stripeTip && !ditherTip, "stacked flat sky stripes get a tip; dithered transitions do not")
        check(quiet, "full-frame backgrounds skip the canvas-edge, outline and light checks")

        // Coaching: next steps on a new sprite, and reminders when saving without (or after) a review.
        let coach = Engine()
        let started = (try? coach.execute("new_sprite", ["width": 16, "height": 16]))?.json["next_steps"] as? [String] ?? []
        check(started.contains { $0.contains("make_color_ramp") } && started.last?.contains("review_model again") == true,
              "a new sprite lists next steps with ramps and a second review")
        let coachDir = FileManager.default.temporaryDirectory.appendingPathComponent("openpixel-coach-\(getpid())")
        func reminder(_ tool: String) -> String? {
            (try? coach.execute(tool, ["path": coachDir.appendingPathComponent("x.png").path]))?.json["review_reminder"] as? String
        }
        _ = try? coach.execute("paint_slice", ["rows": ["..11..", ".1221.", "112211"], "legend": ["1": "#222034", "2": "#df7126"]])
        let unreviewed = reminder("export_png")
        _ = try? coach.execute("add_colors", ["colors": ["#df7127"]])
        _ = try? coach.execute("set_pixels", ["pixels": [[2, 4, "#df7127"]]])
        let firstReview = (try? coach.execute("review_model", [:]))?.json ?? [:]
        let openIssues = reminder("export_png")
        _ = try? coach.execute("set_pixels", ["pixels": [[2, 4, "#df7126"]]])
        let changed = reminder("export_png")
        let second = ((try? coach.execute("review_model", [:]))?.json["issues"] as? [String] ?? []).count
        let reReviewed = reminder("export_png")
        let next = firstReview["next"] as? [String] ?? []
        check(unreviewed?.contains("without a review") == true && openIssues?.contains("issue(s)") == true
              && changed?.contains("since the last review") == true,
              "exports remind: not reviewed, issues still open, changed since the review (\(unreviewed ?? "-") | \(openIssues ?? "-") | \(changed ?? "-"))")
        let palWarn = (try? coach.execute("set_palette", ["colors": ["#2b2a55", "#2c2b57", "#a65a86"]]))?.json["warnings"] as? [String] ?? []
        let addWarn = (try? coach.execute("add_colors", ["colors": ["#a75b87", "#ffd23f"]]))?.json["warnings"] as? [String] ?? []
        check(palWarn.first?.contains("#2b2a55 and #2c2b57") == true && addWarn.first?.contains("#a75b87 and #a65a86") == true
              && !addWarn.contains { $0.contains("#ffd23f") },
              "set_palette and add_colors warn about near-identical colours as they are chosen (\(palWarn.first ?? "-") | \(addWarn.first ?? "-"))")
        check(next.contains { $0.contains("review_model again") } && next.contains { $0.contains("make_color_ramp") },
              "a review with colour issues says to review again and points to make_color_ramp (\(next))")
        check(second == 0 ? reReviewed == nil : reReviewed?.contains("listed \(second) issue(s)") == true,
              "after a fresh review the reminder only reflects that review's open issues (\(reReviewed ?? "none"))")
        try? FileManager.default.removeItem(at: coachDir)

        // A floating 3D scene: a grounded block, a big separate cloud (fine) and one broken-off voxel (a stray).
        let scene = Engine()
        _ = try? scene.execute("new_model", ["size_x": 24, "size_y": 24, "size_z": 24])
        _ = try? scene.execute("fill_box", ["from": [4, 0, 4], "to": [12, 6, 12], "color": 3])
        _ = try? scene.execute("fill_box", ["from": [15, 16, 15], "to": [20, 18, 19], "color": 22])
        _ = try? scene.execute("set_voxels", ["voxels": [[2, 10, 2]], "color": 5])
        let sr = (try? scene.execute("analyze_model", [:]))?.json ?? [:]
        let sIssues = sr["issues"] as? [String] ?? [], sTips = sr["tips"] as? [String] ?? []
        check(sIssues.contains { $0.contains("1 tiny loose piece") } && sTips.contains { $0.contains("1 larger piece") }
              && !sIssues.contains { $0.contains("float in the air") },
              "3D: a broken-off voxel is an issue, a separate cloud only a tip (\(sIssues), \(sTips))")

        // Agent observation and pipeline tools, one scenario per kind of work: a static sprite, an animation,
        // a full-frame background and a voxel model; then the style lock, batches and set reviews.
        let obsDir = FileManager.default.temporaryDirectory.appendingPathComponent("openpixel-observe-\(getpid())")
        try? FileManager.default.createDirectory(at: obsDir, withIntermediateDirectories: true)
        /// A text map from view_as_text as [row label: [column label: character]], read with the column and
        /// row ranges the tool reports. Also checks that every row starts with its label and the units ruler
        /// line matches the column labels.
        func textGrid(_ out: [String: Any], _ key: String) -> (grid: [Int: [Int: Character]], rulersOK: Bool) {
            func labels(_ s: Any?) -> [Int] {
                let ends = ((s as? String)?.split(separator: " ").last.map(String.init) ?? "").components(separatedBy: "→").compactMap { Int($0) }
                guard ends.count == 2 else { return [] }
                return ends[0] <= ends[1] ? Array(ends[0]...ends[1]) : Array((ends[1]...ends[0]).reversed())
            }
            let cols = labels(out["columns"]), rows = labels(out["rows"]), lines = out[key] as? [String] ?? []
            guard !cols.isEmpty, !rows.isEmpty, lines.count > rows.count else { return ([:], false) }
            let head = lines.count - rows.count
            var ok = String(lines[head - 1].suffix(cols.count)) == String(cols.map { Character(String($0 % 10)) })
            var g: [Int: [Int: Character]] = [:]
            for (i, r) in rows.enumerated() {
                let line = lines[head + i]
                ok = ok && Int(line.dropLast(cols.count).trimmingCharacters(in: .whitespaces)) == r
                for (j, c) in Array(line.suffix(cols.count)).enumerated() { g[r, default: [:]][cols[j]] = c }
            }
            return (g, ok)
        }
        func score(_ e: Engine) -> [String: Any] { (try? e.execute("analyze_model", [:]))?.json["score"] as? [String: Any] ?? [:] }
        func codes(_ s: [String: Any]) -> [String] { (s["deductions"] as? [[String: Any]] ?? []).compactMap { $0["code"] as? String } }
        let orbColours: [String: Any] = ["1": "#222034", "2": "#45283c", "3": "#ac3232", "4": "#d95763"]

        // STATIC: the score ranks a top-left-lit orb above a pillow-shaded one, and the automatic critique
        // pins each change on the edit that made it.
        let st = Engine()
        _ = try? st.execute("new_sprite", ["width": 24, "height": 24])
        let c1 = (try? st.execute("paint_slice", ["rows": disc(false), "legend": orbColours]))?.json["critique"] as? [String: Any] ?? [:]
        let c2 = (try? st.execute("paint_slice", ["rows": disc(true), "legend": orbColours]))?.json["critique"] as? [String: Any] ?? [:]
        let pillowScore = c1["score"] as? Int ?? -1, litScore = c2["score"] as? Int ?? -1
        check(((c1["findings"] as? [String]) ?? []).contains { $0.contains("pillow") } && litScore > pillowScore
              && (c2["change"] as? Int) == litScore - pillowScore && (c2["resolved"] as? [String])?.contains("pillow_shading") == true,
              "static: the first edit's critique lists pillow shading; relighting resolves it and raises the score (\(pillowScore) → \(litScore))")
        let cleaned = (try? st.execute("pixel_perfect", [:]))?.json ?? [:]
        let cleanCrit = cleaned["critique"] as? [String: Any] ?? [:]
        let removed = (cleaned["cells"] as? [[String: Any]])?.first
        let redo = (try? st.execute("set_pixels", ["pixels": [[removed?["x"] as? Int ?? 0, removed?["row"] as? Int ?? 0, "#222034"]]]))?.json["critique"] as? [String: Any] ?? [:]
        check((cleanCrit["resolved"] as? [String])?.contains("doubled_corners") == true
              && (redo["introduced"] as? [String])?.contains { $0.contains("doubled corner") } == true && (redo["change"] as? Int ?? 0) < 0,
              "static: pixel_perfect's critique resolves doubled corners; putting one back is reported as introduced, with the score drop")
        _ = try? st.execute("undo", [:])
        _ = try? st.execute("set_pixels", ["pixels": [[6, 9, "#ff00ff"]]])
        let stText = (try? st.execute("view_as_text", ["region": [0, 0, 23, 23]]))?.json ?? [:]
        let (pix, pixRulers) = textGrid(stText, "pixels")
        let magenta = (stText["legend"] as? [String: [String: Any]])?.first { $0.value["hex"] as? String == "#ff00ff" }?.key
        check(pixRulers && magenta != nil && pix[9]?[6].map(String.init) == magenta && pix[0]?[0] == ".",
              "static: view_as_text pixels put x=6, row 9 under its ruler labels, with the legend colour")
        let (vals, _) = textGrid(stText, "values")
        func meanValue(_ rows: ClosedRange<Int>, _ cols: ClosedRange<Int>) -> Double {
            let ds = rows.flatMap { r in cols.compactMap { vals[r]?[$0]?.wholeNumberValue } }
            return ds.isEmpty ? 0 : Double(ds.reduce(0, +)) / Double(ds.count)
        }
        check(meanValue(4...10, 4...10) > meanValue(13...19, 13...19),
              "static: the value map is brighter toward the top-left light (\(meanValue(4...10, 4...10)) vs \(meanValue(13...19, 13...19)))")

        // ANIMATION: a walk frame that lifts the whole body (feet off the ground line) versus one that only
        // swings the arms; the diff map agrees with the frame counts.
        let walker = ["................", "......1111......", ".....133331.....", ".....134431.....", ".....133331.....",
                      "......1331......", ".....133331.....", "....13333331....", "....13333331....", ".....133331.....",
                      ".....133331.....", ".....13..31.....", ".....13..31.....", ".....13..31.....", "....113..311....", "................"]
        func walk(lift: Bool) -> Engine {
            let w = Engine()
            _ = try? w.execute("new_sprite", ["width": 16, "height": 16])
            _ = try? w.execute("paint_slice", ["rows": walker, "legend": orbColours])
            _ = try? w.execute("add_frame", [:])
            if lift { _ = try? w.execute("transform", ["op": "move", "dy": 1]) } else {
                _ = try? w.execute("set_pixels", ["pixels": [[3, 8, "#222034"], [12, 8, "#222034"], [4, 7, "#ac3232"], [11, 7, "#ac3232"]]])
            }
            return w
        }
        let lifted = walk(lift: true), planted = walk(lift: false)
        let liftJSON = (try? lifted.execute("analyze_model", [:]))?.json ?? [:]
        let liftAnim = liftJSON["animation"] as? [String: Any] ?? [:]
        let liftScore = liftJSON["score"] as? [String: Any] ?? [:], plantScore = score(planted)
        let animCat = { (s: [String: Any]) in (s["categories"] as? [String: Int])?["animation"] ?? -1 }
        check(codes(liftScore).contains("ground_jitter") && !codes(plantScore).contains("ground_jitter")
              && (liftAnim["ground_line"] as? [Int]) == [14, 13] && animCat(plantScore) > animCat(liftScore),
              "animation: lifting the feet is flagged as ground-line jitter (rows \(liftAnim["ground_line"] ?? "-")); swinging the arms is not (\(animCat(liftScore)) < \(animCat(plantScore)))")
        let lastCrit = (try? lifted.execute("transform", ["op": "move", "dy": -1]))?.json["critique"] as? [String: Any] ?? [:]
        check((lastCrit["resolved"] as? [String])?.contains("ground_jitter") == true,
              "animation: moving the frame back down resolves the jitter in the critique (\(lastCrit))")
        _ = try? lifted.execute("undo", [:])
        let frameDiff = (try? lifted.execute("view_as_text", ["maps": ["diff"], "frame": 1]))?.json ?? [:]
        let dc = frameDiff["diff_counts"] as? [String: Int] ?? [:], filled = liftAnim["filled_per_frame"] as? [Int] ?? []
        let (dg, diffRulers) = textGrid(frameDiff, "diff")
        check(diffRulers && filled.count == 2 && (dc["added"] ?? -1) + (dc["same"] ?? 0) + (dc["recolored"] ?? 0) == filled[1]
              && (dc["removed"] ?? -1) + (dc["same"] ?? 0) + (dc["recolored"] ?? 0) == filled[0]
              && frameDiff["diff_against_frame"] as? Int == 0 && dg[14]?[4] == "-" && dg[0]?[6] == "+",
              "animation: the diff map against the previous frame accounts for every filled pixel of both frames (\(dc))")
        let noDiff = try? Engine().execute("view_as_text", ["maps": ["diff"]])
        check(noDiff == nil, "animation: a diff on a single frame is refused with a reason")

        // BACKGROUND: hard flat sky stripes score below dithered ones; neither is wrecked by sprite-only checks
        // (edge, outline, light), and the text view shows the whole canvas.
        var skyScores: [Bool: Int] = [:]
        var skyRows: [Bool: [Int: [Int: Character]]] = [:]
        for dithered in [false, true] {
            let bg = Engine()
            _ = try? bg.execute("new_sprite", ["width": 48, "height": 24])
            _ = try? bg.execute("paint_slice", ["rows": sky(dithered: dithered),
                                                 "legend": ["1": "#1e1a3f", "2": "#2e2459", "3": "#473575", "4": "#6e4585", "5": "#243b2c"]])
            skyScores[dithered] = score(bg)["total"] as? Int ?? -1
            let t = (try? bg.execute("view_as_text", ["maps": ["pixels"]]))?.json ?? [:]
            if t["columns"] as? String == "x 0→47" && t["rows"] as? String == "row 0→23" { skyRows[dithered] = textGrid(t, "pixels").grid }
        }
        check((skyScores[true] ?? 0) > (skyScores[false] ?? 0) && (skyScores[false] ?? 0) >= 85,
              "background: dithered band edges score above hard stripes, and a background is not penalised as a sprite (\(skyScores[false] ?? -1) < \(skyScores[true] ?? -1))")
        let distinct = { (g: [Int: [Int: Character]]?, r: Int) in Set((g?[r] ?? [:]).values).count }
        check(skyRows.count == 2 && distinct(skyRows[false], 6) == 1 && distinct(skyRows[true], 6) == 2,
              "background: the text view covers the full canvas; a hard band edge is one character wide, a dithered one mixes two")

        // VOXEL: projections face the right way, and the critique catches a stray voxel when it is placed and
        // clears it when it is erased.
        let vx = Engine()
        _ = try? vx.execute("new_model", ["size_x": 12, "size_y": 12, "size_z": 12])
        _ = try? vx.execute("fill_box", ["from": [2, 0, 2], "to": [8, 5, 8], "color": 3])
        let towerCrit = (try? vx.execute("fill_box", ["from": [2, 6, 6], "to": [4, 9, 8], "color": 5]))?.json["critique"] as? [String: Any] ?? [:]
        let strayCrit = (try? vx.execute("set_voxels", ["voxels": [[10, 8, 10]], "color": 7]))?.json["critique"] as? [String: Any] ?? [:]
        let eraseCrit = (try? vx.execute("erase_voxels", ["voxels": [[10, 8, 10]]]))?.json["critique"] as? [String: Any] ?? [:]
        check((strayCrit["introduced"] as? [String])?.contains { $0.contains("loose piece") } == true && (strayCrit["change"] as? Int ?? 0) < 0
              && (eraseCrit["resolved"] as? [String])?.contains("floating_strays") == true && eraseCrit["score"] as? Int == towerCrit["score"] as? Int,
              "voxel: placing a stray voxel is reported as introduced; erasing it resolves it and restores the score (\(towerCrit["score"] ?? "-"))")
        // The tower stands on the left (x 2-4) at the front (z 6-8) of the block.
        func sil(_ view: String) -> [Int: [Int: Character]] {
            textGrid((try? vx.execute("view_as_text", ["view": view, "maps": ["silhouette"]]))?.json ?? [:], "silhouette").grid
        }
        let front = sil("front"), left = sil("left"), right = sil("right"), above = sil("top")
        check(front[9]?[2] == "#" && front[9]?[5] == "." && left[9]?[7] == "#" && left[9]?[3] == "."
              && right[9]?[7] == "#" && above[7]?[3] == "#" && above[3]?[3] == "#" && front[5]?[8] == "#",
              "voxel: front, left, right and top projections put the tower at the left front of the block")
        // Reading order, not just labels: from the left the front (high z) is on the right of each text row, from
        // the right it is on the left, from the front low x is on the left.
        func order(_ view: String) -> String? { (try? vx.execute("view_as_text", ["view": view, "maps": ["silhouette"]]))?.json["columns"] as? String }
        check(order("left") == "z 1→9" && order("right") == "z 9→1" && order("front") == "x 1→9" && order("back") == "x 9→1",
              "voxel: each projection reads left to right as that view is seen (\(order("left") ?? "-"), \(order("right") ?? "-"))")
        let topText = (try? vx.execute("view_as_text", ["view": "top", "maps": ["pixels"]]))?.json ?? [:]
        let topPix = textGrid(topText, "pixels").grid
        let towerChar = (topText["legend"] as? [String: [String: Any]])?.first { $0.value["index"] as? Int == 5 }?.key
        check(topPix[7]?[3].map(String.init) == towerChar && topPix[3]?[3].map(String.init) != towerChar,
              "voxel: the top projection shows the first voxel from above (the tower's colour on top of the tower only)")

        // STYLE LOCK: a locked palette, size and light for a set; agents can't drift, the person still can.
        let sty = Engine()
        let styleFile = obsDir.appendingPathComponent("house.json").path
        let set = (try? sty.execute("set_style", ["name": "house", "preset": "pico8", "max_colors": 6, "light": "top-left",
                                                  "outline": "dark", "size": [16, 16], "notes": ["2px chunky outlines"], "save_path": styleFile]))?.json ?? [:]
        _ = try? sty.execute("new_sprite", [:])
        let sInfo2 = (try? sty.execute("get_model_info", [:]))?.json ?? [:]
        var refusal = ""
        do { _ = try sty.execute("set_pixels", ["pixels": [[3, 3, "#123456"]]]) } catch { refusal = "\(error)" }
        let rampRefused = (try? sty.execute("make_color_ramp", ["base": "#c0503c"])) == nil
        let exact = try? sty.execute("set_pixels", ["pixels": [[3, 3, "#ff004d"]]])
        check(set["critique"] == nil, "style: locking a style on an empty canvas gives no critique (nothing is drawn yet)")
        check(set["saved"] != nil && sInfo2["size"] as? [Int] == [16, 16, 1] && sInfo2["palette_colors"] as? Int == 16
              && refusal.contains("locks the palette") && refusal.contains("Closest") && rampRefused && exact != nil,
              "style: new canvases take the locked size and palette; off-palette hex colours and ramps are refused with the closest colours, exact matches pass")
        _ = try? sty.execute("set_pixels", ["pixels": [[4, 4, "#123456"]]], source: "person")
        let styScore = score(sty)
        let styNotes = (try? sty.execute("review_model", [:]))?.json["style_notes"] as? [String]
        check(codes(styScore).contains("style_palette") && (styScore["categories"] as? [String: Int])?["style"] != nil && styNotes == ["2px chunky outlines"],
              "style: the person may still use any colour; the review flags it against the style and repeats the notes")
        let loaded = Engine()
        _ = try? loaded.execute("paint_slice", ["rows": disc(true), "legend": orbColours])
        let applied = (try? loaded.execute("set_style", ["path": styleFile]))?.json ?? [:]
        let loadedStyle = (try? loaded.execute("get_style", [:]))?.json["style"] as? [String: Any]
        let movedCount = (applied["applied_to_canvas"] as? [String: Any])?["drawn_colours_moved_to_closest"] as? Int ?? 0
        check(loadedStyle?["name"] as? String == "house" && (loadedStyle?["colors"] as? [String])?.count == 16 && movedCount > 0
              && !codes(score(loaded)).contains("style_palette"),
              "style: a saved style file loads in another session and moves a drawing's colours into the locked palette (\(movedCount) moved)")
        _ = try? loaded.execute("undo", [:])
        let relocked = try? loaded.execute("set_pixels", ["pixels": [[1, 1, "#ff004d"]]])
        check(relocked != nil, "style: after undoing the palette change, a locked colour can still be used (it is added back)")
        let lightLock = Engine()
        _ = try? lightLock.execute("new_sprite", ["width": 24, "height": 24])
        _ = try? lightLock.execute("set_style", ["name": "lit", "lock_palette": false, "light": "top-left"])
        _ = try? lightLock.execute("paint_slice", ["rows": disc(true), "legend": orbColours])
        let litOK = !codes(score(lightLock)).contains("style_light")
        _ = try? lightLock.execute("transform", ["op": "flip", "axis": "x"])
        _ = try? lightLock.execute("transform", ["op": "flip", "axis": "y"])
        check(litOK && codes(score(lightLock)).contains("style_light"),
              "style: shading that agrees with the locked light passes; the same orb lit from the bottom-right is flagged")

        // BATCH: many calls in one request, one critique; checked up front; atomic rollback.
        let bat = Engine()
        _ = try? bat.execute("new_sprite", ["width": 8, "height": 8])
        let ok3 = (try? bat.execute("batch", ["calls": [
            ["tool": "paint_slice", "args": ["rows": ["........", ".1111...", ".1221...", ".1111..."], "legend": ["1": "#222034", "2": "#df7126"]]],
            ["tool": "set_pixels", "args": ["pixels": [[5, 2, "#df7126"]]]],
            ["tool": "view_as_text", "args": ["maps": ["silhouette"]]],
        ]]))?.json ?? [:]
        let inner = ok3["results"] as? [[String: Any]] ?? []
        check(ok3["ran"] as? Int == 3 && ok3["failed"] as? Int == 0 && ok3["critique"] != nil
              && !inner.contains { ($0["result"] as? [String: Any])?["critique"] != nil }
              && (inner.last?["result"] as? [String: Any])?["silhouette"] != nil,
              "batch: three calls run in one request with one critique for the whole batch")
        let revBefore = bat.revision
        let typo = try? bat.execute("batch", ["calls": [["tool": "set_pixels", "args": ["pixels": [[0, 0, 1]]]], ["tool": "set_pixel"]]])
        let revAfterTypo = bat.revision
        let filledBefore = (try? bat.execute("get_model_info", [:]))?.json["voxels_in_active_frame"] as? Int
        let atomic = (try? bat.execute("batch", ["atomic": true, "calls": [
            ["tool": "set_pixels", "args": ["pixels": [[0, 7, 1], [1, 7, 1]]]], ["tool": "fill_box", "args": ["from": [0, 0, 0]]],
        ]]))?.json ?? [:]
        let filledAfter = (try? bat.execute("get_model_info", [:]))?.json["voxels_in_active_frame"] as? Int
        check(typo == nil && revAfterTypo == revBefore && atomic["rolled_back"] as? Bool == true && filledBefore == filledAfter,
              "batch: an unknown tool is refused before anything runs; atomic=true rolls back when a call fails (\(filledBefore ?? -1) = \(filledAfter ?? -1) pixels)")

        // SET REVIEW: three saved orbs, one lit from the other side in other colours.
        var setPaths: [String] = []
        for (k, (flip, colours)) in [(false, orbColours), (false, orbColours),
                                     (true, ["1": "#1a1c2c", "2": "#3b5dc9", "3": "#41a6f6", "4": "#73eff7"] as [String: Any])].enumerated() {
            let e2 = Engine()
            _ = try? e2.execute("new_sprite", ["width": 24, "height": 24])
            _ = try? e2.execute("paint_slice", ["rows": disc(true), "legend": colours])
            if flip { _ = try? e2.execute("transform", ["op": "flip", "axis": "x"]); _ = try? e2.execute("transform", ["op": "flip", "axis": "y"]) }
            let p = obsDir.appendingPathComponent("orb\(k).openpixel").path
            _ = try? e2.execute("save_model", ["path": p])
            setPaths.append(p)
        }
        let rs = try? Engine().execute("review_set", ["paths": setPaths])
        let setJSON = rs?.json["set"] as? [String: Any] ?? [:]
        let setIssues = setJSON["issues"] as? [String] ?? [], setTips = setJSON["tips"] as? [String] ?? []
        check(rs?.images.count == 1 && (rs?.json["files"] as? [Any])?.count == 3 && setJSON["weakest_file"] != nil
              && setIssues.contains { $0.contains("different sides") } && setTips.contains { $0.contains("drift") },
              "review_set: one contact sheet, a score per file, and set checks for mixed light and palette drift")

        // Over HTTP, every file argument is confined, including inside batches, style files and sets.
        let jailRoot = obsDir.appendingPathComponent("jail")
        let policy: (String) throws -> String = { try MCPHTTPServer.confine($0, root: jailRoot) }
        let nestedOut = try? MCPServer.confinePaths("batch", ["calls": [["tool": "export_png", "args": ["path": "/etc/x.png"]]]], policy)
        let nestedIn = try? MCPServer.confinePaths("batch", ["calls": [["tool": "export_png", "args": ["path": "a.png"]]]], policy)
        let innerPath = ((nestedIn?["calls"] as? [[String: Any]])?.first?["args"] as? [String: Any])?["path"] as? String
        check(nestedOut == nil && innerPath?.hasSuffix("/jail/a.png") == true
              && (try? MCPServer.confinePaths("set_style", ["save_path": "/tmp/style.json"], policy)) == nil
              && (try? MCPServer.confinePaths("set_style", ["path": "../style.json"], policy)) == nil
              && (try? MCPServer.confinePaths("review_set", ["paths": ["a.openpixel", "/etc/hosts"]], policy)) == nil
              && (try? MCPServer.confinePaths("export_png", ["path": 5], policy)) == nil,
              "HTTP paths: batch calls, style files and review_set lists are confined like path")
        // UPDATES: agents read the same appcast Sparkle uses (here a local file in release.sh's format).
        check(Updates.compare("1.10.0", "1.9.2") == 1 && Updates.compare("1.0", "1.0.0") == 0 && Updates.compare("1.99.99", "2.0.0") == -1,
              "updates: versions compare by number, not as text")
        func appcast(_ versions: [String]) -> String {
            """
            <?xml version="1.0" encoding="utf-8"?>
            <rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>OpenPixel</title>
            \(versions.map { v in """
                <item><title>OpenPixel \(v)</title><sparkle:version>1</sparkle:version>
                  <sparkle:shortVersionString>\(v)</sparkle:shortVersionString>
                  <sparkle:fullReleaseNotesLink>https://github.com/sophne/openpixel/releases/tag/v\(v)</sparkle:fullReleaseNotesLink>
                  <enclosure url="https://github.com/sophne/openpixel/releases/download/v\(v)/OpenPixel.dmg" sparkle:edSignature="x" length="1" type="application/octet-stream"/>
                </item>
                """ }.joined())
            </channel></rss>
            """
        }
        let feed = obsDir.appendingPathComponent("appcast.xml")
        Updates.feedOverride = feed
        try? appcast(["9.8.0", "9.10.1"]).write(to: feed, atomically: true, encoding: .utf8)
        let upd = Engine()
        let newer = (try? upd.execute("check_for_updates", ["refresh": true]))?.json ?? [:]
        let installNote = (try? upd.execute("check_for_updates", ["install": true]))?.json["install"] as? String ?? ""
        check(newer["latest_version"] as? String == "9.10.1" && newer["update_available"] as? Bool == true
              && (newer["download"] as? String)?.hasSuffix("/v9.10.1/OpenPixel.dmg") == true && (newer["release_notes"] as? String)?.hasSuffix("v9.10.1") == true
              && (newer["next"] as? String)?.contains("install=true") == true && installNote.contains("No OpenPixel window"),
              "updates: the newest release in the feed is found, with its download and notes; without a window, install says what to do")
        try? appcast(["0.0.1"]).write(to: feed, atomically: true, encoding: .utf8)
        let cachedAnswer = (try? upd.execute("check_for_updates", [:]))?.json["latest_version"] as? String
        let current = (try? upd.execute("check_for_updates", ["refresh": true]))?.json ?? [:]
        check(cachedAnswer == "9.10.1" && current["update_available"] as? Bool == false && (current["next"] as? String)?.contains("up to date") == true,
              "updates: answers are cached for a while, refresh asks again, and an older feed means up to date")
        try? "<rss><channel></channel></rss>".write(to: feed, atomically: true, encoding: .utf8)
        check((try? upd.execute("check_for_updates", ["refresh": true])) == nil, "updates: a feed without releases is an error, not \"up to date\"")
        try? appcast(["0.0.1"]).write(to: feed, atomically: true, encoding: .utf8)
        let mcpUpd = MCPServer { LocalBackend(engine: Engine()) }
        let viaMCP = mcpUpd.handle(#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"check_for_updates","arguments":{"refresh":true}}}"#) ?? ""
        var behind: [String: Any] = ["running_version": "99.0.0"], same: [String: Any] = ["running_version": MCPServer.version]
        MCPServer.addConnectionVersion(&behind, installed: nil)
        MCPServer.addConnectionVersion(&same, installed: MCPServer.version)
        check(viaMCP.contains("agent_connection_version") && !viaMCP.contains("\"isError\":true")
              && (behind["reconnect_needed"] as? String)?.contains("99.0.0") == true && same["reconnect_needed"] == nil,
              "updates: over MCP the agent hears its own connection's version, and to reconnect when the app is newer")
        Updates.feedOverride = nil
        try? FileManager.default.removeItem(at: obsDir)

        let server = MCPServer { LocalBackend(engine: engine) }
        let initRes = server.handle(#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#) ?? ""
        check(initRes.contains("\"openpixel\""), "MCP initialize")
        let list = server.handle(#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#) ?? ""
        check(list.contains("paint_slice") && !list.contains("ui_state"), "MCP tools/list hides editor-only tools")
        let listed = ((try? JSONSerialization.jsonObject(with: Data(list.utf8))) as? [String: Any]).flatMap { ($0["result"] as? [String: Any])?["tools"] as? [[String: Any]] } ?? []
        let readOnly = { (n: String) in (listed.first { $0["name"] as? String == n }?["annotations"] as? [String: Any])?["readOnlyHint"] as? Bool }
        check(["view_as_text", "set_style", "get_style", "set_feedback", "batch", "review_set", "check_for_updates"].allSatisfy { n in listed.contains { $0["name"] as? String == n } }
              && readOnly("view_as_text") == true && readOnly("review_set") == true && readOnly("batch") == false,
              "MCP lists the observation and pipeline tools with the right read-only hints")
        let call = server.handle(#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"render_view","arguments":{"view":"front"}}}"#) ?? ""
        check(call.contains("image/png"), "MCP tools/call returns an image")
        let bad = server.handle(#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"fill_box","arguments":{"from":[0,0,0]}}}"#) ?? ""
        check(bad.contains("\"isError\":true"), "MCP reports tool errors")
        check(server.handle(#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#) == nil, "MCP ignores notifications")
        let prompts = server.handle(#"{"jsonrpc":"2.0","id":5,"method":"prompts/list"}"#) ?? ""
        let spritePrompt = server.handle(#"{"jsonrpc":"2.0","id":6,"method":"prompts/get","params":{"name":"make_sprite","arguments":{"subject":"a fox"}}}"#) ?? ""
        check(prompts.contains("make_sprite") && prompts.contains("animate_sprite") && spritePrompt.contains("a fox"), "MCP prompts for sprites and animation")
        // Damaged and hostile files must fail with an error, never crash or read past the data.
        func chunk(_ id: String, _ len: UInt32, _ body: [UInt8]) -> [UInt8] {
            Array(id.utf8) + withUnsafeBytes(of: len.littleEndian, Array.init) + [0, 0, 0, 0] + body
        }
        let header = Array("VOX ".utf8) + [150, 0, 0, 0]
        let hostile: [(String, [UInt8])] = [
            ("truncated SIZE", header + chunk("SIZE", 12, [8, 0, 0, 0])),
            ("chunk longer than file", header + chunk("SIZE", 12, [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]) + chunk("XYZI", 0xFFFF_FFF0, [1, 0, 0, 0])),
            ("huge model size", header + chunk("SIZE", 12, [0, 0, 0, 0x7F, 0, 0, 0, 0x7F, 0, 0, 0, 0x7F])),
            ("zero model size", header + chunk("SIZE", 12, [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])),
            ("short palette", header + chunk("SIZE", 12, [4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]) + chunk("RGBA", 8, [1, 2, 3, 4, 5, 6, 7, 8])),
            ("only a header", header),
        ]
        for (what, bytes) in hostile {
            check((try? VoxFile.decode(Data(bytes), name: "x")) == nil, ".vox \(what) is refused")
        }
        // Colour 200 with no palette: the voxel stays inside the model but is cleared, not looked up.
        let noPalette = header + chunk("SIZE", 12, [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]) + chunk("XYZI", 8, [1, 0, 0, 0, 1, 1, 1, 200])
        if let d = try? VoxFile.decode(Data(noPalette), name: "x") {
            check(d.cels[0][0].data.allSatisfy { Int($0) < d.palette.count }, ".vox colours past the palette are dropped")
        } else { check(false, ".vox without palette opens") }
        let bigJSON = #"{"format":"openpixel","size":[256,256,256],"frames":[{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}]}"#
        check((try? NativeFile.decode(Data(bigJSON.utf8))) == nil, ".openpixel asking for too much memory is refused")
        let shortPal = ##"{"format":"openpixel","size":[1,1,1],"palette":["transparent","#ff0000"],"cels":[{"layer":0,"frame":0,"encoding":"zlib-base64","data":"OwEA"}]}"##
        if let d = try? NativeFile.decode(Data(shortPal.utf8)) {
            check(d.cels[0][0].data.allSatisfy { Int($0) < d.palette.count }, ".openpixel colours past the palette are dropped")
        } else { check(false, ".openpixel with a short palette opens") }

        // Agents over HTTP only reach ~/Documents/OpenPixel (here: a test folder).
        let jail = tmp.appendingPathComponent("jail")
        try? FileManager.default.createDirectory(at: jail, withIntermediateDirectories: true)
        try? FileManager.default.createSymbolicLink(atPath: jail.appendingPathComponent("out").path, withDestinationPath: "/tmp")
        check((try? MCPHTTPServer.confine("a.png", root: jail))?.hasSuffix("/jail/a.png") == true, "HTTP paths: relative names land in the folder")
        for escape in ["/etc/hosts", "../escape.png", "~/x.png", "sub/../../x.png", "out/x.png", "out"] {
            check((try? MCPHTTPServer.confine(escape, root: jail)) == nil, "HTTP paths: \(escape) is refused")
        }
        try? FileManager.default.removeItem(at: tmp)
        if let i = CommandLine.arguments.firstIndex(of: "--selftest"), i + 1 < CommandLine.arguments.count {
            // Optional: write pictures of the welcome model into a folder for a visual check.
            let dir = CommandLine.arguments[i + 1]
            let demo = Engine()
            Sample.build(into: demo)
            _ = try? demo.execute("export_png", ["path": dir + "/sample-iso.png", "scale": 6])
            if let r = try? demo.execute("review_model", ["scale": 4]), let png = r.images.first {
                try? png.write(to: URL(fileURLWithPath: dir + "/sample-review.png"))
            }
            _ = try? demo.execute("export_sheet", ["path": dir + "/sample-sheet.png", "scale": 2])
            print("Pictures written to \(dir)")
        }
        ChatSelfTest.run { check($0, $1) }
        print(ok ? "All checks passed." : "Some checks failed.")
        return ok
    }
}
