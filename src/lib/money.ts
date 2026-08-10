/**
 * Pure money utilities for whole Tanzanian shillings (TZS).
 *
 * All monetary amounts in this system are whole shillings. PostgreSQL stores
 * them as `BIGINT`, which Prisma surfaces as JavaScript `bigint`. A `bigint`
 * is not JSON serializable, so it must be converted to a guarded `number`
 * before it leaves the service layer in a DTO. These helpers make every such
 * conversion explicit and validated: invalid amounts are rejected, never
 * silently rounded, truncated, or clamped.
 */

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A valid number amount is a non-negative safe integer: finite, integral,
 * within `[0, Number.MAX_SAFE_INTEGER]`. Rejects `NaN`, infinities,
 * fractions, negatives, and unsafe integers.
 */
function assertValidNumberAmount(value: number, fn: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${fn}: value must be a non-negative safe integer amount of shillings`,
    );
  }
}

/**
 * Convert a database `bigint` amount of shillings to a JSON-safe `number`.
 * Throws {@link RangeError} for negatives or values above the safe-integer
 * ceiling. The result is confirmed to be a safe integer before returning.
 */
export function toShillings(value: bigint): number {
  if (value < BigInt(0) || value > MAX_SAFE_BIGINT) {
    throw new RangeError(
      "toShillings: value must be a non-negative bigint no greater than Number.MAX_SAFE_INTEGER",
    );
  }

  const result = Number(value);

  if (!Number.isSafeInteger(result)) {
    throw new RangeError(
      "toShillings: value could not be represented as a safe integer",
    );
  }

  return result;
}

/**
 * Convert an application `number` amount of shillings to a database `bigint`.
 * Validates the input as a non-negative safe integer before conversion; never
 * rounds, floors, or truncates.
 */
export function toBigIntShillings(value: number): bigint {
  assertValidNumberAmount(value, "toBigIntShillings");
  return BigInt(value);
}

const groupingFormatter = new Intl.NumberFormat("en-US", {
  useGrouping: true,
  maximumFractionDigits: 0,
});

/**
 * Format a valid `number` amount of shillings as a stable string such as
 * `TZS 1,500,000`: ASCII prefix, an ordinary ASCII space, ASCII comma
 * grouping, and no decimal digits. Rejects invalid amounts rather than
 * formatting them.
 */
export function formatTzs(value: number): string {
  assertValidNumberAmount(value, "formatTzs");
  return `TZS ${groupingFormatter.format(value)}`;
}
