import Foundation

/// Pixel-art craft for agents: the style guide they read before drawing, hue-shifted colour ramps,
/// checks for the classic mistakes (doubled line corners, stray pixels, pillow shading, too many or
/// near-identical colours) and the extra review pictures (pixel grid, values, silhouette, real size).
public enum Craft {

    // MARK: - guide

    public static let topics = ["all", "workflow", "shape", "color", "shading", "outline", "cleanup", "animation", "voxel"]

    static let guide: [(topic: String, text: String)] = [
        ("workflow", """
        WORKFLOW (2D sprite)
        1. Pick the size first and draw at that size: 16×16 icons, 24-32 for characters and items, 48-64 for big subjects. Never draw big and shrink.
        2. Choose the palette before drawing: 2-4 colour ramps (one per material: skin, cloth, metal, wood…), 3-5 shades each, plus one darkest outline colour. make_color_ramp with `base` builds a hue-shifted ramp.
        3. Silhouette: fill the whole shape in ONE flat colour (paint_slice). Check it with review_model: the silhouette picture alone must say what the subject is.
        4. Flat colours: block in each material with its middle shade. Keep shapes big and simple.
        5. Shading: pick ONE light direction (top-left by default) and shade each form by how it faces the light, not by distance from the edge.
        6. Outline and edges, then details last (eyes, buckles, highlights): a detail is 1-3 pixels at this size.
        7. Clean up: run review_model, fix every issue it lists (pixel_perfect fixes doubled corners), and look at the actual-size picture: that is what players see.
        Draw symmetric subjects (faces, front-facing characters, chests, trees) on one half and mirror with transform op=mirror, then break the symmetry slightly by hand if it looks stiff.
        """),
        ("shape", """
        SHAPE AND READABILITY
        - Silhouette first: a strong, readable outline shape beats inner detail. Exaggerate proportions (big head, big hands, chunky props) at small sizes.
        - Lines: draw curves and diagonals as runs of pixels that grow or shrink evenly (1-1-1, 2-2-2, 1-2-3-4, 4-3-2-1). A run that breaks the pattern (2-2-1-2-2, 3-1-3) is a "jaggy" and looks broken.
        - Diagonal lines touch corner to corner. Never put a pixel in the inside corner of a 1-pixel line (an "L" step); that is a "double" and makes lines look thick and blurry.
        - Clusters: group same-coloured pixels into clean clumps. Single pixels of a different colour floating in a fill read as noise.
        - Leave a 1-pixel margin around the sprite for the outline.
        - Every detail must earn its pixels: if it does not read at actual size, remove it.
        """),
        ("color", """
        COLOUR
        - Few colours: about 4-8 for a 16px sprite, 8-16 for 32px, up to 24-32 for big pieces. Reuse ramps across materials.
        - Hue-shift ramps: shadows move toward blue/purple and get more saturated; highlights move toward yellow/orange and get less saturated. A ramp that only gets darker or lighter looks muddy.
        - Avoid pure black for shadows and pure white for highlights; use a dark hue (deep blue, purple, brown) and a warm off-white.
        - Each step of a ramp must differ clearly in brightness from the next; two colours that are almost the same are wasted and look like noise. Check the value (grayscale) picture: the forms must still read.
        - Contrast leads the eye: the strongest light/dark contrast belongs on the focal point (face, weapon, item).
        - Built-in palettes (set_palette preset): db32, db16, pico8, edg32. A fixed palette keeps a set of sprites consistent.
        """),
        ("shading", """
        SHADING
        - One light source for the whole sprite (and the whole set). Default: top-left, so lit faces are on the top and left, shadows bottom and right.
        - Shade by form: think of the sprite as simple 3D shapes (spheres, cylinders, boxes). A sphere gets a highlight towards the light, a core shadow on the far side and a little reflected light at the very edge.
        - Avoid PILLOW SHADING: dark at every edge and light in the middle, in rings that follow the outline. It ignores the light and looks flat.
        - Avoid BANDING: steps of two shades that run exactly parallel and end at the same place look like stripes. Vary the lengths so the boundary staggers.
        - Skies, water and other big gradients drawn as horizontal bands are a fine style, but perfectly straight, hard-edged stripes read flat. Stagger or dither a few pixels along each edge, make bands thinner toward the horizon, and let clouds, hills or light cross them.
        - Use 2-3 shades per material; more shades at small sizes become noise.
        - Dithering (checkerboard of two colours) only for large soft gradients or textures, used sparingly; never on small sprites.
        - Anti-aliasing: an in-between colour on a few step corners of a curve, inside the sprite only. Keep the outer edge hard so the sprite works on any background.
        """),
        ("outline", """
        OUTLINES
        - A 1-pixel outline around the silhouette helps a sprite read on any background.
        - Selective outline ("sel-out"): instead of black everywhere, colour each outline pixel with a dark shade of the colour inside it, and lighten the outline on the lit side. Softer and more polished.
        - Inner lines (between arm and body, folds) use a shade darker than the area, not the outline colour, unless the parts must separate clearly.
        - Outlines follow the same line rules: no doubled corners, even runs.
        """),
        ("cleanup", """
        CLEANUP CHECKLIST (review_model reports most of these)
        - Doubled corners in 1-pixel lines → pixel_perfect, or set_pixels to remove the inside-corner pixel.
        - Stray single pixels → merge into a cluster or remove.
        - Jaggies (uneven runs in lines and curves) → even out the run lengths.
        - Pillow shading / no clear light direction → reshade from the light source.
        - Near-identical colours → replace_color one with the other.
        - Too many colours → merge ramps.
        - Check the actual-size and silhouette pictures last, not just the enlarged one.
        """),
        ("animation", """
        ANIMATION
        - Plan key poses first (contact, extreme, passing), then in-betweens. Small loops: idle 2-4 frames, walk 4-8, run 6-8, attack 3-6.
        - Keep the volume: the sprite's size and mass stay the same unless it squashes and stretches on purpose (squash on landing, stretch on jumping).
        - Anticipation before a big action, follow-through after it (hair, cloth, tails settle a frame later).
        - Timing lives in frame durations (set_frame_duration): hold key poses longer (150-250 ms), move in-betweens quicker (60-100 ms).
        - Loops must connect: the last frame leads into the first. No two frames should be identical unless the hold is intended (use a longer duration instead).
        - Keep the ground line fixed so the sprite does not jitter; move parts by whole pixels and only what should move. Onion skin: compare neighbouring frames with get_slice.
        - Make each frame with add_frame (copies the previous) and change only what moves.
        """),
        ("voxel", """
        VOXEL MODELS (3D)
        - Size to the subject: 16-32 per side for props and characters, 32-64 for buildings. Chunky reads better than detailed.
        - Block out big volumes first (fill_box, draw_sphere, draw_cylinder), check proportions from several angles, then carve and add detail.
        - Use a hue-shifted ramp per material and shade with paint mode: darker at the bottom and in crevices, lighter on top surfaces and edges facing the light. apply_gradient on y gives a quick ground-to-top darkening.
        - Avoid single floating voxels and 1-voxel-thin walls that vanish from some angles.
        - Check every side with review_model; a model must work from all angles, not only the front.
        """),
    ]

