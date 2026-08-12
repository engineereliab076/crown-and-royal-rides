import type { Metadata } from "next";

import { UsersPageClient } from "@/components/admin/users-page-client";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage() {
  await requireAdminPage("admin:manage");
  return <UsersPageClient />;
}
