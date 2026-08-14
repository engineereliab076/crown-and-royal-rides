"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ImagePlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloudinaryLoader } from "@/lib/cloudinary-loader";
import {
  compressVehicleImage,
  VEHICLE_IMAGE_ALLOWED_TYPES,
} from "@/lib/vehicle-image-compression";
import { uploadToProvider } from "@/lib/vehicle-upload-client";
import {
  canMove,
  MAX_CONCURRENT_UPLOADS,
  MAX_GALLERY_IMAGES,
  moveImage,
  normalizeAltText,
  orderedIds,
  reorderByIds,
  suggestAltText,
  type GalleryImage,
} from "@/lib/vehicle-gallery";
import {
  activeCount,
  allAltTextValid,
  createQueuedUpload,
  remainingSlots,
  uploadReducer,
  type QueuedUpload,
} from "@/lib/vehicle-gallery-upload";

interface VehicleIdentity {
  readonly brandName: string;
  readonly model: string;
  readonly year: number;
}

interface GalleryState {
  readonly images: readonly GalleryImage[];
  readonly updatedAt: string;
}

interface Props {
  readonly vehicleId: string;
  readonly vehicle: VehicleIdentity;
  readonly initialGallery: GalleryState;
}

const ACCEPT = VEHICLE_IMAGE_ALLOWED_TYPES.join(",");

async function safeError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {}
  return fallback;
}

function isStale(response: Response): boolean {
  return response.status === 409;
}

