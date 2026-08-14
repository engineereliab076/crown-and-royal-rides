import {
  adminRouteOptions,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { getVehicleImageService } from "@/server/vehicle-images/services";

interface RouteContext {
  params: Promise<{ id: string; imageId: string }>;
}

/** Update an image's alternative text (strict, non-empty). */
export const PATCH = withRouteHandler<RouteContext>(
  async (request, context) => {
    const { actor } = await requireAdmin({ capability: "media:manage" });
    const { id, imageId } = await context.params;
    const body = (await readJsonBody(request)) as { altText?: unknown } | null;
    const image = await getVehicleImageService().updateAltText(actor, {
      vehicleId: id,
      imageId,
      altText: body?.altText,
    });
    return privateJson({ image });
  },
  adminRouteOptions(),
);
