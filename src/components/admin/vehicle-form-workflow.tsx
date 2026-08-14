"use client";

import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  VehicleGalleryManager,
  type GalleryState,
} from "@/components/admin/vehicle-gallery-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BODY_TYPES,
  DRIVER_OPTIONS,
  DRIVETRAINS,
  FUEL_TYPES,
  RENTAL_STATUSES,
  SALE_STATUSES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
} from "@/lib/vehicle-values";
import { formatTzs } from "@/lib/money";
import {
  addFeature,
  buildVehicleModePlan,
  removeFeature,
  REQUIREMENT_STEP,
  stepHref,
  VEHICLE_FORM_STEPS,
  vehicleStepStates,
  type VehicleFormStep,
} from "@/lib/admin-vehicle-ui";
import type { VehicleAdminDTO } from "@/server/modules/vehicles/dto";

interface BrandOption {
  readonly id: string;
  readonly name: string;
}
interface ApiErrorBody {
  error?: {
    message?: unknown;
    details?: { fields?: unknown; missing?: unknown };
  };
}

interface DraftState {
  brandId: string;
  model: string;
  year: string;
  bodyType: string;
  condition: string;
  transmission: string;
  fuelType: string;
  drivetrain: string;
  location: string;
  isForSale: boolean;
  saleStatus: string;
  salePrice: string;
  isNegotiable: boolean;
  isForRent: boolean;
  rentalStatus: string;
  rentalDailyPrice: string;
  minRentalDays: string;
  driverOption: string;
  driverNote: string;
  mileageKm: string;
  engineCc: string;
  engineDescription: string;
  seats: string;
  doors: string;
  exteriorColor: string;
  interiorColor: string;
  registrationNumber: string;
  chassisNumber: string;
  description: string;
  features: readonly string[];
}

function initialState(
  vehicle: VehicleAdminDTO | null,
  brands: readonly BrandOption[],
): DraftState {
  return {
    brandId: vehicle?.brandId ?? brands[0]?.id ?? "",
    model: vehicle?.model ?? "",
    year: vehicle ? String(vehicle.year) : "",
    bodyType: vehicle?.bodyType ?? BODY_TYPES[0],
    condition: vehicle?.condition ?? VEHICLE_CONDITIONS[0],
    transmission: vehicle?.transmission ?? TRANSMISSIONS[0],
    fuelType: vehicle?.fuelType ?? FUEL_TYPES[0],
    drivetrain: vehicle?.drivetrain ?? DRIVETRAINS[0],
    location: vehicle?.location ?? "",
    isForSale: vehicle?.isForSale ?? false,
    saleStatus: vehicle?.saleStatus ?? SALE_STATUSES[0],
    salePrice: vehicle?.salePrice == null ? "" : String(vehicle.salePrice),
    isNegotiable: vehicle?.isNegotiable ?? false,
    isForRent: vehicle?.isForRent ?? false,
    rentalStatus: vehicle?.rentalStatus ?? RENTAL_STATUSES[0],
    rentalDailyPrice:
      vehicle?.rentalDailyPrice == null ? "" : String(vehicle.rentalDailyPrice),
    minRentalDays:
      vehicle?.minRentalDays == null ? "" : String(vehicle.minRentalDays),
    driverOption: vehicle?.driverOption ?? DRIVER_OPTIONS[1],
    driverNote: vehicle?.driverNote ?? "",
    mileageKm: vehicle?.mileageKm == null ? "" : String(vehicle.mileageKm),
    engineCc: vehicle?.engineCc == null ? "" : String(vehicle.engineCc),
    engineDescription: vehicle?.engineDescription ?? "",
    seats: vehicle?.seats == null ? "" : String(vehicle.seats),
    doors: vehicle?.doors == null ? "" : String(vehicle.doors),
    exteriorColor: vehicle?.exteriorColor ?? "",
    interiorColor: vehicle?.interiorColor ?? "",
    registrationNumber: vehicle?.registrationNumber ?? "",
    chassisNumber: vehicle?.chassisNumber ?? "",
    description: vehicle?.description ?? "",
    features: vehicle?.features ?? [],
  };
}

