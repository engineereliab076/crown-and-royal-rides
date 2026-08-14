"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BODY_TYPES,
  DRIVER_OPTIONS,
  FUEL_TYPES,
  SALE_STATUSES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
} from "@/lib/vehicle-values";

interface BrandOption {
  readonly id: string;
  readonly name: string;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {}
  return "The vehicle could not be created.";
}

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function OptionField({
  id,
  title,
  value,
  values,
  onChange,
}: {
  id: string;
  title: string;
  value: string;
  values: readonly string[];
  onChange(value: string): void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{title}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full" aria-label={title}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((option) => (
            <SelectItem key={option} value={option}>
              {label(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function VehicleCreateForm({
  brands,
}: {
  brands: readonly BrandOption[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [bodyType, setBodyType] = useState<string>(BODY_TYPES[0]);
  const [condition, setCondition] = useState<string>(VEHICLE_CONDITIONS[0]);
  const [transmission, setTransmission] = useState<string>(TRANSMISSIONS[0]);
  const [fuelType, setFuelType] = useState<string>(FUEL_TYPES[0]);
  const [driverOption, setDriverOption] = useState<string>(DRIVER_OPTIONS[0]);
  const [saleStatus, setSaleStatus] = useState<string>(SALE_STATUSES[0]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      brandId,
      model: String(form.get("model") ?? ""),
      year: Number(form.get("year")),
      bodyType,
      condition,
      transmission,
      fuelType,
      driverOption,
      isForSale: true,
      saleStatus,
      salePrice: Number(form.get("salePrice")),
      description: String(form.get("description") ?? ""),
    };

    try {
      const response = await fetch("/api/admin/vehicles", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = (await response.json()) as { vehicle: { id: string } };
      router.push(`/admin/vehicles/${result.vehicle.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The vehicle could not be created.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-2xl border bg-card p-5 shadow-soft sm:p-6"
    >
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brandId">Brand</Label>
          <Select value={brandId} onValueChange={setBrandId}>
            <SelectTrigger id="brandId" className="w-full" aria-label="Brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" maxLength={80} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            name="year"
            type="number"
            min={1980}
            max={2100}
            step={1}
            required
          />
        </div>
        <OptionField
          id="bodyType"
          title="Body type"
          value={bodyType}
          values={BODY_TYPES}
          onChange={setBodyType}
        />
        <OptionField
          id="condition"
          title="Condition"
          value={condition}
          values={VEHICLE_CONDITIONS}
          onChange={setCondition}
        />
        <OptionField
          id="transmission"
          title="Transmission"
          value={transmission}
          values={TRANSMISSIONS}
          onChange={setTransmission}
        />
        <OptionField
          id="fuelType"
          title="Fuel type"
          value={fuelType}
          values={FUEL_TYPES}
          onChange={setFuelType}
        />
        <OptionField
          id="driverOption"
          title="Driver option"
          value={driverOption}
          values={DRIVER_OPTIONS}
          onChange={setDriverOption}
        />
        <OptionField
          id="saleStatus"
          title="Sale status"
          value={saleStatus}
          values={SALE_STATUSES}
          onChange={setSaleStatus}
        />
        <div className="space-y-1.5">
          <Label htmlFor="salePrice">Sale price (TZS)</Label>
          <Input
            id="salePrice"
            name="salePrice"
            type="number"
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            step={1}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          maxLength={4000}
          rows={7}
          aria-describedby="description-help"
        />
        <p id="description-help" className="text-xs text-muted-foreground">
          Drafts may be short; publishing requires at least 40 characters.
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          disabled={submitting || brandId.length === 0}
        >
          <PlusIcon aria-hidden="true" />
          {submitting ? "Creating…" : "Create vehicle"}
        </Button>
      </div>
    </form>
  );
}
