"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PurchaseInquiryApiResponse {
  readonly reference: string;
  readonly message: string;
  readonly whatsappUrl: string | null;
}

function openBlankPopup(): Window | null {
  // Supplying `noopener` in the feature string makes Chromium/WebKit free to
  // return null. Open synchronously, retain the handle, then sever the opener
  // before any external navigation.
  const popup = window.open("about:blank", "_blank");
  if (popup !== null) {
    try {
      popup.opener = null;
    } catch {}
  }
  return popup;
}

function closePopup(popup: Window | null): void {
  if (popup === null) return;
  try {
    popup.close();
  } catch {}
}

export function PurchaseRequestForm({ vehicleId }: { vehicleId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // This must remain before the first await so mobile popup blockers see a
    // direct user gesture.
    const popup = openBlankPopup();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);
    setReference(null);
    setError(null);

    const customerEmail = String(data.get("customerEmail") ?? "").trim();
    const message = String(data.get("message") ?? "").trim();
    try {
      const response = await fetch("/api/inquiries/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId,
          customerName: String(data.get("customerName") ?? ""),
          customerPhone: String(data.get("customerPhone") ?? ""),
          ...(customerEmail.length === 0 ? {} : { customerEmail }),
          ...(message.length === 0 ? {} : { message }),
        }),
      });
      const payload = (await response.json()) as Partial<
        PurchaseInquiryApiResponse & { error: { message?: string } }
      >;
      if (!response.ok || typeof payload.reference !== "string") {
        throw new Error("The purchase request could not be saved.");
      }

      setReference(payload.reference);
      form.reset();
      if (typeof payload.whatsappUrl === "string" && popup !== null) {
        popup.location.replace(payload.whatsappUrl);
      } else {
        closePopup(popup);
      }
    } catch {
      closePopup(popup);
      setError("The purchase request could not be saved. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={submitting}>
      <div className="space-y-2">
        <Label htmlFor="purchase-name">Your name</Label>
        <Input
          id="purchase-name"
          name="customerName"
          autoComplete="name"
          maxLength={120}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="purchase-phone">Phone number</Label>
        <Input
          id="purchase-phone"
          name="customerPhone"
          type="tel"
          autoComplete="tel"
          placeholder="0712 345 678"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="purchase-email">Email (optional)</Label>
        <Input
          id="purchase-email"
          name="customerEmail"
          type="email"
          autoComplete="email"
          maxLength={254}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="purchase-message">Message (optional)</Label>
        <Textarea id="purchase-message" name="message" maxLength={2000} />
      </div>
      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? "Saving request…" : "Submit purchase request"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Your request is saved before the optional WhatsApp handoff opens.
      </p>
      <div aria-live="polite" aria-atomic="true">
        {reference === null ? null : (
          <div className="rounded-xl border border-brand-gold/40 bg-brand-gold/10 p-4">
            <p className="font-semibold">Purchase request saved</p>
            <p className="mt-1 text-sm">
              Your reference is <strong>{reference}</strong>.
            </p>
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
