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
  administratorListSchema,
  createAdministratorSchema,
} from "@/server/modules/administrators/schemas";

export const GET = withRouteHandler(async (request) => {
  const { actor } = await requireAdmin({ capability: "admin:manage" });
  const query = queryObject(request.url);
  parseApiInput(administratorListSchema, query, "Invalid administrator query.");
  const page = await getAdminServices().administratorService.list(actor, query);
  return privateJson(page);
}, adminRouteOptions());

export const POST = withRouteHandler(async (request, _context, execution) => {
  const { actor } = await requireAdmin({ capability: "admin:manage" });
  const body = parseApiInput(
    createAdministratorSchema,
    await readJsonBody(request),
    "Invalid administrator details.",
  );
  const services = getAdminServices();
  const result = await services.administratorService.createAdmin(
    actor,
    body,
    services.createRequestAuditContext(
      request.headers,
      execution.correlationId,
    ),
  );
  return privateJson(result, { status: 201 });
}, adminRouteOptions());
