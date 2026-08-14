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
  featureVehicleSchema,
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
  const { featured } = parseApiInput(
    featureVehicleSchema,
    await readJsonBody(request),
    "Invalid featured request.",
  );
  const vehicle = await getAdminServices().vehicleService.setFeatured(actor, {
    vehicleId: id,
    featured,
  });
  return privateJson({ vehicle });
}, adminRouteOptions());
