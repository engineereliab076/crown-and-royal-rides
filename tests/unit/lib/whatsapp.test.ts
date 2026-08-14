import { describe, expect, it } from "vitest";

import {
  buildDirectVehicleWhatsAppMessage,
  buildPurchaseWhatsAppMessage,
  buildWhatsAppUrl,
} from "@/lib/whatsapp";

describe("WhatsApp helpers", () => {
  it("builds digits-only Tanzanian wa.me URLs with exact single encoding", () => {
    const message = "Habari 👋\nToyota & Lexus: 50% ready";
    const url = buildWhatsAppUrl("0712 345-678", message);
    expect(url).toBe(
      `https://wa.me/255712345678?text=${encodeURIComponent(message)}`,
    );
    expect(new URL(url).searchParams.get("text")).toBe(message);
    expect(url).not.toContain("%2525");
  });

  it("produces distinct purchase-reference and direct-contact messages", () => {
    const common = {
      brandName: "Toyota",
      model: "Prado",
      year: 2025,
      salePrice: 145_000_000,
      vehicleUrl: "https://example.test/cars/toyota-prado",
    };
    const purchase = buildPurchaseWhatsAppMessage({
      ...common,
      reference: "CRR-ABCDEFGH",
    });
    const direct = buildDirectVehicleWhatsAppMessage(common);
    expect(purchase).toContain("CRR-ABCDEFGH");
    expect(purchase).toContain("TZS 145,000,000");
    expect(direct).not.toContain("CRR-");
    expect(purchase).not.toContain("customerEmail");
  });

  it("rejects invalid business numbers", () => {
    expect(() => buildWhatsAppUrl("+15551234567", "Hello")).toThrow(TypeError);
  });
});
