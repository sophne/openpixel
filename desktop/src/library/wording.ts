/* Words that name the person's computer in the library's messages and in the agents' set-up guides. On macOS they
   are "your Mac", "the Trash", "Terminal"; Windows and Linux get their own names for the same things
   (lib/platform.ts does this for key caps, "Show in Finder" and "this Mac"). */
import { isMac, platform } from '../lib/platform';

/** "Files on your Mac are not touched." */
export const COMPUTER = isMac ? 'your Mac' : 'your computer';
/** "The file moves to the Trash:" */
export const TRASH = isMac ? 'the Trash' : platform === 'win32' ? 'the Recycle Bin' : 'the trash';
/** "Run this once in Terminal": the Mac's program by name; elsewhere whichever terminal the person uses. */
export const TERMINAL = isMac ? 'Terminal' : 'a terminal';
