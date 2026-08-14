import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Inquiries",
  robots: { index: false, follow: false },
};

export default async function AdminInquiriesPage() {
  const user = await requireAdminPage("inquiry:manage");
  const page = await getAdminServices().inquiryService.listAdmin(
    { id: user.id, role: user.role },
    { page: 1, limit: 100 },
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-gold-foreground">
          Customer requests
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Inquiries
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review newly submitted purchase inquiries.
        </p>
      </div>
      {page.items.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center">
          <h2 className="font-semibold">No inquiries yet</h2>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-soft">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Vehicle</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map((inquiry) => (
                <tr key={inquiry.id} className="hover:bg-muted/20">
                  <td className="px-4 py-4 font-semibold">
                    {inquiry.reference}
                  </td>
                  <td className="px-4 py-4">{inquiry.customerName}</td>
                  <td className="px-4 py-4">{inquiry.customerPhone}</td>
                  <td className="px-4 py-4">
                    {inquiry.subject === null
                      ? "Vehicle unavailable"
                      : `${inquiry.subject.year} ${inquiry.subject.brandName} ${inquiry.subject.model}`}
                  </td>
                  <td className="px-4 py-4 capitalize">{inquiry.type}</td>
                  <td className="px-4 py-4">
                    <Badge variant="secondary" className="capitalize">
                      {inquiry.status.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    {new Intl.DateTimeFormat("en-TZ", {
                      dateStyle: "medium",
                      timeZone: "Africa/Dar_es_Salaam",
                    }).format(new Date(inquiry.createdAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
