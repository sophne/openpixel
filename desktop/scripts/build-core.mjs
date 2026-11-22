#!/usr/bin/env node
// Builds the core for JavaScript: core/wasm (Rust) → WebAssembly → desktop/core-pkg (generated, not in git).
//
//   node scripts/build-core.mjs [--out <folder>] [--debug]
//
// Needs the wasm32-unknown-unknown Rust target and the wasm-bindgen command in the same version as the
// wasm-bindgen crate in core/wasm/Cargo.toml (cargo install wasm-bindgen-cli --version 0.2.100).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, "..", "..", "core");
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = resolve(outAt >= 0 && args[outAt + 1] ? args[outAt + 1] : join(here, "..", "core-pkg"));
const profile = args.includes("--debug") ? "debug" : "release";

function run(command, list, options = {}) {
  const r = spawnSync(command, list, { stdio: "inherit", ...options });
  if (r.error) {
    console.error(`build-core: could not run ${command}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const cargo = process.env.CARGO || "cargo";
const build = ["build", "--target", "wasm32-unknown-unknown", "-p", "openpixel-wasm"];
if (profile === "release") build.splice(1, 0, "--release");
run(cargo, build, { cwd: core });

// CARGO_TARGET_DIR moves cargo's output; honour it.
const target = process.env.CARGO_TARGET_DIR ? resolve(core, process.env.CARGO_TARGET_DIR) : join(core, "target");
const wasm = join(target, "wasm32-unknown-unknown", profile, "openpixel_wasm.wasm");
if (!existsSync(wasm)) {
  console.error(`build-core: ${wasm} was not built`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
run(process.env.WASM_BINDGEN || "wasm-bindgen", ["--target", "web", "--out-dir", out, wasm]);

const built = join(out, "openpixel_wasm_bg.wasm");
console.log(`build-core: ${out} (${(statSync(built).size / 1024).toFixed(0)} KB of WebAssembly)`);
