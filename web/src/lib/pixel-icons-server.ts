import { readFileSync } from "node:fs";
import path from "node:path";

/** One icon as public/icons/pixel-icons.json stores it: name, category indexes, search words, packed stroke. */
export type IconRow = [name: string, categories: number[], tags: string, stroke: string];

let rows: Map<string, IconRow> | null = null;

/** Every icon, read once from public/icons/pixel-icons.json (at build time: both icon pages are static). */
export function iconRows(): Map<string, IconRow> {
  if (!rows) {
    const file = path.join(process.cwd(), "public", "icons", "pixel-icons.json");
    const data = JSON.parse(readFileSync(file, "utf8")) as { icons: IconRow[] };
    rows = new Map(data.icons.map((r) => [r[0], r]));
  }
  return rows;
}

/** The packed stroke of a named icon; throws at build time if the name isn't in the set. */
export function iconStroke(name: string): string {
  const row = iconRows().get(name);
  if (!row) throw new Error(`No pixel icon named ${name}`);
  return row[3];
}
