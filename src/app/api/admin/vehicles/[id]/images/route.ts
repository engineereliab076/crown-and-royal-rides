import {
  adminRouteOptions,
  parseApiInput,
  privateJson,
  readJsonBody,
} from "@/server/http/admin-api";
import { requireAdmin } from "@/server/http/auth-guard";
import { withRouteHandler } from "@/server/http/handler";
import { vehicleParamsSchema } from "@/server/modules/vehicles/schemas";
import { getVehicleImageService } from "@/server/vehicle-images/services";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** List the vehicle's gallery plus the parent `updatedAt` for concurrency. */
export const GET = withRouteHandler<RouteContext>(async (_request, context) => {
  const { actor } = await requireAdmin({ capability: "media:manage" });
  const { id } = parseApiInput(
    vehicleParamsSchema,
    await context.params,
    "Invalid vehicle ID.",
  );
  const gallery = await getVehicleImageService().getGallery(actor, {
    vehicleId: id,
  });
  return privateJson({ gallery });
}, adminRouteOptions());

/** Attach a verified upload to the gallery (201). */
export const POST = withRouteHandler<RouteContext>(
  async (request, context, execution) => {
    const { actor } = await requireAdmin({ capability: "media:manage" });
    const { id } = parseApiInput(
      vehicleParamsSchema,
      await context.params,
      "Invalid vehicle ID.",
    );
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const image = await getVehicleImageService().attach(
      actor,
      { vehicleId: id, upload: body?.upload, altText: body?.altText },
      { correlationId: execution.correlationId },
    );
    return privateJson({ image }, { status: 201 });
  },
  adminRouteOptions(),
);
