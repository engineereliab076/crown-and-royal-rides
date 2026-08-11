import type {
  CreateUploadSignatureInput,
  DeleteOutcome,
  MediaTransform,
  UploadResult,
  UploadSignature,
  VerifiedAsset,
} from "@/server/integrations/media-storage/types";

export interface MediaStorage {
  createUploadSignature(
    input: CreateUploadSignatureInput,
  ): Promise<UploadSignature>;

  verifyUploadResult(result: UploadResult): Promise<VerifiedAsset>;

  deleteAsset(publicId: string): Promise<DeleteOutcome>;

  buildDeliveryUrl(publicId: string, transform?: MediaTransform): string;
}
