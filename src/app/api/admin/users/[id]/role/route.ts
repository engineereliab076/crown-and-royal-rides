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
  administratorParamsSchema,
  setAdministratorRoleSchema,
} from "@/server/modules/administrators/schemas";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PATCH = withRouteHandler<RouteContext>(
  async (request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "admin:manage" });
    const { id } = parseApiInput(
      administratorParamsSchema,
      await context.params,
      "Invalid administrator ID.",
    );
    const body = parseApiInput(
      setAdministratorRoleSchema,
      await readJsonBody(request),
      "Invalid administrator role change.",
    );
    const services = getAdminServices();
    const administrator = await services.administratorService.setRole(
      actor,
      id,
      body,
      services.createRequestAuditContext(
        request.headers,
        execution.correlationId,
      ),
    );
    return privateJson({ administrator });
  },
  adminRouteOptions(),
);
