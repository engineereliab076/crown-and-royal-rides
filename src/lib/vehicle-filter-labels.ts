import type { VehicleSort } from "@/lib/vehicle-filters";

export const VEHICLE_VALUE_LABELS: Readonly<Record<string, string>> = {
  sedan: "Sedan",
  suv: "SUV",
  hatchback: "Hatchback",
  coupe: "Coupe",
  wagon: "Wagon",
  pickup: "Pickup",
  van: "Van",
  convertible: "Convertible",
  brand_new: "Brand new",
  foreign_used: "Foreign used",
  locally_used: "Locally used",
  automatic: "Automatic",
  manual: "Manual",
  petrol: "Petrol",
  diesel: "Diesel",
  hybrid: "Hybrid",
  electric: "Electric",
  fwd: "Front-wheel drive",
  rwd: "Rear-wheel drive",
  awd: "All-wheel drive",
  four_wd: "Four-wheel drive",
  with_driver: "With driver",
  without_driver: "Without driver",
};

export const SORT_LABELS: Readonly<Record<VehicleSort, string>> = {
  newest: "Newest",
  year_desc: "Year: newest first",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  relevance: "Relevance",
};

export function vehicleValueLabel(value: string): string {
  return VEHICLE_VALUE_LABELS[value] ?? value;
}
