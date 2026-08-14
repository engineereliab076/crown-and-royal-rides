import { withRouteHandler } from "@/server/http/handler";
import { getPublicSettings } from "@/server/settings/services";

export const GET = withRouteHandler(async () => {
  const settings = await getPublicSettings();
  return Response.json({ settings }, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  });
}, { origin: { mode: "exempt" } });
