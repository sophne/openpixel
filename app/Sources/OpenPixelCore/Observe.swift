import Foundation

// MARK: - findings and scores

/// One result of the automatic checks. Every issue and tip carries a stable `code`, so two reviews can be
/// compared (what an edit introduced, made worse or fixed), and a score deduction, so a run of edits has a
/// number to converge on.
public struct Finding {
    public enum Level: String { case issue, tip }
    public let code: String
    public let category: String
    public let level: Level
    /// Points taken off the score (0-100) for this finding.
    public let points: Int
    /// How much of it was measured (pixels, pairs, frames…): "worse" compares this, since points are capped.
    public let amount: Int
    public let text: String
}

public struct Findings {
    public private(set) var list: [Finding] = []

    mutating func issue(_ code: String, _ category: String, _ points: Int, n amount: Int = 1, _ text: String) {
        list.append(Finding(code: code, category: category, level: .issue, points: max(0, points), amount: amount, text: text))
    }
    mutating func tip(_ code: String, _ category: String, _ points: Int, n amount: Int = 1, _ text: String) {
        list.append(Finding(code: code, category: category, level: .tip, points: max(0, points), amount: amount, text: text))
    }
    mutating func append(_ other: Findings) { list += other.list }

    var issues: [String] { list.filter { $0.level == .issue }.map { $0.text } }
    var tips: [String] { list.filter { $0.level == .tip }.map { $0.text } }

    /// A category never loses more than this, so one kind of problem can't hide the others.
    static let categoryCap = 40

    /// 100 minus the deductions. Categories are listed when they were checked, so a 3D model has no shading
    /// score and a single frame has no animation score.
    func score(categories checked: [String]) -> [String: Any] {
        var lost: [String: Int] = [:]
        for f in list { lost[f.category, default: 0] += f.points }
        var byCategory: [String: Int] = [:]
        for c in checked { byCategory[c] = 100 - min(100, lost[c] ?? 0) }
        let total = max(0, 100 - lost.values.reduce(0) { $0 + min(Findings.categoryCap, $1) })
        let deductions = list.filter { $0.points > 0 }.sorted { $0.points > $1.points }
            .map { ["code": $0.code, "category": $0.category, "level": $0.level.rawValue, "points": -$0.points] as [String: Any] }
        return ["total": total, "categories": byCategory, "deductions": deductions,
                "meaning": "100 minus deductions for what the automatic checks can measure (lines, colours, light, cleanliness, frames, style lock). It does not judge the idea or appeal: look at the pictures too."]
    }

    func total(categories: [String]) -> Int { score(categories: categories)["total"] as? Int ?? 0 }
}

/// What the agent hears after each edit: the score, its change, and which findings the edit introduced,
/// made worse or resolved. One compact object instead of a full review, so the cause of a new problem is
/// seen at the edit that caused it.
public struct Critique {
    public let total: Int
    public let findings: [String: Finding]

    public init(total: Int, findings: Findings) {
        self.total = total
        var byCode: [String: Finding] = [:]
        for f in findings.list { byCode[f.code] = f }
        self.findings = byCode
    }

    func compared(to before: Critique?) -> [String: Any] {
        func line(_ f: Finding) -> String { "[\(f.level.rawValue)] \(f.text)" }
        let rank: (Finding, Finding) -> Bool = { ($0.level == .issue ? 0 : 1, -$0.points) < ($1.level == .issue ? 0 : 1, -$1.points) }
        let now = findings.values.sorted(by: rank)
        var out: [String: Any] = [
            "score": total,
            "open": ["issues": now.filter { $0.level == .issue }.count, "tips": now.filter { $0.level == .tip }.count],
        ]
        guard let before else {
            if !now.isEmpty { out["findings"] = now.prefix(5).map(line) }
            return out
        }
        out["change"] = total - before.total
        let introduced = now.filter { before.findings[$0.code] == nil && $0.points > 0 }
        let worse = now.filter { f in (before.findings[f.code].map { f.amount > $0.amount || f.points > $0.points }) ?? false }
        let resolved = before.findings.values.filter { findings[$0.code] == nil }.sorted(by: rank)
        if !introduced.isEmpty { out["introduced"] = introduced.prefix(4).map(line) }
        if !worse.isEmpty { out["worse"] = worse.prefix(4).map(line) }
        if !resolved.isEmpty { out["resolved"] = resolved.prefix(4).map { "\($0.code)" } }
        return out
    }
}

// MARK: - text views

/// Pictures as text, for reading exact coordinates and checking form without images: the pixel grid with
/// coordinate rulers, a value map, a silhouette map and a frame-to-frame diff. 3D models are projected
/// along a view axis (the first voxel each ray meets), so the text matches what that view shows.
public enum TextView {
    public static let views = ["front", "back", "left", "right", "top", "bottom"]
    public static let maps = ["pixels", "values", "silhouette", "diff"]
    /// Text grids larger than this are cut (and say so); pass a region to read the rest.
    static let maxSide = 96

