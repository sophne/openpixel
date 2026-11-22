"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/consent";

/** `data-event-icon-name` → `icon_name`: the event's parameters, from the element's other data-event-* attributes. */
function params(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(el.dataset)) {
    if (!key.startsWith("event") || key === "event" || value === undefined) continue;
    const name = key.slice("event".length).replace(/^./, (c) => c.toLowerCase());
    out[name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
}

/**
 * Counts clicks on any element with `data-event="<name>"` as that event (sent to PostHog: anonymously without
 * consent; see trackEvent), with its data-event-* attributes as parameters. A <details> with data-event counts when
 * it opens rather than on click. This lets server-rendered pages track links and buttons without client code.
 */
export default function EventTracking() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.type === "auxclick" && e.button !== 1) return; // middle-click opens links too; ignore right-click
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-event]");
      if (!el || el instanceof HTMLDetailsElement) return;
      trackEvent(el.dataset.event!, params(el));
    };
    // "toggle" doesn't bubble, but a listener in the capture phase still sees it.
    const onToggle = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLDetailsElement && el.open && el.dataset.event) trackEvent(el.dataset.event, params(el));
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);
  return null;
}
