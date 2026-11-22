/* The kit: what every area builds on. Import from '../kit' (and '../lib/…', '../state/…', '../app/…'). */
import { installMotion } from '../lib/motion';
import { installHaptics } from './haptics';
import { installKeys } from './keys';
import { installMenus } from './menus';
import { installModals } from './modals';
import { installTooltips } from './tooltips';

export { toast, Toast } from './toast';
export { adoptTitle, adoptTitles, hideTip, tipParts, useTitle } from './tooltips';
export { copyButton, CopyButton } from './copy';
export { pressable, pressableProps } from './pressable';
export { haptic } from './haptics';
export { inlineRename, RenameText } from './rename';
export { closeMenus, menuItems, moveMenu, onMenuButton, openedMenu, openMenuList, placeFixed, placeMenu } from './menus';
export { askConfirm, askName, closeModals, Dialogs, finishDialog, Modal, openModal, type ModalProps } from './modals';
export { Dropdown, type DropdownApi, type DropdownOption, type DropdownProps } from './Dropdown';
export { Stepper, type StepperProps } from './Stepper';

/** The document- and window-level listeners the old page added at the top level, in the old order (the order
 *  matters: these are capture listeners on window, and the menu's key handler stops the ones after it). Once, from
 *  app/startup.ts, before anything renders. */
export function installKit(): void {
  installTooltips();   // app.js 114–126
  installMotion();     // 156–157: lastInput
  installModals();     // 3030: Tab stays inside the open dialog
  installMenus();      // 3067: menu keys; 3134: a click elsewhere closes menus
  installHaptics();    // 2469
  installKeys();       // 3233: Escape
}
