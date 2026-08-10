"use client";

import Link from "next/link";
import { MenuIcon } from "lucide-react";

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
import { siteConfig } from "@/lib/site";

/**
 * Compact navigation for small screens.
 *
 * Wraps the shared shadcn Sheet: Radix supplies focus trapping, focus
 * restoration to the trigger, and Escape-to-close, so no custom focus logic is
 * added here. Only routes that actually exist are linked.
 */
export function MobileNavigation() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Open navigation menu"
        >
          <MenuIcon className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-4/5 max-w-sm">
        <SheetHeader>
          <SheetTitle>{siteConfig.name}</SheetTitle>
          <SheetDescription>{siteConfig.description}</SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="px-4">
          <ul className="flex flex-col gap-1">
            <li>
              <SheetClose asChild>
                <Link
                  href="/"
                  className="flex min-h-11 items-center rounded-md px-3 text-body font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Home
                </Link>
              </SheetClose>
            </li>
          </ul>
        </nav>
        <p className="mt-auto px-4 pb-2 text-body-sm text-muted-foreground">
          Showroom launching soon
        </p>
      </SheetContent>
    </Sheet>
  );
}
