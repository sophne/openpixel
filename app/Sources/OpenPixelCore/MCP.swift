import Foundation

/// Something that can run tools: the in-process engine, or the open OpenPixel window over its local socket.
public protocol ToolBackend: AnyObject {
    func call(_ tool: String, _ args: [String: Any]) throws -> ToolOutput
    var label: String { get }
}

public final class LocalBackend: ToolBackend {
    public let engine: Engine
    public init(engine: Engine) { self.engine = engine }
    public func call(_ tool: String, _ args: [String: Any]) throws -> ToolOutput { try engine.execute(tool, args, source: "agent") }
    public var label: String { "headless" }
}

/// Model Context Protocol server (JSON-RPC 2.0, one message per line on stdin/stdout).
public final class MCPServer {
    public static let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0.0"
    static let supportedVersions = ["2025-06-18", "2025-03-26", "2024-11-05"]

    let backend: () -> ToolBackend
    public init(backend: @escaping () -> ToolBackend) { self.backend = backend }

    /// The connecting app's name and version from `initialize` (e.g. "claude-code", "cursor-vscode").
    public private(set) var clientInfo: [String: Any] = [:]
    public var onInitialize: (([String: Any]) -> Void)?
    /// Checks (and may rewrite) every `path` argument before a tool runs. Set for agents reached over
    /// HTTP, which can be on another computer, so they only see OpenPixel's own folder.
    public var pathPolicy: ((String) throws -> String)?

    public static let instructions = """
    OpenPixel makes pixel art: flat 2D sprites and 3D voxel models that render to crisp sprites.
    \(ToolCatalog.conventions)
    \(Craft.rules)
    2D sprite workflow: pixel_art_guide → new_sprite at the final size (16-64) → make_color_ramp per material →
    paint_slice with rows of text (axis z, index 0; row 0 is the top; every row the same width) for the silhouette and flat colours →
    shade and outline → review_model → fix every issue (pixel_perfect for doubled corners, set_pixels for single pixels) →
    review again → add_frame for animation → export_png (scale 1) / export_sheet / export_gif.
    extrude_to_3d turns a finished sprite into a voxel model.
    Review at least twice (after blocking in, and before exporting) and build colours with make_color_ramp rather than
    picking hex values one by one. Saves and exports add a review_reminder when the work changed since the last
    review or its issues are still open: act on it before you finish.
    Every edit returns a `critique`: the score (0-100) and the findings that edit introduced, made worse or resolved.
    If an edit introduces a problem, fix or undo it right away. The score only counts what the checks can measure:
    aim for no open issues, then judge the pictures.
    view_as_text gives the canvas as text with coordinate rulers (pixels, values 0-9, silhouette, and a diff against
    another frame): read exact x/row positions there before set_pixels, and check light and silhouette without pictures.
    For a set of assets: set_style locks the palette, size, light and outline for all of them (load or save a style
    file); batch runs many calls in one request; review_set reviews saved files side by side for consistency.
    3D workflow:
    1. get_model_info (or new_model with a size that fits the subject, e.g. 16-48 per side).
    2. Pick colours: get_palette, or make_color_ramp base=… for a hue-shifted ramp per material.
    3. Block out big shapes with fill_box / draw_sphere / draw_cylinder, or draw slices with paint_slice
       (front views on axis z, top views on axis y; depth extrudes).
    4. Add details with set_voxels; shade with apply_gradient or paint mode.
    5. Review: review_model (pictures from 7 angles + automatic checks) and get_slice for exact cells.
    6. Refine: take_snapshot before a change, compare_snapshot after; undo if it got worse.
    7. Export: export_png / export_svg / export_html / export_sheet (sprite sheets for games) / export_gif / export_vox / export_obj.
    Use layers for parts (body, eyes, props) and frames for animation. If the OpenPixel window is open,
    edits appear there live and get_editor_screenshot shows what the person sees.
    """

    /// Ready-made task prompts agents can offer (MCP prompts).
    static let prompts: [(name: String, title: String, description: String, text: (String) -> String)] = [
        ("make_sprite", "Make a 2D pixel-art sprite", "Plan, draw, review and clean up a sprite following pixel-art practice.", { subject in
            """
            Make a 2D pixel-art sprite of \(subject) with OpenPixel.

            1. Call pixel_art_guide (topic all) and follow it.
            2. Decide the size (16, 24, 32 or 48), the view (front, side or 3/4) and the light direction (top-left). Say them in one line.
            3. Choose 2-4 materials and make one ramp each with make_color_ramp base=… (3-5 steps), plus a dark outline hue.
            4. new_sprite, then paint_slice: first the silhouette in one colour, then flat colours, then shading, then outline and details.
            5. After each step call review_model. Look at the silhouette, the grayscale values and the actual-size pictures, not only the enlarged one.
               Read each edit's critique: if it introduced an issue, fix or undo it before moving on. Use view_as_text for exact coordinates.
               List what looks wrong (shape, readability, light, lines, colours) and every issue it reports, fix them, and review again.
            6. Stop when the issues list is empty or every remaining item is deliberate, and the sprite reads at actual size.
            \(MCPServer.instructions)
            """
        }),
        ("animate_sprite", "Animate a pixel-art sprite", "Turn the open sprite into a looping animation with key poses and timing.", { subject in
            """
            Animate the open sprite: \(subject).

            1. Call pixel_art_guide with topic animation.
            2. Plan the key poses and the frame count in one line (idle 2-4, walk 4-8, attack 3-6), and which frames are holds.
            3. For each frame: add_frame (copies the previous), change only what moves, keep the ground line and the volume steady.
            4. Set durations with set_frame_duration: key poses longer, in-betweens shorter.
            5. review_model shows every frame side by side and checks for identical frames, jumps in volume and a ground line that moves; fix them.
               view_as_text maps=["diff"] shows exactly which pixels change from the previous frame.
            6. Export with export_gif and export_sheet.
            """
        }),
        ("make_voxel_sprite", "Make a 3D pixel-art model", "Step-by-step guide to build, review and refine a voxel model.", { subject in
            "Make a 3D pixel-art voxel model of \(subject) with OpenPixel.\n\n" + MCPServer.instructions +
                "\nRead pixel_art_guide (topics voxel and color) first. After each major step call review_model, list what looks wrong, and fix it before moving on."
        }),
    ]

