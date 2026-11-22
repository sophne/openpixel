import { downloadRedirect } from "@/lib/github";

// /downloads/linux-deb always sends people to the newest stable openpixel.deb on GitHub.
export function GET() {
  return downloadRedirect("linux-deb");
}
