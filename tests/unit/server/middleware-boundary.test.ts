import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Static import-boundary guard for the Edge middleware.
 *
 * The middleware (and the edge config it imports) must remain free of Prisma,
 * the auth repository/service/rate-limiter, capabilities/business rules, Argon2,
 * Node-only session APIs, and provider SDKs. All authoritative checks happen in
 * Node (session callback, layout, guard, services) — never at the edge.
 */

function importSources(relativePath: string): string[] {
  const source = readFileSync(
    new URL(`../../../${relativePath}`, import.meta.url),
    "utf8",
  );
  const sources: string[] = [];
  const pattern = /(?:from|import)\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1] !== undefined) sources.push(match[1]);
  }
  return sources;
}

const FORBIDDEN_EXACT = new Set([
  "@/server/auth", // the full (Node) Auth.js config
  "argon2",
  "next/headers",
]);

const FORBIDDEN_PREFIXES = [
  "@/server/db",
  "@/generated/prisma",
  "@prisma/",
  "@/server/modules/auth/repository",
  "@/server/modules/auth/service",
  "@/server/modules/auth/rate-limit",
  "@/server/modules/auth/password",
  "@/server/modules/auth/capabilities",
  "@/server/auth/services",
  "@/server/auth/callbacks",
  "@/server/integrations/",
  "cloudinary",
  "resend",
  "@upstash/",
  "@sentry/",
];

function assertClean(relativePath: string): void {
  for (const source of importSources(relativePath)) {
    expect(
      FORBIDDEN_EXACT.has(source),
      `${relativePath} imports ${source}`,
    ).toBe(false);
    for (const prefix of FORBIDDEN_PREFIXES) {
      expect(
        source.startsWith(prefix),
        `${relativePath} imports ${source}`,
      ).toBe(false);
    }
  }
}

describe("middleware import boundary", () => {
  it("src/middleware.ts imports no prohibited server/database modules", () => {
    assertClean("src/middleware.ts");
  });

  it("src/server/auth/edge-config.ts (imported by middleware) stays edge-safe", () => {
    assertClean("src/server/auth/edge-config.ts");
  });

  it("the middleware only pulls in Auth.js and the edge config", () => {
    const sources = importSources("src/middleware.ts");
    expect(sources).toContain("next-auth");
    expect(sources).toContain("@/server/auth/edge-config");
  });
});
