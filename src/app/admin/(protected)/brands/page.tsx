import type { Metadata } from "next";

import { BrandManagementClient } from "@/components/admin/brand-management-client";
import { getAdminServices } from "@/server/admin/services";
import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Brands",
  robots: { index: false, follow: false },
};

export default async function AdminBrandsPage() {
  const user = await requireAdminPage("content:manage");
  const brands = await getAdminServices().brandService.list({
    id: user.id,
    role: user.role,
  });
  return <BrandManagementClient initialBrands={brands} />;
}
