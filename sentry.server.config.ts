import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/env";

if (
  env.SENTRY_DSN !== undefined &&
  env.SENTRY_ENVIRONMENT !== undefined &&
  env.NEXT_PUBLIC_SENTRY_DSN !== undefined
) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    enabled: true,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}
