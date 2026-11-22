import type { MetadataRoute } from "next";
import { COMPETITORS } from "@/lib/compare";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly" | "yearly") => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });
  return [
    page("/", 1, "weekly"),
    page("/downloads", 0.9, "weekly"),
    page("/explore", 0.8, "monthly"),
    page("/icons", 0.8, "monthly"),
    page("/icons/library", 0.7, "monthly"),
    page("/changelog", 0.7, "weekly"),
    page("/compare", 0.7, "monthly"),
    page("/faq", 0.6, "monthly"),
    ...COMPETITORS.map((c) => page(`/compare/${c.slug}`, 0.6, "monthly")),
    page("/legal/terms", 0.2, "yearly"),
    page("/legal/privacy", 0.2, "yearly"),
    page("/legal/licenses", 0.2, "yearly"),
  ];
}
