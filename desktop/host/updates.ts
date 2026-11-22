/* Whether a newer OpenPixel is out. This is the one place the release feed is read: the file the app's own updater
   reads (electron-builder's `latest-mac.yml`, `latest.yml` on Windows, `latest-linux.yml`, attached to every GitHub
   release). The core knows how to read the feed and what to tell an agent (core/engine/src/updates.rs); the host only
   brings it the feed's text, because the core cannot wait for the network here. */
import type { Core } from './core';
import type { Platform } from './platform';
import { type Json, parseObject } from './util';

/** The newest stable release's files. */
export const FEED_BASE = 'https://github.com/sophne/openpixel/releases/latest/download/';
const FEED_FILES: Partial<Record<Platform['os'], string>> = { darwin: 'latest-mac.yml', win32: 'latest.yml', linux: 'latest-linux.yml' };
/** A fetched feed is good for ten minutes, as before. */
const CACHE_SECONDS = 600;

/** The feed for a system; null where there is none (a page in a browser is always the newest there is).
    `base` is the folder the feed files are in, when it is not the newest GitHub release (tests). */
export function feedUrl(os: Platform['os'], base: string = FEED_BASE): string | null {
  const file = FEED_FILES[os];
  return file === undefined ? null : (base.endsWith('/') ? base : `${base}/`) + file;
}

export class Updates {
  private cached: { at: number; text: string } | null = null;
  private readonly platform: Platform;
  private readonly core: Core;

  constructor(platform: Platform, core: Core) {
    this.platform = platform;
    this.core = core;
  }

  /** The feed this copy reads: its system's file, in the folder the shell names (`desktop.updates.feed`) or else
      in the newest release. */
  get feed(): string | null {
    const { platform } = this;
    return feedUrl(platform.os, platform.desktop?.updates?.feed ?? FEED_BASE);
  }

  /** What check_for_updates answers. Rejects with Error(text) when the feed cannot be read.
      A core that cannot read the feed yet answers "unknown" for the latest version, not a guess. */
  async report(refresh = false): Promise<Json> {
    const { platform, core } = this;
    const fresh = this.cached !== null && platform.now() - this.cached.at < CACHE_SECONDS;
    if (refresh || !fresh) {
      const url = this.feed;
      if (url === null) throw new Error('there is no update feed for this system');
      const text = await platform.fetchText(url, { 'User-Agent': `OpenPixel/${core.version()}` });
      if (text === null) throw new Error('the update feed did not answer (offline?)');
      this.cached = { at: platform.now(), text };
    }
    const text = (this.cached as { text: string }).text;
    if (typeof core.pkg.updateReport !== 'function') {
      return { running_version: core.version(), latest_version: 'unknown', update_available: 'unknown' };
    }
    let answer: string;
    try {
      answer = core.pkg.updateReport(text, platform.os);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    const o = parseObject(answer);
    if (!o) throw new Error('the update feed lists no release');
    return o;
  }
}
