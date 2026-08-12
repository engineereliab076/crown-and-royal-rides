"use client";

import { RefreshCwIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SettingsDto {
  readonly businessName: string;
  readonly whatsappNumber: string;
  readonly primaryPhone: string;
  readonly secondaryPhone: string | null;
  readonly email: string;
  readonly address: string;
  readonly openingHours: unknown;
  readonly socialLinks: unknown;
  readonly heroHeadline: string;
  readonly heroSubheadline: string;
  readonly inquiryNotificationEmails: readonly string[];
  readonly updatedAt: string;
  readonly updatedById: string | null;
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {}
  return "Business settings could not be saved.";
}

export function SettingsPageClient() {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await safeError(response));
      const body = (await response.json()) as { settings: SettingsDto };
      setSettings(body.settings);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Business settings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const openingHours = JSON.parse(
        String(form.get("openingHours") ?? "{}"),
      ) as unknown;
      const socialLinks = JSON.parse(
        String(form.get("socialLinks") ?? "{}"),
      ) as unknown;
      const input = {
        businessName: String(form.get("businessName") ?? ""),
        whatsappNumber: String(form.get("whatsappNumber") ?? ""),
        primaryPhone: String(form.get("primaryPhone") ?? ""),
        secondaryPhone: String(form.get("secondaryPhone") ?? ""),
        email: String(form.get("email") ?? ""),
        address: String(form.get("address") ?? ""),
        openingHours,
        socialLinks,
        heroHeadline: String(form.get("heroHeadline") ?? ""),
        heroSubheadline: String(form.get("heroSubheadline") ?? ""),
        inquiryNotificationEmails: String(
          form.get("inquiryNotificationEmails") ?? "",
        )
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await safeError(response));
      const body = (await response.json()) as { settings: SettingsDto };
      setSettings(body.settings);
      toast.success("Business settings saved.");
    } catch (caught) {
      setError(
        caught instanceof SyntaxError
          ? "Opening hours and social links must be valid JSON objects."
          : caught instanceof Error
            ? caught.message
            : "Business settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCwIcon className="size-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-gold-foreground">
          Business profile
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Update the existing singleton business configuration. Changed field
          names are audited.
        </p>
      </div>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {settings ? (
        <form
          onSubmit={save}
          className="space-y-6 rounded-2xl border bg-card p-5 shadow-soft sm:p-6"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field
              label="Business name"
              name="businessName"
              defaultValue={settings.businessName}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={settings.email}
            />
            <Field
              label="WhatsApp number"
              name="whatsappNumber"
              defaultValue={settings.whatsappNumber}
            />
            <Field
              label="Primary phone"
              name="primaryPhone"
              defaultValue={settings.primaryPhone}
            />
            <Field
              label="Secondary phone"
              name="secondaryPhone"
              defaultValue={settings.secondaryPhone ?? ""}
              required={false}
            />
            <Field
              label="Address"
              name="address"
              defaultValue={settings.address}
            />
            <Field
              label="Hero headline"
              name="heroHeadline"
              defaultValue={settings.heroHeadline}
            />
            <Field
              label="Hero subheadline"
              name="heroSubheadline"
              defaultValue={settings.heroSubheadline}
            />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <JsonField
              label="Opening hours (JSON object)"
              name="openingHours"
              value={settings.openingHours}
            />
            <JsonField
              label="Social links (JSON object)"
              name="socialLinks"
              value={settings.socialLinks}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inquiryNotificationEmails">
              Inquiry notification emails
            </Label>
            <Textarea
              id="inquiryNotificationEmails"
              name="inquiryNotificationEmails"
              rows={4}
              defaultValue={settings.inquiryNotificationEmails.join("\n")}
              aria-describedby="inquiry-emails-help"
            />
            <p
              id="inquiry-emails-help"
              className="text-xs text-muted-foreground"
            >
              One email per line or comma-separated.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={saving}>
              <SaveIcon aria-hidden="true" />
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Settings are not configured. Create the singleton row through the
          approved local setup before editing.
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
      />
    </div>
  );
}

function JsonField({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: unknown;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        rows={8}
        defaultValue={JSON.stringify(value, null, 2)}
        required
        spellCheck={false}
        className="font-mono text-xs"
      />
    </div>
  );
}
