import { describe, expect, it } from "vitest";

import {
  emailHref,
  parseOpeningHours,
  parseSocialLinks,
  phoneHref,
  whatsappHref,
} from "@/lib/public-contact";

describe("public contact presentation", () => {
  it("normalizes Tanzanian contact URLs", () => {
    expect(phoneHref("0712 345 678")).toBe("tel:+255712345678");
    expect(whatsappHref("255712345678", "Hello there")).toBe(
      "https://wa.me/255712345678?text=Hello%20there",
    );
    expect(emailHref("team@example.com")).toBe("mailto:team@example.com");
  });

  it("rejects malformed contacts", () => {
    expect(phoneHref("javascript:alert(1)")).toBeNull();
    expect(whatsappHref(null)).toBeNull();
    expect(emailHref("not-an-email")).toBeNull();
  });

  it("accepts only expected HTTPS social links", () => {
    expect(
      parseSocialLinks({
        instagram: "https://instagram.com/crownrides",
        unknown: "https://example.com",
        facebook: "javascript:alert(1)",
        youtube: "http://youtube.com/channel/example",
        x: 42,
      }),
    ).toEqual([
      {
        label: "Instagram",
        href: "https://instagram.com/crownrides",
      },
    ]);
  });

  it("skips malformed opening-hours entries", () => {
    expect(
      parseOpeningHours({ Monday: "08:00–17:00", Tuesday: 7, "": "always" }),
    ).toEqual([{ label: "Monday", href: "08:00–17:00" }]);
    expect(parseOpeningHours(["bad"])).toEqual([]);
  });
});
