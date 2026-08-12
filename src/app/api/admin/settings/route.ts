import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { updateBusinessSettingsSchema } from "@/server/modules/settings/schemas";

export const GET = withRouteHandler(async () => {
  const { actor } = await requireAdmin({ capability: "settings:update" });
  const settings = await getAdminServices().settingsService.get(actor);
  return privateJson({ settings });
}, adminRouteOptions());

export const PUT = withRouteHandler(async (request, _context, execution) => {
  const { actor } = await requireAdmin({ capability: "settings:update" });
  const body = parseApiInput(
    updateBusinessSettingsSchema,
    await readJsonBody(request),
    "Invalid business settings.",
  );
  const services = getAdminServices();
  const settings = await services.settingsService.update(
    actor,
    body,
    services.createRequestAuditContext(
      request.headers,
      execution.correlationId,
    ),
  );
  return privateJson({ settings });
}, adminRouteOptions());