    /// Runs every file argument of a call through `policy`: `path`, `save_path`, the `paths` list, and the
    /// same inside each call of a batch, so no tool or nesting reaches a file the policy refuses.
    public static func confinePaths(_ tool: String, _ args: [String: Any], _ policy: (String) throws -> String) throws -> [String: Any] {
        var out = args
        for key in ["path", "save_path"] where out[key] != nil && !(out[key] is NSNull) {
            guard let p = out[key] as? String else { throw PCError.invalid("\(key) must be text") }
            out[key] = try policy(p)
        }
        if let list = out["paths"] {
            guard let ps = list as? [Any] else { throw PCError.invalid("paths must be a list of text") }
            out["paths"] = try ps.map { v -> String in
                guard let p = v as? String else { throw PCError.invalid("paths must be a list of text") }
                return try policy(p)
            }
        }
        if tool == "batch", let calls = out["calls"] as? [Any] {
            out["calls"] = try calls.map { c -> Any in
                guard var o = c as? [String: Any] else { return c }
                let name = o["tool"] as? String ?? ""
                if let inner = o["args"] {
                    guard let ia = inner as? [String: Any] else { throw PCError.invalid("each call's args must be an object") }
                    o["args"] = try confinePaths(name, ia, policy)
                }
                return o
            }
        }
        return out
    }

    /// Handles one JSON-RPC message; returns the response line, or nil for notifications.
    public func handle(_ line: String) -> String? {
        guard let data = line.data(using: .utf8), !line.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        guard let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return encode(["jsonrpc": "2.0", "id": NSNull(), "error": ["code": -32700, "message": "parse error"]])
        }
        let id = msg["id"]
        let method = msg["method"] as? String ?? ""
        let params = msg["params"] as? [String: Any] ?? [:]
        if id == nil { return nil } // notification (e.g. notifications/initialized)

        func reply(_ result: [String: Any]) -> String { encode(["jsonrpc": "2.0", "id": id!, "result": result]) }
        func fail(_ code: Int, _ m: String) -> String { encode(["jsonrpc": "2.0", "id": id!, "error": ["code": code, "message": m]]) }

        switch method {
        case "initialize":
            clientInfo = params["clientInfo"] as? [String: Any] ?? [:]
            onInitialize?(clientInfo)
            let asked = params["protocolVersion"] as? String ?? MCPServer.supportedVersions[0]
            let v = MCPServer.supportedVersions.contains(asked) ? asked : MCPServer.supportedVersions[0]
            return reply([
                "protocolVersion": v,
                "capabilities": ["tools": ["listChanged": false], "prompts": ["listChanged": false]],
                "serverInfo": ["name": "openpixel", "title": "OpenPixel", "version": MCPServer.version],
                "instructions": MCPServer.instructions,
            ])
        case "ping":
            return reply([:])
        case "tools/list":
            return reply(["tools": ToolCatalog.all.filter { !$0.hidden }.map { $0.mcpJSON }])
        case "tools/call":
            guard let name = params["name"] as? String, let spec = ToolCatalog.spec(name), !spec.hidden else {
                return fail(-32602, "unknown tool")
            }
            var args = params["arguments"] as? [String: Any] ?? [:]
            do {
                if let policy = pathPolicy { args = try MCPServer.confinePaths(name, args, policy) }
                let out = try backend().call(name, args)
                var content: [[String: Any]] = [["type": "text", "text": encode(out.json, pretty: true)]]
                for img in out.images { content.append(["type": "image", "data": img.base64EncodedString(), "mimeType": "image/png"]) }
                return reply(["content": content, "isError": false])
            } catch {
                return reply(["content": [["type": "text", "text": "Error: \(error)"]], "isError": true])
            }
        case "prompts/list":
            return reply(["prompts": MCPServer.prompts.map { p -> [String: Any] in
                ["name": p.name, "title": p.title, "description": p.description,
                 "arguments": [["name": "subject", "description": "What to make", "required": true]]]
            }])
        case "prompts/get":
            let name = params["name"] as? String ?? "make_voxel_sprite"
            guard let p = MCPServer.prompts.first(where: { $0.name == name }) else { return fail(-32602, "unknown prompt \(name)") }
            let subject = (params["arguments"] as? [String: Any])?["subject"] as? String ?? "a small object"
            return reply(["description": p.description, "messages": [["role": "user", "content": ["type": "text", "text": p.text(subject)]]]])
        case "resources/list":
            return reply(["resources": []])
        default:
            return fail(-32601, "method not found: \(method)")
        }
    }

    func encode(_ obj: Any, pretty: Bool = false) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let d = try? JSONSerialization.data(withJSONObject: obj, options: pretty ? [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes] : [.sortedKeys, .withoutEscapingSlashes]) else {
            return "{}"
        }
        return String(decoding: d, as: UTF8.self)
    }

    /// Reads stdin until it closes. Each response goes out on one stdout line.
    public func runStdio() {
        while let line = readLine(strippingNewline: true) {
            if let out = handle(line) {
                FileHandle.standardOutput.write((out + "\n").data(using: .utf8)!)
            }
        }
    }
}
