"use client";

import {
  ClipboardListIcon,
  CrownIcon,
  LayoutDashboardIcon,
  MenuIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LogoutButton } from "@/components/admin/logout-button";
import type {
  AdminNavigationIcon,
  AdminNavigationItem,
} from "@/components/admin/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ICONS: Record<AdminNavigationIcon, typeof LayoutDashboardIcon> = {
  dashboard: LayoutDashboardIcon,
  users: UsersIcon,
  audit: ClipboardListIcon,
  settings: SettingsIcon,
};

function NavigationLinks({
  items,
  mobile = false,
}: {
  items: readonly AdminNavigationItem[];
  mobile?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={mobile ? "Mobile admin navigation" : "Admin navigation"}>
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            pathname === item.href ||
            (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
          const link = (
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {item.label}
            </Link>
          );
          return (
            <li key={item.href}>
              {mobile ? <SheetClose asChild>{link}</SheetClose> : link}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Brand() {
  return (
    <Link
      href="/admin"
      className="flex min-h-11 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-gold text-brand-gold-foreground">
        <CrownIcon aria-hidden="true" className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">Crown &amp; Royal</span>
        <span className="block text-xs text-muted-foreground">
          Administration
        </span>
      </span>
    </Link>
  );
}

export function AdminShell({
  children,
  navigation,
  user,
}: {
  children: React.ReactNode;
  navigation: readonly AdminNavigationItem[];
  user: { readonly name: string; readonly role: string };
}) {
  const pathname = usePathname();
  const current = navigation.find((item) => item.href === pathname);
  const title = current?.label ?? "Dashboard";

  return (
    <div className="min-h-screen bg-surface-subtle lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="border-b border-sidebar-border px-5 py-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <NavigationLinks items={navigation} />
        </div>
        <div className="border-t border-sidebar-border p-4">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground capitalize">
            {user.role}
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-background/90 px-4 backdrop-blur lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  className="lg:hidden"
                  aria-label="Open admin navigation"
                >
                  <MenuIcon aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="bg-sidebar p-0">
                <SheetHeader className="border-b border-sidebar-border px-5 py-4 text-left">
                  <SheetTitle asChild>
                    <Brand />
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    Navigate the administration area.
                  </SheetDescription>
                </SheetHeader>
                <div className="px-3 py-5">
                  <NavigationLinks items={navigation} mobile />
                </div>
              </SheetContent>
            </Sheet>
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <li>
                  {pathname === "/admin" ? (
                    <span aria-current="page">Administration</span>
                  ) : (
                    <Link
                      href="/admin"
                      className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Administration
                    </Link>
                  )}
                </li>
                {pathname !== "/admin" ? (
                  <>
                    <li aria-hidden="true">/</li>
                    <li
                      className="truncate font-medium text-foreground"
                      aria-current="page"
                    >
                      {title}
                    </li>
                  </>
                ) : null}
              </ol>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-48 truncate text-sm font-medium">
                {user.name}
              </p>
              <p className="text-xs text-muted-foreground capitalize">
                {user.role}
              </p>
            </div>
            <LogoutButton />
          </div>
        </header>
        <main id="admin-main-content" className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
