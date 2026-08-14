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
  brandParamsSchema,
  updateBrandSchema,
} from "@/server/modules/brands/schemas";

interface RouteContext {
  params: Promise<{ id: string }>;
}
export const PATCH = withRouteHandler<RouteContext>(
  async (request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "content:manage" });
    const { id } = parseApiInput(
      brandParamsSchema,
      await context.params,
      "Invalid brand ID.",
    );
    const body = parseApiInput(
      updateBrandSchema,
      await readJsonBody(request),
      "Invalid brand update.",
    );
    const services = getAdminServices();
    const brand = await services.brandService.update(
      actor,
      id,
      body,
      services.createRequestAuditContext(
        request.headers,
        execution.correlationId,
      ),
    );
    return privateJson({ brand });
  },
  adminRouteOptions(),
);

export const DELETE = withRouteHandler<RouteContext>(
  async (request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "content:manage" });
    const { id } = parseApiInput(
      brandParamsSchema,
      await context.params,
      "Invalid brand ID.",
    );
    const services = getAdminServices();
    const brand = await services.brandService.remove(
      actor,
      id,
      services.createRequestAuditContext(
        request.headers,
        execution.correlationId,
      ),
    );
    return privateJson({ brand });
  },
  adminRouteOptions(),
);
