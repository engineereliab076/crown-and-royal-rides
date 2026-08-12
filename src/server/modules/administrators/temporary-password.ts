import "server-only";

import { randomInt } from "node:crypto";

import { passwordSchema } from "@/server/modules/auth/schemas";

const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_+?";
const ALL_CHARACTERS = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;
const TEMPORARY_PASSWORD_LENGTH = 20;

function choose(alphabet: string): string {
  return alphabet[randomInt(0, alphabet.length)] as string;
}

function secureShuffle(characters: string[]): void {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex] as string,
      characters[index] as string,
    ];
  }
}

/**
 * Generate a policy-compliant temporary password using only Node's
 * cryptographically secure random source. The plaintext is returned only to the
 * immediate service caller and must never be persisted or logged.
 */
export function generateTemporaryPassword(): string {
  const characters = [
    choose(LOWERCASE),
    choose(UPPERCASE),
    choose(DIGITS),
    choose(SYMBOLS),
  ];

  while (characters.length < TEMPORARY_PASSWORD_LENGTH) {
    characters.push(choose(ALL_CHARACTERS));
  }
  secureShuffle(characters);

  const password = characters.join("");
  return passwordSchema.parse(password);
}
