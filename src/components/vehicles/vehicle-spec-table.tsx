import { cn } from "@/lib/utils";
import type { PublicVehicleDetail } from "@/server/modules/vehicles/public-dto";

/**
 * Accessible specification table rendered as a semantic description list.
 *
 * Only available, safe public specifications are rendered — a missing value is
 * omitted, never shown blank. Private identifiers (registration/chassis) are
 * not part of the public detail DTO and can never appear here.
 */

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

interface Row {
  readonly term: string;
  readonly value: string;
}

function buildRows(vehicle: PublicVehicleDetail): readonly Row[] {
  const rows: Row[] = [
    { term: "Body type", value: humanize(vehicle.bodyType) },
    { term: "Condition", value: humanize(vehicle.condition) },
    { term: "Transmission", value: humanize(vehicle.transmission) },
    { term: "Fuel type", value: humanize(vehicle.fuelType) },
  ];
  if (vehicle.drivetrain) {
    rows.push({
      term: "Drivetrain",
      value: vehicle.drivetrain.replaceAll("_", "-").toUpperCase(),
    });
  }
  if (vehicle.mileageKm !== null) {
    rows.push({
      term: "Mileage",
      value: `${NUMBER_FORMAT.format(vehicle.mileageKm)} km`,
    });
  }
  if (vehicle.engineCc !== null || vehicle.engineDescription) {
    const parts = [
      vehicle.engineCc !== null
        ? `${NUMBER_FORMAT.format(vehicle.engineCc)} cc`
        : null,
      vehicle.engineDescription,
    ].filter((part): part is string => part !== null && part.length > 0);
    if (parts.length > 0)
      rows.push({ term: "Engine", value: parts.join(" · ") });
  }
  if (vehicle.seats !== null) {
    rows.push({ term: "Seats", value: String(vehicle.seats) });
  }
  if (vehicle.doors !== null) {
    rows.push({ term: "Doors", value: String(vehicle.doors) });
  }
  if (vehicle.exteriorColor) {
    rows.push({ term: "Exterior colour", value: vehicle.exteriorColor });
  }
  if (vehicle.interiorColor) {
    rows.push({ term: "Interior colour", value: vehicle.interiorColor });
  }
  if (vehicle.location) {
    rows.push({ term: "Location", value: vehicle.location });
  }
  rows.push({
    term: "Driver arrangement",
    value: humanize(vehicle.driverOption),
  });
  if (vehicle.driverNote) {
    rows.push({ term: "Driver note", value: vehicle.driverNote });
  }
  return rows;
}

export function VehicleSpecTable({
  vehicle,
  className,
}: {
  vehicle: PublicVehicleDetail;
  className?: string;
}) {
  const rows = buildRows(vehicle);
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-1",
        className,
      )}
    >
      {rows.map((row) => (
        <div key={row.term}>
          <dt className="text-xs font-medium text-muted-foreground">
            {row.term}
          </dt>
          <dd className="mt-1 text-sm">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
