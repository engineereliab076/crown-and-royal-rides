import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminNavigation } from "@/components/admin/navigation";
import { requireAdminPage } from "@/server/auth/page-guard";

/**
 * Minimum protected admin layout.
 *
 * Retrieves the database-validated session (the session callback performs the
 * authoritative lookup), redirects anonymous/invalid sessions to the login
 * page, and redirects forced-change administrators to the change-password page.
 * The login and change-password routes live outside this route group, so no
 * redirect loop is possible. The full sidebar/shell arrives in Group 4.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdminPage();
  const actor = { id: user.id, role: user.role };
  return (
    <AdminShell
      navigation={getAdminNavigation(actor)}
      user={{ name: user.name, role: user.role }}
    >
      {children}
    </AdminShell>
  );
}
