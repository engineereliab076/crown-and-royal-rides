import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { mediaSignatureRequestSchema } from "@/server/modules/vehicles/schemas";

export const POST = withRouteHandler(async (request) => {
  const { actor } = await requireAdmin({ capability: "media:manage" });
  const { vehicleId } = parseApiInput(
    mediaSignatureRequestSchema,
    await readJsonBody(request),
    "Invalid upload authorization request.",
  );
  const authorization =
    await getAdminServices().vehicleMediaService.createCoverUploadAuthorization(
      actor,
      vehicleId,
    );
  return privateJson({ authorization });
}, adminRouteOptions());
