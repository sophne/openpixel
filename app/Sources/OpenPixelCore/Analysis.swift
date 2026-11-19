import Foundation

/// Checks an agent (or person) can use to review a model before refining it.
public enum Analysis {
    public static func analyze(_ doc: Document, frame: Int, style: StyleLock? = nil) -> [String: Any] {
        full(doc, frame: frame, style: style).json
    }

    /// The report plus its findings (coded and scored), which the automatic critique compares between edits.
    public static func full(_ doc: Document, frame: Int, style: StyleLock? = nil) -> (json: [String: Any], findings: Findings, total: Int) {
        let g = doc.composite(frame: frame)
        var count = 0
        var lo = (Int.max, Int.max, Int.max), hi = (-1, -1, -1)
        var perColor: [Int: Int] = [:]
        for y in 0..<doc.sy { for z in 0..<doc.sz { for x in 0..<doc.sx {
            let v = g[doc.index(x, y, z)]
            if v == 0 { continue }
            count += 1
            perColor[Int(v), default: 0] += 1
            lo = (min(lo.0, x), min(lo.1, y), min(lo.2, z)); hi = (max(hi.0, x), max(hi.1, y), max(hi.2, z))
        } } }
        var f = Findings()
        var result: [String: Any] = [
            "size": [doc.sx, doc.sy, doc.sz], "frame": frame, "voxels": count,
        ]
        if count == 0 {
            f.issue("empty", "shape", 100, "The model is empty.")
            result["issues"] = f.issues
            result["tips"] = [String]()
            result["score"] = f.score(categories: ["shape"])
            return (result, f, 0)
        }
        result["bounds"] = ["min": [lo.0, lo.1, lo.2], "max": [hi.0, hi.1, hi.2],
                            "size": [hi.0 - lo.0 + 1, hi.1 - lo.1 + 1, hi.2 - lo.2 + 1]]
        result["colors"] = perColor.sorted { $0.value > $1.value }.map {
            ["index": $0.key, "hex": doc.palette[$0.key].hex, "voxels": $0.value]
        }
        let unused = (1..<doc.palette.count).filter { perColor[$0] == nil }
        result["unused_palette_indexes"] = unused

        // Connected parts (6-neighbour). Parts not touching the ground and smaller than the largest are "floating".
        var label = [Int32](repeating: -1, count: doc.count)
        var parts: [(size: Int, grounded: Bool, sample: (Int, Int, Int))] = []
        for y in 0..<doc.sy { for z in 0..<doc.sz { for x in 0..<doc.sx {
            let i = doc.index(x, y, z)
            if g[i] == 0 || label[i] >= 0 { continue }
            let id = Int32(parts.count)
            var stack = [(x, y, z)]; label[i] = id
            var size = 0, grounded = false
            while let (cx, cy, cz) = stack.popLast() {
                size += 1
                if cy == lo.1 { grounded = true }
                for (nx, ny, nz) in [(cx+1,cy,cz),(cx-1,cy,cz),(cx,cy+1,cz),(cx,cy-1,cz),(cx,cy,cz+1),(cx,cy,cz-1)]
                where doc.inBounds(nx, ny, nz) {
                    let j = doc.index(nx, ny, nz)
                    if g[j] != 0 && label[j] < 0 { label[j] = id; stack.append((nx, ny, nz)) }
                }
            }
            parts.append((size, grounded, (x, y, z)))
        } } }
        let largest = parts.map { $0.size }.max() ?? 0
        let flat = doc.sz == 1
        // A picture that fills (nearly) the whole canvas is a background or scene, not a sprite on empty canvas:
        // margins, outlines and a single light direction don't apply to it.
        let fullFrame = flat && count * 10 >= doc.sx * doc.sy * 9
        result["kind"] = flat ? (fullFrame ? "full-frame background or scene" : "sprite") : "3d model"
        let floating = flat ? [] : parts.filter { !$0.grounded && $0.size < largest }
        result["parts"] = parts.count
        if flat && parts.count > 1 && !fullFrame {
            f.issue("separate_shapes", "shape", min(12, 3 * (parts.count - 1)), n: parts.count, "\(parts.count) separate shapes; small ones may be stray pixels (see find_voxels).")
        }
        if !floating.isEmpty {
            // Tiny loose bits are almost always stray voxels; bigger separate pieces (clouds, a floating island's
            // rocks, a hovering prop) are often meant to float, so they only get a tip.
            let tiny = max(3, min(8, count / 2000)) // a few voxels: a stray click or a broken-off bit
            let strays = floating.filter { $0.size <= tiny }, pieces = floating.filter { $0.size > tiny }
            result["floating_parts"] = floating.prefix(20).map { ["voxels": $0.size, "at": [$0.sample.0, $0.sample.1, $0.sample.2]] }
            if !strays.isEmpty {
                f.issue("floating_strays", "cleanup", min(15, 5 * strays.count), n: strays.count, "\(strays.count) tiny loose piece(s) of \(tiny) voxels or fewer float apart from everything else: probably strays (see floating_parts).")
            }
            if !pieces.isEmpty {
                f.tip("floating_pieces", "shape", 0, "\(pieces.count) larger piece(s) are separate from the main body. Fine for clouds or a floating scene; otherwise connect them.")
            }
        }

        // Left/right symmetry around the occupied bounds' centre.
        var same = 0, total = 0
        for y in lo.1...hi.1 { for z in lo.2...hi.2 { for x in lo.0...hi.0 {
            let v = g[doc.index(x, y, z)]
            if v == 0 { continue }
            total += 1
            let mx = lo.0 + hi.0 - x
            if doc.inBounds(mx, y, z) && g[doc.index(mx, y, z)] == v { same += 1 }
        } } }
        let sym = total == 0 ? 1.0 : Double(same) / Double(total)
        result["symmetry_x"] = (sym * 1000).rounded() / 1000
        if sym > 0.9 && sym < 0.999 && !fullFrame {
            f.tip("near_symmetric", "shape", 2, "Almost symmetric left/right (\(Int(sym * 100))%): if it should be symmetric, transform op=mirror makes it exact.")
        }

        if flat {
            if !fullFrame && (lo.0 == 0 || lo.1 == 0 || hi.0 == doc.sx - 1 || hi.1 == doc.sy - 1) {
                f.issue("touches_edge", "shape", 6, "The sprite touches the canvas edge; leave a 1-pixel margin for outlines.")
            }
        } else {
            if lo.0 == 0 || lo.2 == 0 || hi.0 == doc.sx - 1 || hi.1 == doc.sy - 1 || hi.2 == doc.sz - 1 {
                f.issue("touches_edge", "shape", 6, "The model touches the edge of the model space; resize_model gives it room.")
            }
            if lo.1 > 0 { f.tip("off_ground", "shape", 3, "The lowest voxel is at y=\(lo.1); if the model should stand on the ground, move it down (transform op=move dy=-\(lo.1)).") }
        }
        if perColor.count == 1 && count > 8 {
            f.issue("one_colour", "color", 15, "Only one colour is used; shading with 2-4 tones of a ramp reads better as pixel art.")
        }
        // Surface share: lone voxels with no neighbours are often stray clicks.
        var lonely = 0
        for y in lo.1...hi.1 { for z in lo.2...hi.2 { for x in lo.0...hi.0 where g[doc.index(x, y, z)] != 0 {
            var n = 0
            for (nx, ny, nz) in [(x+1,y,z),(x-1,y,z),(x,y+1,z),(x,y-1,z),(x,y,z+1),(x,y,z-1)]
            where doc.inBounds(nx, ny, nz) && g[doc.index(nx, ny, nz)] != 0 { n += 1 }
            if n == 0 { lonely += 1 }
        } } }
        if lonely > 0 { f.issue("lonely", "cleanup", min(12, 2 + 2 * lonely), n: lonely, "\(lonely) single \(flat ? "pixel" : "voxel")(s) with no neighbours (possible strays).") }
        var light: String?, outlineShare: Double?
        if flat {
            Craft.spriteChecks(doc, frame: frame, fullFrame: fullFrame, style: style, into: &result, findings: &f)
            let art = result["pixel_art"] as? [String: Any]
            light = (art?["light"] as? [String: Any])?["brightest_toward"] as? String
            outlineShare = art?["outline_dark_share"] as? Double
        }
        let anim = Craft.animationChecks(doc, fullFrame: fullFrame, findings: &f)
        if !anim.isEmpty { result["animation"] = anim }
        if let style {
            style.check(doc, usedIndexes: Set(perColor.keys), light: light, outlineDarkShare: outlineShare, into: &f)
            result["style"] = style.name
        }
        var categories = ["shape", "cleanup", "color"]
        if flat { categories.append("shading") }
        if doc.frames.count > 1 { categories.append("animation") }
        if style != nil { categories.append("style") }
        result["issues"] = f.issues
        result["tips"] = f.tips
        let score = f.score(categories: categories)
        result["score"] = score
        return (result, f, score["total"] as? Int ?? 0)
    }

    /// Differences between two grids of the same size.
    public static func diff(_ a: [UInt8], _ b: [UInt8], doc: Document, limit: Int = 50) -> [String: Any] {
        guard a.count == b.count else { return ["error": "sizes differ"] }
        var added = 0, removed = 0, recolored = 0
        var samples: [[String: Any]] = []
        for y in 0..<doc.sy { for z in 0..<doc.sz { for x in 0..<doc.sx {
            let i = doc.index(x, y, z)
            let o = a[i], n = b[i]
            if o == n { continue }
            let kind = o == 0 ? "added" : n == 0 ? "removed" : "recolored"
            if o == 0 { added += 1 } else if n == 0 { removed += 1 } else { recolored += 1 }
            if samples.count < limit { samples.append(["at": [x, y, z], "change": kind, "from": Int(o), "to": Int(n)]) }
        } } }
        return ["added": added, "removed": removed, "recolored": recolored, "samples": samples]
    }
}
