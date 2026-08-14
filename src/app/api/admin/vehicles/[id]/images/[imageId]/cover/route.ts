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

/** Promote an image to cover, with optimistic concurrency. */
export const POST = withRouteHandler<RouteContext>(async (request, context) => {
  const { actor } = await requireAdmin({ capability: "media:manage" });
  const { id, imageId } = await context.params;
  const body = (await readJsonBody(request)) as {
    expectedUpdatedAt?: unknown;
  } | null;
  const gallery = await getVehicleImageService().setCover(actor, {
    vehicleId: id,
    imageId,
    expectedUpdatedAt: body?.expectedUpdatedAt,
  });
  return privateJson({ gallery });
}, adminRouteOptions());
