import type { Metadata } from "next";

import { AuditLogPageClient } from "@/components/admin/audit-log-page-client";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Audit Log",
  robots: { index: false, follow: false },
};

export default async function AdminAuditLogPage() {
  await requireAdminPage("audit:read");
  return <AuditLogPageClient />;
}