    public static func guideText(_ topic: String?) -> String {
        let t = (topic ?? "all").lowercased()
        let parts = t == "all" ? guide : guide.filter { $0.topic == t }
        return parts.map { $0.text }.joined(separator: "\n\n")
    }

    /// The short version that goes into the MCP instructions.
    public static let rules = """
    Pixel-art rules (call pixel_art_guide for the full guide before your first drawing): \
    draw at the final size; silhouette first, then flat colours, then shading, then outline and details; \
    few colours in hue-shifted ramps (make_color_ramp base=…); one light source (top-left); \
    no pillow shading (dark rings along the edge); clean 1-pixel lines without doubled L-corners or uneven runs; \
    no stray single pixels; check the actual-size, silhouette and value pictures from review_model and fix every issue it lists.
    """

    // MARK: - colour

    static func hsv(_ c: RGBA) -> (h: Double, s: Double, v: Double) {
        let r = Double(c.r) / 255, g = Double(c.g) / 255, b = Double(c.b) / 255
        let mx = max(r, g, b), mn = min(r, g, b), d = mx - mn
        var h = 0.0
        if d > 0 {
            if mx == r { h = 60 * ((g - b) / d).truncatingRemainder(dividingBy: 6) }
            else if mx == g { h = 60 * ((b - r) / d + 2) }
            else { h = 60 * ((r - g) / d + 4) }
        }
        if h < 0 { h += 360 }
        return (h, mx == 0 ? 0 : d / mx, mx)
    }

