// Release data from GitHub, fetched on the server and cached, so visitors never call GitHub themselves.

import { FILES, type DownloadFile } from "@/lib/platforms";

export const REPO = process.env.GITHUB_REPO || "sophne/openpixel";
export const REPO_URL = `https://github.com/${REPO}`;
export const X_URL = process.env.NEXT_PUBLIC_X_URL || "https://x.com/eminvkc";
/**
 * Whether the Mac releases are signed with a Developer ID and notarized by Apple. Until then macOS asks people to
 * confirm the first launch and the Mac app can't install its own updates (its Update button opens the downloads
 * page); the site says so. Set NEXT_PUBLIC_NOTARIZED=true once releases are notarized (see RELEASING.md).
 */
export const NOTARIZED = process.env.NEXT_PUBLIC_NOTARIZED === "true";
/** Always the newest stable release: GitHub redirects this to that release's file of the same name. */
export const assetUrl = (file: string) => `${REPO_URL}/releases/latest/download/${file}`;
/** The Mac disk image, the download structured data names. */
export const DOWNLOAD_URL = assetUrl("OpenPixel.dmg");
/** GitHub's API. Only tests point this elsewhere (a local file server with canned releases). */
const API_URL = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

export type Release = {
  tag: string;
  version: string;
  name: string;
  date: string;
  url: string;
  notes: string;
  prerelease: boolean;
  /** Size in bytes of each download this release carries, by file name (lib/platforms.ts lists the names). */
  assets: Record<string, number>;
};

type ApiAsset = { name: string; size: number };
type ApiRelease = {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  body: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: ApiAsset[];
};

async function api<T>(path: string): Promise<T | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "openpixel-website",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`${API_URL}/repos/${REPO}${path}`, {
      headers,
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // GitHub unreachable, rate-limited, or the repository is still private: the page shows its fallback.
    return null;
  }
}

function toRelease(r: ApiRelease): Release {
  return {
    tag: r.tag_name,
    version: r.tag_name.replace(/^v/, ""),
    name: r.name || r.tag_name,
    date: r.published_at ?? "",
    url: r.html_url,
    notes: r.body ?? "",
    prerelease: r.prerelease,
    assets: Object.fromEntries(
      (r.assets ?? []).filter((a) => FILES.some((f) => f.file === a.name)).map((a) => [a.name, a.size]),
    ),
  };
}

export async function latestRelease(): Promise<Release | null> {
  const r = await api<ApiRelease>("/releases/latest");
  return r ? toRelease(r) : null;
}

export async function allReleases(): Promise<Release[]> {
  const list = await api<ApiRelease[]>("/releases?per_page=30");
  return (list ?? []).filter((r) => !r.draft).map(toRelease);
}

/**
 * Whether the newest release carries this file: true or false when GitHub answered, null when it didn't (then
 * nobody knows, and links go to the file's usual address).
 */
export function hasFile(release: Release | null, f: DownloadFile): boolean | null {
  return release ? release.assets[f.file] !== undefined : null;
}

/**
 * The answer of a /downloads/<file> route: a redirect to the newest release's file on GitHub. While the newest
 * release doesn't carry that file yet, people land on the downloads page instead of GitHub's "not found".
 */
export async function downloadRedirect(id: DownloadFile["id"]): Promise<Response> {
  const f = FILES.find((x) => x.id === id)!;
  const there = hasFile(await latestRelease(), f);
  const to = there === false ? `/downloads#${f.os}` : assetUrl(f.file);
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
}

export function formatSize(bytes?: number): string | null {
  if (!bytes) return null;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
