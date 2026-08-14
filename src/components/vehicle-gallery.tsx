"use client";

import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cloudinaryLoader } from "@/lib/cloudinary-loader";
import {
  initialIndex,
  lightboxKeyAction,
  resolveSwipe,
  stepIndex,
} from "@/lib/vehicle-lightbox";

export interface VehicleGalleryImage {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string | null;
  readonly isCover: boolean;
  readonly sortOrder: number;
}

interface Props {
  readonly images: readonly VehicleGalleryImage[];
  readonly title: string;
}

function altFor(
  image: VehicleGalleryImage,
  title: string,
  index: number,
): string {
  const trimmed = image.altText?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : `${title} — photo ${index + 1}`;
}

export function VehicleGallery({ images, title }: Props) {
  const ordered = [...images].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1),
  );
  const [selected, setSelected] = useState(() => initialIndex(ordered));
  const [open, setOpen] = useState(false);
  const [lightIndex, setLightIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const labelId = useId();
  const statusId = useId();

  const total = ordered.length;

  const openLightbox = useCallback((index: number) => {
    setLightIndex(index);
    setOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setOpen(false);
    // Return focus to the element that opened the dialog.
    triggerRef.current?.focus();
  }, []);

  const navigate = useCallback(
    (delta: number) =>
      setLightIndex((current) => stepIndex(current, delta, total)),
    [total],
  );

  // Focus the dialog on open; lock background scroll; restore on close.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const action = lightboxKeyAction(event.key);
      if (action === null) return;
      event.preventDefault();
      if (action === "close") closeLightbox();
      else navigate(action === "next" ? 1 : -1);
    },
    [closeLightbox, navigate],
  );

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchStartX.current;
      touchStartX.current = null;
      if (start === null) return;
      const end = event.changedTouches[0]?.clientX ?? start;
      const action = resolveSwipe(end - start);
      if (action === null) return;
      navigate(action === "next" ? 1 : -1);
    },
    [navigate],
  );

  if (total === 0) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl border bg-surface-subtle text-sm text-muted-foreground">
        Image unavailable
      </div>
    );
  }

  const main = ordered[selected] ?? ordered[0]!;
  const light = ordered[lightIndex] ?? ordered[0]!;

  return (
    <section aria-label={`${title} photos`} className="space-y-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => openLightbox(selected)}
        className="block w-full overflow-hidden rounded-2xl border bg-surface-raised shadow-soft focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${title} photo viewer`}
      >
        <Image
          loader={cloudinaryLoader}
          src={main.url}
          alt={altFor(main, title, selected)}
          width={main.width}
          height={main.height}
          sizes="(min-width: 1280px) 1152px, (min-width: 640px) calc(100vw - 3rem), calc(100vw - 2rem)"
          priority
          className="aspect-video w-full object-cover"
        />
      </button>

      {total > 1 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {ordered.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-current={index === selected}
                aria-label={`Show ${altFor(image, title, index)}`}
                className={`block w-full overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:ring-ring ${
                  index === selected
                    ? "ring-2 ring-brand-gold-foreground"
                    : "opacity-80 hover:opacity-100"
                }`}
              >
                <Image
                  loader={cloudinaryLoader}
                  src={image.url}
                  alt={altFor(image, title, index)}
                  width={image.width}
                  height={image.height}
                  sizes="(min-width: 640px) 8rem, 22vw"
                  className="aspect-video w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          onClick={closeLightbox}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            aria-describedby={statusId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="relative flex h-full w-full flex-col outline-none"
          >
            <div className="flex items-center justify-between p-4 text-white">
              <h2 id={labelId} className="text-sm font-medium">
                {title}
              </h2>
              <p id={statusId} aria-live="polite" className="text-sm">
                Image {lightIndex + 1} of {total}
              </p>
              <button
                ref={closeRef}
                type="button"
                onClick={closeLightbox}
                aria-label="Close photo viewer"
                className="rounded-full p-2 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
              >
                <XIcon aria-hidden="true" />
              </button>
            </div>

            <div className="relative flex flex-1 items-center justify-center px-4 pb-6">
              {total > 1 ? (
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  aria-label="Previous image"
                  className="absolute left-2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
                >
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
              ) : null}
              <Image
                loader={cloudinaryLoader}
                src={light.url}
                alt={altFor(light, title, lightIndex)}
                width={light.width}
                height={light.height}
                sizes="100vw"
                className="max-h-full max-w-full object-contain"
              />
              {total > 1 ? (
                <button
                  type="button"
                  onClick={() => navigate(1)}
                  aria-label="Next image"
                  className="absolute right-2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
                >
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
