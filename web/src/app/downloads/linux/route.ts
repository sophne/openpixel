import { downloadRedirect } from "@/lib/github";

// /downloads/linux always sends people to the newest stable OpenPixel.AppImage on GitHub.
export function GET() {
  return downloadRedirect("linux");
}
