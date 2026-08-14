import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  queryObject,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import {
  createVehicleSchema,
  vehicleListQuerySchema,
} from "@/server/modules/vehicles/schemas";

export const GET = withRouteHandler(async (request) => {
  const { actor } = await requireAdmin({ capability: "content:manage" });
  const query = queryObject(request.url);
  parseApiInput(vehicleListQuerySchema, query, "Invalid vehicle query.");
  const page = await getAdminServices().vehicleService.listAdmin(actor, query);
  return privateJson(page);
}, adminRouteOptions());

export const POST = withRouteHandler(async (request) => {
  const { actor } = await requireAdmin({ capability: "content:manage" });
  const body = parseApiInput(
    createVehicleSchema,
    await readJsonBody(request),
    "Invalid vehicle details.",
  );
  const vehicle = await getAdminServices().vehicleService.create(actor, body);
  return privateJson({ vehicle }, { status: 201 });
}, adminRouteOptions());
