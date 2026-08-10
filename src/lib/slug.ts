const INVALID_SLUG_MESSAGE = "Value must contain characters usable in a slug.";

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g,
      "",
    )
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new TypeError(INVALID_SLUG_MESSAGE);
  }

  return slug;
}

export function createVehicleSlug(input: {
  brand: string;
  model: string;
  year: number;
  shortId: string;
}): string {
  if (
    !Number.isSafeInteger(input.year) ||
    input.year < 1980 ||
    input.year > 2100
  ) {
    throw new TypeError(
      "Vehicle year must be a safe integer from 1980 through 2100.",
    );
  }

  return `${slugify(input.brand)}-${slugify(input.model)}-${input.year}-${slugify(input.shortId)}`;
}

export function createPackageSlug(input: {
  destination: string;
  descriptor: string;
}): string {
  return `${slugify(input.destination)}-${slugify(input.descriptor)}`;
}
