import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The public gallery/lightbox interaction is verified end-to-end by Playwright
 * (real DOM, focus, keyboard, swipe). Here we assert, at the source level, the
 * accessibility and safety guarantees the project requires of the component —
 * mirroring the repository's source-scan test convention.
 */
const source = readFileSync("src/components/vehicle-gallery.tsx", "utf8");

describe("public vehicle gallery source guarantees", () => {
  it("uses a semantic, labelled, modal dialog with a live status", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("aria-labelledby");
    expect(source).toContain('aria-live="polite"');
    expect(source).toMatch(/Image \{lightIndex \+ 1\} of \{total\}/);
  });

  it("wires keyboard, swipe, and focus-return behavior", () => {
    expect(source).toContain("lightboxKeyAction");
    expect(source).toContain("resolveSwipe");
    expect(source).toContain("onTouchStart");
    expect(source).toContain("onTouchEnd");
    // Focus returns to the trigger on close.
    expect(source).toContain("triggerRef.current?.focus()");
    // Focus enters the dialog on open.
    expect(source).toContain("closeRef.current?.focus()");
  });

  it("renders through the Cloudinary loader and never uses unsafe HTML", () => {
    expect(source).toContain("loader={cloudinaryLoader}");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toContain("unoptimized");
  });

  it("provides alt text for every image and a safe empty state", () => {
    expect(source).toContain("alt={altFor(");
    expect(source).toContain("Image unavailable");
    // Prev/Next controls exist and are hidden for a single image.
    expect(source).toContain('aria-label="Previous image"');
    expect(source).toContain('aria-label="Next image"');
    expect(source).toContain("total > 1");
  });
});
