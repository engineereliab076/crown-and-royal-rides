export class IntegrationUnavailableError extends Error {
  readonly code = "INTEGRATION_UNAVAILABLE";

  constructor(cause?: unknown) {
    super("An external integration is temporarily unavailable.", { cause });
    this.name = "IntegrationUnavailableError";
  }
}
