"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/consent";
import { fileById } from "@/lib/platforms";

/**
 * Counts clicks on the app's download links as an `app_download` event (through Tag Manager, and only with
 * consent). GA's own download tracking misses these: the links are /downloads/mac, /downloads/windows,
 * /downloads/linux and /downloads/linux-deb (routes that redirect to the newest file on GitHub), not URLs ending
 * in .dmg or .exe. The event says which file and system was chosen (`file_name`, `download_os`), and each link
 * says where it sits with `data-download="<place>"`, sent as `download_location`.
 */
export default function DownloadTracking() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.type === "auxclick" && e.button !== 1) return; // middle-click opens it too; ignore right-click
      const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href^="/downloads/"]');
      const file = link ? fileById(link.getAttribute("href")!.slice("/downloads/".length)) : undefined;
      if (!link || !file) return;
      trackEvent("app_download", {
        file_name: file.file,
        file_extension: file.file.split(".").pop() ?? "",
        download_os: file.os,
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
