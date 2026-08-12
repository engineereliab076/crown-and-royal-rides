import { describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import {
  administratorActionSchema,
  administratorListSchema,
  createAdministratorSchema,
  setAdministratorRoleSchema,
} from "@/server/modules/administrators/schemas";

describe("administrator schemas", () => {
  it("normalizes email and trims a valid name", () => {
    expect(
      createAdministratorSchema.parse({
        email: "  Admin@Example.COM ",
        name: "  Example Admin  ",
        role: AdminRole.manager,
      }),
    ).toEqual({
      email: "admin@example.com",
      name: "Example Admin",
      role: AdminRole.manager,
    });
  });

  it("rejects server-controlled and actor fields", () => {
    for (const field of [
      "passwordHash",
      "sessionVersion",
      "isActive",
      "createdAt",
      "actorId",
    ]) {
      expect(
        createAdministratorSchema.safeParse({
          email: "admin@example.com",
          name: "Example Admin",
          role: AdminRole.manager,
          [field]: "attacker-controlled",
        }).success,
      ).toBe(false);
    }
    expect(
      administratorActionSchema.safeParse({ actorId: "fake" }).success,
    ).toBe(false);
  });

  it("accepts only Prisma roles and strict list filters", () => {
    expect(
      setAdministratorRoleSchema.safeParse({ role: "staff" }).success,
    ).toBe(false);
    expect(
      administratorListSchema.parse({
        page: "2",
        limit: "10",
        role: "owner",
        isActive: "false",
      }),
    ).toEqual({ page: 2, limit: 10, role: "owner", isActive: false });
    expect(
      administratorListSchema.safeParse({ page: "1", unexpected: "x" }).success,
    ).toBe(false);
  });
});
