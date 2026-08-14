import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { createBrandSchema } from "@/server/modules/brands/schemas";

export const GET = withRouteHandler(async () => {
  const { actor } = await requireAdmin({ capability: "content:manage" });
  return privateJson({
    brands: await getAdminServices().brandService.list(actor),
  });
}, adminRouteOptions());

export const POST = withRouteHandler(async (request, _context, execution) => {
  const { actor } = await requireAdmin({ capability: "content:manage" });
  const body = parseApiInput(
    createBrandSchema,
    await readJsonBody(request),
    "Invalid brand details.",
  );
  const services = getAdminServices();
  const brand = await services.brandService.create(
    actor,
    body,
    services.createRequestAuditContext(
      request.headers,
      execution.correlationId,
    ),
  );
  return privateJson({ brand }, { status: 201 });
}, adminRouteOptions());
