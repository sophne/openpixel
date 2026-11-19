import Foundation

/// A style that every sprite in a set must follow: a locked palette, a colour budget, the light direction,
/// the outline policy, the canvas size and free-form notes. Set by an agent (or loaded from a style file
/// shared by a whole pipeline) and kept across new_sprite/new_model, so a set of assets stays consistent.
/// The lock binds agents only; the person in the editor can still change anything.
public struct StyleLock: Equatable {
    public static let lights = ["top-left", "top", "top-right", "left", "right", "none"]
    public static let outlines = ["dark", "none", "any"]

    public var name = "style"
    /// Index 0 is the transparent slot, as in Document.palette.
    public var palette: [RGBA]?
    public var lockPalette = true
    public var maxColors: Int?
    public var light: String?
    public var outline: String?
    public var size: [Int]?
    public var notes: [String] = []

    public init() {}

    public var json: [String: Any] {
        var o: [String: Any] = ["name": name, "lock_palette": lockPalette, "notes": notes]
        if let p = palette { o["colors"] = p.dropFirst().map { $0.hex } }
        if let m = maxColors { o["max_colors"] = m }
        if let l = light { o["light"] = l }
        if let ol = outline { o["outline"] = ol }
        if let s = size { o["size"] = s }
        return o
    }

    /// Reads a style file (or tool arguments: the same keys).
    public static func from(_ o: [String: Any], base: StyleLock = StyleLock()) throws -> StyleLock {
        var s = base
        let a = Args(o)
        if let n = a.string("name") { s.name = n }
        if let preset = a.string("preset") {
            guard let p = Palettes.named(preset) else { throw PCError.invalid("unknown palette \(preset); use \(Palettes.names.joined(separator: ", "))") }
            s.palette = p
        }
        if let list = a.array("colors") {
            let cols = list.compactMap { ($0 as? String).flatMap(RGBA.parse) }.map { RGBA($0.r, $0.g, $0.b) }
            guard cols.count == list.count, !cols.isEmpty, cols.count < Document.maxColors else {
                throw PCError.invalid("colors must be 1-255 hex colours like \"#d95763\"")
            }
            s.palette = [RGBA(0, 0, 0, 0)] + cols
        }
        if a.has("lock_palette") { s.lockPalette = a.bool("lock_palette", true) }
        if a.has("max_colors") {
            guard let m = a.int("max_colors"), m >= 1, m <= 255 else { throw PCError.invalid("max_colors must be 1-255") }
            s.maxColors = m
        }
        if let l = a.string("light") {
            guard lights.contains(l) else { throw PCError.invalid("light must be one of \(lights.joined(separator: ", "))") }
            s.light = l
        }
        if let ol = a.string("outline") {
            guard outlines.contains(ol) else { throw PCError.invalid("outline must be one of \(outlines.joined(separator: ", "))") }
            s.outline = ol
        }
        if let sz = a.array("size") {
            let v = sz.compactMap { Args.number($0).map { Int($0) } }
            guard (2...3).contains(v.count), v.count == sz.count, v.allSatisfy({ (1...256).contains($0) }) else {
                throw PCError.invalid("size must be [width, height] for sprites or [x, y, z] for models, each 1-256")
            }
            s.size = v
        }
        if let n = a.string("notes") { s.notes = [n] }
        if let list = a.array("notes") { s.notes = list.compactMap { $0 as? String } }
        return s
    }

    static func sameRGB(_ a: RGBA, _ b: RGBA) -> Bool { a.r == b.r && a.g == b.g && a.b == b.b }

    func contains(_ c: RGBA) -> Bool { palette?.dropFirst().contains { StyleLock.sameRGB($0, c) } ?? true }

    /// The closest locked colours to `c`, for error messages.
    func nearest(_ c: RGBA, _ n: Int = 3) -> [String] {
        guard let p = palette else { return [] }
        return p.indices.dropFirst().sorted { p[$0].distance(to: c) < p[$1].distance(to: c) }.prefix(n).map { "\($0) \(p[$0].hex)" }
    }

    /// Whether the brightest side found by the light check agrees with the locked light.
    static func lightAgrees(locked: String, found: String) -> Bool {
        if locked == "none" || found.isEmpty || found == "no clear side" { return true }
        let want = Set(locked.split(separator: "-").map(String.init)), got = Set(found.split(separator: "-").map(String.init))
        if got.contains("bottom") { return false }
        // Top-left light: lit toward the top, the left, or both. A side light must not be lit on the other side.
        if want.contains("left") && got.contains("right") || want.contains("right") && got.contains("left") { return false }
        return !want.isDisjoint(with: got) || (want == ["top"] && got.isSubset(of: ["top", "left", "right"]))
    }

    /// Style checks for a model or sprite (added to the analysis as category "style").
    func check(_ doc: Document, usedIndexes: Set<Int>, light found: String?, outlineDarkShare: Double?, into f: inout Findings) {
        if palette != nil {
            let off = usedIndexes.sorted().map { doc.palette[$0] }.filter { !contains($0) }
            if !off.isEmpty {
                f.issue("style_palette", "style", min(20, 6 + 2 * off.count),
                        n: off.count, "\(off.count) colour(s) outside the locked \"\(name)\" palette: \(off.prefix(6).map { $0.hex }.joined(separator: ", ")). Replace them with locked colours (replace_color).")
            }
        }
        if let m = maxColors, usedIndexes.count > m {
            f.issue("style_max_colors", "style", min(15, 3 * (usedIndexes.count - m)),
                    n: usedIndexes.count, "Uses \(usedIndexes.count) colours; the \"\(name)\" style allows \(m). Merge shades with replace_color.")
        }
        if let s = size {
            let have = s.count == 2 ? [doc.sx, doc.sy] : [doc.sx, doc.sy, doc.sz]
            if have != s {
                f.issue("style_size", "style", 8, "The canvas is \(have.map(String.init).joined(separator: "×")); the \"\(name)\" style is \(s.map(String.init).joined(separator: "×")).")
            }
        }
        if let l = light, let found, !StyleLock.lightAgrees(locked: l, found: found) {
            f.issue("style_light", "style", 10, "The brightest pixels sit toward the \(found), but the \"\(name)\" style lights from the \(l). Reshade so lit faces point \(l).")
        }
        if outline == "dark", let share = outlineDarkShare, share < 0.6 {
            f.issue("style_outline", "style", 8, "Only \(Int(share * 100))% of the silhouette edge is dark; the \"\(name)\" style asks for a dark outline all round.")
        }
    }
}
