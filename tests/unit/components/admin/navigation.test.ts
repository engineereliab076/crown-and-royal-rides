import { describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import {
  ADMIN_NAVIGATION,
  getAdminNavigation,
} from "@/components/admin/navigation";

const OWNER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("admin navigation", () => {
  it("shows owner-only destinations to owners", () => {
    expect(
      getAdminNavigation({ id: OWNER_ID, role: AdminRole.owner }).map(
        ({ label }) => label,
      ),
    ).toEqual([
      "Dashboard",
      "Vehicles",
      "Inquiries",
      "Users",
      "Audit Log",
      "Settings",
    ]);
  });

  it("shows managers their permitted content destination", () => {
    expect(
      getAdminNavigation({ id: OWNER_ID, role: AdminRole.manager }).map(
        ({ label }) => label,
      ),
    ).toEqual(["Dashboard", "Vehicles", "Inquiries"]);
  });

  it("provides one centralized source for mobile and desktop navigation", () => {
    const ownerItems = getAdminNavigation({
      id: OWNER_ID,
      role: AdminRole.owner,
    });
    expect(ownerItems.every((item) => ADMIN_NAVIGATION.includes(item))).toBe(
      true,
    );
    expect(new Set(ADMIN_NAVIGATION.map((item) => item.href)).size).toBe(
      ADMIN_NAVIGATION.length,
    );
  });
});
