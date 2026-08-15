"use client";

import { MenuIcon } from "lucide-react";
import { useState } from "react";

import { NavigationLinks } from "@/components/layout/navigation-links";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Compact navigation for small screens.
 *
 * Wraps the shared shadcn Sheet: Radix supplies focus trapping, focus
 * restoration to the trigger, and Escape-to-close, so no custom focus logic is
 * added here. Only routes that actually exist are linked.
 */
export function MobileNavigation({ businessName }: { businessName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
          <SheetTitle>{businessName}</SheetTitle>
          <SheetDescription>
            Browse vehicles or contact our team.
          </SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="px-4">
          <NavigationLinks mobile onNavigate={() => setOpen(false)} />
        </nav>
        <p className="mt-auto px-4 pb-2 text-body-sm text-muted-foreground">
          Vehicle sales and rentals in Tanzania
        </p>
      </SheetContent>
    </Sheet>
  );
}