    static func rgb(_ h: Double, _ s: Double, _ v: Double) -> RGBA {
        let hh = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        let s = min(1, max(0, s)), v = min(1, max(0, v))
        let c = v * s, x = c * (1 - abs((hh / 60).truncatingRemainder(dividingBy: 2) - 1)), m = v - c
        let (r, g, b): (Double, Double, Double)
        switch hh {
        case ..<60: (r, g, b) = (c, x, 0)
        case ..<120: (r, g, b) = (x, c, 0)
        case ..<180: (r, g, b) = (0, c, x)
        case ..<240: (r, g, b) = (0, x, c)
        case ..<300: (r, g, b) = (x, 0, c)
        default: (r, g, b) = (c, 0, x)
        }
        let q = { (t: Double) in UInt8(max(0, min(255, ((t + m) * 255).rounded()))) }
        return RGBA(q(r), q(g), q(b))
    }

    /// Turns hue `h` toward `target` by at most `by` degrees, the short way round.
    static func turn(_ h: Double, toward target: Double, by: Double) -> Double {
        var d = (target - h).truncatingRemainder(dividingBy: 360)
        if d > 180 { d -= 360 }
        if d < -180 { d += 360 }
        return h + (d > 0 ? min(d, by) : max(d, -by))
    }

    /// Perceived brightness 0-1.
    static func luma(_ c: RGBA) -> Double { (0.299 * Double(c.r) + 0.587 * Double(c.g) + 0.114 * Double(c.b)) / 255 }

    /// A shading ramp around one base colour, darkest first. The base sits in the middle; shadows turn toward
    /// blue and gain saturation, highlights turn toward yellow and lose it.
    public static func ramp(base: RGBA, steps: Int, hueShift: Double) -> [RGBA] {
        let (h, s, v) = hsv(base)
        let mid = Double(steps - 1) / 2
        // Greys pick up a slight tint so the shift shows.
        let grey = s < 0.08
        return (0..<steps).map { k -> RGBA in
            let t = mid == 0 ? 0 : (Double(k) - mid) / mid // -1 shadow … +1 highlight
            let steps = abs(Double(k) - mid)
            if t < 0 {
                let hh = turn(h, toward: 245, by: hueShift * steps)
                let ss = grey ? 0.12 * -t : min(1, s + (1 - s) * 0.25 * -t)
                let vv = v - (v - max(0.1, v * 0.3)) * -t
                return rgb(grey ? 245 : hh, ss, vv)
            }
            if t > 0 {
                let hh = turn(h, toward: 55, by: hueShift * steps)
                let ss = grey ? 0.08 * t : s * (1 - 0.45 * t)
                let vv = v + (min(1, v + 0.35) - v) * t + (1 - v) * 0.15 * t
                return rgb(grey ? 55 : hh, ss, min(1, vv))
            }
            return base
        }
    }

    /// A ramp between two colours (darkest first), bent toward cool in the shadows and warm in the lights.
    public static func ramp(from c0: RGBA, to c1: RGBA, steps: Int, hueShift: Double) -> [RGBA] {
        (0..<steps).map { k in
            let t = Double(k) / Double(steps - 1)
            let mix: (UInt8, UInt8) -> UInt8 = { UInt8((Double($0) + (Double($1) - Double($0)) * t).rounded()) }
            let c = RGBA(mix(c0.r, c1.r), mix(c0.g, c1.g), mix(c0.b, c1.b))
            if k == 0 || k == steps - 1 || hueShift == 0 { return c }
            let (h, s, v) = hsv(c)
            if s < 0.05 { return c }
            let pull = (t - 0.5) * 2 // -1 … 1, zero in the middle
            return rgb(turn(h, toward: pull < 0 ? 245 : 55, by: abs(pull) * hueShift), s, v)
        }
    }

    // MARK: - 2D sprite checks

