import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { vehicleParamsSchema } from "@/server/modules/vehicles/schemas";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withRouteHandler<RouteContext>(async (_request, context) => {
  const { actor } = await requireAdmin({ capability: "content:manage" });
  const { id } = parseApiInput(
    vehicleParamsSchema,
    await context.params,
    "Invalid vehicle ID.",
  );
  const vehicle = await getAdminServices().vehicleService.getAdminById(
    actor,
    id,
  );
  return privateJson({ vehicle });
}, adminRouteOptions());
