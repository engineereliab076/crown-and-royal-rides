import type { PublicationRequirement } from "@/server/modules/vehicles/dto";
import {
  LISTING_STATES,
  RENTAL_STATUSES,
  SALE_STATUSES,
} from "@/lib/vehicle-values";

export const VEHICLE_FORM_STEPS = [
  { id: 1, key: "basics", label: "Basics" },
  { id: 2, key: "modes-and-pricing", label: "Modes and pricing" },
  { id: 3, key: "driver-arrangement", label: "Driver arrangement" },
  { id: 4, key: "specifications", label: "Specifications" },
  { id: 5, key: "description-and-features", label: "Description and features" },
  { id: 6, key: "images", label: "Images" },
  { id: 7, key: "review", label: "Review" },
] as const;

export type VehicleFormStep = (typeof VEHICLE_FORM_STEPS)[number]["id"];

export const REQUIREMENT_STEP: Readonly<
  Record<PublicationRequirement, VehicleFormStep>
> = {
  brand: 1,
  model: 1,
  year: 1,
  bodyType: 1,
  condition: 1,
  transmission: 1,
  fuelType: 1,
  drivetrain: 1,
  location: 1,
  commercialMode: 2,
  saleStatus: 2,
  salePrice: 2,
  rentalStatus: 2,
  rentalDailyPrice: 2,
  minRentalDays: 2,
  driverNote: 3,
  mileageKm: 4,
  exteriorColor: 4,
  seats: 4,
  description: 5,
  image: 6,
  coverImage: 6,
  imageAltText: 6,
};

export function normalizeStep(
  value: string | number | undefined,
): VehicleFormStep {
  const parsed = typeof value === "number" ? value : Number(value);
  return parsed >= 1 && parsed <= 7 && Number.isInteger(parsed)
    ? (parsed as VehicleFormStep)
    : 1;
}

export function stepHref(vehicleId: string, step: VehicleFormStep): string {
  return `/admin/vehicles/${vehicleId}/edit?step=${step}`;
}

export function vehicleStepStates(
  current: VehicleFormStep,
  checklist: readonly { key: PublicationRequirement; met: boolean }[] | null,
) {
  return VEHICLE_FORM_STEPS.map((step) => {
    const requirements = checklist?.filter(
      (item) => REQUIREMENT_STEP[item.key] === step.id,
    );
    const complete =
      step.id === 7
        ? checklist?.every((item) => item.met) === true
        : requirements !== undefined &&
          requirements.length > 0 &&
          requirements.every((item) => item.met);
    return {
      ...step,
      current: step.id === current,
      complete,
      incomplete: step.id !== current && !complete,
    };
  });
}

export function addFeature(
  features: readonly string[],
  rawValue: string,
): { features: readonly string[]; error: string | null } {
  const value = rawValue.trim();
  if (value.length === 0)
    return { features, error: "Enter a feature before adding it." };
  if (value.length > 80)
    return { features, error: "A feature must be at most 80 characters." };
  if (features.includes(value))
    return { features, error: "That feature is already listed." };
  if (features.length >= 50)
    return { features, error: "A vehicle may have at most 50 features." };
  return { features: [...features, value], error: null };
}

export function removeFeature(
  features: readonly string[],
  index: number,
): readonly string[] {
  return features.filter((_feature, featureIndex) => featureIndex !== index);
}

export interface VehicleFilterState {
  readonly search: string;
  readonly listingState: string;
  readonly saleStatus: string;
  readonly rentalStatus: string;
  readonly isForSale: string;
  readonly isForRent: string;
  readonly featured: string;
  readonly verified: string;
  readonly brandId: string;
  readonly page: number;
  readonly limit: number;
}

export const EMPTY_VEHICLE_FILTERS: VehicleFilterState = Object.freeze({
  search: "",
  listingState: "",
  saleStatus: "",
  rentalStatus: "",
  isForSale: "",
  isForRent: "",
  featured: "",
  verified: "",
  brandId: "",
  page: 1,
  limit: 20,
});

