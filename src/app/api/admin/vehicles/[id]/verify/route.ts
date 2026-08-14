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
export const POST = withRouteHandler<RouteContext>(async (request, context) => {
  const { actor } = await requireAdmin({ capability: "content:manage" });
  const { id } = parseApiInput(
    vehicleParamsSchema,
    await context.params,
    "Invalid vehicle ID.",
  );
  parseApiInput(
    vehicleActionSchema,
    await readJsonBody(request, { allowEmpty: true }),
    "Invalid verification request.",
  );
  const vehicle = await getAdminServices().vehicleService.markVerified(actor, {
    vehicleId: id,
  });
  return privateJson({ vehicle });
}, adminRouteOptions());
