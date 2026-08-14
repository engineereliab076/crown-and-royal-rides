import { describe, expect, it, vi } from "vitest";

const { CRON_SECRET } = vi.hoisted(() => ({
  CRON_SECRET: "test-cron-secret-value-1234567890-abcdefghij",
}));

vi.mock("@/lib/env", () => ({ env: { CRON_SECRET } }));

import { requireCronAuthorization } from "@/server/http/cron-guard";

function request(authorization?: string): Request {
  return new Request("http://localhost:3000/api/cron/media-deletions", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("cron authorization guard", () => {
  it("accepts the exact bearer secret", () => {
    expect(() =>
      requireCronAuthorization(request(`Bearer ${CRON_SECRET}`)),
    ).not.toThrow();
  });

  it("rejects a missing authorization header with 401", () => {
    expect(() => requireCronAuthorization(request())).toThrow(
      expect.objectContaining({ status: 401, code: "CRON_UNAUTHORIZED" }),
    );
  });

  it("rejects a wrong secret with 401", () => {
    expect(() =>
      requireCronAuthorization(request("Bearer wrong-secret")),
    ).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("rejects a non-bearer scheme with 401", () => {
    expect(() =>
      requireCronAuthorization(request(`Basic ${CRON_SECRET}`)),
    ).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("never includes the secret in the thrown error", () => {
    try {
      requireCronAuthorization(request("Bearer nope"));
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(CRON_SECRET);
    }
  });
});
