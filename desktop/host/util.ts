/* Small things the host's parts share. Nothing here reaches outside (no Node, no DOM beyond text and base64). */

export type Json = Record<string, unknown>;

/** Text of an error as the old app showed it: the message itself, no "Error:" in front. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : String(e);
}

export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(errorText(e));
}

// What Swift's `as? String`, `as? Int`, `as? Bool`, `as? [String: Any]` let through.
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'boolean' ? Number(v) : undefined);
export const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : undefined);
export const obj = (v: unknown): Json | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : undefined);

/** A tool argument read as yes or no, the way the engine reads it (Args.bool). */
export function argBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', 'yes', '1'].includes(v.toLowerCase());
  return fallback;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const text = (data: Uint8Array): string => decoder.decode(data);

export function base64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const pngDataURL = (png: Uint8Array): string => 'data:image/png;base64,' + base64(png);

/** JSON that is an object, or undefined (a list, a number or broken text all count as nothing). */
export function parseObject(textOrData: string | Uint8Array): Json | undefined {
  try {
    return obj(JSON.parse(typeof textOrData === 'string' ? textOrData : text(textOrData)));
  } catch {
    return undefined;
  }
}

/** A new identifier, upper case like the Mac's UUID().uuidString. */
export const newUUID = (): string => crypto.randomUUID().toUpperCase();

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
