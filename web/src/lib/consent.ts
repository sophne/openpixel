/**
 * Google Analytics through Google Tag Manager, loaded only after the visitor allows it in the cookie banner.
 * Until then no Google script runs and no cookie is set. The choice itself is kept in localStorage on this site
 * (strictly necessary: it's how we remember not to ask again) and can be changed from "Cookie settings" in the footer.
 *
 * Set NEXT_PUBLIC_GTM_ID to use another container, or to "off" to remove analytics and the banner entirely.
 */

const ID = process.env.NEXT_PUBLIC_GTM_ID || "GTM-MXC8C47C";
export const GTM_ID = ID === "off" ? "" : ID;

export type Choice = "granted" | "denied";

const KEY = "openpixel-consent";
/** Sent by the footer's "Cookie settings" link to open the banner again. */
export const OPEN_EVENT = "openpixel:cookie-settings";

type Gtag = (...args: unknown[]) => void;
type W = Window & { dataLayer?: unknown[]; gtag?: Gtag };

export function storedChoice(): Choice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null; // storage blocked: ask every visit, never assume consent
  }
}

export function storeChoice(choice: Choice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
}

function gtag(): Gtag {
  const w = window as W;
  w.dataLayer = w.dataLayer || [];
  // gtag must push the arguments object itself, not an array: that's what Google's tag reads.
  w.gtag ||= function () {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  return w.gtag;
}

/** Starts Tag Manager with analytics allowed. Advertising signals stay denied: the banner never asks for them. */
export function loadAnalytics() {
  if (!GTM_ID) return;
  const tag = gtag();
  if (document.getElementById("gtm-script")) {
    tag("consent", "update", { analytics_storage: "granted" });
    return;
  }
  tag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted",
  });
  tag("set", "ads_data_redaction", true);
  (window as W).dataLayer!.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const s = document.createElement("script");
  s.id = "gtm-script";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
  document.head.appendChild(s);
}

/**
 * Sends an event to Tag Manager, only when the visitor has allowed analytics and Tag Manager is loaded.
 * Without consent nothing is queued or sent.
 */
export function trackEvent(event: string, params: Record<string, string> = {}) {
  if (!GTM_ID || storedChoice() !== "granted" || !document.getElementById("gtm-script")) return;
  const w = window as W;
  (w.dataLayer ||= []).push({ event, ...params });
}

/** Withdraws consent: tells Google's tag to stop and deletes the Analytics cookies it set. */
export function stopAnalytics() {
  if (document.getElementById("gtm-script")) gtag()("consent", "update", { analytics_storage: "denied" });
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
