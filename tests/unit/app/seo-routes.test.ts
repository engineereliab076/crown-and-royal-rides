import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ slugs: ["active-car"] as string[] }));

vi.mock("@/server/cache/vehicles", () => ({
  getCachedSitemapVehicleSlugs: async (
    load: () => Promise<readonly string[]>,
  ) => load(),
}));
vi.mock("@/server/vehicles/services", () => ({
  getPublicCatalogueService: () => ({
    listIndexableSlugs: async () => state.slugs,
  }),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("public discovery routes", () => {
  beforeEach(() => {
    state.slugs = ["active-car"];
  });

  it("publishes static pages and only service-approved vehicle slugs", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "http://localhost:3000/",
        "http://localhost:3000/cars",
        "http://localhost:3000/cars-for-sale",
        "http://localhost:3000/cars-for-rent",
        "http://localhost:3000/about",
        "http://localhost:3000/contact",
        "http://localhost:3000/privacy",
        "http://localhost:3000/cars/active-car",
      ]),
    );
    expect(urls.some((url) => url.includes("package"))).toBe(false);
    expect(urls.some((url) => url.includes("?"))).toBe(false);
  });

  it("allows public crawling, disallows admin/API paths, and names the sitemap", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/"],
      },
      sitemap: "http://localhost:3000/sitemap.xml",
    });
  });
});
