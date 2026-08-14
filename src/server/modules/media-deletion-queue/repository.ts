import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Durable outbox for remote media assets awaiting provider deletion.
 *
 * The application never deletes a provider asset "inline and hope": a deletion
 * intent is first recorded here inside the same transaction that removes the
 * owning database row, then the provider call is attempted after commit. On
 * success the row is resolved (deleted); on failure it survives for a later
 * retry job (Group 2+). This module is that retry job's substrate — it is
 * provider-agnostic (no Cloudinary SDK, no provider public IDs in errors) and
 * carries only the columns the frozen `media_deletion_queue` schema defines.
 */

/** The owner category a queued asset belonged to (e.g. a vehicle image). */
export type MediaDeletionOwnerType = "vehicle";

export interface EnqueueMediaDeletionInput {
  readonly publicId: string;
  readonly ownerType: MediaDeletionOwnerType;
}

export interface PendingMediaDeletionRecord {
  readonly id: bigint;
  readonly publicId: string;
  readonly ownerType: string;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly lastAttemptedAt: Date | null;
}

const PENDING_DELETION_SELECT = {
  id: true,
  publicId: true,
  ownerType: true,
  attempts: true,
  createdAt: true,
  lastAttemptedAt: true,
} as const satisfies Prisma.MediaDeletionQueueSelect;

/** The minimal Prisma surface these operations need. */
export type MediaDeletionQueuePrismaClient = Pick<
  PrismaClient,
  "mediaDeletionQueue"
>;

export interface MediaDeletionQueueRepository {
  /** Record a durable deletion intent. Meant to run inside a transaction. */
  enqueue(input: EnqueueMediaDeletionInput): Promise<{ readonly id: bigint }>;
  /** Resolve a completed deletion by removing its queue row. Idempotent. */
  resolve(id: bigint): Promise<void>;
  /** Oldest-first pending deletions, for a future retry worker. */
  listPending(limit: number): Promise<readonly PendingMediaDeletionRecord[]>;
  /** Record a failed attempt without exposing the provider's error text. */
  recordFailure(id: bigint, attemptedAt: Date): Promise<void>;
}

export function createPrismaMediaDeletionQueueRepository(
  client: MediaDeletionQueuePrismaClient,
): MediaDeletionQueueRepository {
  return {
    async enqueue(input) {
      const created = await client.mediaDeletionQueue.create({
        data: { publicId: input.publicId, ownerType: input.ownerType },
        select: { id: true },
      });
      return { id: created.id };
    },

    async resolve(id) {
      // The retry job may resolve a row another attempt already removed; treat a
      // missing row as success rather than surfacing a not-found error.
      await client.mediaDeletionQueue.deleteMany({ where: { id } });
    },

    async listPending(limit) {
      return client.mediaDeletionQueue.findMany({
        select: PENDING_DELETION_SELECT,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },

    async recordFailure(id, attemptedAt) {
      // A generic marker only — never the provider's error message or public ID.
      await client.mediaDeletionQueue.updateMany({
        where: { id },
        data: {
          attempts: { increment: 1 },
          lastAttemptedAt: attemptedAt,
          lastError: "deletion_retry_failed",
        },
      });
    },
  };
}