    /// A sprite's front slice as rows top to bottom.
    struct Image2D {
        let w: Int, h: Int
        var px: [UInt8]
        init(_ doc: Document, frame: Int) {
            w = doc.sx; h = doc.sy
            let g = doc.composite(frame: frame)
            px = [UInt8](repeating: 0, count: w * h)
            for r in 0..<h { for c in 0..<w { px[r * w + c] = g[doc.index(c, h - 1 - r, 0)] } }
        }
        @inline(__always) func at(_ c: Int, _ r: Int) -> UInt8 { c < 0 || r < 0 || c >= w || r >= h ? 0 : px[r * w + c] }
    }

    /// Pixels in the inside corner of a 1-pixel line ("doubles", "L-corners"). A pixel counts when exactly two of its
    /// side neighbours share its colour, they sit at a right angle, the cell between them diagonally does not, and the
    /// line does not run straight on from both of them (that would be the corner of a box, which is wanted).
    /// Only line work is checked: the pixel and both neighbours are 1 pixel thin, the line is at least 4 pixels long,
    /// and it is either on the silhouette edge or darker than what lies outside the corner (a contour), so small
    /// clusters of texture and highlights are left alone.
    static func doubles(_ img: Image2D, palette: [RGBA], only color: UInt8? = nil) -> [(Int, Int)] {
        let sides = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        func sameSides(_ c: Int, _ r: Int, _ v: UInt8) -> Int { sides.filter { img.at(c + $0.0, r + $0.1) == v }.count }
        // Size of each same-colour run (8-connected), to skip tiny clusters.
        var comp = [Int](repeating: -1, count: img.w * img.h)
        var sizes: [Int] = []
        for start in img.px.indices where img.px[start] != 0 && comp[start] < 0 {
            let v = img.px[start], id = sizes.count
            var stack = [start]; comp[start] = id
            var n = 0
            while let i = stack.popLast() {
                n += 1
                let c = i % img.w, r = i / img.w
                for dr in -1...1 { for dc in -1...1 where dr != 0 || dc != 0 {
                    let nc = c + dc, nr = r + dr
                    guard nc >= 0, nr >= 0, nc < img.w, nr < img.h else { continue }
                    let j = nr * img.w + nc
                    if img.px[j] == v && comp[j] < 0 { comp[j] = id; stack.append(j) }
                } }
            }
            sizes.append(n)
        }
        var out: [(Int, Int)] = []
        for r in 0..<img.h { for c in 0..<img.w {
            let v = img.px[r * img.w + c]
            if v == 0 || (color != nil && v != color) { continue }
            let dirs = sides.filter { img.at(c + $0.0, r + $0.1) == v }
            guard dirs.count == 2 else { continue }
            let (a, b) = (dirs[0], dirs[1])
            guard a.0 * b.0 + a.1 * b.1 == 0 else { continue } // a straight line, not a corner
            if img.at(c + a.0 + b.0, r + a.1 + b.1) == v { continue } // part of a 2×2 block
            let aOn = img.at(c + 2 * a.0, r + 2 * a.1) == v, bOn = img.at(c + 2 * b.0, r + 2 * b.1) == v
            if aOn && bOn { continue }
            guard sizes[comp[r * img.w + c]] >= 4,
                  sameSides(c + a.0, r + a.1, v) <= 2, sameSides(c + b.0, r + b.1, v) <= 2 else { continue }
            // Outside the corner: the two cells opposite a and b.
            let outside = [img.at(c - a.0, r - a.1), img.at(c - b.0, r - b.1)]
            var onEdge = outside.contains(0)
            for dr in -1...1 { for dc in -1...1 where img.at(c + dc, r + dr) == 0 { onEdge = true } }
            let contour = outside.allSatisfy { $0 != 0 && luma(palette[Int($0)]) > luma(palette[Int(v)]) + 0.06 }
            guard onEdge || contour else { continue }
            out.append((c, r))
        } }
        return out
    }

    /// Pixels whose colour differs from all eight neighbours, inside the sprite (not lone pixels on empty canvas).
    static func strays(_ img: Image2D) -> [(Int, Int)] {
        var out: [(Int, Int)] = []
        for r in 0..<img.h { for c in 0..<img.w {
            let v = img.px[r * img.w + c]
            if v == 0 { continue }
            var same = false, filled = 0
            for dr in -1...1 { for dc in -1...1 where dr != 0 || dc != 0 {
                let n = img.at(c + dc, r + dr)
                if n == v { same = true }
                if n != 0 { filled += 1 }
            } }
            if !same && filled >= 5 { out.append((c, r)) }
        } }
        return out
    }