const PRIVATE_FILTER_KEYS = new Set([
  "registrationNumber",
  "chassisNumber",
  "registration_number",
  "chassis_number",
]);

export function parseVehicleFilters(
  values: Readonly<Record<string, string | string[] | undefined>>,
): VehicleFilterState {
  const read = (key: keyof VehicleFilterState): string => {
    if (PRIVATE_FILTER_KEYS.has(key)) return "";
    const value = values[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const page = Number(read("page"));
  const limit = Number(read("limit"));
  const listed = <T extends string>(
    value: string,
    allowed: readonly T[],
  ): T | "" => (allowed.includes(value as T) ? (value as T) : "");
  const boolean = (value: string): string =>
    value === "true" || value === "false" ? value : "";
  const uuid = (value: string): string =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
      ? value
      : "";
  return {
    search: read("search").slice(0, 120),
    listingState: listed(read("listingState"), LISTING_STATES),
    saleStatus: listed(read("saleStatus"), SALE_STATUSES),
    rentalStatus: listed(read("rentalStatus"), RENTAL_STATUSES),
    isForSale: boolean(read("isForSale")),
    isForRent: boolean(read("isForRent")),
    featured: boolean(read("featured")),
    verified: boolean(read("verified")),
    brandId: uuid(read("brandId")),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20,
  };
}

export function serializeVehicleFilters(
  filters: VehicleFilterState,
  overrides: Partial<VehicleFilterState> = {},
): string {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const key of [
    "search",
    "listingState",
    "saleStatus",
    "rentalStatus",
    "isForSale",
    "isForRent",
    "featured",
    "verified",
    "brandId",
  ] as const) {
    const value = next[key].trim();
    if (value.length > 0) params.set(key, value);
  }
  if (next.page > 1) params.set("page", String(next.page));
  if (next.limit !== 20) params.set("limit", String(next.limit));
  const query = params.toString();
  return query.length === 0 ? "/admin/vehicles" : `/admin/vehicles?${query}`;
}

export function transitionActionForStatus(
  mode: "sale" | "rental",
  status: string,
): string {
  return `${mode}_${status}`;
}

export interface VehicleModeSnapshot {
  readonly isForSale: boolean;
  readonly saleStatus: string | null;
  readonly isForRent: boolean;
  readonly rentalStatus: string | null;
}

export interface VehicleModeDraft {
  readonly isForSale: boolean;
  readonly saleStatus: string;
  readonly salePrice: number | null;
  readonly isNegotiable: boolean;
  readonly isForRent: boolean;
  readonly rentalStatus: string;
  readonly rentalDailyPrice: number | null;
  readonly minRentalDays: number | null;
}

/**
 * Builds the database-consistent mode PATCH and separates subsequent status
 * changes so callers can send them through the transition endpoint.
 */
export function buildVehicleModePlan(
  current: VehicleModeSnapshot,
  draft: VehicleModeDraft,
) {
  const saleStatus =
    current.isForSale && draft.isForSale
      ? current.saleStatus
      : draft.isForSale
        ? draft.saleStatus
        : null;
  const rentalStatus =
    current.isForRent && draft.isForRent
      ? current.rentalStatus
      : draft.isForRent
        ? draft.rentalStatus
        : null;
  const transitions = [
    ...(current.isForSale &&
    draft.isForSale &&
    current.saleStatus !== draft.saleStatus
      ? [transitionActionForStatus("sale", draft.saleStatus)]
      : []),
    ...(current.isForRent &&
    draft.isForRent &&
    current.rentalStatus !== draft.rentalStatus
      ? [transitionActionForStatus("rental", draft.rentalStatus)]
      : []),
  ];
  return {
    data: {
      isForSale: draft.isForSale,
      saleStatus,
      salePrice: draft.isForSale ? draft.salePrice : null,
      isNegotiable: draft.isNegotiable,
      isForRent: draft.isForRent,
      rentalStatus,
      rentalDailyPrice: draft.isForRent ? draft.rentalDailyPrice : null,
      minRentalDays: draft.isForRent ? draft.minRentalDays : null,
    },
    transitions,
  } as const;
}
