import { describe, expect, it, vi } from "vitest";

import type { MediaStorage } from "@/server/integrations/media-storage/interface";
import type { DeleteOutcome } from "@/server/integrations/media-storage/types";
import type {
  MediaDeletionQueueRepository,
  PendingMediaDeletionRecord,
} from "@/server/modules/media-deletion-queue/repository";
import { createMediaDeletionRetryService } from "@/server/modules/media-deletion-queue/retry-service";

interface QueueState {
  entries: PendingMediaDeletionRecord[];
}

function entry(
  id: number,
  overrides: Partial<PendingMediaDeletionRecord> = {},
): PendingMediaDeletionRecord {
  return {
    id: BigInt(id),
    publicId: `vehicles/vehicle/v/asset-${id}`,
    ownerType: "vehicle",
    attempts: 0,
    createdAt: new Date(1_000_000 + id),
    lastAttemptedAt: null,
    ...overrides,
  };
}

function fakeQueue(state: QueueState): {
  repository: MediaDeletionQueueRepository;
  listPending: ReturnType<typeof vi.fn>;
} {
  const listPending = vi.fn(async (limit: number) =>
    state.entries.slice(0, limit),
  );
  return {
    listPending,
    repository: {
      enqueue: vi.fn(async () => ({ id: BigInt(0) })),
      listPending,
      async resolve(id) {
        state.entries = state.entries.filter((e) => e.id !== id);
      },
      async recordFailure(id, attemptedAt) {
        state.entries = state.entries.map((e) =>
          e.id === id
            ? { ...e, attempts: e.attempts + 1, lastAttemptedAt: attemptedAt }
            : e,
        );
      },
    },
  };
}

function fakeStorage(
  outcomeFor: (publicId: string) => DeleteOutcome | "throw",
): { storage: MediaStorage; deleteAsset: ReturnType<typeof vi.fn> } {
  const deleteAsset = vi.fn(async (publicId: string) => {
    const outcome = outcomeFor(publicId);
    if (outcome === "throw") throw new Error("transport failure");
    return outcome;
  });
  const storage: MediaStorage = {
    createUploadSignature: vi.fn(),
    verifyUploadResult: vi.fn(),
    deleteAsset,
    buildDeliveryUrl: () => "",
  } as unknown as MediaStorage;
  return { storage, deleteAsset };
}

describe("media deletion retry service", () => {
  it("selects a bounded batch of at most 25 in the repository order", async () => {
    const state: QueueState = {
      entries: Array.from({ length: 40 }, (_u, i) => entry(i + 1)),
    };
    const queue = fakeQueue(state);
    const { storage } = fakeStorage(() => ({ status: "deleted" }));
    const service = createMediaDeletionRetryService({
      repository: queue.repository,
      mediaStorage: () => storage,
    });
    const result = await service.process();
    expect(queue.listPending).toHaveBeenCalledWith(25);
    expect(result.selected).toBe(25);
    expect(result.deleted).toBe(25);
  });

  it("resolves entries whose provider asset is deleted or already gone", async () => {
    const state: QueueState = {
      entries: [entry(1), entry(2)],
    };
    const queue = fakeQueue(state);
    const { storage } = fakeStorage((publicId) =>
      publicId.endsWith("-1")
        ? { status: "deleted" }
        : { status: "alreadyMissing" },
    );
    const service = createMediaDeletionRetryService({
      repository: queue.repository,
      mediaStorage: () => storage,
    });
    const result = await service.process();
    expect(result).toMatchObject({
      selected: 2,
      deleted: 2,
      failed: 0,
      retained: 0,
    });
    expect(state.entries).toHaveLength(0);
  });

  it("keeps and counts a failed provider deletion, incrementing attempts", async () => {
    const state: QueueState = { entries: [entry(1)] };
    const queue = fakeQueue(state);
    const { storage } = fakeStorage(() => ({
      status: "failed",
      reason: "provider unavailable",
    }));
    const service = createMediaDeletionRetryService({
      repository: queue.repository,
      mediaStorage: () => storage,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });
    const result = await service.process();
    expect(result).toMatchObject({ selected: 1, deleted: 0, failed: 1 });
    expect(state.entries[0]?.attempts).toBe(1);
    expect(state.entries[0]?.lastAttemptedAt).toEqual(
      new Date("2026-08-14T00:00:00.000Z"),
    );
  });

  it("treats a thrown provider error as a failed attempt, not a crash", async () => {
    const state: QueueState = { entries: [entry(1), entry(2)] };
    const queue = fakeQueue(state);
    const { storage, deleteAsset } = fakeStorage((publicId) =>
      publicId.endsWith("-1") ? "throw" : { status: "deleted" },
    );
    const service = createMediaDeletionRetryService({
      repository: queue.repository,
      mediaStorage: () => storage,
    });
    const result = await service.process();
    // The throw on item 1 must not stop item 2.
    expect(deleteAsset).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ selected: 2, deleted: 1, failed: 1 });
  });

  it("permanently retains entries that reached the maximum attempt count", async () => {
    const state: QueueState = {
      entries: [entry(1, { attempts: 10 }), entry(2, { attempts: 3 })],
    };
    const queue = fakeQueue(state);
    const { storage, deleteAsset } = fakeStorage(() => ({ status: "deleted" }));
    const service = createMediaDeletionRetryService({
      repository: queue.repository,
      mediaStorage: () => storage,
      maxAttempts: 10,
    });
    const result = await service.process();
    expect(result).toMatchObject({
      selected: 2,
      retained: 1,
      deleted: 1,
      failed: 0,
    });
    // The exhausted entry is skipped (not discarded) and no provider call made.
    expect(deleteAsset).toHaveBeenCalledTimes(1);
    expect(state.entries.some((e) => e.id === BigInt(1))).toBe(true);
  });

  it("returns only safe numeric counts and no provider details", async () => {
    const state: QueueState = { entries: [entry(1)] };
    const queue = fakeQueue(state);
    const { storage } = fakeStorage(() => ({ status: "deleted" }));
    const service = createMediaDeletionRetryService({
      repository: queue.repository,
      mediaStorage: () => storage,
    });
    const result = await service.process();
    expect(Object.keys(result).sort()).toEqual([
      "deleted",
      "failed",
      "retained",
      "selected",
    ]);
    expect(JSON.stringify(result)).not.toContain("asset-");
  });
});
