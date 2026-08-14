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
  vehicleParamsSchema,
  vehicleTransitionSchema,
} from "@/server/modules/vehicles/schemas";

interface RouteContext {
  params: Promise<{ id: string }>;
}
export const POST = withRouteHandler<RouteContext>(
  async (request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "content:manage" });
    const { id } = parseApiInput(
      vehicleParamsSchema,
      await context.params,
      "Invalid vehicle ID.",
    );
    const { action } = parseApiInput(
      vehicleTransitionSchema,
      await readJsonBody(request),
      "Invalid vehicle transition.",
    );
    const vehicle = await getAdminServices().vehicleService.transitionVehicle(
      actor,
      { vehicleId: id, action },
      { correlationId: execution.correlationId, actorId: actor.id },
    );
    return privateJson({ vehicle });
  },
  adminRouteOptions(),
);
