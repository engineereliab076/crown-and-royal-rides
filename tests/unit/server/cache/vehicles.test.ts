import { describe, expect, it } from "vitest";

import { vehicleCacheTag } from "@/server/cache/vehicles";

describe("vehicle cache tags", () => {
  it("creates the stable per-slug tag", () => {
    expect(vehicleCacheTag("toyota-land-cruiser-2025-safe")).toBe(
      "vehicle:toyota-land-cruiser-2025-safe",
    );
  });
});
