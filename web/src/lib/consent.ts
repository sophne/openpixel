/**
 * Web analytics and session replay with PostHog (EU cloud), started in src/instrumentation-client.ts.
 *
 * - Before a choice, and after "Decline": cookieless. Page views and the site's events are counted anonymously,
 *   with no cookies and nothing stored in the browser; PostHog tells visits apart with a hash its servers make and
 *   rotate daily. No session replay.
 * - After "Allow": PostHog's first-party cookie and storage, and session replay with every input masked.
 *
 * PostHog keeps the choice itself in localStorage (strictly necessary: it's how we remember not to ask again); it
 * can be changed from "Cookie settings" in the footer.
 *
 * Settings, read at build time: NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN (empty or "off" removes analytics and the banner)
 * and NEXT_PUBLIC_POSTHOG_HOST (the ingestion host, https://eu.i.posthog.com for this project).
 */
import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? "";
export const ANALYTICS_TOKEN = token === "off" ? "" : token;
export const ANALYTICS_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "";
/** The PostHog app for links (eu.i.posthog.com → eu.posthog.com). */
export const ANALYTICS_UI_HOST = ANALYTICS_HOST.replace(".i.posthog.com", ".posthog.com");
export const ANALYTICS = Boolean(ANALYTICS_TOKEN);

export type Choice = "granted" | "denied";

/** Sent by the footer's "Cookie settings" link to open the banner again. */
export const OPEN_EVENT = "openpixel:cookie-settings";

/** The visitor's answer to the banner, or null while they haven't chosen. */
export function storedChoice(): Choice | null {
  if (!ANALYTICS) return null;
  const status = posthog.get_explicit_consent_status();
  return status === "pending" ? null : status;
}

/** Applies the banner's answer: cookies and session replay, or cookieless counting only. */
export function applyChoice(choice: Choice) {
  if (!ANALYTICS) return;
  if (choice === "granted") posthog.opt_in_capturing();
  else posthog.opt_out_capturing();
}

/**
 * Sends one of the site's events (an app download, a copied icon…) with its details. It is counted in either mode:
 * cookieless before consent or after "Decline", with PostHog's cookie after "Allow".
 */
export function trackEvent(event: string, params: Record<string, string> = {}) {
  if (!ANALYTICS) return;
  posthog.capture(event, params);
}

/**
 * The site used Google Analytics before PostHog. Its cookies (_ga, _ga_<id>) and the old consent answer are removed
 * on the next visit; that answer covered Google Analytics only, so the banner asks again.
 */
export function forgetGoogleAnalytics() {
  try {
    localStorage.removeItem("openpixel-consent");
  } catch {
    // Storage blocked: nothing was stored either.
  }
  const host = location.hostname.split(".");
  const domains = host.map((_, i) => host.slice(i).join(".")).filter((d) => d.includes(".") || d === "localhost");
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (!/^(_ga|_gid|_gat)/.test(name)) continue;
    const gone = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = gone;
    for (const d of domains) document.cookie = `${gone}; domain=.${d}`;
  }
}
