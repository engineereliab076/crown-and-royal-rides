/**
 * Pure multi-file upload-queue logic (Phase 4, Group 3).
 *
 * Each queued file owns an independent state and 0–100 progress. This module is
 * the state machine and slot/concurrency arithmetic only — the React component
 * performs the actual compression, authorization, XHR upload (real progress),
 * and attachment, dispatching the results here. Everything is pure and Node-
 * testable; no file contents, URLs, or signatures are stored here.
 */

import {
  MAX_CONCURRENT_UPLOADS,
  MAX_GALLERY_IMAGES,
  normalizeAltText,
} from "@/lib/vehicle-gallery";

export type UploadStatus =
  | "waiting"
  | "compressing"
  | "authorizing"
  | "uploading"
  | "attaching"
  | "succeeded"
  | "failed";

export interface QueuedUpload {
  readonly id: string;
  readonly fileName: string;
  readonly status: UploadStatus;
  readonly progress: number;
  readonly altText: string;
  readonly error: string | null;
}

const ACTIVE_STATUSES: ReadonlySet<UploadStatus> = new Set([
  "compressing",
  "authorizing",
  "uploading",
  "attaching",
]);

/** Statuses that still occupy one of the vehicle's 15 gallery slots. */
function occupiesSlot(status: UploadStatus): boolean {
  return status !== "failed";
}

export function createQueuedUpload(
  id: string,
  fileName: string,
  altText: string,
): QueuedUpload {
  return { id, fileName, status: "waiting", progress: 0, altText, error: null };
}

/**
 * Slots left for new files given the already-attached count and the current
 * queue. A file that has failed frees its slot; anything else (including a
 * succeeded-but-not-yet-refreshed file) still counts.
 */
export function remainingSlots(
  attachedCount: number,
  queue: readonly QueuedUpload[],
): number {
  const occupied = queue.filter((item) => occupiesSlot(item.status)).length;
  return Math.max(0, MAX_GALLERY_IMAGES - attachedCount - occupied);
}

/** Number of uploads currently in an active (in-flight) state. */
export function activeCount(queue: readonly QueuedUpload[]): number {
  return queue.filter((item) => ACTIVE_STATUSES.has(item.status)).length;
}

/**
 * The next waiting upload IDs to start so that no more than the concurrency
 * limit are active at once. Deterministic (queue order).
 */
export function nextToStart(
  queue: readonly QueuedUpload[],
  limit: number = MAX_CONCURRENT_UPLOADS,
): string[] {
  const active = activeCount(queue);
  const capacity = Math.max(0, limit - active);
  if (capacity === 0) return [];
  return queue
    .filter((item) => item.status === "waiting")
    .slice(0, capacity)
    .map((item) => item.id);
}

/** Whether any upload is still in flight (used to disable/confirm-exit). */
export function isUploading(queue: readonly QueuedUpload[]): boolean {
  return queue.some((item) => ACTIVE_STATUSES.has(item.status));
}

/** Every non-failed queued upload must carry valid, non-empty alt text. */
export function allAltTextValid(queue: readonly QueuedUpload[]): boolean {
  return queue
    .filter((item) => item.status !== "failed")
    .every((item) => normalizeAltText(item.altText) !== null);
}

export type UploadAction =
  | { type: "add"; items: readonly QueuedUpload[] }
  | { type: "status"; id: string; status: UploadStatus }
  | { type: "progress"; id: string; progress: number }
  | { type: "altText"; id: string; altText: string }
  | { type: "succeeded"; id: string }
  | { type: "failed"; id: string; error: string }
  | { type: "retry"; id: string }
  | { type: "remove"; id: string };

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function uploadReducer(
  state: readonly QueuedUpload[],
  action: UploadAction,
): QueuedUpload[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.items];
    case "remove":
      return state.filter((item) => item.id !== action.id);
    case "status":
      return state.map((item) =>
        item.id === action.id ? { ...item, status: action.status } : item,
      );
    case "progress":
      return state.map((item) =>
        item.id === action.id
          ? { ...item, progress: clampProgress(action.progress) }
          : item,
      );
    case "altText":
      return state.map((item) =>
        item.id === action.id ? { ...item, altText: action.altText } : item,
      );
    case "succeeded":
      return state.map((item) =>
        item.id === action.id
          ? { ...item, status: "succeeded", progress: 100, error: null }
          : item,
      );
    case "failed":
      return state.map((item) =>
        item.id === action.id
          ? { ...item, status: "failed", error: action.error }
          : item,
      );
    case "retry":
      // A retry returns the file to waiting; the caller requests a fresh
      // authorization and reuses the already-compressed blob it still holds.
      return state.map((item) =>
        item.id === action.id
          ? { ...item, status: "waiting", progress: 0, error: null }
          : item,
      );
    default:
      return [...state];
  }
}
