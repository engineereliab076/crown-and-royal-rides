import { describe, expect, it } from "vitest";

import {
  ALT_TEXT_MAX_LENGTH,
  canMove,
  coverAfterRemoval,
  MAX_GALLERY_IMAGES,
  moveImage,
  normalizeAltText,
  orderedIds,
  reorderByIds,
  suggestAltText,
  type GalleryImage,
} from "@/lib/vehicle-gallery";
import {
  ALT_TEXT_MAX_LENGTH as SERVER_ALT_MAX,
  MAX_VEHICLE_IMAGES,
} from "@/server/modules/vehicle-images/schemas";

function image(id: string, sortOrder: number, isCover = false): GalleryImage {
  return {
    id,
    url: `https://res.cloudinary.com/c/image/upload/v1/${id}.jpg`,
    width: 1600,
    height: 900,
    altText: `alt ${id}`,
    sortOrder,
    isCover,
  };
}

describe("client/server limit parity", () => {
  it("keeps the client gallery limits in sync with the server schema", () => {
    expect(MAX_GALLERY_IMAGES).toBe(MAX_VEHICLE_IMAGES);
    expect(ALT_TEXT_MAX_LENGTH).toBe(SERVER_ALT_MAX);
  });
});

describe("gallery ordering", () => {
  const images = [image("a", 0, true), image("b", 1), image("c", 2)];

  it("lists ids in sort order", () => {
    expect(orderedIds(images)).toEqual(["a", "b", "c"]);
  });

  it("reorders by ids and assigns contiguous sort order", () => {
    const reordered = reorderByIds(images, ["c", "a", "b"]);
    expect(reordered.map((i) => [i.id, i.sortOrder])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("moves a single image earlier and later", () => {
    expect(orderedIds(moveImage(images, "c", "earlier"))).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(orderedIds(moveImage(images, "a", "later"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("reports whether a move is possible at the edges", () => {
    expect(canMove(images, "a", "earlier")).toBe(false);
    expect(canMove(images, "c", "later")).toBe(false);
    expect(canMove(images, "b", "earlier")).toBe(true);
  });
});

describe("cover after removal", () => {
  const images = [image("a", 0, true), image("b", 1), image("c", 2)];

  it("promotes the smallest sort order when the cover is removed", () => {
    expect(coverAfterRemoval(images, "a")).toBe("b");
  });

  it("keeps the cover when a non-cover is removed", () => {
    expect(coverAfterRemoval(images, "c")).toBe("a");
  });

  it("returns null when the final image is removed", () => {
    expect(coverAfterRemoval([image("a", 0, true)], "a")).toBeNull();
  });
});

describe("alt text", () => {
  it("trims and rejects empty or over-long values", () => {
    expect(normalizeAltText("  Front view  ")).toBe("Front view");
    expect(normalizeAltText("   ")).toBeNull();
    expect(normalizeAltText("a".repeat(ALT_TEXT_MAX_LENGTH + 1))).toBeNull();
  });

  it("suggests a safe non-empty value from vehicle identity and position", () => {
    const suggestion = suggestAltText(
      { brandName: "Toyota", model: "Land Cruiser", year: 2025 },
      1,
    );
    expect(suggestion).toContain("2025 Toyota Land Cruiser");
    expect(normalizeAltText(suggestion)).not.toBeNull();
  });
});
