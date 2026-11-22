// electron-builder's beforePack step: puts the native `openpixel` program for the system and processor being packed
// into release/.core/<os>-<arch>/, from where electron-builder.yml ships it as resources/core/openpixel[.exe].
// It is looked for in: the file named in OPENPIXEL_MCP_DIST; core/target/<rust target>/release (a cross build);
// core/target/release when packing for the machine this runs on (`npm run build:mcp`).
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

const TARGETS = {
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
  linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
};
const OS = { darwin: 'mac', win32: 'win', linux: 'linux' }; // electron-builder's ${os}

exports.default = async function stageCore(context) {
  const desktop = path.join(__dirname, '..');
  const platform = context.electronPlatformName, arch = Arch[context.arch];
  const exe = platform === 'win32' ? 'openpixel.exe' : 'openpixel';
  const triple = (TARGETS[platform] || {})[arch];
  const target = path.join(desktop, '..', 'core', 'target');
  const candidates = [
    process.env.OPENPIXEL_MCP_DIST && path.resolve(process.env.OPENPIXEL_MCP_DIST),
    triple && path.join(target, triple, 'release', exe),
    platform === process.platform && arch === process.arch && path.join(target, 'release', exe),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`No openpixel program for ${platform} ${arch}. Build it first:\n`
      + `  cargo build --release --manifest-path ../core/Cargo.toml --bin openpixel${triple ? ` --target ${triple}` : ''}\n`
      + `(looked in: ${candidates.join(', ') || 'nowhere: unknown target'})`);
  }
  const folder = path.join(desktop, 'release', '.core', `${OS[platform]}-${arch}`);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(found, path.join(folder, exe));
  fs.chmodSync(path.join(folder, exe), 0o755);
  console.log(`  • openpixel for ${platform} ${arch}: ${path.relative(desktop, found)}`);
};
