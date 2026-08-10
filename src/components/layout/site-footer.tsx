import Link from "next/link";

import { Container } from "@/components/layout/container";
import { siteConfig } from "@/lib/site";

/**
 * Concise public footer shell.
 *
 * Deliberately minimal: a text wordmark, the restrained site description, a
 * single valid navigation link, and copyright. No invented contact details,
 * legal claims, social icons, or newsletter form.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-border bg-surface-subtle">
      <Container as="div" className="py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md space-y-2">
            {/* Text wordmark placeholder; replaced by the supplied logo later. */}
            <p className="text-subsection font-semibold tracking-tight text-foreground">
              {siteConfig.name}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {siteConfig.description}
            </p>
          </div>

          <nav aria-label="Footer navigation">
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href="/"
                  className="inline-flex min-h-11 items-center rounded-md text-body-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Home
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <p className="text-body-sm text-muted-foreground">
            &copy; {year} {siteConfig.name}. All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}
