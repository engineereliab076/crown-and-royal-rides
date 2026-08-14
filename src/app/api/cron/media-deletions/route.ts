import { privateJson } from "@/server/http/admin-api";
import { requireCronAuthorization } from "@/server/http/cron-guard";
import { withRouteHandler } from "@/server/http/handler";
import { getIntegrationContainer } from "@/server/integrations/container";
import { getMediaDeletionRetryService } from "@/server/media-deletion-queue/services";

/**
 * Cron endpoint that drains the media-deletion outbox (Phase 4, Group 2).
 *
 * Authenticated purely by `Authorization: Bearer <CRON_SECRET>` — no admin
 * cookie and no browser-origin check (a server-to-server request has no Origin).
 * The response carries only safe aggregate counts and is never cached.
 */
export const POST = withRouteHandler(
  async (request) => {
    requireCronAuthorization(request);
    const result = await getMediaDeletionRetryService().process();
    return privateJson({ result });
  },
  {
    // Server-to-server: exempt from browser-origin validation. Authorization is
    // the bearer secret, checked inside the handler.
    origin: { mode: "exempt" },
    errorReporter: () => getIntegrationContainer().errorReporter,
  },
);
