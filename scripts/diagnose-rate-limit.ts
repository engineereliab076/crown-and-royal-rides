/**
 * Local, safe rate-limiter diagnostic (CLI).
 *
 * Run with:  pnpm diagnose:rate-limit
 * (which invokes `tsx --conditions react-server scripts/diagnose-rate-limit.ts`)
 *
 * It performs the minimal login-path rate-limit operation against the *already
 * configured* Upstash credentials in the current environment and prints a single
 * line: `PASS|FAIL <stableCode> <correlationId>`. It never prints the URL, token,
 * Redis key, response body, or any environment value, never opens a network
 * endpoint, and never modifies application or database data. If the credentials
 * are not present in the environment it reports RATE_LIMIT_CONFIGURATION_MISSING
 * without contacting any provider.
 */
import { createCorrelationId } from "@/lib/correlation";
import {
  formatProbeLine,
  runRateLimitProbe,
} from "@/server/diagnostics/rate-limit-probe";
import { UpstashRateLimiter } from "@/server/integrations/rate-limiter/upstash";

async function main(): Promise<void> {
  const correlationId = createCorrelationId();
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const namespace = process.env.RATE_LIMIT_NAMESPACE;

  if (!restUrl || !restToken || !namespace) {
    console.log(
      formatProbeLine({
        ok: false,
        code: "RATE_LIMIT_CONFIGURATION_MISSING",
        correlationId,
      }),
    );
    process.exitCode = 1;
    return;
  }

  let rateLimiter: UpstashRateLimiter;
  try {
    rateLimiter = new UpstashRateLimiter({ restUrl, restToken, namespace });
  } catch {
    console.log(
      formatProbeLine({
        ok: false,
        code: "RATE_LIMIT_CONFIGURATION_MISSING",
        correlationId,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const result = await runRateLimitProbe({ rateLimiter, correlationId });
  console.log(formatProbeLine(result));
  process.exitCode = result.ok ? 0 : 1;
}

void main();