    /// The tallest stack of 3 or more flat, full-width bands (one colour across at least 92% of every row, each band
    /// at least 2 rows) that follow each other with hard edges. A dithered or staggered transition row breaks the stack.
    static func stripes(_ img: Image2D) -> (from: Int, to: Int, heights: [Int])? {
        guard img.w >= 24, img.h >= 8 else { return nil }
        var bands: [(start: Int, height: Int, color: UInt8)] = [] // color 0 = the row is not flat
        for r in 0..<img.h {
            var count: [UInt8: Int] = [:]
            for c in 0..<img.w { count[img.px[r * img.w + c], default: 0] += 1 }
            let top = count.max { $0.value < $1.value }!
            let color: UInt8 = top.key != 0 && top.value * 100 >= img.w * 92 ? top.key : 0
            if let last = bands.last, last.color == color { bands[bands.count - 1].height += 1 } else { bands.append((r, 1, color)) }
        }
        var best: [(start: Int, height: Int, color: UInt8)] = [], run: [(start: Int, height: Int, color: UInt8)] = []
        for b in bands {
            if b.color != 0 && b.height >= 2 { run.append(b) } else { run = [] }
            if run.count >= 3 && run.reduce(0, { $0 + $1.height }) > best.reduce(0, { $0 + $1.height }) { best = run }
        }
        guard best.count >= 3, let first = best.first, let last = best.last else { return nil }
        return (first.start, last.start + last.height - 1, best.map { $0.height })
    }

    static func pearson(_ a: [Double], _ b: [Double]) -> Double {
        let n = Double(a.count)
        guard n > 2 else { return 0 }
        let ma = a.reduce(0, +) / n, mb = b.reduce(0, +) / n
        var sab = 0.0, saa = 0.0, sbb = 0.0
        for i in a.indices { let x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y }
        return saa == 0 || sbb == 0 ? 0 : sab / (saa * sbb).squareRoot()
    }

    static func round2(_ x: Double) -> Double { (x * 100).rounded() / 100 }

