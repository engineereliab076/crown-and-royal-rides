import { describe, expect, it } from "vitest";

import {
  ARGON2ID_PARAMETERS,
  hashPassword,
  verifyPassword,
} from "@/server/modules/auth/password";

const PASSWORD = "Correct-Horse-Battery-Staple-12";
const LEAK_MARKER = "SUPER_SECRET_LEAK_MARKER_password_1";

describe("hashPassword", () => {
  it("produces an Argon2id PHC-encoded hash", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("embeds the configured Argon2id parameters in the encoded hash", async () => {
    const hash = await hashPassword(PASSWORD);
    // Parameter order in the encoding is library-defined, so each parameter is
    // asserted independently rather than as a fixed substring.
    expect(hash).toContain(`m=${ARGON2ID_PARAMETERS.memoryCost}`);
    expect(hash).toContain(`t=${ARGON2ID_PARAMETERS.timeCost}`);
    expect(hash).toContain(`p=${ARGON2ID_PARAMETERS.parallelism}`);
    expect(ARGON2ID_PARAMETERS.memoryCost).toBe(65536);
    expect(ARGON2ID_PARAMETERS.timeCost).toBe(3);
    expect(ARGON2ID_PARAMETERS.parallelism).toBe(4);
  });

  it("uses a fresh random salt so the same password hashes differently", async () => {
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);
    expect(first).not.toBe(second);
  });

  it("never embeds the plaintext password in the encoded hash", async () => {
    const hash = await hashPassword(LEAK_MARKER);
    expect(hash).not.toContain(LEAK_MARKER);
  });
});

describe("verifyPassword", () => {
  it("returns true for the correct password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
  });

  it("returns false for an incorrect password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, "not-the-password")).toBe(false);
  });

  it.each([
    ["empty string", ""],
    ["not a hash", "definitely-not-a-hash"],
    ["truncated argon2 hash", "$argon2id$v=19$m=65536,p=4,t=3$deadbeef"],
    ["foreign algorithm", "$2b$10$abcdefghijklmnopqrstuv"],
  ])(
    "fails safely for a malformed stored hash (%s)",
    async (_label, stored) => {
      await expect(verifyPassword(stored, PASSWORD)).resolves.toBe(false);
    },
  );

  it("does not expose the supplied password when a hash is malformed", async () => {
    let thrown: unknown;
    let result: boolean | undefined;
    try {
      result = await verifyPassword("$argon2id$broken", LEAK_MARKER);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(result).toBe(false);
    // A thrown error is the only channel that could carry the plaintext; there
    // is none, so nothing can leak the marker.
    expect(String(thrown ?? "")).not.toContain(LEAK_MARKER);
  });
});
