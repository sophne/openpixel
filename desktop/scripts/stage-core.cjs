// electron-builder's beforePack step: puts the native `openpixel` program for the system and processor being packed
// into release/.core/<os>-<arch>/, from where electron-builder.yml ships it as resources/core/openpixel[.exe].
// It is looked for in: the file named in OPENPIXEL_MCP_DIST; core/target/<rust target>/release (a cross build);
// core/target/release when packing for the machine this runs on (`npm run build:mcp`).
// A universal Mac app is packed once for x64 and once for arm64 (this runs for each) and joined afterwards, which
// makes the two programs one universal program: so a Mac release needs both
//   cargo build --release --bin openpixel --target x86_64-apple-darwin   and   --target aarch64-apple-darwin.
// What is found is checked against the system and processor it is packed for.
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

const TARGETS = {
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
  linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
};
const OS = { darwin: 'mac', win32: 'win', linux: 'linux' }; // electron-builder's ${os}

/** What kind of program a file is, from its first bytes: { system: 'darwin' | 'linux' | 'win32', arch: 'x64' |
    'arm64' | 'universal' | 'other' }, or null when it is no program at all. */
function programKind(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4096);
  let got = 0;
  try { got = fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
  if (got < 20) return null;
  const magic = head.readUInt32BE(0);
  // Mach-O, 64-bit: the processor follows the magic number. A universal file starts with a table of them.
  if (magic === 0xcffaedfe) return { system: 'darwin', arch: { 0x01000007: 'x64', 0x0100000c: 'arm64' }[head.readUInt32LE(4)] ?? 'other' };
  if (magic === 0xcafebabe || magic === 0xcafebabf) return { system: 'darwin', arch: 'universal' };
  // ELF: e_machine.
  if (magic === 0x7f454c46) return { system: 'linux', arch: { 0x3e: 'x64', 0xb7: 'arm64' }[head.readUInt16LE(18)] ?? 'other' };
  // Windows: "MZ", then the PE header's machine field.
  if (head.readUInt16BE(0) === 0x4d5a) {
    const pe = head.readUInt32LE(0x3c);
    if (pe + 6 <= got && head.readUInt32BE(pe) === 0x50450000) return { system: 'win32', arch: { 0x8664: 'x64', 0xaa64: 'arm64' }[head.readUInt16LE(pe + 4)] ?? 'other' };
  }
  return null;
}

/** Why `file` cannot be shipped as the program for `platform` and `arch`; undefined when it can. A universal Mac
    program serves both of a universal app's halves. */
function wrongProgram(file, platform, arch) {
  const kind = programKind(file);
  if (!kind) return 'it is not a program';
  if (kind.system !== platform) return `it is a ${kind.system} program`;
  if (kind.arch !== arch && !(platform === 'darwin' && kind.arch === 'universal')) return `it is built for ${kind.arch}`;
  return undefined;
}
exports.programKind = programKind;
exports.wrongProgram = wrongProgram;

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
  // The wrong program in an installer would only show when an agent starts it on someone's computer.
  const wrong = wrongProgram(found, platform, arch);
  if (wrong) throw new Error(`${found} cannot be shipped as openpixel for ${platform} ${arch}: ${wrong}.`);
  const folder = path.join(desktop, 'release', '.core', `${OS[platform]}-${arch}`);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(found, path.join(folder, exe));
  fs.chmodSync(path.join(folder, exe), 0o755);
  console.log(`  • openpixel for ${platform} ${arch}: ${path.relative(desktop, found)}`);
};
