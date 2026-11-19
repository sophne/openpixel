/**
 * Semantic search in the browser with a small model2vec embedding model (potion-base-4M, MIT) served from this site,
 * packed by web/scripts/explore/search_model.py. A text's vector is the mean of its WordPiece tokens' vectors, so
 * "fire" finds the torch, the campfire and the volcano without sharing a word with them. No request leaves the site.
 */

export type Encoder = (text: string) => Float32Array | null;

const BASE = "/explore/search";
let loading: Promise<Encoder> | null = null;

/** Loads the model once (about 3.5 MB); later calls get the same encoder. */
export function loadEncoder(): Promise<Encoder> {
  loading ??= (async () => {
    const [meta, vocabText, buf] = await Promise.all([
      fetch(`${BASE}/meta.json`).then((r) => r.json() as Promise<{ rows: number; dims: number }>),
      fetch(`${BASE}/vocab.txt`).then((r) => r.text()),
      fetch(`${BASE}/vectors.bin`).then((r) => r.arrayBuffer()),
    ]);
    const { rows, dims } = meta;
    const table = new Int8Array(buf, 0, rows * dims);
    const scales = new Float32Array(buf.slice(rows * dims, rows * dims + rows * 4));
    const vocab = new Map<string, number>();
    vocabText.split("\n").forEach((t, i) => vocab.set(t, i));
    return (text: string) => encode(text, vocab, table, scales, dims);
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Lowercase, strip accents and split into words and punctuation, like BERT's basic tokenizer. */
function words(text: string): string[] {
  const clean = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return clean.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

/** Greedy longest-match WordPiece; a word that can't be split into known pieces is skipped. */
function pieces(word: string, vocab: Map<string, number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < word.length) {
    let j = word.length;
    let id: number | undefined;
    while (j > i) {
      id = vocab.get(i === 0 ? word.slice(i, j) : `##${word.slice(i, j)}`);
      if (id !== undefined) break;
      j--;
    }
    if (id === undefined) return [];
    out.push(id);
    i = j;
  }
  return out;
}

function encode(text: string, vocab: Map<string, number>, table: Int8Array, scales: Float32Array, dims: number) {
  const ids = words(text).flatMap((w) => (w.length > 100 ? [] : pieces(w, vocab)));
  if (ids.length === 0) return null;
  const v = new Float32Array(dims);
  for (const id of ids) {
    const s = scales[id];
    const row = id * dims;
    for (let d = 0; d < dims; d++) v[d] += table[row + d] * s;
  }
  let n = 0;
  for (let d = 0; d < dims; d++) n += v[d] * v[d];
  n = Math.sqrt(n) || 1;
  for (let d = 0; d < dims; d++) v[d] /= n;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let d = 0; d < a.length; d++) s += a[d] * b[d];
  return s;
}
