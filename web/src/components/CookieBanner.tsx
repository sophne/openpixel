"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ANALYTICS, OPEN_EVENT, applyChoice, storedChoice, type Choice } from "@/lib/consent";

/**
 * Asks once whether we may use cookies for analytics and session replay (PostHog). Until then, and after "Decline",
 * visits are only counted anonymously, without cookies or session replay; "Decline" is as easy as "Allow". Slides in
 * shortly after the page appears, never takes focus and never blocks the page. "Cookie settings" in the footer
 * opens it again, so the choice can be changed at any time.
 */
export default function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ANALYTICS) return;
    // A short pause so the banner arrives after the page, not with it.
    const id = storedChoice() ? 0 : window.setTimeout(() => setOpen(true), 700);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener(OPEN_EVENT, reopen);
    };
  }, []);

  if (!ANALYTICS) return null;

  const choose = (choice: Choice) => {
    applyChoice(choice);
    setOpen(false);
  };

  return (
    <section className={`cookie${open ? " open" : ""}`} aria-label="Cookie consent" inert={!open}>
      <p>
        Can we use cookies to understand how the site is used, including anonymised session recordings? Without them we
        only count visits anonymously. <Link href="/legal/privacy#analytics">Privacy policy</Link>
      </p>
      <div className="cookie-actions">
        <button type="button" className="cookie-button" onClick={() => choose("denied")}>
          Decline
        </button>
        <button type="button" className="cookie-button" onClick={() => choose("granted")}>
          Allow
        </button>
      </div>
    </section>
  );
}

/** The footer link that opens the banner again, so a choice can be changed at any time. */
export function CookieSettingsLink() {
  if (!ANALYTICS) return null;
  return (
    <button type="button" className="footer-button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      Cookie settings
    </button>
  );
}
