import { describe, expect, it } from "vitest";

import { purchaseInquirySchema } from "@/server/modules/inquiries/schemas";

const VALID = {
  vehicleId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
  customerName: "  Asha Mrema  ",
  customerPhone: "0712 345 678",
  customerEmail: " ASHA@EXAMPLE.COM ",
  message: "  Please call in the afternoon.  ",
};

describe("purchase inquiry schema", () => {
  it("trims and normalizes the supported customer fields", () => {
    expect(purchaseInquirySchema.parse(VALID)).toEqual({
      vehicleId: VALID.vehicleId,
      customerName: "Asha Mrema",
      customerPhone: "+255712345678",
      customerEmail: "asha@example.com",
      message: "Please call in the afternoon.",
    });
  });

  it.each([
    "reference",
    "type",
    "status",
    "subjectSnapshot",
    "packageId",
    "createdAt",
    "brandName",
    "salePrice",
  ])("rejects the server-controlled or unknown field %s", (field) => {
    expect(
      purchaseInquirySchema.safeParse({ ...VALID, [field]: "attacker" })
        .success,
    ).toBe(false);
  });

  it("rejects invalid phones and non-UUID vehicle IDs", () => {
    expect(
      purchaseInquirySchema.safeParse({
        ...VALID,
        vehicleId: "vehicle",
        customerPhone: "+15551234567",
      }).success,
    ).toBe(false);
  });
});
