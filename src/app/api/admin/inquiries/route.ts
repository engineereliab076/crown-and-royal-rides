import { getAdminServices } from "@/server/admin/services";
import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  queryObject,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { adminInquiryListQuerySchema } from "@/server/modules/inquiries/schemas";

export const GET = withRouteHandler(async (request) => {
  const { actor } = await requireAdmin({ capability: "inquiry:manage" });
  const query = queryObject(request.url);
  parseApiInput(adminInquiryListQuerySchema, query, "Invalid inquiry query.");
  const page = await getAdminServices().inquiryService.listAdmin(actor, query);
  return privateJson(page);
}, adminRouteOptions());
