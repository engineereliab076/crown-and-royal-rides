"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PUBLIC_NAVIGATION } from "@/components/layout/public-navigation";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavigationLinks({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className={mobile ? "flex flex-col gap-1" : "flex items-center gap-1"}>
      {PUBLIC_NAVIGATION.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                mobile && "text-base",
                active &&
                  "font-semibold after:absolute after:bottom-1 after:left-3 after:h-0.5 after:w-5 after:bg-brand-gold-foreground",
              )}
            >
              {item.label}
              {active ? <span className="sr-only"> (current page)</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