    /// A view of one frame as a grid of palette indexes, with the model coordinate each column and row stands for.
    struct Projection {
        var cols: [Int] = [], rows: [Int] = []
        var cells: [UInt8] = [] // rows.count × cols.count
        var colAxis = "x", rowAxis = "y", layout = ""
        func at(_ c: Int, _ r: Int) -> UInt8 { cells[r * cols.count + c] }
    }

    static func project(_ doc: Document, frame: Int, view: String) -> Projection {
        let g = doc.composite(frame: frame)
        var p = Projection()
        let sprite = doc.sz == 1
        func firstHit(_ cells: [(Int, Int, Int)]) -> UInt8 {
            for (x, y, z) in cells { let v = g[doc.index(x, y, z)]; if v != 0 { return v } }
            return 0
        }
        switch view {
        case "back":
            p.cols = Array((0..<doc.sx).reversed()); p.rows = Array((0..<doc.sy).reversed())
            p.layout = "seen from behind: columns x=\(doc.sx - 1)→0 (mirrored), rows y=\(doc.sy - 1) (top) → 0"
            p.cells = p.rows.flatMap { y in p.cols.map { x in firstHit((0..<doc.sz).map { (x, y, $0) }) } }
        case "left":
            p.colAxis = "z"; p.cols = Array(0..<doc.sz); p.rows = Array((0..<doc.sy).reversed())
            p.layout = "seen from the left: columns z=0 (back) → \(doc.sz - 1) (front), rows y=\(doc.sy - 1) (top) → 0"
            p.cells = p.rows.flatMap { y in p.cols.map { z in firstHit((0..<doc.sx).map { ($0, y, z) }) } }
        case "right":
            p.colAxis = "z"; p.cols = Array((0..<doc.sz).reversed()); p.rows = Array((0..<doc.sy).reversed())
            p.layout = "seen from the right: columns z=\(doc.sz - 1) (front) → 0 (back), rows y=\(doc.sy - 1) (top) → 0"
            p.cells = p.rows.flatMap { y in p.cols.map { z in firstHit((0..<doc.sx).reversed().map { ($0, y, z) }) } }
        case "top":
            p.rowAxis = "z"; p.cols = Array(0..<doc.sx); p.rows = Array(0..<doc.sz)
            p.layout = "seen from above: columns x=0→\(doc.sx - 1), rows z=0 (back) → \(doc.sz - 1) (front)"
            p.cells = p.rows.flatMap { z in p.cols.map { x in firstHit((0..<doc.sy).reversed().map { (x, $0, z) }) } }
        case "bottom":
            p.rowAxis = "z"; p.cols = Array(0..<doc.sx); p.rows = Array((0..<doc.sz).reversed())
            p.layout = "seen from below: columns x=0→\(doc.sx - 1), rows z=\(doc.sz - 1) (front) → 0 (back)"
            p.cells = p.rows.flatMap { z in p.cols.map { x in firstHit((0..<doc.sy).map { (x, $0, z) }) } }
        default: // front
            p.cols = Array(0..<doc.sx)
            if sprite {
                // Image rows, as set_pixels and paint_slice count them.
                p.rowAxis = "row"; p.rows = Array(0..<doc.sy)
                p.layout = "the sprite: columns x=0→\(doc.sx - 1), rows 0 (top) → \(doc.sy - 1), as set_pixels counts them"
                p.cells = p.rows.flatMap { r in p.cols.map { x in g[doc.index(x, doc.sy - 1 - r, 0)] } }
            } else {
                p.rows = Array((0..<doc.sy).reversed())
                p.layout = "seen from the front: columns x=0→\(doc.sx - 1), rows y=\(doc.sy - 1) (top) → 0"
                p.cells = p.rows.flatMap { y in p.cols.map { x in firstHit((0..<doc.sz).reversed().map { (x, y, $0) }) } }
            }
        }
        return p
    }

    /// Column and row positions to show: the region asked for (in the view's own coordinates), or the
    /// filled area with a one-cell margin, cut to `maxSide`.
    static func window(_ p: Projection, also: Projection?, region: [Int]?) -> (cols: [Int], rows: [Int], note: String?) {
        var colIdx = Array(p.cols.indices), rowIdx = Array(p.rows.indices)
        if let r = region, r.count == 4 {
            let (c0, c1) = (min(r[0], r[2]), max(r[0], r[2])), (r0, r1) = (min(r[1], r[3]), max(r[1], r[3]))
            colIdx = colIdx.filter { (c0...c1).contains(p.cols[$0]) }
            rowIdx = rowIdx.filter { (r0...r1).contains(p.rows[$0]) }
        } else {
            var cMin = Int.max, cMax = -1, rMin = Int.max, rMax = -1
            for r in p.rows.indices { for c in p.cols.indices where p.at(c, r) != 0 || (also?.at(c, r) ?? 0) != 0 {
                cMin = min(cMin, c); cMax = max(cMax, c); rMin = min(rMin, r); rMax = max(rMax, r)
            } }
            if cMax >= 0 {
                colIdx = Array(max(0, cMin - 1)...min(p.cols.count - 1, cMax + 1))
                rowIdx = Array(max(0, rMin - 1)...min(p.rows.count - 1, rMax + 1))
            }
        }
        var note: String?
        if colIdx.count > maxSide || rowIdx.count > maxSide {
            note = "cut to \(maxSide)×\(maxSide) cells; pass region [col0, row0, col1, row1] to read another part"
            colIdx = Array(colIdx.prefix(maxSide)); rowIdx = Array(rowIdx.prefix(maxSide))
        }
        return (colIdx, rowIdx, note)
    }

