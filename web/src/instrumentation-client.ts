import posthog from "posthog-js";
import { ANALYTICS_HOST, ANALYTICS_TOKEN, ANALYTICS_UI_HOST, forgetGoogleAnalytics } from "@/lib/consent";

// PostHog for web analytics and session replay, started before the page hydrates (Next.js runs this file first).
//
// Until a visitor allows cookies in the banner, PostHog runs cookieless: no cookies, no local or session storage,
// no session replay, and visitors are told apart only by a hash PostHog's servers make and rotate each day. That's
// `cookieless_mode: "on_reject"` with everyone treated as having declined until they choose
// (`opt_out_capturing_by_default`). Allowing switches to normal cookies and turns on session replay; declining keeps
// the cookieless mode. See src/lib/consent.ts for the banner's side.
if (ANALYTICS_TOKEN) {
  posthog.init(ANALYTICS_TOKEN, {
    api_host: ANALYTICS_HOST,
    ui_host: ANALYTICS_UI_HOST,
    defaults: "2026-08-30",
    cookieless_mode: "on_reject",
    opt_out_capturing_by_default: true,
    person_profiles: "identified_only",
    session_recording: { maskAllInputs: true },
    // The site runs no PostHog surveys, so their script isn't loaded.
    disable_surveys: true,
  });
}
forgetGoogleAnalytics();
