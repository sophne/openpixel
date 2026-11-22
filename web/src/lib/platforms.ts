// The systems OpenPixel runs on and the files each one downloads. Shared by the download buttons, the downloads
// page, the redirect routes and the click tracking, so a file name or requirement is written once.

export type Os = "mac" | "windows" | "linux";

export type DownloadFile = {
  /** The last part of its redirect route: /downloads/<id>. */
  id: "mac" | "windows" | "linux" | "linux-deb";
  os: Os;
  /** The asset's fixed name on every GitHub release. */
  file: string;
  /** What kind of file it is, for the downloads page. */
  kind: string;
};

export const FILES: DownloadFile[] = [
  { id: "mac", os: "mac", file: "OpenPixel.dmg", kind: "Disk image, universal: Apple silicon and Intel" },
  { id: "windows", os: "windows", file: "OpenPixel-Setup.exe", kind: "Installer, 64-bit" },
  { id: "linux", os: "linux", file: "OpenPixel.AppImage", kind: "AppImage, x64" },
  { id: "linux-deb", os: "linux", file: "openpixel.deb", kind: "Package for Debian and Ubuntu, x64" },
];

export const fileById = (id: string) => FILES.find((f) => f.id === id);
export const routeOf = (f: DownloadFile) => `/downloads/${f.id}`;

export type Platform = {
  os: Os;
  /** The system's own name ("macOS") and the short one used on buttons ("Mac"). */
  name: string;
  short: string;
  /** The oldest system it runs on. */
  requires: string;
  /** The other two, for "Also for …". */
  others: string;
};

export const PLATFORMS: Platform[] = [
  { os: "mac", name: "macOS", short: "Mac", requires: "macOS 12 or later, Apple silicon and Intel", others: "Windows and Linux" },
  { os: "windows", name: "Windows", short: "Windows", requires: "Windows 10 or later, 64-bit", others: "Mac and Linux" },
  { os: "linux", name: "Linux", short: "Linux", requires: "64-bit Linux (x64)", others: "Mac and Windows" },
];

/** The file a "Download for <system>" button fetches: the first one listed for that system. */
export const mainFile = (os: Os) => FILES.find((f) => f.os === os)!;

/**
 * Works out the visitor's system before the page is first painted and writes it on <html data-os="…">; the
 * stylesheet then shows the matching download button, note and commands (see "the visitor's system" in globals.css).
 * It runs in the browser because every page is static or cached for all visitors: reading the request's User-Agent
 * on the server would make each page dynamic. Without JavaScript nothing is set and the neutral versions show.
 *
 * Only desktop systems the app runs on get a value. Phones and tablets stay neutral, and so does an iPad that
 * calls itself a Mac (it has a touch screen, a Mac doesn't), ChromeOS, and Linux on ARM (the builds are x64).
 */
export const OS_SCRIPT = `(function(){try{var n=navigator,d=n.userAgentData,u=(n.userAgent||"").toLowerCase(),p=((d&&d.platform)||n.platform||"").toLowerCase(),o="";if(!(d&&d.mobile)&&!/android|iphone|ipad|ipod|mobile|tablet|cros/.test(u)){if(p.indexOf("mac")===0||u.indexOf("macintosh")>=0){if(!(n.maxTouchPoints>1))o="mac"}else if(p.indexOf("win")===0||u.indexOf("windows nt")>=0)o="windows";else if((p.indexOf("linux")===0||u.indexOf("linux")>=0||u.indexOf("x11")>=0)&&!/aarch64|arm/.test((n.platform||"").toLowerCase()+u))o="linux"}if(o)document.documentElement.setAttribute("data-os",o)}catch(e){}})();`;

/** The system the script above found, or null (also on the server). */
export function detectedOs(): Os | null {
  if (typeof document === "undefined") return null;
  const os = document.documentElement.dataset.os;
  return os === "mac" || os === "windows" || os === "linux" ? os : null;
}

/**
 * For a <script> placed right after a group of radio buttons named `name` with the values "mac", "windows" and
 * "linux": picks the visitor's system before first paint. components/OsChoice.tsx does the same after a link
 * inside the site, where scripts in the page don't run.
 */
export const osChoiceScript = (name: string) =>
  `(function(){try{var o=document.documentElement.getAttribute("data-os"),r=o&&document.querySelector('input[type=radio][name="${name}"][value="'+o+'"]');if(r)r.checked=true}catch(e){}})();`;
