/* The words on the agents' socket: one JSON request per line,
   {"tool": name, "args": {...}} → {"ok": true, "json": {...}, "images": [base64 PNG]} or {"ok": false, "error": ".."}.
   host/node/bridge.ts moves the lines; this decides what they say. */
import type { ToolOutput } from './core';
import { type Json, base64, errorText, obj, parseObject, str } from './util';

/** The `{"hello": info}` an agent's connection starts with, or undefined for any other line. */
export function helloOf(line: string): Json | undefined {
  return obj(parseObject(line)?.hello);
}

/** The reply line for one request line; `run` executes the tool. */
export async function response(line: string, run: (tool: string, args: Json) => ToolOutput | Promise<ToolOutput>): Promise<string> {
  const req = parseObject(line);
  const tool = str(req?.tool);
  if (!req || tool === undefined) return JSON.stringify({ ok: false, error: 'bad request' });
  try {
    const out = await run(tool, obj(req.args) ?? {});
    return JSON.stringify({ ok: true, json: out.json, images: out.images.map(base64) });
  } catch (e) {
    return JSON.stringify({ ok: false, error: errorText(e) });
  }
}
