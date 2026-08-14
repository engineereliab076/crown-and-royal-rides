import { MessageCircleIcon } from "lucide-react";

import { PurchaseRequestForm } from "@/components/purchase-request-form";
import { Button } from "@/components/ui/button";

export function ContactActions({
  vehicleId,
  directWhatsAppUrl,
}: {
  vehicleId: string;
  directWhatsAppUrl: string | null;
}) {
  return (
    <section
      aria-labelledby="purchase-request-heading"
      className="rounded-2xl border bg-card p-5 shadow-soft sm:p-7"
    >
      <h2 id="purchase-request-heading" className="text-xl font-semibold">
        Purchase this vehicle
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Send a saved purchase request, or contact our team directly.
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_auto]">
        <PurchaseRequestForm vehicleId={vehicleId} />
        {directWhatsAppUrl === null ? null : (
          <div className="border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <Button asChild variant="outline" size="lg" className="w-full">
              <a
                href={directWhatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircleIcon aria-hidden="true" />
                Contact via WhatsApp
              </a>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
