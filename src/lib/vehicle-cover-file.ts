export const VEHICLE_COVER_ACCEPT = "image/jpeg,image/png,image/webp";
export const VEHICLE_COVER_MAX_BYTES = 10 * 1024 * 1024;

export function validateVehicleCoverFile(file: {
  readonly type: string;
  readonly size: number;
}): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size <= 0 || file.size > VEHICLE_COVER_MAX_BYTES) {
    return "The image must be no larger than 10 MB.";
  }
  return null;
}
