const SENSITIVE_KEY = /password|hash|secret|token|credential|database.?url/i;
const SENSITIVE_VALUE =
  /\$argon2|postgres(?:ql)?:\/\/|bearer\s+|eyJ[A-Za-z0-9_-]+\./i;

export function sanitizeAuditMetadata(value: unknown): unknown {
  if (typeof value === "string") {
    return SENSITIVE_VALUE.test(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) return value.map(sanitizeAuditMetadata);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeAuditMetadata(child),
      ]),
    );
  }
  return value;
}