    /// Pixel-art checks for a 2D sprite: adds to `result` and returns problems and gentler style tips.
    static func spriteChecks(_ doc: Document, frame: Int, fullFrame: Bool = false,
                             into result: inout [String: Any]) -> (issues: [String], tips: [String]) {
        let img = Image2D(doc, frame: frame)
        var issues: [String] = [], tips: [String] = []
        var report: [String: Any] = [:]
        let pal = doc.palette
        var used: [UInt8: Int] = [:]
        for v in img.px where v != 0 { used[v, default: 0] += 1 }
        let filled = used.values.reduce(0, +)
        guard filled > 0 else { return ([], []) }

        // Colours.
        let side = max(img.w, img.h)
        let budget = side <= 16 ? 8 : side <= 32 ? 16 : side <= 64 ? 32 : 48
        report["colors_used"] = used.count
        if used.count > budget {
            issues.append("Uses \(used.count) colours; a sprite this size reads best with about \(budget) or fewer. Merge similar shades (replace_color).")
        }
        let keys = used.keys.sorted()
        var near: [String] = []
        for i in keys.indices { for j in keys.indices where j > i {
            let a = pal[Int(keys[i])], b = pal[Int(keys[j])]
            if a.distance(to: b) < 9 * 10 * 10 { near.append("\(a.hex) (index \(keys[i])) ≈ \(b.hex) (index \(keys[j]))") }
        } }
        if !near.isEmpty {
            report["near_identical_colors"] = near
            issues.append("\(near.count) pair(s) of almost identical colours; they add noise without adding shape. Merge them with replace_color.")
        }
        let black = used.filter { pal[Int($0.key)].r < 8 && pal[Int($0.key)].g < 8 && pal[Int($0.key)].b < 8 }.map { $0.value }.reduce(0, +)

        // Lines.
        let dbl = doubles(img, palette: pal)
        if !dbl.isEmpty {
            report["doubled_corners"] = ["count": dbl.count, "at_x_row": dbl.prefix(12).map { [$0.0, $0.1] }]
            issues.append("\(dbl.count) doubled corner pixel(s) in 1-pixel lines (L-shaped steps make lines look thick). pixel_perfect removes them; check the result.")
        }
        let st = strays(img)
        if st.count > max(3, filled / 40) {
            report["stray_pixels"] = ["count": st.count, "at_x_row": st.prefix(12).map { [$0.0, $0.1] }]
            let text = fullFrame
                ? "\(st.count) single pixels unlike all their neighbours. Stars, fireflies and sparkles are fine; scattered noise in large areas is not."
                : "\(st.count) single pixels unlike all their neighbours. Keep deliberate ones (eye glints, highlights, small fruit) and merge the rest into clusters; too many read as noise."
            if st.count > max(6, filled / 15) && !fullFrame { issues.append(text) } else { tips.append(text) }
        }

        // Edge and interior pixels; distance from the edge for the interior.
        var dist = [Int](repeating: -1, count: img.w * img.h)
        var queue: [Int] = []
        var edge: [Int] = []
        for r in 0..<img.h { for c in 0..<img.w where img.px[r * img.w + c] != 0 {
            let open = [(1, 0), (-1, 0), (0, 1), (0, -1)].contains { img.at(c + $0.0, r + $0.1) == 0 }
            if open { dist[r * img.w + c] = 0; queue.append(r * img.w + c); edge.append(r * img.w + c) }
        } }
        var qi = 0
        while qi < queue.count {
            let i = queue[qi]; qi += 1
            let c = i % img.w, r = i / img.w
            for (dc, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let nc = c + dc, nr = r + dr
                guard nc >= 0, nr >= 0, nc < img.w, nr < img.h else { continue }
                let j = nr * img.w + nc
                if img.px[j] != 0 && dist[j] < 0 { dist[j] = dist[i] + 1; queue.append(j) }
            }
        }

        // Stacked flat stripes (skies, water, gradients drawn as bands).
        if let band = stripes(img) {
            report["stripes"] = ["rows": [band.from, band.to], "heights": band.heights]
            let even = (band.heights.max() ?? 1) * 10 <= (band.heights.min() ?? 1) * 13
            tips.append("Rows \(band.from)-\(band.to) are \(band.heights.count) flat full-width stripes with hard straight edges"
                + (even ? ", all about the same height" : " (heights \(band.heights.map(String.init).joined(separator: ", ")))")
                + ". A valid style, but it reads flat: stagger or dither a few pixels along each edge, vary the heights, or let clouds, hills or light cross the bands.")
        }

        // A full-frame background has no silhouette on empty canvas: outline, light direction and pillow shading
        // are about sprites, so they are skipped.
        if fullFrame {
            report["note"] = "Full-frame background: outline, light-direction and pillow-shading checks are skipped."
            result["pixel_art"] = report
            return (issues, tips)
        }

        // Outline.
        let darkEdge = edge.filter { luma(pal[Int(img.px[$0])]) < 0.22 }.count
        let edgeShare = Double(darkEdge) / Double(max(1, edge.count))
        report["outline_dark_share"] = round2(edgeShare)
        if side >= 16 && edgeShare < 0.35 {
            tips.append("Only \(Int(edgeShare * 100))% of the silhouette edge is dark; a 1-pixel outline (or a darker rim) makes the shape read on any background.")
        }
        if black > filled / 5 {
            tips.append("Pure black covers \(black * 100 / filled)% of the sprite; a dark hue (deep blue, purple, brown) or a selective outline looks richer.")
        }

        // Light: how brightness inside the sprite (not the outline) leans across the shape.
        var L: [Double] = [], X: [Double] = [], Y: [Double] = [], D: [Double] = []
        for i in img.px.indices where dist[i] >= 1 {
            L.append(luma(pal[Int(img.px[i])])); X.append(Double(i % img.w)); Y.append(Double(i / img.w)); D.append(Double(dist[i]))
        }
        let interiorColours = Set(img.px.indices.filter { dist[$0] >= 1 }.map { img.px[$0] }).count
        if L.count >= 30 && interiorColours >= 3 {
            let cx = pearson(L, X), cy = pearson(L, Y), cd = pearson(L, D)
            var dir = ""
            if cy < -0.12 { dir = "top" } else if cy > 0.12 { dir = "bottom" }
            if cx < -0.12 { dir += dir.isEmpty ? "left" : "-left" } else if cx > 0.12 { dir += dir.isEmpty ? "right" : "-right" }
            report["light"] = ["brightest_toward": dir.isEmpty ? "no clear side" : dir,
                               "brightness_vs_x": round2(cx), "brightness_vs_row": round2(cy), "brightness_vs_edge_distance": round2(cd)]
            let directional = max(abs(cx), abs(cy))
            if cd > 0.45 && directional < 0.2 {
                issues.append("Looks pillow-shaded: brightness follows the distance from the edge (\(round2(cd))) instead of a light direction. Pick one light (top-left) and reshade by form.")
            } else if dir.hasPrefix("bottom") {
                tips.append("The brightest pixels sit toward the \(dir); light usually comes from above (top-left). Check the shading direction.")
            } else if dir.isEmpty {
                tips.append("No clear light direction inside the sprite; shade the side facing the light lighter and the far side darker.")
            }
        }
        // Too-flat: big areas of one colour with no shading.
        if filled >= 64 && interiorColours < 3 {
            tips.append("The inside uses \(interiorColours) colour(s); 2-3 shades per material give the shape volume.")
        }
        result["pixel_art"] = report
        return (issues, tips)
    }

