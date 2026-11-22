/* The app's logic for whoever hosts it: Electron's main process today (desktop/electron), a browser later.
   See docs/desktop-architecture.md, section 3, and platform.ts. */
import { AppHost } from './documents';
import type { Host, HostOptions } from './platform';

export type { ChatRunner, ChatRunnerOptions } from './chat-api';
export type { CoreEngine, CorePackage, HostIo } from './core';
export type * from './platform';

/** Sets the app up: the library, a blank canvas (or `open`), the agents' socket. The page can be shown right after;
    `start()` says what it shows first. */
export function createHost(options: HostOptions): Host {
  return new AppHost(options);
}
