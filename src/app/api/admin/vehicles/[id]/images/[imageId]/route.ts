import { adminRouteOptions, privateJson } from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { getVehicleImageService } from "@/server/vehicle-images/services";

interface RouteContext {
  params: Promise<{ id: string; imageId: string }>;
}

/** Remove an image and return the refreshed gallery state. */
export const DELETE = withRouteHandler<RouteContext>(
  async (_request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "media:manage" });
    const { id, imageId } = await context.params;
    const gallery = await getVehicleImageService().remove(
      actor,
      { vehicleId: id, imageId },
      { correlationId: execution.correlationId },
    );
    return privateJson({ gallery });
  },
  adminRouteOptions(),
);
