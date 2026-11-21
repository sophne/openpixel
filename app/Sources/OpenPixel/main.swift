import AppKit
import Foundation
import OpenPixelCore

let arguments = CommandLine.arguments

func argValue(_ flag: String) -> String? {
    guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
    return arguments[i + 1]
}

if arguments.contains("--version") {
    print("OpenPixel \(MCPServer.version)")
    exit(0)
}

if arguments.contains("--help") || arguments.contains("-h") {
    print("""
    OpenPixel \(MCPServer.version) — 3D pixel art editor with a built-in MCP server.

      OpenPixel                      open the editor
      OpenPixel <file.openpixel>    open a model
      OpenPixel --mcp                run the MCP server on stdin/stdout (drives the open window,
                                      or works headless when the window is closed)
      OpenPixel --mcp --headless     MCP server that never touches the window
      OpenPixel --mcp-http [port]    MCP over HTTP on 127.0.0.1 (default 8765) for ChatGPT via a tunnel;
                                     prints the address (add --token <secret> to fix its secret part)
      OpenPixel --screenshot out.png open, draw ~120 frames, save the window picture and quit
      OpenPixel --selftest           run built-in checks
      OpenPixel --ui-test <folder>   click through the editor, write report.json and pictures there
    """)
    exit(0)
}

if arguments.contains("--mcp-http") {
    let port = UInt16(argValue("--mcp-http") ?? "") ?? 8765
    MCPMode.run(headless: arguments.contains("--headless"), httpPort: port, httpToken: argValue("--token"))
    exit(0)
}

if arguments.contains("--mcp") {
    MCPMode.run(headless: arguments.contains("--headless"))
    exit(0)
}

if arguments.contains("--selftest") {
    exit(SelfTest.run() ? 0 : 1)
}

let app = NSApplication.shared
let flagValues = Set([argValue("--screenshot"), argValue("--ui-test"), argValue("--record"), argValue("--demo")].compactMap { $0 })
let delegate = AppDelegate(screenshotPath: argValue("--screenshot"),
                           openPath: arguments.dropFirst().first { !$0.hasPrefix("-") && !flagValues.contains($0) },
                           uiTestFolder: argValue("--ui-test"))
// Demo recordings for the website (not in --help): --record <folder> saves the window's frames there while
// --demo <config.json> drives the page (web/demo.js).
delegate.recordFolder = argValue("--record")
delegate.demoConfig = argValue("--demo").flatMap { try? String(contentsOfFile: $0, encoding: .utf8) }
app.delegate = delegate
app.setActivationPolicy(.regular)
if argValue("--screenshot") != nil { FileHandle.standardError.write("[screenshot] starting\n".data(using: .utf8)!) }
DispatchQueue.main.async { delegate.launchIfNeeded() }
app.run()
