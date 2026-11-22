import Link from "next/link";
import { PLATFORMS, mainFile, routeOf } from "@/lib/platforms";

/**
 * The download button, in every version it can take: "Download" to the downloads page, and "Download for Mac",
 * "for Windows" and "for Linux" straight to that system's file. All four are in the page; the stylesheet shows the
 * one for the visitor's system (found before first paint by OS_SCRIPT in lib/platforms.ts) and removes the others
 * from the page, the keyboard order and screen readers. Without JavaScript, and on phones, tablets and systems
 * the app doesn't run on, that is the neutral one.
 *
 * `place` says where the button sits, for the download count (DownloadTracking). With `compact`, " for Mac" drops
 * away on very narrow screens (the header).
 */
export default function DownloadButton({ place, className, compact = false }: { place: string; className: string; compact?: boolean }) {
  return (
    <>
      <Link className={className} href="/downloads" data-for-os="other">
        Download
      </Link>
      {PLATFORMS.map((p) => (
        <a
          key={p.os}
          className={className}
          href={routeOf(mainFile(p.os))}
          data-for-os={p.os}
          data-download={place}
          // The whole label for screen readers, also where the header hides its second half.
          aria-label={compact ? `Download for ${p.short}` : undefined}
        >
          {compact ? (
            <>
              Download <span className="for-os">for {p.short}</span>
            </>
          ) : (
            `Download for ${p.short}`
          )}
        </a>
      ))}
    </>
  );
}

/**
 * The line that goes with the button: what the visitor's system needs, and where the other systems are.
 * `free` starts it with "Free for" (the comparison pages).
 */
export function DownloadNote({ className, free = false }: { className?: string; free?: boolean }) {
  const cap = (s: string) => (free ? `Free for ${s}` : s);
  return (
    <p className={className}>
      <span data-for-os="other">{free ? "Free for Mac, Windows and Linux." : "A desktop app for Mac, Windows and Linux."}</span>
      {PLATFORMS.map((p) => (
        <span key={p.os} data-for-os={p.os}>
          {cap(p.requires)}. <Link href="/downloads">Also for {p.others}</Link>.
        </span>
      ))}
    </p>
  );
}
