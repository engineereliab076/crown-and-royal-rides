import { describe, expect, it } from "vitest";

import {
  clampWidth,
  cloudinaryLoader,
  CLOUDINARY_WIDTH_LADDER,
} from "@/lib/cloudinary-loader";

const BASE =
  "https://res.cloudinary.com/demo/image/upload/v1712345678/prod/vehicles/vehicle/abc/asset-1.jpg";

describe("clampWidth", () => {
  it("rounds up to the nearest ladder rung", () => {
    expect(clampWidth(300)).toBe(320);
    expect(clampWidth(320)).toBe(320);
    expect(clampWidth(500)).toBe(640);
    expect(clampWidth(1000)).toBe(1200);
  });

  it("caps at the largest rung and floors invalid input", () => {
    expect(clampWidth(99999)).toBe(2400);
    expect(clampWidth(0)).toBe(CLOUDINARY_WIDTH_LADDER[0]);
    expect(clampWidth(-10)).toBe(CLOUDINARY_WIDTH_LADDER[0]);
    expect(clampWidth(Number.NaN)).toBe(CLOUDINARY_WIDTH_LADDER[0]);
  });
});

describe("cloudinaryLoader", () => {
  it("inserts the exact transformation into the /image/upload/ path", () => {
    const result = cloudinaryLoader({ src: BASE, width: 900 });
    expect(result).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_960/v1712345678/prod/vehicles/vehicle/abc/asset-1.jpg",
    );
  });

  it("clamps the requested width into the ladder", () => {
    expect(cloudinaryLoader({ src: BASE, width: 300 })).toContain("w_320");
    expect(cloudinaryLoader({ src: BASE, width: 5000 })).toContain("w_2400");
  });

  it("never adds credentials, signatures, or public IDs", () => {
    const result = cloudinaryLoader({ src: BASE, width: 1200 });
    expect(result).not.toMatch(/api_key|api_secret|signature|s--/);
  });

  it.each([
    "https://evil.example/demo/image/upload/v1/x.jpg",
    "http://res.cloudinary.com/demo/image/upload/v1/x.jpg",
    "https://res.cloudinary.com/demo/video/upload/v1/x.mp4",
    "https://res.cloudinary.com/demo/image/fetch/https://evil/x.jpg",
    "not a url",
  ])("returns unexpected host/path forms unchanged (%s)", (src) => {
    expect(cloudinaryLoader({ src, width: 800 })).toBe(src);
  });

  it("rejects a URL carrying query or credentials by returning it unchanged", () => {
    const withQuery = `${BASE}?evil=1`;
    expect(cloudinaryLoader({ src: withQuery, width: 800 })).toBe(withQuery);
    const withCreds =
      "https://user:pass@res.cloudinary.com/demo/image/upload/v1/x.jpg";
    expect(cloudinaryLoader({ src: withCreds, width: 800 })).toBe(withCreds);
  });

  it("does not stack an attacker-supplied transformation segment", () => {
    const injected =
      "https://res.cloudinary.com/demo/image/upload/e_grayscale,l_evil/v1/prod/x.jpg";
    const result = cloudinaryLoader({ src: injected, width: 640 });
    expect(result).not.toContain("e_grayscale");
    expect(result).not.toContain("l_evil");
    expect(result).toContain("f_auto,q_auto,c_limit,w_640");
  });
});
