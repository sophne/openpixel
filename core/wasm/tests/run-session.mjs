// Runs the scripted session (session.json) through the WebAssembly package in Node and writes what the
// native test writes: <out>/transcript.txt, the tools' pictures in <out>/images, and every file the tools
// export. tests/native_vs_wasm.rs runs the same session natively and compares the two folders byte for byte.
//
//   node run-session.mjs <core-pkg folder> <session.json> <out folder>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [pkgDir, sessionFile, outDir] = process.argv.slice(2);
if (!pkgDir || !sessionFile || !outDir) {
  console.error("usage: node run-session.mjs <core-pkg folder> <session.json> <out folder>");
  process.exit(2);
}
const pkg = await import(pathToFileURL(path.join(pkgDir, "openpixel_wasm.js")).href);
pkg.initSync({ module: fs.readFileSync(path.join(pkgDir, "openpixel_wasm_bg.wasm")) });

const APPCAST = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>OpenPixel</title>
<item><title>OpenPixel 9.10.1</title><sparkle:version>1</sparkle:version>
<sparkle:shortVersionString>9.10.1</sparkle:shortVersionString>
<sparkle:fullReleaseNotesLink>https://github.com/sophne/openpixel/releases/tag/v9.10.1</sparkle:fullReleaseNotesLink>
<enclosure url="https://github.com/sophne/openpixel/releases/download/v9.10.1/OpenPixel.dmg" sparkle:edSignature="x" length="1" type="application/octet-stream"/>
</item>
</channel></rss>`;

fs.mkdirSync(path.join(outDir, "images"), { recursive: true });

// The host: Node's file system, a clock that ticks 1.25 s per reading, and a canned update feed.
let clock = 0;
let temp = 0;
const io = {
  read: (p) => {
    // The reason is the host's own wording; the native test host says the same.
    if (!fs.existsSync(p)) throw new Error("no such file");
    return fs.readFileSync(p);
  },
  write: (p, data) => {
    const tmp = `${p}.tmp-${temp++}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, p);
  },
  exists: (p) => fs.existsSync(p),
  createDirAll: (p) => void fs.mkdirSync(p, { recursive: true }),
  homeDir: () => outDir,
  now: () => 1700000000.5 + 1.25 * clock++,
  httpGet: (url) => {
    if (url !== pkg.updateFeedUrl()) throw new Error(`unexpected address ${url}`);
    return new TextEncoder().encode(APPCAST);
  },
};

const place = (v) => (typeof v === "string" ? v.replaceAll("$OUT", outDir) : v);
const placeDeep = (v) =>
  Array.isArray(v) ? v.map(placeDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, placeDeep(x)])) : place(v);
const oneLine = (s) => s.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r");

const engines = new Map();
const changes = new Map();
const lines = [];
const steps = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
steps.forEach((step, i) => {
  let ok = true;
  let text = "";
  let images = [];
  const name = step.e ?? step.new ?? "";
  try {
    if (step.new) {
      const e = new pkg.Engine(io);
      const seen = [];
      e.onChange((tool) => seen.push(tool));
      engines.set(step.new, e);
      changes.set(step.new, seen);
    } else if (step.catalog) {
      text = pkg.toolCatalog();
    } else if (step.updateReport) {
      const [xml, running, installed] = step.updateReport;
      text = running === null ? pkg.updateReport(xml) : pkg.updateReportFor(xml, running, installed ?? undefined);
    } else {
      const e = engines.get(step.e);
      if (step.tool) {
        const r = e.execute(step.tool, JSON.stringify(placeDeep(step.args ?? {})), step.source ?? "agent");
        text = r.json;
        images = r.images;
      } else if ("sample" in step) {
        pkg.buildSample(e, step.sample);
      } else if (step.open3d) {
        pkg.openSample3d(e);
      } else if (step.markClean) {
        e.markClean();
      } else if ("autosave" in step) {
        e.autosave(step.autosave === null ? undefined : place(step.autosave));
      } else if (step.rename) {
        e.rename(step.rename[0] === null ? undefined : place(step.rename[0]), step.rename[1]);
      } else if (step.hostTool) {
        e.setHostTool(step.hostTool, (argsJson) => ({ json: JSON.stringify({ host: true, args: JSON.parse(argsJson) }), images: [new Uint8Array([1, 2, 3])] }));
      } else if (step.dropHostTool) {
        e.setHostTool(step.dropHostTool, undefined);
      } else {
        throw new Error(`unknown step ${JSON.stringify(step)}`);
      }
    }
  } catch (err) {
    ok = false;
    text = err instanceof Error ? err.message : String(err);
  }
  images.forEach((bytes, k) => fs.writeFileSync(path.join(outDir, "images", `${i}-${k}.bin`), bytes));
  let state = "-";
  let seen = [];
  const e = engines.get(name);
  if (e) {
    state = [e.name, e.path ?? "-", e.dirty, e.revision, e.isSprite, e.size.join("x")].join("|");
    seen = changes.get(name).splice(0);
  }
  lines.push(`#${i} ${ok ? "ok" : "err"} images=${images.length} changes=${seen.join(",")} state=${oneLine(state)}`);
  lines.push(oneLine(text));
});
// The run's own folder out of the transcript, as it is, escaped once (JSON) and twice (oneLine); see native_vs_wasm.rs.
const once = outDir.replaceAll("\\", "\\\\"), twice = outDir.replaceAll("\\", "\\\\\\\\");
fs.writeFileSync(path.join(outDir, "transcript.txt"), lines.join("\n").replaceAll(twice, "$OUT").replaceAll(once, "$OUT").replaceAll(outDir, "$OUT") + "\n");
for (const e of engines.values()) e.free();
console.log(`${steps.length} steps`);
