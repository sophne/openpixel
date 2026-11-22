/* Words that name the person's computer in the library's messages. On macOS they are the old page's, letter for
   letter; Windows and Linux get their own names for the same things (lib/platform.ts does this for key caps and
   "Show in Finder"). */
import { isMac, platform } from '../lib/platform';

/** "Files on your Mac are not touched." */
export const COMPUTER = isMac ? 'your Mac' : 'your computer';
/** "The file moves to the Trash:" */
export const TRASH = isMac ? 'the Trash' : platform === 'win32' ? 'the Recycle Bin' : 'the trash';
