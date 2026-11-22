import type { MetadataRoute } from "next";
import { FILES, routeOf } from "@/lib/platforms";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    // /downloads/mac, /windows, /linux and /linux-deb only redirect to the files on GitHub: nothing there to index.
    rules: { userAgent: "*", allow: "/", disallow: FILES.map(routeOf) },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
