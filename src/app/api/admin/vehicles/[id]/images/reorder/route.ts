import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { vehicleParamsSchema } from "@/server/modules/vehicles/schemas";
import { getVehicleImageService } from "@/server/vehicle-images/services";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Persist a whole-gallery reorder as one batch, with optimistic concurrency. */
export const PATCH = withRouteHandler<RouteContext>(
  async (request, context) => {
    const { actor } = await requireAdmin({ capability: "media:manage" });
    const { id } = parseApiInput(
      vehicleParamsSchema,
      await context.params,
      "Invalid vehicle ID.",
    );
    const body = (await readJsonBody(request)) as {
      imageIds?: unknown;
      expectedUpdatedAt?: unknown;
    } | null;
    const gallery = await getVehicleImageService().reorder(actor, {
      vehicleId: id,
      imageIds: body?.imageIds,
      expectedUpdatedAt: body?.expectedUpdatedAt,
    });
    return privateJson({ gallery });
  },
  adminRouteOptions(),
);
