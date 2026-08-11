export interface EmailTag {
  readonly name: string;
  readonly value: string;
}

export interface EmailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html?: string;
  readonly text?: string;
  readonly tags?: readonly EmailTag[];
}

export type SendOutcome =
  | Readonly<{ accepted: true; externalId: string }>
  | Readonly<{
      accepted: false;
      code: string;
      reason: string;
    }>;

export interface EmailFailure {
  readonly code: string;
  readonly reason: string;
}
