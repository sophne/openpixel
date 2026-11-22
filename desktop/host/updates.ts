/* Whether a newer OpenPixel is out. This is the one place the release feed is read: the same appcast the Mac app's
   updater used. The core knows how to read the feed and what to tell an agent (Updates.swift); the host only
   brings it the feed's text, because the core cannot wait for the network here. */
import type { Core } from './core';
import type { Platform } from './platform';
import { type Json, parseObject } from './util';

export const FEED_URL = 'https://github.com/sophne/openpixel/releases/latest/download/appcast.xml';
/** A fetched feed is good for ten minutes, as before. */
const CACHE_SECONDS = 600;

export class Updates {
  private cached: { at: number; xml: string } | null = null;
  private readonly platform: Platform;
  private readonly core: Core;

  constructor(platform: Platform, core: Core) {
    this.platform = platform;
    this.core = core;
  }

  /** What check_for_updates answers. Rejects with Error(text) when the feed cannot be read.
      A core that cannot read the feed yet answers "unknown" for the latest version, not a guess. */
  async report(refresh = false): Promise<Json> {
    const { platform, core } = this;
    const fresh = this.cached !== null && platform.now() - this.cached.at < CACHE_SECONDS;
    if (refresh || !fresh) {
      const xml = await platform.fetchText(FEED_URL, { 'User-Agent': `OpenPixel/${core.version()}` });
      if (xml === null) throw new Error('the update feed did not answer (offline?)');
      this.cached = { at: platform.now(), xml };
    }
    const xml = (this.cached as { xml: string }).xml;
    if (typeof core.pkg.updateReport !== 'function') {
      return { running_version: core.version(), latest_version: 'unknown', update_available: 'unknown' };
    }
    let answer: string;
    try {
      answer = core.pkg.updateReport(xml);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    const o = parseObject(answer);
    if (!o) throw new Error('the update feed lists no release');
    return o;
  }
}
