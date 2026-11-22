import { downloadRedirect } from "@/lib/github";

// /downloads/windows always sends people to the newest stable OpenPixel-Setup.exe on GitHub.
export function GET() {
  return downloadRedirect("windows");
}