export function VehicleGalleryManager({
  vehicleId,
  vehicle,
  initialGallery,
}: Props) {
  const [gallery, setGallery] = useState<GalleryState>(initialGallery);
  const [queue, dispatch] = useReducer(uploadReducer, [] as QueuedUpload[]);
  const [pending, setPending] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const filesRef = useRef<Map<string, File>>(new Map());
  const blobsRef = useRef<Map<string, { blob: Blob; fileName: string }>>(
    new Map(),
  );
  const previewRef = useRef<Map<string, string>>(new Map());
  const processingRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<readonly QueuedUpload[]>(queue);
  const galleryRef = useRef<GalleryState>(gallery);
  queueRef.current = queue;
  galleryRef.current = gallery;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const revokePreview = useCallback((id: string) => {
    const url = previewRef.current.get(id);
    if (url !== undefined) {
      URL.revokeObjectURL(url);
      previewRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const previews = previewRef.current;
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url);
      previews.clear();
    };
  }, []);

  const refetchGallery = useCallback(async () => {
    const response = await fetch(`/api/admin/vehicles/${vehicleId}/images`, {
      credentials: "same-origin",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { gallery: GalleryState };
    setGallery(body.gallery);
  }, [vehicleId]);

  const startFile = useCallback(
    async (id: string) => {
      processingRef.current.add(id);
      try {
        let compressed = blobsRef.current.get(id);
        if (compressed === undefined) {
          dispatch({ type: "status", id, status: "compressing" });
          const file = filesRef.current.get(id);
          if (file === undefined) throw new Error("The file is unavailable.");
          const result = await compressVehicleImage(file);
          compressed = { blob: result.blob, fileName: result.fileName };
          blobsRef.current.set(id, compressed);
        }

        // Each attempt requests a fresh signed authorization.
        dispatch({ type: "status", id, status: "authorizing" });
        const signatureResponse = await fetch("/api/admin/media/signature", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicleId }),
        });
        if (!signatureResponse.ok) {
          throw new Error(
            await safeError(
              signatureResponse,
              "Upload authorization could not be created.",
            ),
          );
        }
        const { authorization } = (await signatureResponse.json()) as {
          authorization: Parameters<
            typeof uploadToProvider
          >[0]["authorization"];
        };

        dispatch({ type: "status", id, status: "uploading" });
        const completed = await uploadToProvider({
          authorization,
          blob: compressed.blob,
          fileName: compressed.fileName,
          onProgress: (percent) =>
            dispatch({ type: "progress", id, progress: percent }),
        });

        dispatch({ type: "status", id, status: "attaching" });
        const altText =
          queueRef.current.find((item) => item.id === id)?.altText ?? "";
        const attachResponse = await fetch(
          `/api/admin/vehicles/${vehicleId}/images`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              upload: completed,
              altText: normalizeAltText(altText) ?? altText,
            }),
          },
        );
        if (!attachResponse.ok) {
          throw new Error(
            await safeError(attachResponse, "The image could not be attached."),
          );
        }
        dispatch({ type: "succeeded", id });
        await refetchGallery();
        // Now attached and reflected in the gallery: drop transient artifacts.
        blobsRef.current.delete(id);
        filesRef.current.delete(id);
        revokePreview(id);
        dispatch({ type: "remove", id });
      } catch (error) {
        dispatch({
          type: "failed",
          id,
          error:
            error instanceof Error
              ? error.message
              : "The image could not be uploaded.",
        });
      } finally {
        processingRef.current.delete(id);
      }
    },
    [refetchGallery, revokePreview, vehicleId],
  );

  // Concurrency pump: start eligible waiting files (valid alt text) up to the
  // active limit. Guarded so a file is never started twice.
  useEffect(() => {
    let active = activeCount(queue);
    for (const item of queue) {
      if (active >= MAX_CONCURRENT_UPLOADS) break;
      if (
        item.status === "waiting" &&
        normalizeAltText(item.altText) !== null &&
        !processingRef.current.has(item.id)
      ) {
        active += 1;
        void startFile(item.id);
      }
    }
  }, [queue, startFile]);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (fileList === null || fileList.length === 0) return;
      setNotice(null);
      const attached = gallery.images.length;
      const slots = remainingSlots(attached, queueRef.current);
      const selected = Array.from(fileList);
      const accepted = selected.slice(0, slots);
      if (selected.length > accepted.length) {
        setNotice(
          `A vehicle may have at most ${MAX_GALLERY_IMAGES} images. Only the first ${accepted.length} were added.`,
        );
      }
      const items: QueuedUpload[] = [];
      accepted.forEach((file, index) => {
        const id = crypto.randomUUID();
        filesRef.current.set(id, file);
        previewRef.current.set(id, URL.createObjectURL(file));
        const position = attached + queueRef.current.length + index + 1;
        items.push(
          createQueuedUpload(id, file.name, suggestAltText(vehicle, position)),
        );
      });
      if (items.length > 0) dispatch({ type: "add", items });
    },
    [gallery.images.length, vehicle],
  );

  const commitOrder = useCallback(
    async (nextOrder: string[]) => {
      const snapshot = galleryRef.current;
      setPending("reorder");
      setGallery((current) => ({
        ...current,
        images: reorderByIds(current.images, nextOrder),
      }));
      try {
        const response = await fetch(
          `/api/admin/vehicles/${vehicleId}/images/reorder`,
          {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageIds: nextOrder,
              expectedUpdatedAt: snapshot.updatedAt,
            }),
          },
        );
        if (!response.ok) {
          if (isStale(response)) {
            await refetchGallery();
            setConflict(
              "The gallery changed elsewhere. It has been reloaded — try again.",
            );
            return;
          }
          setGallery(snapshot);
          setNotice(await safeError(response, "The order could not be saved."));
          return;
        }
        const body = (await response.json()) as { gallery: GalleryState };
        setGallery(body.gallery);
        setConflict(null);
      } catch {
        setGallery(snapshot);
        setNotice("The order could not be saved.");
      } finally {
        setPending(null);
      }
    },
    [refetchGallery, vehicleId],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over === null || active.id === over.id) return;
      const current = orderedIds(galleryRef.current.images);
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      void commitOrder(arrayMove(current, oldIndex, newIndex));
    },
    [commitOrder],
  );

  const onMove = useCallback(
    (id: string, direction: "earlier" | "later") => {
      void commitOrder(
        orderedIds(moveImage(galleryRef.current.images, id, direction)),
      );
    },
    [commitOrder],
  );

  const onSetCover = useCallback(
    async (imageId: string) => {
      const snapshot = galleryRef.current;
      setPending(imageId);
      try {
        const response = await fetch(
          `/api/admin/vehicles/${vehicleId}/images/${imageId}/cover`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedUpdatedAt: snapshot.updatedAt }),
          },
        );
        if (!response.ok) {
          if (isStale(response)) {
            await refetchGallery();
            setConflict(
              "The gallery changed elsewhere. It has been reloaded — try again.",
            );
            return;
          }
          setNotice(await safeError(response, "The cover could not be set."));
          return;
        }
        const body = (await response.json()) as { gallery: GalleryState };
        setGallery(body.gallery);
        setConflict(null);
      } finally {
        setPending(null);
      }
    },
    [refetchGallery, vehicleId],
  );

  const onEditAlt = useCallback(
    async (imageId: string, value: string) => {
      const altText = normalizeAltText(value);
      if (altText === null) {
        setNotice("Alternative text cannot be empty.");
        return;
      }
      setPending(imageId);
      try {
        const response = await fetch(
          `/api/admin/vehicles/${vehicleId}/images/${imageId}/alt-text`,
          {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ altText }),
          },
        );
        if (!response.ok) {
          setNotice(await safeError(response, "The text could not be saved."));
          return;
        }
        await refetchGallery();
        setNotice("Alternative text saved.");
      } finally {
        setPending(null);
      }
    },
    [refetchGallery, vehicleId],
  );

  const onDelete = useCallback(
    async (imageId: string) => {
      setConfirmingDelete(null);
      setPending(imageId);
      try {
        const response = await fetch(
          `/api/admin/vehicles/${vehicleId}/images/${imageId}`,
          { method: "DELETE", credentials: "same-origin" },
        );
        if (!response.ok) {
          setNotice(
            await safeError(response, "The image could not be removed."),
          );
          return;
        }
        const body = (await response.json()) as { gallery: GalleryState };
        setGallery(body.gallery);
      } finally {
        setPending(null);
      }
    },
    [vehicleId],
  );

  const busy = pending !== null;
  const images = [...gallery.images].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1),
  );
  const ids = images.map((image) => image.id);
  const slotsLeft = remainingSlots(gallery.images.length, queue);

  return (
    <section className="space-y-6" aria-label="Vehicle gallery">
      <div className="rounded-xl border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Gallery images</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              JPEG, PNG, or WebP. Up to {MAX_GALLERY_IMAGES} images; {slotsLeft}{" "}
              slot{slotsLeft === 1 ? "" : "s"} remaining. Images are compressed
              in your browser before upload.
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="vehicle-gallery-files">Add images</Label>
          <Input
            id="vehicle-gallery-files"
            type="file"
            multiple
            accept={ACCEPT}
            disabled={slotsLeft === 0}
            onChange={(event) => {
              addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </div>
        {notice ? (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {conflict ? (
          <p role="alert" className="mt-2 text-sm text-amber-700">
            {conflict}
          </p>
        ) : null}
      </div>

      {queue.length > 0 ? (
        <ul className="space-y-3" aria-label="Uploads in progress">
          {queue.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border bg-card p-3"
            >
              {previewRef.current.get(item.id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewRef.current.get(item.id)}
                  alt=""
                  className="h-14 w-14 rounded object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {uploadStatusLabel(item)}
                </p>
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.progress}
                  aria-label={`Upload progress for ${item.fileName}`}
                >
                  <div
                    className="h-full bg-brand-gold-foreground transition-[width]"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <div className="mt-2 space-y-1">
                  <Label
                    htmlFor={`alt-${item.id}`}
                    className="text-xs text-muted-foreground"
                  >
                    Description (required)
                  </Label>
                  <Input
                    id={`alt-${item.id}`}
                    value={item.altText}
                    disabled={item.status === "succeeded"}
                    aria-invalid={normalizeAltText(item.altText) === null}
                    onChange={(event) =>
                      dispatch({
                        type: "altText",
                        id: item.id,
                        altText: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              </div>
              {item.status === "failed" ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs text-destructive">{item.error}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => dispatch({ type: "retry", id: item.id })}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <ImagePlusIcon aria-hidden="true" className="mx-auto mb-2" />
          No images yet. Add one or more to build this vehicle&apos;s gallery.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((image, index) => (
                <SortableCard
                  key={image.id}
                  image={image}
                  index={index}
                  total={images.length}
                  busy={busy}
                  pendingId={pending}
                  confirming={confirmingDelete === image.id}
                  canEarlier={canMove(images, image.id, "earlier")}
                  canLater={canMove(images, image.id, "later")}
                  onMove={onMove}
                  onSetCover={onSetCover}
                  onEditAlt={onEditAlt}
                  onRequestDelete={() => setConfirmingDelete(image.id)}
                  onCancelDelete={() => setConfirmingDelete(null)}
                  onConfirmDelete={() => onDelete(image.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {queue.length > 0 && !allAltTextValid(queue) ? (
        <p role="status" className="text-xs text-amber-700">
          Add a description to every image before it can upload.
        </p>
      ) : null}
    </section>
  );
}

function uploadStatusLabel(item: QueuedUpload): string {
  switch (item.status) {
    case "waiting":
      return normalizeAltText(item.altText) === null
        ? "Waiting — add a description"
        : "Waiting…";
    case "compressing":
      return "Compressing…";
    case "authorizing":
      return "Authorizing…";
    case "uploading":
      return `Uploading… ${item.progress}%`;
    case "attaching":
      return "Attaching…";
    case "succeeded":
      return "Added";
    case "failed":
      return "Failed";
    default:
      return "";
  }
}

interface CardProps {
  readonly image: GalleryImage;
  readonly index: number;
  readonly total: number;
  readonly busy: boolean;
  readonly pendingId: string | null;
  readonly confirming: boolean;
  readonly canEarlier: boolean;
  readonly canLater: boolean;
  readonly onMove: (id: string, direction: "earlier" | "later") => void;
  readonly onSetCover: (id: string) => void;
  readonly onEditAlt: (id: string, value: string) => void;
  readonly onRequestDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

function SortableCard(props: CardProps) {
  const { image, index, total, busy } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });
  const [altDraft, setAltDraft] = useState(image.altText ?? "");

  useEffect(() => {
    setAltDraft(image.altText ?? "");
  }, [image.altText]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="space-y-2 rounded-lg border bg-card p-2"
    >
      <div className="relative">
        <Image
          loader={cloudinaryLoader}
          src={image.url}
          alt={image.altText ?? ""}
          width={image.width}
          height={image.height}
          sizes="(min-width: 640px) 12rem, 45vw"
          className="aspect-video w-full rounded object-cover"
        />
        <span
          className={`absolute top-1 left-1 rounded px-1.5 py-0.5 text-xs font-medium ${
            image.isCover
              ? "bg-brand-gold-foreground text-white"
              : "bg-black/60 text-white"
          }`}
        >
          {image.isCover ? "★ Cover" : `#${index + 1}`}
        </span>
        <button
          type="button"
          className="absolute top-1 right-1 cursor-grab rounded bg-black/60 px-1.5 py-0.5 text-xs text-white"
          aria-label={`Drag to reorder ${image.altText ?? "image"}`}
          {...attributes}
          {...listeners}
        >
          Drag
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !props.canEarlier}
          onClick={() => props.onMove(image.id, "earlier")}
          aria-label={`Move ${image.altText ?? "image"} earlier`}
        >
          ← Earlier
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !props.canLater}
          onClick={() => props.onMove(image.id, "later")}
          aria-label={`Move ${image.altText ?? "image"} later`}
        >
          Later →
        </Button>
        <Button
          type="button"
          size="sm"
          variant={image.isCover ? "secondary" : "outline"}
          disabled={busy || image.isCover}
          onClick={() => props.onSetCover(image.id)}
          aria-label={`Set ${image.altText ?? "image"} as cover`}
        >
          <StarIcon aria-hidden="true" /> Cover
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`edit-alt-${image.id}`} className="text-xs">
          Description
        </Label>
        <Input
          id={`edit-alt-${image.id}`}
          value={altDraft}
          onChange={(event) => setAltDraft(event.currentTarget.value)}
          aria-invalid={normalizeAltText(altDraft) === null}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || altDraft.trim() === (image.altText ?? "").trim()}
          onClick={() => props.onEditAlt(image.id, altDraft)}
        >
          Save description
        </Button>
      </div>

      {props.confirming ? (
        <div className="flex items-center gap-2" role="group">
          <span className="text-xs">
            Delete image #{index + 1} of {total}?
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={props.onConfirmDelete}
          >
            Confirm
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={props.onCancelDelete}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={props.onRequestDelete}
          aria-label={`Delete ${image.altText ?? "image"}`}
        >
          <Trash2Icon aria-hidden="true" /> Delete
        </Button>
      )}
    </li>
  );
}
