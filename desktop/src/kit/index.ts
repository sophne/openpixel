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

/** The kit's document- and window-level listeners. The order matters: these are capture listeners on window, and
 *  the menu's key handler stops the ones after it. Once, from app/startup.ts, before anything renders. */
export function installKit(): void {
  installTooltips();
  installMotion();     // lastInput: pointer or keyboard
  installModals();     // Tab stays inside the open dialog
  installMenus();      // menu keys; a click elsewhere closes menus
  installHaptics();
  installKeys();       // Escape
}
