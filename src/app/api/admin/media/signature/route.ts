import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { uploadAuthorizationRequestSchema } from "@/server/modules/vehicle-images/schemas";
import { getVehicleImageService } from "@/server/vehicle-images/services";

export const POST = withRouteHandler(async (request) => {
  const { actor } = await requireAdmin({ capability: "media:manage" });
  const input = parseApiInput(
    uploadAuthorizationRequestSchema,
    await readJsonBody(request),
    "Invalid upload authorization request.",
  );
  const authorization =
    await getVehicleImageService().createUploadAuthorization(actor, input);
  return privateJson({ authorization });
}, adminRouteOptions());
