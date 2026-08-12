import { describe, expect, it } from "vitest";

import { passwordSchema } from "@/server/modules/auth/schemas";
import { generateTemporaryPassword } from "@/server/modules/administrators/temporary-password";

describe("generateTemporaryPassword", () => {
  it("always satisfies the approved password schema", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(
        passwordSchema.safeParse(generateTemporaryPassword()).success,
      ).toBe(true);
    }
  });

  it("produces distinct passwords across calls", () => {
    const generated = new Set(
      Array.from({ length: 100 }, () => generateTemporaryPassword()),
    );
    expect(generated.size).toBe(100);
  });
});
