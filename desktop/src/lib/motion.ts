/* Motion (app.js 148–173).
   Popups grow out of whatever opened them: the point of the popup nearest the trigger is the transform origin,
   so a menu under a button grows down from the button, one that flips upward grows up, and the colour picker grows
   sideways from its swatch. Dialogs are not anchored to anything, so they grow from the centre. Only popups a pointer
   opened animate (keyboard use is constant and must feel instant), exits are instant, and reduced motion fades only. */
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const reducedMotion: MediaQueryList = window.matchMedia('(prefers-reduced-motion: reduce)');

/** What the person used last: 'pointer' or 'key'. Read it as `lastInput` (a live binding); set it with setLastInput. */
export let lastInput: 'pointer' | 'key' = 'pointer';
export function setLastInput(v: 'pointer' | 'key'): void { lastInput = v; }

let installed = false;
export function installMotion(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
  window.addEventListener('keydown', (e) => { if (!['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) lastInput = 'key'; }, true);
}

export function originFrom(trigger: Element, box: Element): string {
  box.getAnimations().forEach((a) => a.cancel()); // measure at full size, not mid-animation
  const t = trigger.getBoundingClientRect(), b = box.getBoundingClientRect();
  const x = Math.max(0, Math.min(b.width, t.left + t.width / 2 - b.left));
  const y = Math.max(0, Math.min(b.height, t.top + t.height / 2 - b.top));
  return `${Math.round(x)}px ${Math.round(y)}px`;
}
export function popIn(el: HTMLElement | null | undefined, origin = '50% 50%', { scale = 0.96, duration = 150 } = {}): void {
  if (!el || !el.animate || lastInput !== 'pointer') return;
  el.getAnimations().forEach((a) => a.cancel());
  el.style.transformOrigin = origin;
  const still = reducedMotion.matches;
  el.animate(still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: `scale(${scale})` }, { opacity: 1, transform: 'none' }],
    { duration: still ? 120 : duration, easing: EASE_OUT });
}
