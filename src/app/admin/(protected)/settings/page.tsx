import type { Metadata } from "next";

import { SettingsPageClient } from "@/components/admin/settings-page-client";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function AdminSettingsPage() {
  await requireAdminPage("settings:update");
  return <SettingsPageClient />;
}