    /// Ruler lines (hundreds, tens, units) over the columns, then each row with its coordinate in front.
    static func ruled(_ cols: [Int], _ rows: [Int], _ char: (Int, Int) -> Character) -> [String] {
        let labels = rows.map(String.init)
        let w = max(labels.map(\.count).max() ?? 1, 1)
        let pad = String(repeating: " ", count: w + 1)
        var out: [String] = []
        let widest = cols.map { abs($0) }.max() ?? 0
        if widest >= 100 { out.append(pad + String(cols.map { $0 >= 100 ? Character(String($0 / 100 % 10)) : " " })) }
        if widest >= 10 { out.append(pad + String(cols.map { $0 >= 10 ? Character(String($0 / 10 % 10)) : " " })) }
        out.append(pad + String(cols.map { Character(String($0 % 10)) }))
        for (ri, label) in labels.enumerated() {
            out.append(String(repeating: " ", count: w - label.count) + label + " " + String(cols.indices.map { char($0, ri) }))
        }
        return out
    }

    static func render(_ doc: Document, frame: Int, view: String, maps wanted: [String], compare: Int?, region: [Int]?) -> [String: Any] {
        let p = project(doc, frame: frame, view: view)
        let q = compare.map { project(doc, frame: $0, view: view) }
        let (ci, ri, note) = window(p, also: q, region: region)
        let cols = ci.map { p.cols[$0] }, rows = ri.map { p.rows[$0] }
        var out: [String: Any] = ["view": view, "frame": frame, "layout": p.layout,
                                  "columns": "\(p.colAxis) \(cols.first ?? 0)→\(cols.last ?? 0)",
                                  "rows": "\(p.rowAxis) \(rows.first ?? 0)→\(rows.last ?? 0)"]
        if let note { out["note"] = note }
        if ci.isEmpty || ri.isEmpty { out["note"] = "nothing in this region"; return out }
        func cell(_ c: Int, _ r: Int) -> UInt8 { p.at(ci[c], ri[r]) }

        if wanted.contains("pixels") {
            var legend: [String: Any] = [:], custom: [UInt8: Character] = [:], extra = 0
            out["pixels"] = ruled(cols, rows) { c, r in
                let v = cell(c, r)
                if v == 0 { return "." }
                let ch: Character
                if Int(v) <= Engine.slots.count { ch = Engine.slots[Int(v) - 1] } else if let k = custom[v] { ch = k } else {
                    ch = extra < Engine.extraSlots.count ? Engine.extraSlots[extra] : "#"; extra += 1; custom[v] = ch
                }
                legend[String(ch)] = ["index": Int(v), "hex": doc.palette[Int(v)].hex]
                return ch
            }
            out["legend"] = legend
        }
        if wanted.contains("values") {
            out["values"] = ruled(cols, rows) { c, r in
                let v = cell(c, r)
                guard v != 0 else { return "." }
                return Character(String(min(9, Int(Craft.luma(doc.palette[Int(v)]) * 10))))
            }
            out["value_scale"] = "0 darkest … 9 brightest (perceived brightness of each colour); '.' empty"
        }
        if wanted.contains("silhouette") {
            out["silhouette"] = ruled(cols, rows) { c, r in cell(c, r) == 0 ? "." : "#" }
        }
        if wanted.contains("diff"), let q, let other = compare {
            var counts = ["added": 0, "removed": 0, "recolored": 0, "same": 0]
            out["diff"] = ruled(cols, rows) { c, r in
                let now = cell(c, r), was = q.at(ci[c], ri[r])
                switch (was, now) {
                case (0, 0): return "."
                case (0, _): counts["added"]! += 1; return "+"
                case (_, 0): counts["removed"]! += 1; return "-"
                default:
                    if was == now { counts["same"]! += 1; return "o" }
                    counts["recolored"]! += 1; return "*"
                }
            }
            out["diff_against_frame"] = other
            out["diff_counts"] = counts
            out["diff_key"] = "o unchanged, + filled in this frame, - emptied, * recoloured, . empty in both"
        }
        return out
    }
}
