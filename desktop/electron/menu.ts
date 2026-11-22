import { Menu, type MenuItemConstructorOptions } from 'electron';

/* The menu bar: the same menus, items and shortcuts as the Mac app's `buildMenu` (AppDelegate.swift), with
   ⌘ becoming Ctrl on Windows and Linux. Editor commands reach the page as `PC.command(cmd)`; file commands go to
   the host (desktop/host), which owns the documents. On Windows and Linux the window has no title bar and therefore no visible
   menu bar: the shortcuts still work there, and the page's own menus cover the rest. */

export interface MenuActions {
  /** Calls `window.PC.<fn>(...args)` in the page. */
  page(fn: string, ...args: unknown[]): void;
  /** Sends a message to the host as the page would. Failures are shown to the person unless `quiet`. */
  host(msg: Record<string, unknown> & { kind: string }, quiet?: boolean): void;
  /** ⌘W: the page closes its active tab; with none left to close, the window closes. */
  closeTab(): void;
  closeWindow(): void;
}

type Item = MenuItemConstructorOptions;

/** The Export submenu's entries: title, the format the host knows it by, and the one that has a shortcut. */
const EXPORTS: [string, string, string?][] = [
  ['PNG Picture…', 'png', 'CmdOrCtrl+Shift+E'], ['Sprite Sheet…', 'sheet'], ['Animated GIF…', 'gif'], ['SVG Vector…', 'svg'],
  ['HTML Page…', 'html'], ['MagicaVoxel .vox…', 'vox'], ['OBJ Mesh…', 'obj'],
];

export function menuTemplate(a: MenuActions, platform: NodeJS.Platform = process.platform): Item[] {
  const mac = platform === 'darwin';
  const sep: Item = { type: 'separator' };
  /** An item that sends a `PC.command`. */
  const cmd = (label: string, command: string, accelerator?: string): Item =>
    ({ id: `command:${command}`, label, accelerator, click: () => a.page('command', command) });
  const native = (id: string, label: string, action: string, accelerator?: string, extra: Record<string, unknown> = {}): Item =>
    ({ id, label, accelerator, click: () => a.host({ kind: 'native', action, ...extra }) });
  const updates = native('app:checkUpdates', 'Check for Updates…', 'checkUpdates');
  const about: Item = { id: 'app:about', label: 'About OpenPixel', role: 'about' };

  const appMenu: Item = {
    label: 'OpenPixel',
    submenu: [about, updates, sep,
      { label: 'Hide OpenPixel', role: 'hide' },
      { label: 'Quit OpenPixel', role: 'quit' }],
  };
  const file: Item = {
    label: 'File',
    submenu: [
      { id: 'file:new', label: 'New Model…', accelerator: 'CmdOrCtrl+N', click: () => a.page('showNewDialog') },
      native('file:open', 'Open…', 'open', 'CmdOrCtrl+O'),
      sep,
      native('file:save', 'Save', 'save', 'CmdOrCtrl+S'),
      native('file:saveAs', 'Save As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
      { label: 'Export', submenu: EXPORTS.map(([label, format, key]) => native(`export:${format}`, label, 'export', key, { format })) },
      sep,
      { id: 'file:closeTab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => a.closeTab() },
      { id: 'file:closeWindow', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => a.closeWindow() },
      // Without an application menu, Quit lives at the end of File ("Exit" on Windows, as the role names it).
      ...(mac ? [] : [sep, { id: 'app:quit', role: 'quit' } as Item]),
    ],
  };
  const edit: Item = {
    label: 'Edit',
    submenu: [
      // Undo and redo are the document's (the engine's history), also while a text field has the focus, as on the Mac.
      { id: 'edit:undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => a.host({ kind: 'tool', name: 'undo', args: {} }, true) },
      { id: 'edit:redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => a.host({ kind: 'tool', name: 'redo', args: {} }, true) },
      sep,
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ],
  };
  const view: Item = {
    label: 'View',
    submenu: [
      cmd('2D Canvas', 'viewSlice', 'CmdOrCtrl+1'),
      cmd('3D View', 'view3d', 'CmdOrCtrl+2'),
      sep,
      cmd('Zoom In', 'zoomIn', 'CmdOrCtrl+='),
      cmd('Zoom Out', 'zoomOut', 'CmdOrCtrl+-'),
      cmd('Fit / Reset View', 'resetCamera', 'CmdOrCtrl+0'),
      sep,
      cmd('Pixel Grid', 'pixelGrid', "CmdOrCtrl+'"),
      cmd('Show or Hide Frames', 'frames'),
      cmd('Show or Hide Sidebar', 'sidebar', 'CmdOrCtrl+\\'),
      sep,
      cmd('Review Model', 'review', 'CmdOrCtrl+R'),
    ],
  };
  const layer: Item = {
    label: 'Layer',
    submenu: [
      cmd('New Layer', 'newLayer', 'CmdOrCtrl+Shift+N'),
      cmd('Duplicate Layer', 'duplicateLayer', 'CmdOrCtrl+D'),
      cmd('Merge Down', 'mergeDown', 'CmdOrCtrl+E'),
      sep,
      cmd('Delete Layer', 'deleteLayer', 'CmdOrCtrl+Backspace'),
    ],
  };
  const frame: Item = {
    label: 'Frame',
    submenu: [
      cmd('New Frame', 'newFrame', 'CmdOrCtrl+Alt+N'),
      cmd('Delete Frame', 'deleteFrame', 'CmdOrCtrl+Alt+Backspace'),
      sep,
      cmd('Play / Stop', 'playStop'),
      cmd('Onion Skin', 'onion'),
    ],
  };
  const windowMenu: Item = { label: 'Window', submenu: [{ label: 'Minimize', role: 'minimize', accelerator: 'CmdOrCtrl+M' }] };
  const help: Item = {
    label: 'Help',
    role: 'help',
    submenu: [
      cmd('Keyboard Shortcuts', 'shortcuts', 'CmdOrCtrl+/'),
      { id: 'help:agents', label: 'Connect an AI Agent…', click: () => a.page('showAgentHelp') },
      // On the Mac these two are in the application menu.
      ...(mac ? [] : [sep, updates, about]),
    ],
  };
  return [...(mac ? [appMenu] : []), file, edit, view, layer, frame, windowMenu, help];
}

export function buildMenu(a: MenuActions): Menu {
  const menu = Menu.buildFromTemplate(menuTemplate(a));
  Menu.setApplicationMenu(menu);
  return menu;
}
