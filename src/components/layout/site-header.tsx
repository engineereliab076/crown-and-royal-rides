import Link from "next/link";

import { Container } from "@/components/layout/container";
import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { NavigationLinks } from "@/components/layout/navigation-links";
import type { PublicSettingsPresentation } from "@/server/settings/public-presentation";

/**
 * Public site header shell.
 *
 * A Server Component; the only interactive piece (the mobile menu) is an
 * isolated Client Component. It ships a keyboard skip link, a text wordmark,
 * primary navigation limited to routes that exist, and a non-interactive launch
 * status.
 */
export function SiteHeader({
  settings,
}: {
  settings: PublicSettingsPresentation;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      {/* Keyboard-only skip link: visually hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-50 focus:ring-2 focus:ring-ring focus:outline-none"
      >
        Skip to main content
      </a>

      <Container className="flex h-16 items-center justify-between gap-4">
        {/*
          Text wordmark placeholder. Replace with the client-supplied logo asset
          once it is provided; this is not the final brand mark.
        */}
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-md text-subsection font-semibold tracking-tight text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {settings.businessName}
        </Link>

        <div className="flex items-center gap-3 sm:gap-4">
          <nav aria-label="Primary navigation" className="hidden md:block">
            <NavigationLinks />
          </nav>

          <div className="md:hidden">
            <MobileNavigation businessName={settings.businessName} />
          </div>
        </div>
      </Container>
    </header>
  );
}
