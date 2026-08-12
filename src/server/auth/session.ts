import "server-only";

import { cache } from "react";

/** Request-scoped reuse of the database-validated Auth.js session. */
export const getValidatedAdminSession = cache(async () => {
  const { auth } = await import("@/server/auth");
  return auth();
});
