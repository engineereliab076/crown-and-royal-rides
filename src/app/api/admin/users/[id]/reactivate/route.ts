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
  administratorActionSchema,
  administratorParamsSchema,
} from "@/server/modules/administrators/schemas";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withRouteHandler<RouteContext>(
  async (request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "admin:manage" });
    const { id } = parseApiInput(
      administratorParamsSchema,
      await context.params,
      "Invalid administrator ID.",
    );
    parseApiInput(
      administratorActionSchema,
      await readJsonBody(request, { allowEmpty: true }),
      "Invalid reactivation request.",
    );
    const services = getAdminServices();
    const administrator = await services.administratorService.reactivate(
      actor,
      id,
      services.createRequestAuditContext(
        request.headers,
        execution.correlationId,
      ),
    );
    return privateJson({ administrator });
  },
  adminRouteOptions(),
);
