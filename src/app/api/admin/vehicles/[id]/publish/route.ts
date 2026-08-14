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
  vehicleActionSchema,
  vehicleParamsSchema,
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
    parseApiInput(
      vehicleActionSchema,
      await readJsonBody(request, { allowEmpty: true }),
      "Invalid publish request.",
    );
    const vehicle = await getAdminServices().vehicleService.publish(actor, id, {
      correlationId: execution.correlationId,
      actorId: actor.id,
    });
    return privateJson({ vehicle });
  },
  adminRouteOptions(),
);
