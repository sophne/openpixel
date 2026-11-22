//! `openpixel`: the MCP program agents start. Port of main.swift's modes that are not the window.
use openpixel::{mcp, mcp_mode, selftest};

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    let has = |flag: &str| arguments.iter().any(|a| a == flag);
    let value = |flag: &str| arguments.iter().position(|a| a == flag).and_then(|i| arguments.get(i + 1)).cloned();

    if has("--version") {
        println!("OpenPixel {}", mcp::VERSION);
        return;
    }

    if has("--help") || has("-h") || arguments.len() <= 1 {
        help();
        return;
    }

    if has("--mcp-http") {
        let port = value("--mcp-http").and_then(|p| p.parse::<u16>().ok()).unwrap_or(8765);
        mcp_mode::run(has("--headless"), Some(port), value("--token"));
    }

    if has("--mcp") {
        mcp_mode::run(has("--headless"), None, None);
    }

    if has("--selftest") {
        std::process::exit(if selftest::run() { 0 } else { 1 });
    }

    help();
    std::process::exit(2);
}

/// The editor itself is the OpenPixel desktop app; this program is what agents start.
fn help() {
    println!(
        "OpenPixel {v} — 3D pixel art editor with a built-in MCP server.\n\
         \n\
         \x20 openpixel --mcp                run the MCP server on stdin/stdout (drives the open window,\n\
         \x20                                 or works headless when the window is closed)\n\
         \x20 openpixel --mcp --headless     MCP server that never touches the window\n\
         \x20 openpixel --mcp-http [port]    MCP over HTTP on 127.0.0.1 (default 8765) for ChatGPT via a tunnel;\n\
         \x20                                prints the address (add --token <secret> to fix its secret part)\n\
         \x20 openpixel --selftest           run built-in checks\n\
         \x20 openpixel --version            print the version\n\
         \n\
         The editor is the OpenPixel app; this program is what agents start to work in it.",
        v = mcp::VERSION
    );
}
