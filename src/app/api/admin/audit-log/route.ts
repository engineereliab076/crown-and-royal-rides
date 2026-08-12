import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  queryObject,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { auditLogListSchema } from "@/server/modules/audit-log/schemas";

export const GET = withRouteHandler(async (request) => {
  const { actor } = await requireAdmin({ capability: "audit:read" });
  const query = queryObject(request.url);
  parseApiInput(auditLogListSchema, query, "Invalid audit-log query.");
  const page = await getAdminServices().auditLogService.list(actor, query);
  return privateJson(page);
}, adminRouteOptions());
