"use client";

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

const REQUIREMENT_LABELS: Readonly<Record<string, string>> = {
  coverImage: "a cover image",
  saleMode: "sale mode and status",
  salePrice: "a positive sale price",
  description: "a description of at least 40 characters",
};

export function VehiclePublishButton({
  vehicleId,
  published,
}: {
  vehicleId: string;
  published: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    if (submitting || published) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/publish`, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await response.json()) as {
        error?: { message?: unknown; details?: { missing?: unknown } };
      };
      if (!response.ok) {
        const missing = body.error?.details?.missing;
        if (Array.isArray(missing)) {
          const labels = missing
            .filter((item): item is string => typeof item === "string")
            .map((item) => REQUIREMENT_LABELS[item] ?? item);
          if (labels.length > 0)
            throw new Error(`Before publishing, add ${labels.join(", ")}.`);
        }
        throw new Error(
          typeof body.error?.message === "string"
            ? body.error.message
            : "The vehicle could not be published.",
        );
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The vehicle could not be published.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      <Button
        type="button"
        size="lg"
        onClick={publish}
        disabled={submitting || published}
      >
        <SendIcon aria-hidden="true" />
        {published
          ? "Published"
          : submitting
            ? "Publishing…"
            : "Publish vehicle"}
      </Button>
    </div>
  );
}
