/* Reading and writing values the way the Swift app did (the app this logic was ported from: see
   docs/desktop-architecture.md, History), so the same agent output gives the same answer and saved chats read back.

   The Swift app read each agent's JSON with casts (`o["x"] as? String`): a value of another type counted as missing, and
   a JSON null was a value (NSNull), not nil. It trimmed with Foundation's character sets and counted characters as
   people see them (an emoji is one). These helpers keep those rules in one place; the parsers read like the Swift app's. */

import { randomUUID } from 'node:crypto';

export type Dict = Record<string, unknown>;

export const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The key is there at all (a JSON null counts: in Swift `o["x"] != nil` was true for it). Never looks at Object's own
    members, so a key an agent happens to call "constructor" is just a key. */
export const has = (o: Dict | undefined, k: string): boolean =>
  o !== undefined && Object.prototype.hasOwnProperty.call(o, k);

/** `o["x"]`: undefined when missing (Swift's nil), null when it is JSON null (NSNull). */
export const get = (o: Dict | undefined, k: string): unknown => (has(o, k) ? (o as Dict)[k] : undefined);

/** `a ?? b` over lookups: the first key that is there, even when its value is null. */
export function pick(o: Dict | undefined, ...keys: string[]): unknown {
  for (const k of keys) if (has(o, k)) return (o as Dict)[k];
  return undefined;
}

/** `as? String` */
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
/** `as? Bool`: true and false, and the numbers 1 and 0 (Foundation's numbers cast to Bool when they are exactly those). */
export const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : undefined;
/** `as? Int`: whole numbers (and true/false as 1/0, as Foundation's numbers cast). */
export const int = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : typeof v === 'boolean' ? Number(v) : undefined;
/** `as? [String: Any]` */
export const dict = (v: unknown): Dict | undefined => (isDict(v) ? v : undefined);
/** `as? [[String: Any]]`: only when every item is an object (one stray string and the cast fails as a whole). */
export const dicts = (v: unknown): Dict[] | undefined =>
  Array.isArray(v) && v.every(isDict) ? (v as Dict[]) : undefined;
/** `as? [String]` */
export const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;

/** ChatRunner.set: there, and not JSON null. */
export const isSet = (v: unknown): boolean => v !== undefined && v !== null;
/** ChatRunner.first: the first value that is set. */
export const firstSet = (...vs: unknown[]): unknown => vs.find(isSet);

/** A line of JSON as an object, or undefined (the Swift app ignored everything else: arrays, bare values, noise). */
export function parseObject(text: string): Dict | undefined {
  try { return dict(JSON.parse(text)); } catch { return undefined; }
}

// MARK: - writing JSON

/** JSONSerialization with no options: compact, and "/" written as "\/" (Foundation's habit). Used wherever the Swift
    wrote JSON that way, so tool results shown as JSON and the config handed to Claude carry the same text. Keys come
    out in the order they were written (Foundation's order was arbitrary). */
export const nsJSON = (v: unknown): string => JSON.stringify(v).replace(/\//g, '\\/');

/** JSONSerialization with .withoutEscapingSlashes: plain compact JSON. */
export const plainJSON = (v: unknown): string => JSON.stringify(v);

/** JSONSerialization with [.prettyPrinted, .withoutEscapingSlashes]: two spaces, and " : " after each key. */
export function prettyJSON(v: unknown, indent = ''): string {
  const inner = indent + '  ';
  if (Array.isArray(v)) {
    return v.length ? `[\n${v.map((x) => inner + prettyJSON(x, inner)).join(',\n')}\n${indent}]` : `[\n\n${indent}]`;
  }
  if (isDict(v)) {
    const keys = Object.keys(v);
    return keys.length
      ? `{\n${keys.map((k) => `${inner}${JSON.stringify(k)} : ${prettyJSON(v[k], inner)}`).join(',\n')}\n${indent}}`
      : `{\n\n${indent}}`;
  }
  return JSON.stringify(v);
}

// MARK: - text

// CharacterSet.whitespaces is Unicode's space separators and the tab; .whitespacesAndNewlines adds the line breaks.
// (JavaScript's trim() also takes U+FEFF and leaves U+0085, so it is not used.)
const SPACES = ' \\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000\\t';
const BREAKS = '\\n\\u000B\\u000C\\r\\u0085\\u2028\\u2029';
const trimmer = (set: string): RegExp => new RegExp(`^[${set}]+|[${set}]+$`, 'g');
const TRIM_SPACES = trimmer(SPACES);
const TRIM_ALL = trimmer(SPACES + BREAKS);

/** trimmingCharacters(in: .whitespaces) */
export const trimSpaces = (s: string): string => s.replace(TRIM_SPACES, '');
/** trimmingCharacters(in: .whitespacesAndNewlines) */
export const trimAll = (s: string): string => s.replace(TRIM_ALL, '');
/** trimmingCharacters(in: CharacterSet(charactersIn: chars)) */
export function trimChars(s: string, chars: string): string {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a] as string)) a++;
  while (b > a && chars.includes(s[b - 1] as string)) b--;
  return s.slice(a, b);
}

/** split(whereSeparator: \.isNewline): the lines of a text, without the empty ones. */
export const lines = (s: string): string[] => s.split(/[\n\r\u000B\u000C\u0085\u2028\u2029]+/).filter((l) => l !== '');

/** Terminal colour and cursor codes, which some tools print even when asked not to. */
export const stripAnsi = (s: string): string => s.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '');

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** String.prefix(n): the first n characters as people count them. */
export function prefix(s: string, n: number): string {
  if (s.length <= n) return s; // fewer code units than n: it cannot hold more than n characters
  let count = 0;
  for (const g of graphemes.segment(s)) {
    if (count === n) return s.slice(0, g.index);
    count++;
  }
  return s;
}

/** Swift's uuidString (upper case). */
export const uuid = (): string => randomUUID().toUpperCase();

/** \w as Foundation's regular expressions read it (letters and digits of any script, marks, connectors), for use
    inside a character class of a pattern with the u flag. */
export const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200C\\u200D';
