import { randomUUID } from "node:crypto";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createCorrelationId(): string {
  return randomUUID();
}

export function isValidCorrelationId(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}
