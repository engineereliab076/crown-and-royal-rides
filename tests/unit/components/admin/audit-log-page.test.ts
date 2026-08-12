import { describe, expect, it } from "vitest";

import { sanitizeAuditMetadata } from "@/components/admin/audit-metadata";

describe("audit metadata rendering", () => {
  it("preserves safe values and redacts credential-shaped fields and values", () => {
    const safe = sanitizeAuditMetadata({
      correlationId: "correlation-123",
      changedFields: ["businessName"],
      passwordHash: "$argon2id$secret-value",
      nested: { token: "eyJheader.payload.signature" },
      accidentalUrl: "postgresql://user:password@example.test/database",
    });
    const rendered = JSON.stringify(safe);
    expect(rendered).toContain("correlation-123");
    expect(rendered).toContain("businessName");
    expect(rendered).not.toContain("argon2id");
    expect(rendered).not.toContain("eyJheader");
    expect(rendered).not.toContain("postgresql://");
  });
});
