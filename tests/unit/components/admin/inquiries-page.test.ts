import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin inquiries page", () => {
  const source = readFileSync(
    "src/app/admin/(protected)/inquiries/page.tsx",
    "utf8",
  );

  it("guards both page and service with inquiry:manage", () => {
    expect(source).toContain('requireAdminPage("inquiry:manage")');
    expect(source).toContain("inquiryService.listAdmin");
  });

  it("renders explicit safe fields and never dumps raw JSON", () => {
    for (const field of [
      "reference",
      "customerName",
      "customerPhone",
      "subject.year",
      "subject.brandName",
      "subject.model",
      "createdAt",
    ]) {
      expect(source).toContain(field);
    }
    expect(source).not.toContain("JSON.stringify");
    expect(source).not.toContain("subjectSnapshot");
  });
});
