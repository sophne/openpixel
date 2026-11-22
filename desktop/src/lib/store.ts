/* Stores: the page's state lives in plain mutable objects (S, ui, home, sv, …).
   Code changes a store and calls changed(store); components read it with useStore(store).

   Code (and the UI test) reads the DOM straight after changing state: a click, then a look at what it drew.
   changed() makes that work: it renders the components that use the store before it returns. */
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

interface Meta { version: number; listeners: Set<() => void> }
const metas = new WeakMap<object, Meta>();

function metaOf(s: object): Meta {
  let m = metas.get(s);
  if (!m) { m = { version: 0, listeners: new Set() }; metas.set(s, m); }
  return m;
}

/** Marks a plain object as a store. It stays the same object: read and write its fields directly. */
export function store<T extends object>(initial: T): T {
  metaOf(initial);
  return initial;
}

let holding = 0;   // > 0 while React is rendering for us, or inside batch(): changed() only marks, the render follows

/** Says a store's contents changed. The components using it are drawn again before this returns (see flush). */
export function changed(...stores: object[]): void {
  for (const s of stores) {
    const m = metaOf(s);
    m.version++;
    for (const l of [...m.listeners]) l();
  }
  flush();
}

/** Renders everything that is waiting, now. A no-op while React is already rendering (an effect or a ref callback
 *  that calls changed(): React draws the result itself right after). */
export function flush(): void {
  if (holding) return;
  holding++;
  try { flushSync(() => {}); } finally { holding--; }
}

/** Runs `fn` with rendering held back, then renders once: for a function that changes several stores in a row. */
export function batch<T>(fn: () => T): T {
  holding++;
  try { return fn(); } finally { holding--; flush(); }
}

/** Subscribes the component to a store and returns the store itself. */
export function useStore<T extends object>(s: T): T {
  const m = metaOf(s);
  useSyncExternalStore(
    (onChange) => { m.listeners.add(onChange); return () => { m.listeners.delete(onChange); }; },
    () => m.version,
  );
  return s;
}

/** A store's change counter: a dependency for useEffect/useMemo that should run again when the store changed. */
export function versionOf(s: object): number { return metaOf(s).version; }

/** Listens to a store outside React (canvas modules). Returns the function that stops listening. */
export function watch(s: object, fn: () => void): () => void {
  const m = metaOf(s);
  m.listeners.add(fn);
  return () => { m.listeners.delete(fn); };
}
