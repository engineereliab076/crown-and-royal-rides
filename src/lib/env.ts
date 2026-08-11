import "server-only";

import { parseEnv } from "@/lib/env.schema";

/**
 * The validated, immutable environment configuration.
 *
 * Parsed exactly once at module load from `process.env`. This module is
 * server-only: importing it from a Client Component is a build error, which
 * keeps secrets out of the browser bundle.
 */
export const env = parseEnv({ ...process.env });

export type { Environment } from "@/lib/env.schema";
