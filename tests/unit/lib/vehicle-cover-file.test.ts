import { describe, expect, it } from "vitest";

import {
  validateVehicleCoverFile,
  VEHICLE_COVER_MAX_BYTES,
} from "@/lib/vehicle-cover-file";

describe("vehicle cover file validation", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "accepts one allowed %s image",
    (type) => {
      expect(validateVehicleCoverFile({ type, size: 1000 })).toBeNull();
    },
  );

  it("rejects unsupported and oversized files before upload", () => {
    expect(
      validateVehicleCoverFile({ type: "image/svg+xml", size: 1000 }),
    ).toContain("JPEG");
    expect(
      validateVehicleCoverFile({
        type: "image/jpeg",
        size: VEHICLE_COVER_MAX_BYTES + 1,
      }),
    ).toContain("10 MB");
  });
});