    /// Animation checks across all frames of a sprite (or model).
    static func animationChecks(_ doc: Document) -> (info: [String: Any], tips: [String]) {
        guard doc.frames.count > 1 else { return ([:], []) }
        var tips: [String] = []
        let grids = doc.frames.indices.map { doc.composite(frame: $0) }
        let counts = grids.map { $0.reduce(0) { $0 + ($1 == 0 ? 0 : 1) } }
        var same: [String] = []
        for i in grids.indices {
            let j = (i + 1) % grids.count
            if i == grids.count - 1 && grids.count < 3 { break }
            if grids[i] == grids[j] { same.append("\(i)→\(j)") }
        }
        if !same.isEmpty {
            tips.append("Identical neighbouring frames (\(same.joined(separator: ", "))): drop one and lengthen the other's duration instead.")
        }
        var jumps: [String] = []
        for i in 0..<(counts.count - 1) where counts[i] > 0 {
            let change = Double(abs(counts[i + 1] - counts[i])) / Double(counts[i])
            if change > 0.3 { jumps.append("\(i)→\(i + 1) (\(Int(change * 100))%)") }
        }
        if !jumps.isEmpty {
            tips.append("The amount of filled cells jumps between frames \(jumps.joined(separator: ", ")); unless that is a deliberate squash/stretch or effect, keep the volume steady.")
        }
        let durations = doc.frames.map { $0.duration }
        if durations.count >= 4 && Set(durations).count == 1 {
            tips.append("Every frame lasts \(durations[0]) ms; holding key poses longer (set_frame_duration) gives the motion weight.")
        }
        return (["frames": doc.frames.count, "filled_per_frame": counts, "durations_ms": durations], tips)
    }

    // MARK: - pixel-perfect cleanup

    /// Removes doubled corner pixels from 1-pixel lines on one z slice of a layer, giving each removed pixel the
    /// colour around it (often empty). Repeats until clean. Returns the cells changed.
    static func pixelPerfect(_ d: inout Document, layer: Int, frame: Int, depth: Int, only color: UInt8?) -> [[Int]] {
        var changed: [[Int]] = []
        for _ in 0..<6 {
            // Read this layer's slice as an image.
            var img = Image2D(d, frame: frame)
            for r in 0..<img.h { for c in 0..<img.w { img.px[r * img.w + c] = d.get(layer, frame, c, img.h - 1 - r, depth) } }
            let found = doubles(img, palette: d.palette, only: color)
            if found.isEmpty { break }
            var done = Set<Int>()
            for (c, r) in found {
                // Skip a pixel whose neighbour was just removed in this pass: re-check next pass.
                if [(1, 0), (-1, 0), (0, 1), (0, -1)].contains(where: { done.contains((r + $0.1) * img.w + c + $0.0) }) { continue }
                let v = img.px[r * img.w + c]
                var votes: [UInt8: Int] = [:]
                for dr in -1...1 { for dc in -1...1 where (dr != 0 || dc != 0) {
                    let n = img.at(c + dc, r + dr)
                    if n != v { votes[n, default: 0] += (dr == 0 || dc == 0) ? 2 : 1 }
                } }
                let fill = votes.max { $0.value < $1.value || ($0.value == $1.value && $0.key > $1.key) }?.key ?? 0
                d.set(layer, frame, c, img.h - 1 - r, depth, fill)
                img.px[r * img.w + c] = fill
                done.insert(r * img.w + c)
                changed.append([c, r])
            }
        }
        return changed
    }

