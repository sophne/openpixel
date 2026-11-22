import { downloadRedirect } from "@/lib/github";

// /downloads/mac always sends people to the newest stable OpenPixel.dmg on GitHub.
export function GET() {
  return downloadRedirect("mac");
}
