//! OpenPixel's engine for JavaScript (see docs/desktop-architecture.md, "The core's JavaScript face").
//! One package for the desktop app (Electron's main process) and, later, a browser.
//!
//! The engine's files, clock and network come from a JavaScript `HostIo` object whose methods are all
//! synchronous. A method that is missing, or that throws, fails the tool that needed it with the same kind of
//! error a failed file read gives natively ("could not read /path: reason").
//!
//! Everything is in `js`, compiled for `wasm32` only: natively this crate is empty (its tests compare the
//! WebAssembly build with the native engine).
#[cfg(target_arch = "wasm32")]
mod js;
#[cfg(target_arch = "wasm32")]
pub use js::*;
