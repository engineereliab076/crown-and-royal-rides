/**
 * Centralized public presentation state for a catalogue vehicle (Phase 6).
 *
 * This is the single source of truth that maps a safe public vehicle record to
 * its public-facing behavior: which commercial modes are actionable, whether a
 * price may be shown as a live/available price, whether inquiry and WhatsApp
 * actions are permitted, whether the page is indexable, and which status badge
 * to render. Pages and components must consume this result rather than
 * re-deriving the business rules independently.
 *
 * The module is intentionally pure and client-safe: it imports no server-only
 * code, no Prisma, and no provider SDK. It operates only on already-mapped,
 * JSON-safe values so its output can be computed on the server and passed
 * verbatim to client components.
 */

/** The four mutually exclusive public presentation states. */
export type PublicVehicleState =
  "active" | "sold-historical" | "retired" | "unavailable";

/** The status badge a card or detail header should render. */
export type PublicVehicleBadge =
  | "for-sale"
  | "for-rent"
  | "for-sale-and-rent"
  | "reserved"
  | "sold"
  | "retired"
  | "unavailable";

/** Robots directive derived from the presentation state. */
export interface RobotsDirective {
  readonly index: boolean;
  readonly follow: boolean;
}

/**
 * The complete resolved presentation state. Every field is a plain boolean,
 * string, or nested plain object so the whole result serializes safely.
 */
export interface VehiclePublicState {
  readonly state: PublicVehicleState;
  /** Sale mode is actionable now (a purchase/inquiry may be initiated). */
  readonly saleActionable: boolean;
  /** Rental mode is actionable now. */
  readonly rentalActionable: boolean;
  /** The sale price may be displayed as a live/available price. */
  readonly showSalePrice: boolean;
  /** The daily rental price may be displayed as a live/available price. */
  readonly showRentalPrice: boolean;
  /** A saved inquiry may be submitted for this vehicle. */
  readonly inquiryAllowed: boolean;
  /** A direct WhatsApp action may be offered for this vehicle. */
  readonly whatsappAllowed: boolean;
  /** Convenience mirror of `robots.index`. */
  readonly indexable: boolean;
  readonly robots: RobotsDirective;
  readonly badge: PublicVehicleBadge;
}

/**
 * The minimal safe fields the resolver needs. Deliberately narrow: no private
 * identifiers, timestamps, or relations. Prices are already JSON-safe numbers.
 */
export interface VehicleStateInput {
  readonly listingState: string;
  readonly isForSale: boolean;
  readonly saleStatus: string | null;
  readonly salePrice: number | null;
  readonly isForRent: boolean;
  readonly rentalStatus: string | null;
  readonly rentalDailyPrice: number | null;
  readonly minRentalDays: number | null;
}

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the public presentation state for a single vehicle record.
 *
 * The record is assumed to already be a published or archived vehicle; drafts
 * are excluded upstream (they resolve to 404) but are handled defensively here
 * as non-indexable with no actions.
 */
export function resolveVehiclePublicState(
  vehicle: VehicleStateInput,
): VehiclePublicState {
  const saleUsable =
    vehicle.isForSale &&
    (vehicle.saleStatus === "available" || vehicle.saleStatus === "reserved");
  const rentalUsable =
    vehicle.isForRent &&
    (vehicle.rentalStatus === "available" ||
      vehicle.rentalStatus === "reserved");

  let state: PublicVehicleState;
  if (vehicle.listingState === "archived") {
    // Retired maps to the archived listing state; never a distinct enum.
    state = "retired";
  } else if (vehicle.listingState !== "published") {
    // Drafts (and any unknown state) never render public actions.
    state = "unavailable";
  } else if (saleUsable || rentalUsable) {
    state = "active";
  } else if (vehicle.isForSale && vehicle.saleStatus === "sold") {
    state = "sold-historical";
  } else {
    state = "unavailable";
  }

  const active = state === "active";
  const saleActionable =
    active && vehicle.isForSale && vehicle.saleStatus === "available";
  const rentalActionable =
    active && vehicle.isForRent && vehicle.rentalStatus === "available";

  const showSalePrice = active && saleUsable && isPositive(vehicle.salePrice);
  const showRentalPrice =
    active && rentalUsable && isPositive(vehicle.rentalDailyPrice);

  const inquiryAllowed = saleActionable || rentalActionable;
  const whatsappAllowed = inquiryAllowed;

  const robots: RobotsDirective =
    state === "active"
      ? { index: true, follow: true }
      : state === "retired"
        ? { index: false, follow: false }
        : { index: false, follow: true };

  return {
    state,
    saleActionable,
    rentalActionable,
    showSalePrice,
    showRentalPrice,
    inquiryAllowed,
    whatsappAllowed,
    indexable: robots.index,
    robots,
    badge: resolveBadge(state, saleActionable, rentalActionable),
  };
}

function resolveBadge(
  state: PublicVehicleState,
  saleActionable: boolean,
  rentalActionable: boolean,
): PublicVehicleBadge {
  if (state === "sold-historical") return "sold";
  if (state === "retired") return "retired";
  if (state === "unavailable") return "unavailable";
  if (saleActionable && rentalActionable) return "for-sale-and-rent";
  if (saleActionable) return "for-sale";
  if (rentalActionable) return "for-rent";
  // Active but nothing currently available: a reserved/held listing.
  return "reserved";
}
