import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getPublicSettingsPresentation } from "@/server/settings/public-presentation";

// Public routes are rendered on request. Their underlying settings and vehicle
// reads remain in Next's tagged data cache; this prevents `next build` from
// contacting a database while retaining five-minute ISR-style freshness.
export const dynamic = "force-dynamic";

export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await getPublicSettingsPresentation();
  return (
    <>
      <SiteHeader settings={settings} />
      {children}
      <SiteFooter settings={settings} />
    </>
  );
}
