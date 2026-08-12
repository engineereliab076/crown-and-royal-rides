import { describe, expect, it, vi } from "vitest";

import { createAdministratorRateLimiter } from "@/server/modules/administrators/rate-limit";
import type { RateLimiter } from "@/server/integrations/rate-limiter/interface";

describe("administrator password-reset rate limiting", () => {
  it("uses an HMAC-hashed namespaced key without raw IDs", async () => {
    const check = vi.fn<RateLimiter["check"]>().mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      resetAt: 1_000,
    });
    const limiter = createAdministratorRateLimiter({
      rateLimiter: { check },
      hashSecret: "a-secure-test-secret-at-least-32-characters",
    });
    await limiter.checkPasswordReset({
      actorId: "actor-id",
      targetId: "target-id",
    });

    const key = check.mock.calls[0]?.[0] ?? "";
    expect(key).toMatch(/^admin:password-reset:/);
    expect(key).not.toContain("actor-id");
    expect(key).not.toContain("target-id");
  });

  it("fails closed when the provider throws", async () => {
    const limiter = createAdministratorRateLimiter({
      rateLimiter: {
        check: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      },
      hashSecret: "a-secure-test-secret-at-least-32-characters",
    });
    await expect(
      limiter.checkPasswordReset({ actorId: "actor", targetId: "target" }),
    ).resolves.toEqual({ allowed: false });
  });
});
