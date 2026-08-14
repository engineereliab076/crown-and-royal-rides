import { describe, expect, it } from "vitest";

import {
  initialIndex,
  lightboxKeyAction,
  resolveSwipe,
  stepIndex,
  SWIPE_THRESHOLD_PX,
} from "@/lib/vehicle-lightbox";

describe("stepIndex", () => {
  it("wraps forward and backward within bounds", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });

  it("is safe for a single image or empty set", () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("lightboxKeyAction", () => {
  it("maps arrows and escape to actions", () => {
    expect(lightboxKeyAction("ArrowRight")).toBe("next");
    expect(lightboxKeyAction("ArrowLeft")).toBe("prev");
    expect(lightboxKeyAction("Escape")).toBe("close");
    expect(lightboxKeyAction("Enter")).toBeNull();
    expect(lightboxKeyAction("a")).toBeNull();
  });
});

describe("resolveSwipe", () => {
  it("ignores movement below the threshold", () => {
    expect(resolveSwipe(0)).toBeNull();
    expect(resolveSwipe(SWIPE_THRESHOLD_PX - 1)).toBeNull();
    expect(resolveSwipe(-(SWIPE_THRESHOLD_PX - 1))).toBeNull();
  });

  it("advances on a leftward swipe and goes back on a rightward swipe", () => {
    expect(resolveSwipe(-(SWIPE_THRESHOLD_PX + 10))).toBe("next");
    expect(resolveSwipe(SWIPE_THRESHOLD_PX + 10)).toBe("prev");
  });
});

describe("initialIndex", () => {
  it("selects the cover image or falls back to 0", () => {
    expect(
      initialIndex([{ isCover: false }, { isCover: true }, { isCover: false }]),
    ).toBe(1);
    expect(initialIndex([{ isCover: false }, { isCover: false }])).toBe(0);
    expect(initialIndex([])).toBe(0);
  });
});
