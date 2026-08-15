"use client";

import { MessageCircleIcon, PhoneIcon, ShoppingBagIcon } from "lucide-react";

export function StickyMobileActions({
  showPurchase,
  whatsappUrl,
  phoneUrl,
}: {
  showPurchase: boolean;
  whatsappUrl: string | null;
  phoneUrl: string | null;
}) {
  function focusPurchase() {
    const target = document.getElementById("purchase-request");
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-elevated backdrop-blur md:hidden"
      aria-label="Vehicle actions"
    >
      <div className="mx-auto flex max-w-lg gap-2">
        {showPurchase ? (
          <button
            type="button"
            onClick={focusPurchase}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ShoppingBagIcon aria-hidden="true" className="size-4" />
            Purchase request
          </button>
        ) : null}
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageCircleIcon aria-hidden="true" className="size-4" />
            WhatsApp
          </a>
        ) : null}
        {!whatsappUrl && phoneUrl ? (
          <a
            href={phoneUrl}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PhoneIcon aria-hidden="true" className="size-4" />
            Call
          </a>
        ) : null}
      </div>
    </div>
  );
}
