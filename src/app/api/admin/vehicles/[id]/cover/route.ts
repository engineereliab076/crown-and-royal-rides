import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import {
  completedVehicleUploadSchema,
  vehicleParamsSchema,
} from "@/server/modules/vehicles/schemas";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withRouteHandler<RouteContext>(
  async (request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "media:manage" });
    const { id } = parseApiInput(
      vehicleParamsSchema,
      await context.params,
      "Invalid vehicle ID.",
    );
    const completedUpload = parseApiInput(
      completedVehicleUploadSchema,
      await readJsonBody(request),
      "Invalid completed upload.",
    );
    const vehicle = await getAdminServices().vehicleMediaService.attachCover(
      actor,
      id,
      completedUpload,
      { correlationId: execution.correlationId, actorId: actor.id },
    );
    return privateJson({ vehicle });
  },
  adminRouteOptions(),
);