    // MARK: - review pictures

    /// The sprite at `scale` pixels per pixel on `bg`; `map` can recolour (value, silhouette).
    static func picture(_ doc: Document, frame: Int, scale s: Int, bg: RGBA, grid: Bool = false,
                        map: ((RGBA) -> RGBA)? = nil) -> Picture {
        let img = Image2D(doc, frame: frame)
        var pic = Picture(width: img.w * s, height: img.h * s, fill: bg)
        for r in 0..<img.h { for c in 0..<img.w {
            let v = img.px[r * img.w + c]
            if v == 0 { continue }
            var col = doc.palette[Int(v)]; col.a = 255
            if let m = map { col = m(col) }
            for y in 0..<s { for x in 0..<s { pic.setPixel((r * s + y) * pic.width + c * s + x, col) } }
        } }
        if grid && s >= 5 {
            // A thin line on every pixel border, stronger every 8 pixels (counting from 0 at the top-left).
            for y in 0..<pic.height { for x in 0..<pic.width {
                let onX = x % s == 0, onY = y % s == 0
                guard onX || onY else { continue }
                let major = (onX && (x / s) % 8 == 0) || (onY && (y / s) % 8 == 0)
                let p = pic.pixel(y * pic.width + x)
                let k = major ? 0.45 : 0.18
                let toward: Double = luma(p) > 0.55 ? 0 : 255
                let m = { (ch: UInt8) in UInt8(Double(ch) + (toward - Double(ch)) * k) }
                pic.setPixel(y * pic.width + x, RGBA(m(p.r), m(p.g), m(p.b)))
            } }
        }
        return pic
    }

    static func gray(_ c: RGBA) -> RGBA { let l = UInt8((luma(c) * 255).rounded()); return RGBA(l, l, l) }

    /// Review pictures for a 2D sprite.
    static func spriteReview(_ doc: Document, frame: Int, scale: Int?) -> (images: [Data], layout: String) {
        let side = max(doc.sx, doc.sy)
        let big = scale ?? max(4, min(14, 300 / side))
        let dark = RGBA(44, 44, 48), light = RGBA(214, 214, 206), mid = RGBA(110, 132, 120)
        let (detail, _) = Renderer.sheet([picture(doc, frame: frame, scale: big, bg: dark, grid: true),
                                          picture(doc, frame: frame, scale: big, bg: RGBA(30, 30, 30), grid: true, map: gray)],
                                         columns: 2, gap: 8, background: RGBA(20, 20, 22))
        let small = max(2, min(4, 128 / side))
        let (sizes, _) = Renderer.sheet([picture(doc, frame: frame, scale: small, bg: light, map: { _ in RGBA(30, 28, 40) }),
                                         picture(doc, frame: frame, scale: 1, bg: dark),
                                         picture(doc, frame: frame, scale: 1, bg: light),
                                         picture(doc, frame: frame, scale: 2, bg: mid),
                                         picture(doc, frame: frame, scale: 2, bg: dark)],
                                        columns: 5, gap: 8, background: RGBA(70, 70, 76))
        var images = [ImageFiles.png(detail), ImageFiles.png(sizes)]
        var layout = "Picture 1: left, the sprite enlarged with a pixel grid (bold lines every 8 pixels from the top-left, x to the right, rows down); right, the same in grayscale values. "
            + "Picture 2: silhouette, actual size on dark, actual size on light, 2× on green, 2× on dark."
        if doc.frames.count > 1 {
            let fs = max(2, min(6, 480 / max(1, doc.sx * doc.frames.count)))
            let (strip, _) = Renderer.sheet(doc.frames.indices.map { picture(doc, frame: $0, scale: fs, bg: dark) },
                                            columns: doc.frames.count, gap: 4, background: RGBA(70, 70, 76))
            images.append(ImageFiles.png(strip))
            layout += " Picture 3: every animation frame in order, left to right."
        }
        return (images, layout)
    }
}