function pretty(value: string): string {
  return value
    .replaceAll(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
function nullableInteger(value: string): number | null {
  return value.trim().length === 0 ? null : Number(value);
}
function moneyHint(value: string): string | null {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? formatTzs(amount) : null;
}

async function apiResult<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody & T;
  if (response.ok) return body;
  const error = new Error(
    typeof body.error?.message === "string" ? body.error.message : fallback,
  ) as Error & { fields?: string[] };
  if (Array.isArray(body.error?.details?.fields)) {
    error.fields = body.error.details.fields
      .filter((field): field is string => typeof field === "string")
      .map((field) => field.split(".").at(-1) ?? field);
  }
  throw error;
}

function SelectField(props: {
  id: keyof DraftState;
  label: string;
  value: string;
  values: readonly string[];
  onChange(value: string): void;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <select
        id={props.id}
        name={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? `${props.id}-error` : undefined}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {props.values.map((value) => (
          <option key={value} value={value}>
            {pretty(value)}
          </option>
        ))}
      </select>
      {props.error ? (
        <p id={`${props.id}-error`} className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

function TextField(props: {
  id: keyof DraftState;
  label: string;
  value: string;
  onChange(value: string): void;
  type?: "text" | "number";
  min?: number;
  max?: number;
  maxLength?: number;
  required?: boolean;
  help?: string;
  privateField?: boolean;
  error?: string;
}) {
  const describedBy =
    [
      props.help ? `${props.id}-help` : "",
      props.error ? `${props.id}-error` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>
        {props.label}
        {props.privateField ? (
          <span className="ml-2 text-xs font-normal text-amber-700">
            Private · admin only
          </span>
        ) : null}
      </Label>
      <Input
        id={props.id}
        name={props.id}
        type={props.type}
        min={props.min}
        max={props.max}
        step={props.type === "number" ? 1 : undefined}
        maxLength={props.maxLength}
        required={props.required}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
      />
      {props.help ? (
        <p id={`${props.id}-help`} className="text-xs text-muted-foreground">
          {props.help}
        </p>
      ) : null}
      {props.error ? (
        <p id={`${props.id}-error`} className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export function VehicleFormWorkflow({
  brands,
  initialVehicle,
  initialGallery,
  initialStep,
}: {
  brands: readonly BrandOption[];
  initialVehicle: VehicleAdminDTO | null;
  initialGallery: GalleryState | null;
  initialStep: VehicleFormStep;
}) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [draft, setDraft] = useState(() =>
    initialState(initialVehicle, brands),
  );
  const [step, setStep] = useState(initialStep);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [featureDraft, setFeatureDraft] = useState("");
  const [featureError, setFeatureError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = useCallback(
    <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
      setDraft((current) => ({ ...current, [key]: value }));
      setDirty(true);
      setNotice(null);
      setFieldErrors((current) => ({ ...current, [key]: "" }));
    },
    [],
  );

  const refreshVehicle = useCallback(async () => {
    if (vehicle === null) return;
    const response = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { vehicle: VehicleAdminDTO };
    setVehicle(body.vehicle);
  }, [vehicle]);

  const states = useMemo(
    () =>
      vehicleStepStates(step, vehicle?.publicationReadiness.checklist ?? null),
    [step, vehicle],
  );

  function goToStep(
    next: VehicleFormStep,
    options: { force?: boolean; preserveNotice?: boolean } = {},
  ) {
    if (vehicle === null && next !== 1) return;
    if (
      dirty &&
      !options.force &&
      !window.confirm("Leave this step without saving your changes?")
    )
      return;
    setStep(next);
    setError(null);
    if (!options.preserveNotice) setNotice(null);
    if (vehicle !== null)
      router.replace(stepHref(vehicle.id, next), { scroll: false });
    document.querySelector<HTMLElement>("#vehicle-step-heading")?.focus();
  }

  function showFailure(caught: unknown) {
    const message =
      caught instanceof Error
        ? caught.message
        : "The vehicle could not be saved.";
    const fields =
      caught instanceof Error &&
      "fields" in caught &&
      Array.isArray((caught as Error & { fields?: unknown }).fields)
        ? (caught as Error & { fields: string[] }).fields
        : [];
    setError(message);
    setFieldErrors(Object.fromEntries(fields.map((field) => [field, message])));
    requestAnimationFrame(() => {
      const first = fields[0];
      if (first)
        formRef.current
          ?.querySelector<HTMLElement>(`#${CSS.escape(first)}`)
          ?.focus();
    });
  }

  async function patchVehicle(
    id: string,
    body: unknown,
  ): Promise<VehicleAdminDTO> {
    const response = await fetch(`/api/admin/vehicles/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (
      await apiResult<{ vehicle: VehicleAdminDTO }>(
        response,
        "The vehicle could not be saved.",
      )
    ).vehicle;
  }

  async function transition(
    id: string,
    action: string,
  ): Promise<VehicleAdminDTO> {
    const response = await fetch(`/api/admin/vehicles/${id}/transition`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    return (
      await apiResult<{ vehicle: VehicleAdminDTO }>(
        response,
        "The vehicle status could not be changed.",
      )
    ).vehicle;
  }

  async function saveCurrent(continueAfter = true) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setNotice("Saving…");
    try {
      let saved = vehicle;
      if (step === 1) {
        const basics = {
          brandId: draft.brandId,
          model: draft.model,
          year: Number(draft.year),
          bodyType: draft.bodyType,
          condition: draft.condition,
          transmission: draft.transmission,
          fuelType: draft.fuelType,
          drivetrain: draft.drivetrain,
          location: draft.location,
        };
        if (vehicle === null) {
          const response = await fetch("/api/admin/vehicles", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...basics,
              driverOption: "without_driver",
              isForSale: false,
              saleStatus: null,
              salePrice: null,
              isForRent: false,
              rentalStatus: null,
              rentalDailyPrice: null,
              minRentalDays: null,
            }),
          });
          saved = (
            await apiResult<{ vehicle: VehicleAdminDTO }>(
              response,
              "The draft could not be created.",
            )
          ).vehicle;
          setVehicle(saved);
          setDirty(false);
          setNotice("Draft created and saved.");
          router.replace(stepHref(saved.id, 2));
          return;
        }
        saved = await patchVehicle(vehicle.id, {
          step: "basics",
          data: basics,
        });
      } else if (vehicle !== null && step === 2) {
        const plan = buildVehicleModePlan(vehicle, {
          isForSale: draft.isForSale,
          saleStatus: draft.saleStatus,
          salePrice: nullableInteger(draft.salePrice),
          isNegotiable: draft.isNegotiable,
          isForRent: draft.isForRent,
          rentalStatus: draft.rentalStatus,
          rentalDailyPrice: nullableInteger(draft.rentalDailyPrice),
          minRentalDays: nullableInteger(draft.minRentalDays),
        });
        saved = await patchVehicle(vehicle.id, {
          step: "modes-and-pricing",
          data: plan.data,
        });
        for (const action of plan.transitions) {
          saved = await transition(vehicle.id, action);
        }
      } else if (vehicle !== null && step === 3) {
        saved = await patchVehicle(vehicle.id, {
          step: "driver-arrangement",
          data: {
            driverOption: draft.driverOption,
            driverNote: nullableText(draft.driverNote),
          },
        });
      } else if (vehicle !== null && step === 4) {
        saved = await patchVehicle(vehicle.id, {
          step: "specifications",
          data: {
            mileageKm: nullableInteger(draft.mileageKm),
            engineCc: nullableInteger(draft.engineCc),
            engineDescription: nullableText(draft.engineDescription),
            seats: nullableInteger(draft.seats),
            doors: nullableInteger(draft.doors),
            exteriorColor: nullableText(draft.exteriorColor),
            interiorColor: nullableText(draft.interiorColor),
            drivetrain: draft.drivetrain,
            registrationNumber: nullableText(draft.registrationNumber),
            chassisNumber: nullableText(draft.chassisNumber),
          },
        });
      } else if (vehicle !== null && step === 5) {
        saved = await patchVehicle(vehicle.id, {
          step: "description-and-features",
          data: {
            description: nullableText(draft.description),
            features: draft.features,
          },
        });
      } else if (vehicle !== null && step === 6) {
        await refreshVehicle();
      }
      if (saved !== null) setVehicle(saved);
      setDirty(false);
      setNotice("Saved.");
      if (continueAfter && step < 7) {
        goToStep((step + 1) as VehicleFormStep, {
          force: true,
          preserveNotice: true,
        });
      }
    } catch (caught) {
      showFailure(caught);
      setNotice(null);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (vehicle === null || saving || !vehicle.publicationReadiness.ready)
      return;
    setSaving(true);
    setError(null);
    setNotice("Publishing…");
    try {
      const published = await transition(vehicle.id, "publish");
      setVehicle(published);
      setNotice("Vehicle published successfully.");
      setDirty(false);
    } catch (caught) {
      showFailure(caught);
      setNotice(null);
    } finally {
      setSaving(false);
    }
  }

  const errorFor = (field: keyof DraftState) => fieldErrors[field];
  const set =
    <K extends keyof DraftState>(key: K) =>
    (value: DraftState[K]) =>
      change(key, value);
  const heading =
    VEHICLE_FORM_STEPS.find((item) => item.id === step)?.label ?? "Vehicle";

  return (
    <div className="space-y-6">
      <nav
        aria-label="Vehicle form steps"
        className="overflow-x-auto rounded-2xl border bg-card p-3 shadow-soft"
      >
        <ol className="flex min-w-max gap-2 lg:grid lg:min-w-0 lg:grid-cols-7">
          {states.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={vehicle === null && item.id !== 1}
                onClick={() => goToStep(item.id)}
                aria-current={item.current ? "step" : undefined}
                className={`flex min-h-12 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.current ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:text-foreground"}`}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border"
                  aria-hidden="true"
                >
                  {item.complete ? <CheckIcon className="size-3.5" /> : item.id}
                </span>
                <span>
                  <span className="block">{item.label}</span>
                  <span className="block text-[10px] opacity-75">
                    {item.current
                      ? "Current"
                      : item.complete
                        ? "Complete"
                        : "Needs attention"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {vehicle?.listingState === "published" &&
      !vehicle.publicationReadiness.ready ? (
        <div
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          This legacy published vehicle is missing newer publication details. It
          remains published until an administrator explicitly changes its
          lifecycle.
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="text-sm font-medium text-muted-foreground"
        >
          {notice}
        </p>
      ) : null}

      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void saveCurrent(true);
        }}
        className="space-y-6 rounded-2xl border bg-card p-5 shadow-soft sm:p-6"
      >
        <div>
          <p className="text-xs font-medium tracking-wide text-brand-gold-foreground uppercase">
            Step {step} of 7
          </p>
          <h2
            id="vehicle-step-heading"
            tabIndex={-1}
            className="mt-1 text-xl font-semibold outline-none"
          >
            {heading}
          </h2>
        </div>

        {step === 1 ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="brandId">Brand</Label>
              <select
                id="brandId"
                name="brandId"
                value={draft.brandId}
                onChange={(event) => set("brandId")(event.currentTarget.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
              {errorFor("brandId") ? (
                <p className="text-xs text-destructive">
                  {errorFor("brandId")}
                </p>
              ) : null}
            </div>
            <TextField
              id="model"
              label="Model"
              value={draft.model}
              onChange={set("model")}
              maxLength={80}
              required
              error={errorFor("model")}
            />
            <TextField
              id="year"
              label="Year"
              value={draft.year}
              onChange={set("year")}
              type="number"
              min={1980}
              max={2100}
              required
              error={errorFor("year")}
            />
            <SelectField
              id="bodyType"
              label="Body type"
              value={draft.bodyType}
              values={BODY_TYPES}
              onChange={set("bodyType")}
              error={errorFor("bodyType")}
            />
            <SelectField
              id="condition"
              label="Condition"
              value={draft.condition}
              values={VEHICLE_CONDITIONS}
              onChange={set("condition")}
              error={errorFor("condition")}
            />
            <SelectField
              id="transmission"
              label="Transmission"
              value={draft.transmission}
              values={TRANSMISSIONS}
              onChange={set("transmission")}
              error={errorFor("transmission")}
            />
            <SelectField
              id="fuelType"
              label="Fuel type"
              value={draft.fuelType}
              values={FUEL_TYPES}
              onChange={set("fuelType")}
              error={errorFor("fuelType")}
            />
            <SelectField
              id="drivetrain"
              label="Drivetrain"
              value={draft.drivetrain}
              values={DRIVETRAINS}
              onChange={set("drivetrain")}
              error={errorFor("drivetrain")}
            />
            <TextField
              id="location"
              label="Location"
              value={draft.location}
              onChange={set("location")}
              maxLength={160}
              help="Required before publication."
              error={errorFor("location")}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <fieldset className="space-y-4 rounded-xl border p-4">
              <legend className="px-1 font-semibold">Sale</legend>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.isForSale}
                  onChange={(event) =>
                    set("isForSale")(event.currentTarget.checked)
                  }
                  className="size-5"
                />
                <span>Offer this vehicle for sale</span>
              </label>
              {draft.isForSale ? (
                <>
                  <SelectField
                    id="saleStatus"
                    label="Sale status"
                    value={draft.saleStatus}
                    values={SALE_STATUSES}
                    onChange={set("saleStatus")}
                    error={errorFor("saleStatus")}
                  />
                  <TextField
                    id="salePrice"
                    label="Sale price (TZS)"
                    value={draft.salePrice}
                    onChange={set("salePrice")}
                    type="number"
                    min={1}
                    max={Number.MAX_SAFE_INTEGER}
                    error={errorFor("salePrice")}
                  />
                  {moneyHint(draft.salePrice) ? (
                    <p className="text-xs text-muted-foreground">
                      Displays as {moneyHint(draft.salePrice)}
                    </p>
                  ) : null}
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={draft.isNegotiable}
                      onChange={(event) =>
                        set("isNegotiable")(event.currentTarget.checked)
                      }
                      className="size-5"
                    />
                    <span>Price is negotiable</span>
                  </label>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Saving clears sale status and price atomically.
                </p>
              )}
            </fieldset>
            <fieldset className="space-y-4 rounded-xl border p-4">
              <legend className="px-1 font-semibold">Daily rental</legend>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.isForRent}
                  onChange={(event) =>
                    set("isForRent")(event.currentTarget.checked)
                  }
                  className="size-5"
                />
                <span>Offer this vehicle for rent</span>
              </label>
              {draft.isForRent ? (
                <>
                  <SelectField
                    id="rentalStatus"
                    label="Rental status"
                    value={draft.rentalStatus}
                    values={RENTAL_STATUSES}
                    onChange={set("rentalStatus")}
                    error={errorFor("rentalStatus")}
                  />
                  <TextField
                    id="rentalDailyPrice"
                    label="Daily rental price (TZS)"
                    value={draft.rentalDailyPrice}
                    onChange={set("rentalDailyPrice")}
                    type="number"
                    min={1}
                    max={Number.MAX_SAFE_INTEGER}
                    error={errorFor("rentalDailyPrice")}
                  />
                  {moneyHint(draft.rentalDailyPrice) ? (
                    <p className="text-xs text-muted-foreground">
                      Displays as {moneyHint(draft.rentalDailyPrice)} per day
                    </p>
                  ) : null}
                  <TextField
                    id="minRentalDays"
                    label="Minimum rental days"
                    value={draft.minRentalDays}
                    onChange={set("minRentalDays")}
                    type="number"
                    min={1}
                    max={365}
                    error={errorFor("minRentalDays")}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Saving clears rental status, daily price, and minimum days
                  atomically.
                </p>
              )}
            </fieldset>
            <p className="text-sm text-muted-foreground lg:col-span-2">
              Sale and rental availability are independent. A sold vehicle may
              remain available for rent.
            </p>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-5">
            <SelectField
              id="driverOption"
              label="Driver arrangement"
              value={draft.driverOption}
              values={DRIVER_OPTIONS}
              onChange={set("driverOption")}
              error={errorFor("driverOption")}
            />
            <p className="text-sm text-muted-foreground">
              Choose whether chauffeur service is included or available for this
              vehicle.
            </p>
            {draft.driverOption === "with_driver" ? (
              <div className="space-y-1.5">
                <Label htmlFor="driverNote">Driver note</Label>
                <Textarea
                  id="driverNote"
                  name="driverNote"
                  maxLength={500}
                  rows={5}
                  value={draft.driverNote}
                  onChange={(event) =>
                    set("driverNote")(event.currentTarget.value)
                  }
                  aria-describedby="driverNote-help"
                />
                <p
                  id="driverNote-help"
                  className="text-xs text-muted-foreground"
                >
                  Required for publication when a driver is offered.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                id="mileageKm"
                label="Mileage (km)"
                value={draft.mileageKm}
                onChange={set("mileageKm")}
                type="number"
                min={0}
                max={2_000_000}
                help={
                  draft.condition === "brand_new"
                    ? "Optional for a brand-new vehicle."
                    : "Required for publication because this is a used vehicle."
                }
                error={errorFor("mileageKm")}
              />
              <TextField
                id="engineCc"
                label="Engine capacity (cc)"
                value={draft.engineCc}
                onChange={set("engineCc")}
                type="number"
                min={1}
                max={10_000}
                error={errorFor("engineCc")}
              />
              <TextField
                id="engineDescription"
                label="Engine description"
                value={draft.engineDescription}
                onChange={set("engineDescription")}
                maxLength={120}
                error={errorFor("engineDescription")}
              />
              <TextField
                id="seats"
                label="Seats"
                value={draft.seats}
                onChange={set("seats")}
                type="number"
                min={1}
                max={60}
                help="Required for publication."
                error={errorFor("seats")}
              />
              <TextField
                id="doors"
                label="Doors"
                value={draft.doors}
                onChange={set("doors")}
                type="number"
                min={1}
                max={8}
                error={errorFor("doors")}
              />
              <TextField
                id="exteriorColor"
                label="Exterior colour"
                value={draft.exteriorColor}
                onChange={set("exteriorColor")}
                maxLength={40}
                help="Required for publication."
                error={errorFor("exteriorColor")}
              />
              <TextField
                id="interiorColor"
                label="Interior colour"
                value={draft.interiorColor}
                onChange={set("interiorColor")}
                maxLength={40}
                error={errorFor("interiorColor")}
              />
            </div>
            <fieldset className="grid gap-5 rounded-xl border border-amber-300 bg-amber-50/50 p-4 md:grid-cols-2">
              <legend className="px-1 font-semibold text-amber-900">
                Private vehicle identifiers
              </legend>
              <p className="text-sm text-amber-900 md:col-span-2">
                Visible only to authorized administrators. Never included in
                public previews, links, or vehicle APIs.
              </p>
              <TextField
                id="registrationNumber"
                label="Registration number"
                value={draft.registrationNumber}
                onChange={set("registrationNumber")}
                maxLength={120}
                privateField
                error={errorFor("registrationNumber")}
              />
              <TextField
                id="chassisNumber"
                label="Chassis number"
                value={draft.chassisNumber}
                onChange={set("chassisNumber")}
                maxLength={120}
                privateField
                error={errorFor("chassisNumber")}
              />
            </fieldset>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-6">
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                rows={9}
                maxLength={4000}
                value={draft.description}
                onChange={(event) =>
                  set("description")(event.currentTarget.value)
                }
                aria-describedby="description-count"
              />
              <p
                id="description-count"
                className={`text-xs ${draft.description.trim().length >= 40 ? "text-emerald-700" : "text-muted-foreground"}`}
              >
                {draft.description.length} / 4000 characters · at least 40
                required for publication.
              </p>
            </div>
            <div className="space-y-3">
              <Label htmlFor="featureDraft">Features</Label>
              <div className="flex gap-2">
                <Input
                  id="featureDraft"
                  value={featureDraft}
                  maxLength={80}
                  onChange={(event) => {
                    setFeatureDraft(event.currentTarget.value);
                    setFeatureError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const result = addFeature(draft.features, featureDraft);
                      setFeatureError(result.error);
                      if (!result.error) {
                        change("features", result.features);
                        setFeatureDraft("");
                      }
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.features.length >= 50}
                  onClick={() => {
                    const result = addFeature(draft.features, featureDraft);
                    setFeatureError(result.error);
                    if (!result.error) {
                      change("features", result.features);
                      setFeatureDraft("");
                    }
                  }}
                >
                  <PlusIcon aria-hidden="true" /> Add
                </Button>
              </div>
              {featureError ? (
                <p role="alert" className="text-xs text-destructive">
                  {featureError}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {draft.features.length} of 50 features. Exact duplicates are not
                allowed.
              </p>
              <ul
                className="flex flex-wrap gap-2"
                aria-label="Vehicle features"
              >
                {draft.features.map((feature, index) => (
                  <li
                    key={`${feature}-${index}`}
                    className="flex items-center gap-1 rounded-full border bg-muted/30 px-3 py-1.5 text-sm"
                  >
                    <span>{feature}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${feature}`}
                      className="rounded p-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        change("features", removeFeature(draft.features, index))
                      }
                    >
                      <XIcon aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {vehicle !== null && initialGallery !== null ? (
          <div className={step === 6 ? "space-y-4" : "hidden"}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Images</p>
                <p className="text-lg font-semibold">
                  {vehicle.images.length} / 15
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Cover</p>
                <p className="text-sm font-medium">
                  {vehicle.coverImage ? "Selected" : "Missing"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  Missing alt text
                </p>
                <p className="text-lg font-semibold">
                  {
                    vehicle.images.filter((image) => !image.altText?.trim())
                      .length
                  }
                </p>
              </div>
            </div>
            <VehicleGalleryManager
              vehicleId={vehicle.id}
              vehicle={{
                brandName: vehicle.brandName,
                model: vehicle.model,
                year: vehicle.year,
              }}
              initialGallery={initialGallery}
              onGalleryChanged={refreshVehicle}
            />
          </div>
        ) : null}

        {step === 7 && vehicle !== null ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Review
                title="Basics"
                rows={[
                  [
                    "Vehicle",
                    `${vehicle.year} ${vehicle.brandName} ${vehicle.model}`,
                  ],
                  ["Location", vehicle.location ?? "—"],
                  ["Body type", pretty(vehicle.bodyType)],
                  ["Condition", pretty(vehicle.condition)],
                  ["Transmission", pretty(vehicle.transmission)],
                  ["Fuel type", pretty(vehicle.fuelType)],
                  [
                    "Drivetrain",
                    vehicle.drivetrain ? pretty(vehicle.drivetrain) : "—",
                  ],
                ]}
              />
              <Review
                title="Modes and pricing"
                rows={[
                  [
                    "Sale",
                    vehicle.isForSale
                      ? `${pretty(vehicle.saleStatus ?? "unavailable")} · ${vehicle.salePrice == null ? "—" : formatTzs(vehicle.salePrice)}`
                      : "Disabled",
                  ],
                  [
                    "Rental",
                    vehicle.isForRent
                      ? `${pretty(vehicle.rentalStatus ?? "unavailable")} · ${vehicle.rentalDailyPrice == null ? "—" : `${formatTzs(vehicle.rentalDailyPrice)}/day`}`
                      : "Disabled",
                  ],
                ]}
              />
              <Review
                title="Driver arrangement"
                rows={[
                  ["Option", pretty(vehicle.driverOption)],
                  ["Note", vehicle.driverNote ?? "—"],
                ]}
              />
              <Review
                title="Specifications"
                rows={[
                  [
                    "Mileage",
                    vehicle.mileageKm == null
                      ? "—"
                      : `${vehicle.mileageKm.toLocaleString("en-TZ")} km`,
                  ],
                  [
                    "Seats / doors",
                    `${vehicle.seats ?? "—"} / ${vehicle.doors ?? "—"}`,
                  ],
                  [
                    "Colours",
                    `${vehicle.exteriorColor ?? "—"} / ${vehicle.interiorColor ?? "—"}`,
                  ],
                  [
                    "Engine",
                    [
                      vehicle.engineCc == null ? "" : `${vehicle.engineCc} cc`,
                      vehicle.engineDescription ?? "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—",
                  ],
                ]}
              />
              <Review
                title="Description and features"
                rows={[
                  ["Description", vehicle.description ?? "—"],
                  [
                    "Features",
                    vehicle.features.length ? vehicle.features.join(", ") : "—",
                  ],
                ]}
              />
              <Review
                title="Gallery"
                rows={[
                  ["Images", String(vehicle.images.length)],
                  ["Cover", vehicle.coverImage?.altText ?? "Missing"],
                ]}
              />
            </div>
            <section className="rounded-xl border border-amber-300 bg-amber-50/50 p-4">
              <h3 className="font-semibold text-amber-900">
                Private · administrators only
              </h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-amber-800">
                    Registration number
                  </dt>
                  <dd className="font-medium">
                    {vehicle.registrationNumber ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-amber-800">Chassis number</dt>
                  <dd className="font-medium">
                    {vehicle.chassisNumber ?? "—"}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="rounded-xl border p-4">
              <h3 className="font-semibold">Publication checklist</h3>
              {vehicle.publicationReadiness.missing.length === 0 ? (
                <p className="mt-2 text-sm text-emerald-700">
                  Every server requirement is satisfied.
                </p>
              ) : (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {VEHICLE_FORM_STEPS.map((formStep) => {
                    const missing =
                      vehicle.publicationReadiness.checklist.filter(
                        (item) =>
                          !item.met &&
                          REQUIREMENT_STEP[item.key] === formStep.id,
                      );
                    if (missing.length === 0) return null;
                    return (
                      <section
                        key={formStep.id}
                        className="rounded-lg border p-3"
                      >
                        <h4 className="text-sm font-semibold">
                          Step {formStep.id} · {formStep.label}
                        </h4>
                        <ul className="mt-2 space-y-2">
                          {missing.map((item) => (
                            <li key={item.key}>
                              <button
                                type="button"
                                className="text-left text-sm text-destructive underline underline-offset-4"
                                onClick={() => goToStep(formStep.id)}
                              >
                                {item.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="lg"
                disabled={
                  saving ||
                  !vehicle.publicationReadiness.ready ||
                  vehicle.listingState === "published"
                }
                onClick={() => void publish()}
              >
                <SendIcon aria-hidden="true" />
                {vehicle.listingState === "published"
                  ? "Published"
                  : "Publish vehicle"}
              </Button>
              {vehicle.listingState === "published" ? (
                <Button asChild variant="outline">
                  <Link href={`/cars/${vehicle.slug}`}>Open public detail</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <Button
            type="button"
            variant="outline"
            disabled={saving || step === 1}
            onClick={() => goToStep((step - 1) as VehicleFormStep)}
          >
            <ChevronLeftIcon aria-hidden="true" /> Previous
          </Button>
          <div className="flex flex-wrap gap-2">
            {vehicle !== null && step < 7 ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving || !dirty}
                onClick={() => void saveCurrent(false)}
              >
                {saving ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
            {step < 7 ? (
              <Button
                type="submit"
                disabled={saving || (step === 1 && brands.length === 0)}
              >
                {step === 1 && vehicle === null
                  ? "Create draft and continue"
                  : saving
                    ? "Saving…"
                    : "Save and continue"}
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}

function Review({
  title,
  rows,
}: {
  title: string;
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <section className="rounded-xl border p-4">
      <h3 className="font-semibold">{title}</h3>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
