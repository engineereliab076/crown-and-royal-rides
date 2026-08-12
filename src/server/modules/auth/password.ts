import "server-only";

import argon2 from "argon2";

/**
 * Password hashing and verification for administrator credentials.
 *
 * Argon2id is the only algorithm used. The cost parameters below are fixed
 * production security parameters and must not be lowered — not even to make
 * tests run faster. Argon2 generates a cryptographically secure random salt for
 * every hash internally, so no salt is passed, stored, or reused here.
 *
 * This module is server-only: the native `argon2` addon must never reach a
 * client bundle. Plaintext passwords are never stored, logged, returned, or
 * embedded in errors; verification failures (including malformed stored hashes)
 * resolve to `false` rather than throwing, so no internal detail leaks.
 */

/**
 * Fixed Argon2id parameters (architecture Section 20.2).
 *
 * - `memoryCost` is expressed in KiB, so 65536 KiB = 64 MiB.
 * - `timeCost` is the number of iterations.
 * - `parallelism` is the number of lanes.
 *
 * The encoded hash therefore carries `$argon2id$v=19$m=65536,...,t=3` with
 * `p=4`, and these values are asserted by the unit tests.
 */
export const ARGON2ID_PARAMETERS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const);

/**
 * Hash a plaintext password with Argon2id using the fixed production
 * parameters. Argon2 supplies a fresh secure random salt on every call, so the
 * same password produces a different encoded hash each time. The returned value
 * is the self-describing PHC string safe to persist as `passwordHash`.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_PARAMETERS);
}

/**
 * Verify a plaintext password against a stored Argon2id hash.
 *
 * Returns `true` only when the password matches. An incorrect password, an
 * empty or malformed stored hash, or any internal verification error all
 * resolve to `false` — never a throw — so callers cannot distinguish "wrong
 * password" from "corrupt hash", and no internal error detail (or the supplied
 * password) is ever surfaced.
 */
export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  if (typeof passwordHash !== "string" || passwordHash.length === 0) {
    return false;
  }

  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    // A malformed or unsupported stored hash makes argon2.verify throw. Treat
    // that as a failed verification without exposing the underlying error.
    return false;
  }
}
