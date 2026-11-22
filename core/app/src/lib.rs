//! OpenPixel's MCP program: what agents start (see docs/desktop-architecture.md). `openpixel --mcp` speaks MCP on
//! stdin/stdout and forwards each tool call to the open window, or works on its own engine when no window is open;
//! `openpixel --mcp-http` serves the same over HTTP on this computer.
pub mod bridge;
pub mod json;
pub mod mcp;
pub mod mcp_http;
pub mod mcp_mode;
mod mcp_text;
pub mod paths;
pub mod selftest;
