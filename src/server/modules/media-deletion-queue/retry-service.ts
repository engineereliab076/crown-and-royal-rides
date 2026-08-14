import "server-only";

import type { MediaStorage } from "@/server/integrations/media-storage/interface";
import type { MediaDeletionQueueRepository } from "@/server/modules/media-deletion-queue/repository";

/**
 * Deletion-retry processing layer (Phase 4, Group 2).
 *
 * Drains a bounded batch of the durable media-deletion outbox and re-attempts
 * each provider deletion. It is provider-agnostic (only {@link MediaStorage} is
 * called), returns only safe aggregate counts, and never surfaces or logs a
 * public ID, provider response, URL, or raw error.
 *
 * Concurrency: provider deletion is idempotent (a not-found asset is treated as
 * success), so overlapping invocations cannot corrupt or lose queue entries. The
 * frozen `media_deletion_queue` schema has no claim/lock column, so two
 * simultaneous jobs may both attempt the same entry — an unavoidable, harmless
 * duplicate attempt: the first success resolves the row, and a second attempt on
 * an already-deleted asset simply reports success. Attempt counters may therefore
 * over-count in the rare overlap; this is documented and acceptable.
 */

/** Default maximum entries drained per invocation. */
export const DEFAULT_DELETION_BATCH_SIZE = 25;
/**
 * After this many failed attempts an entry is permanently retained (skipped, not
 * silently discarded) for human inspection rather than retried forever.
 */
export const DEFAULT_MAX_DELETION_ATTEMPTS = 10;

export interface MediaDeletionRetryResult {
  /** Entries fetched this run. */
  readonly selected: number;
  /** Entries whose provider asset was deleted (or already gone) and resolved. */
  readonly deleted: number;
  /** Entries skipped because they reached the maximum attempt count. */
  readonly retained: number;
  /** Entries whose provider deletion failed this run and were kept for retry. */
  readonly failed: number;
}

export interface MediaDeletionRetryService {
  process(): Promise<MediaDeletionRetryResult>;
}

export interface MediaDeletionRetryDependencies {
  readonly repository: MediaDeletionQueueRepository;
  readonly mediaStorage: () => MediaStorage;
  readonly now?: () => Date;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
}

export function createMediaDeletionRetryService(
  deps: MediaDeletionRetryDependencies,
): MediaDeletionRetryService {
  const batchSize = deps.batchSize ?? DEFAULT_DELETION_BATCH_SIZE;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_DELETION_ATTEMPTS;
  const now = deps.now ?? (() => new Date());

  return {
    async process() {
      const pending = await deps.repository.listPending(batchSize);
      let deleted = 0;
      let retained = 0;
      let failed = 0;

      for (const entry of pending) {
        // Permanently retain (do not discard) an entry that has exhausted its
        // attempts; it stays queued for human inspection.
        if (entry.attempts >= maxAttempts) {
          retained += 1;
          continue;
        }

        let outcome;
        try {
          outcome = await deps.mediaStorage().deleteAsset(entry.publicId);
        } catch {
          // A thrown provider/transport error is a failed attempt, not a crash:
          // record it (redacted) and keep the entry. One bad item never stops
          // the rest of the batch.
          try {
            await deps.repository.recordFailure(entry.id, now());
          } catch {}
          failed += 1;
          continue;
        }

        if (
          outcome.status === "deleted" ||
          outcome.status === "alreadyMissing"
        ) {
          // Idempotent success: a not-found asset means the obligation is met.
          try {
            await deps.repository.resolve(entry.id);
            deleted += 1;
          } catch {
            // The provider asset is gone but the row could not be removed; count
            // it as a failed attempt so a later run retries the resolve.
            failed += 1;
          }
          continue;
        }

        try {
          await deps.repository.recordFailure(entry.id, now());
        } catch {}
        failed += 1;
      }

      return { selected: pending.length, deleted, retained, failed };
    },
  };
}
