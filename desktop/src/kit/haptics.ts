/* Buttons that answer a press with a small spring (.haptic in style.css) and, on a Force Touch trackpad, a tap
  . The app ignores the message where there is nothing to tap. */
import { nativeAction } from '../lib/host';

export function haptic(): void { nativeAction('haptic'); }

let installed = false;
export function installHaptics(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.haptic, .tb-add') : null;
    if (b && !b.disabled) haptic();
  });
}
