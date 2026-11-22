"use client";

import { useLayoutEffect } from "react";
import { detectedOs } from "@/lib/platforms";

/**
 * Picks the visitor's system in a group of radio buttons named `name` (their values are "mac", "windows" and
 * "linux"), for when the page is reached by a link inside the site. On a fresh page load the small script next to
 * the radio buttons has already done it before first paint (osChoiceScript in lib/platforms.ts), so nothing changes here.
 * Runs before the browser paints, and never overrides a choice the visitor made.
 */
export default function OsChoice({ name }: { name: string }) {
  useLayoutEffect(() => {
    const os = detectedOs();
    const radios = [...document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${name}"]`)];
    const mine = radios.find((r) => r.value === os);
    if (mine && radios.every((r) => r.checked === r.defaultChecked)) mine.checked = true;
  }, [name]);
  return null;
}
