"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/consent";

/** Every "Download for macOS" button links here; the route redirects to the newest OpenPixel.dmg on GitHub. */
export const DOWNLOAD_PATH = "/downloads/mac";

/**
 * Counts clicks on the app's download buttons as an `app_download` event (through Tag Manager, and only with
 * consent). GA's own download tracking misses these: the link is /downloads/mac, not a URL ending in .dmg.
 * Each button says where it sits with `data-download="<place>"`, sent as `download_location`.
 */
export default function DownloadTracking() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.type === "auxclick" && e.button !== 1) return; // middle-click opens it too; ignore right-click
      const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(`a[href="${DOWNLOAD_PATH}"]`);
      if (!link) return;
      trackEvent("app_download", {
        file_name: "OpenPixel.dmg",
        file_extension: "dmg",
        link_url: link.href,
        link_text: (link.getAttribute("aria-label") ?? link.textContent ?? "").replace(/\s+/g, " ").trim(),
        download_location: link.dataset.download ?? "unknown",
      });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, []);
  return null;
}
