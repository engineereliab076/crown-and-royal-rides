/**
 * Browser upload client (Phase 4, Group 3).
 *
 * Performs the direct-to-provider upload with a real `XMLHttpRequest` so the UI
 * can report genuine 0–100 per-file progress (never fabricated). Nothing here is
 * persisted to any browser storage: the short-lived authorization is used once
 * and discarded. The completed-upload envelope returned to the caller carries
 * only the minimal fields the server re-verifies.
 */

export interface UploadAuthorization {
  readonly uploadUrl: string;
  readonly apiKey: string;
  readonly timestamp: number;
  readonly signature: string;
  readonly publicId: string;
  readonly uploadPublicId: string;
  readonly folder: string;
  readonly allowedFormats: readonly string[];
  readonly maxBytes: number;
  readonly transformation: string;
}

export interface CompletedUpload {
  readonly publicId: string;
  readonly version: number;
  readonly signature: string;
}

export interface UploadToProviderParams {
  readonly authorization: UploadAuthorization;
  readonly blob: Blob;
  readonly fileName: string;
  readonly onProgress?: (percent: number) => void;
  readonly signal?: AbortSignal;
}

interface ProviderResponse {
  readonly public_id?: unknown;
  readonly version?: unknown;
  readonly signature?: unknown;
}

/**
 * Upload a compressed blob to the provider using the signed authorization,
 * resolving with the minimal completion envelope. Rejects with a safe, generic
 * Error (no provider body) on any failure.
 */
export function uploadToProvider(
  params: UploadToProviderParams,
): Promise<CompletedUpload> {
  const { authorization, blob, fileName, onProgress, signal } = params;
  if (blob.size > authorization.maxBytes) {
    return Promise.reject(
      new Error("The image exceeds the authorized file-size limit."),
    );
  }

  return new Promise<CompletedUpload>((resolve, reject) => {
    const form = new FormData();
    form.set("file", blob, fileName);
    form.set("api_key", authorization.apiKey);
    form.set("timestamp", String(authorization.timestamp));
    form.set("signature", authorization.signature);
    form.set("folder", authorization.folder);
    form.set("public_id", authorization.uploadPublicId);
    form.set("allowed_formats", authorization.allowedFormats.join(","));
    form.set("overwrite", "false");
    form.set("transformation", authorization.transformation);
    form.set("type", "upload");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", authorization.uploadUrl, true);

    if (signal !== undefined) {
      if (signal.aborted) {
        xhr.abort();
        reject(new Error("The upload was cancelled."));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (onProgress === undefined) return;
      const percent = event.lengthComputable
        ? (event.loaded / event.total) * 100
        : 0;
      onProgress(Math.min(100, Math.max(0, Math.round(percent))));
    };

    xhr.onerror = () =>
      reject(new Error("The image provider could not be reached."));
    xhr.onabort = () => reject(new Error("The upload was cancelled."));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error("The image provider could not accept the upload."));
        return;
      }
      let parsed: ProviderResponse;
      try {
        parsed = JSON.parse(xhr.responseText) as ProviderResponse;
      } catch {
        reject(new Error("The completed upload response was invalid."));
        return;
      }
      if (
        typeof parsed.public_id !== "string" ||
        parsed.public_id !== authorization.publicId ||
        !Number.isSafeInteger(parsed.version) ||
        typeof parsed.signature !== "string"
      ) {
        reject(new Error("The completed upload response was invalid."));
        return;
      }
      onProgress?.(100);
      resolve({
        publicId: parsed.public_id,
        version: parsed.version as number,
        signature: parsed.signature,
      });
    };

    xhr.send(form);
  });
}
