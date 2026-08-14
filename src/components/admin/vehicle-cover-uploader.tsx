"use client";

import { ImagePlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  validateVehicleCoverFile,
  VEHICLE_COVER_ACCEPT,
} from "@/lib/vehicle-cover-file";

interface UploadAuthorization {
  readonly uploadUrl: string;
  readonly apiKey: string;
  readonly timestamp: number;
  readonly signature: string;
  readonly publicId: string;
  readonly uploadPublicId: string;
  readonly folder: string;
  readonly allowedFormats: readonly string[];
  readonly maxBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly transformation: string;
}

interface CloudinaryUploadResponse {
  readonly public_id?: unknown;
  readonly version?: unknown;
  readonly signature?: unknown;
}

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

export function VehicleCoverUploader({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0] ?? null;
    setError(null);
    setStatus(null);
    if (selected === null) {
      clearFile();
      return;
    }
    const problem = validateVehicleCoverFile(selected);
    if (problem !== null) {
      clearFile();
      setError(problem);
      return;
    }
    setFile(selected);
  }

  async function upload() {
    if (file === null || busy) return;
    setBusy(true);
    setError(null);
    setStatus("Requesting secure upload authorization…");
    try {
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
        authorization: UploadAuthorization;
      };
      if (file.size > authorization.maxBytes) {
        throw new Error("The image exceeds the authorized file-size limit.");
      }

      setStatus("Uploading cover image…");
      const data = new FormData();
      data.set("file", file);
      data.set("api_key", authorization.apiKey);
      data.set("timestamp", String(authorization.timestamp));
      data.set("signature", authorization.signature);
      data.set("folder", authorization.folder);
      data.set("public_id", authorization.uploadPublicId);
      data.set("allowed_formats", authorization.allowedFormats.join(","));
      data.set("overwrite", "false");
      data.set("transformation", authorization.transformation);
      data.set("type", "upload");
      const providerResponse = await fetch(authorization.uploadUrl, {
        method: "POST",
        body: data,
      });
      if (!providerResponse.ok) {
        throw new Error("The image provider could not accept the upload.");
      }
      const provider =
        (await providerResponse.json()) as CloudinaryUploadResponse;
      if (
        typeof provider.public_id !== "string" ||
        provider.public_id !== authorization.publicId ||
        !Number.isSafeInteger(provider.version) ||
        typeof provider.signature !== "string"
      ) {
        throw new Error("The completed upload response was invalid.");
      }

      setStatus("Verifying and attaching cover image…");
      const attachResponse = await fetch(
        `/api/admin/vehicles/${vehicleId}/cover`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicId: provider.public_id,
            version: provider.version,
            signature: provider.signature,
          }),
        },
      );
      if (!attachResponse.ok) {
        throw new Error(
          await safeError(
            attachResponse,
            "The verified cover could not be attached.",
          ),
        );
      }
      clearFile();
      setStatus("Cover image attached.");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The cover image could not be uploaded.",
      );
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div>
        <h3 className="text-sm font-semibold">Upload cover image</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          One JPEG, PNG, or WebP image, up to 10 MB and 6000 × 6000 pixels.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vehicle-cover">Cover image file</Label>
        <Input
          ref={inputRef}
          id="vehicle-cover"
          type="file"
          accept={VEHICLE_COVER_ACCEPT}
          disabled={busy}
          onChange={selectFile}
        />
      </div>
      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" onClick={upload} disabled={busy || file === null}>
        <ImagePlusIcon aria-hidden="true" />
        {busy ? "Uploading…" : "Upload cover"}
      </Button>
    </div>
  );
}
