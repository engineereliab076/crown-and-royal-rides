import "server-only";

import { AuthError, CredentialsSignin } from "next-auth";

/** Safe Auth.js error codes used by the login server action. */
export const AUTHENTICATION_UNAVAILABLE_CODE =
  "authentication_unavailable" as const;
export const AUTHENTICATION_INTERNAL_CODE = "authentication_internal" as const;

/** A genuine quota rejection. This remains the existing safe rate-limit path. */
export class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Fail-closed provider/configuration failure; never an invalid-credential error.
 * Carries the attempt's server-generated correlation ID so the login UI can show
 * a support reference that matches the safe diagnostic event in the logs.
 */
export class AuthenticationUnavailable extends AuthError {
  readonly code = AUTHENTICATION_UNAVAILABLE_CODE;
  readonly correlationId?: string;

  constructor(correlationId?: string) {
    super("Authentication is temporarily unavailable.");
    this.name = "AuthenticationUnavailable";
    this.correlationId = correlationId;
  }
}

/** Unexpected authorize failure, safely classified without sensitive context. */
export class AuthenticationInternalFailure extends AuthError {
  readonly code = AUTHENTICATION_INTERNAL_CODE;
  readonly correlationId?: string;

  constructor(correlationId?: string) {
    super("Authentication failed because of an internal error.");
    this.name = "AuthenticationInternalFailure";
    this.correlationId = correlationId;
  }
}
