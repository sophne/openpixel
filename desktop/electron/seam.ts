import type { Host, HostOptions, Platform } from '../host/platform';
import type { ChatRunner, ChatRunnerOptions } from '../host/chat-api';

/* The one place where the shell meets the app's logic and the core. As written here it is empty, so the shell
   builds and typechecks on its own; scripts/build-electron.mjs swaps this file's content, while bundling, for

     export { createHost } from '../host/index';                    // the app's logic
     export { nodePlatform } from '../host/node/platform-node';     // the Node half of Platform
     export { createChatRunner } from '../host/node/chat/index';    // Agent Chat: the person's own agent CLIs
     export * as core from '../core-pkg/<name>.js';                 // the wasm-bindgen glue from `npm run build:core`

   when all of them are there (and says which one is not in `missing`). The types below are what electron/host.ts
   relies on. */

/** The Node half of Platform (files, folders, time, network) and where the agents' socket is. */
export type NodePlatform = Pick<Platform, 'fs' | 'paths' | 'now' | 'fetchText'> & { socketPath: string };
/** The wasm-bindgen package (`--target web`): `initSync` first, then it is what `createHost` takes as `core`. */
export type CorePackage = { initSync(options: { module: BufferSource | WebAssembly.Module }): unknown } & Record<string, unknown>;

export const createHost: ((options: HostOptions) => Host) | undefined = undefined;
export const nodePlatform: ((options: { uiTest?: string; screenshot?: boolean }) => NodePlatform) | undefined = undefined;
export const createChatRunner: ((options: ChatRunnerOptions) => ChatRunner) | undefined = undefined;
export const core: CorePackage | undefined = undefined;
/** The first piece that was not there when the shell was bundled. */
export const missing: string | undefined = 'desktop/host/index.ts';
