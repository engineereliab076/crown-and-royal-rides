import { describe, expect, it } from "vitest";

import {
  MAX_CONCURRENT_UPLOADS,
  MAX_GALLERY_IMAGES,
} from "@/lib/vehicle-gallery";
import {
  activeCount,
  allAltTextValid,
  createQueuedUpload,
  isUploading,
  nextToStart,
  remainingSlots,
  uploadReducer,
  type QueuedUpload,
} from "@/lib/vehicle-gallery-upload";

function item(id: string, overrides: Partial<QueuedUpload> = {}): QueuedUpload {
  return {
    ...createQueuedUpload(id, `${id}.jpg`, "A description"),
    ...overrides,
  };
}

describe("upload-queue slot arithmetic", () => {
  it("respects the 15-image cap including attached and queued files", () => {
    const queue = [item("a"), item("b")];
    expect(remainingSlots(10, queue)).toBe(MAX_GALLERY_IMAGES - 10 - 2);
    expect(remainingSlots(15, [])).toBe(0);
  });

  it("frees a slot for a failed file", () => {
    const queue = [item("a", { status: "failed" }), item("b")];
    expect(remainingSlots(13, queue)).toBe(MAX_GALLERY_IMAGES - 13 - 1);
  });
});

describe("upload-queue concurrency", () => {
  it("starts at most the concurrency limit and counts active uploads", () => {
    const queue = [
      item("a", { status: "uploading" }),
      item("b", { status: "compressing" }),
      item("c", { status: "waiting" }),
      item("d", { status: "waiting" }),
    ];
    expect(activeCount(queue)).toBe(2);
    expect(nextToStart(queue, MAX_CONCURRENT_UPLOADS)).toEqual(["c"]);
    expect(isUploading(queue)).toBe(true);
  });

  it("returns nothing to start when the limit is saturated", () => {
    const queue = [
      item("a", { status: "uploading" }),
      item("b", { status: "uploading" }),
      item("c", { status: "attaching" }),
      item("d", { status: "waiting" }),
    ];
    expect(nextToStart(queue, 3)).toEqual([]);
  });
});

describe("upload-queue alt-text validation", () => {
  it("requires non-empty alt text on every non-failed file", () => {
    expect(allAltTextValid([item("a"), item("b")])).toBe(true);
    expect(allAltTextValid([item("a", { altText: "   " })])).toBe(false);
    // A failed file is excluded from the requirement.
    expect(
      allAltTextValid([item("a", { altText: "  ", status: "failed" })]),
    ).toBe(true);
  });
});

describe("upload reducer", () => {
  it("gives each file independent progress", () => {
    let state = uploadReducer([], {
      type: "add",
      items: [item("a"), item("b")],
    });
    state = uploadReducer(state, { type: "progress", id: "a", progress: 40 });
    state = uploadReducer(state, { type: "progress", id: "b", progress: 90 });
    expect(state.find((i) => i.id === "a")?.progress).toBe(40);
    expect(state.find((i) => i.id === "b")?.progress).toBe(90);
  });

  it("clamps progress to 0..100", () => {
    let state = uploadReducer([item("a")], {
      type: "progress",
      id: "a",
      progress: 250,
    });
    expect(state[0]?.progress).toBe(100);
    state = uploadReducer(state, { type: "progress", id: "a", progress: -5 });
    expect(state[0]?.progress).toBe(0);
  });

  it("retry returns a failed file to waiting with reset progress and error", () => {
    let state = uploadReducer([item("a")], {
      type: "failed",
      id: "a",
      error: "boom",
    });
    expect(state[0]).toMatchObject({ status: "failed", error: "boom" });
    state = uploadReducer(state, { type: "retry", id: "a" });
    expect(state[0]).toMatchObject({
      status: "waiting",
      progress: 0,
      error: null,
    });
  });

  it("marks one file failed without disturbing the others", () => {
    let state = uploadReducer([], {
      type: "add",
      items: [item("a"), item("b"), item("c")],
    });
    state = uploadReducer(state, { type: "succeeded", id: "a" });
    state = uploadReducer(state, { type: "failed", id: "b", error: "x" });
    expect(state.find((i) => i.id === "a")?.status).toBe("succeeded");
    expect(state.find((i) => i.id === "b")?.status).toBe("failed");
    expect(state.find((i) => i.id === "c")?.status).toBe("waiting");
  });
});
