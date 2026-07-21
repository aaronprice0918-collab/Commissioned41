import type { MetadataRoute } from "next";

// Static sitemap for the five brand routes. Production base is the apex domain.
const BASE = "https://commissioned41.com";

const ROUTES = ["/", "/mission", "/products", "/about", "/contact"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((route) => ({
    url: `${BASE}${route}`,
    lastModified,
    changeFrequency: "monthly",
    priority: route === "/" ? 1 : 0.8,
  }));
}
