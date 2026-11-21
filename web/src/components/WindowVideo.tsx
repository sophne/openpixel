"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A recording of the app laid over its window shot (AppWindow): the picture paints first, the video fades in once it
 * is actually playing, and loops muted. With reduced motion it never starts, so the picture (its last frame) stays.
 */
export default function WindowVideo({ mp4, webm, label }: { mp4: string; webm?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (still.matches) {
        v.pause();
        setPlaying(false);
      } else {
        v.play().catch(() => setPlaying(false));
      }
    };
    sync();
    still.addEventListener("change", sync);
    return () => still.removeEventListener("change", sync);
  }, []);

  return (
    <video
      ref={ref}
      className={`window-video${playing ? " on" : ""}`}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={label}
      onPlaying={() => setPlaying(true)}
    >
      {webm && <source src={webm} type="video/webm" />}
      <source src={mp4} type="video/mp4" />
    </video>
  );
}
