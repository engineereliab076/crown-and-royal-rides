import "server-only";

import { AppError } from "@/server/http/errors";
import type { AuditContext } from "@/server/modules/audit-log/context";
import type { AuditLogRepository } from "@/server/modules/audit-log/repository";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import type {
  PublicBusinessSettings,
  SettingsRepository,
} from "@/server/modules/settings/repository";
import {
  updateBusinessSettingsSchema,
  type UpdateBusinessSettingsInput,
} from "@/server/modules/settings/schemas";

export const SETTINGS_AUDIT_ACTION = "settings.updated";

const EDITABLE_FIELDS = [
  "businessName",
  "whatsappNumber",
  "primaryPhone",
  "secondaryPhone",
  "email",
  "address",
  "openingHours",
  "socialLinks",
  "heroHeadline",
  "heroSubheadline",
  "inquiryNotificationEmails",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

export interface SettingsTransactionRepositories {
  readonly settings: SettingsRepository;
  readonly auditLog: AuditLogRepository;
}

export type SettingsTransactionRunner = <T>(
  operation: (repositories: SettingsTransactionRepositories) => Promise<T>,
) => Promise<T>;

export interface SettingsService {
  get(actor: AuthenticatedActor): Promise<PublicBusinessSettings>;
  update(
    actor: AuthenticatedActor,
    input: UpdateBusinessSettingsInput,
    context: AuditContext,
  ): Promise<PublicBusinessSettings>;
}

function notConfigured(): AppError {
  return new AppError({
    status: 404,
    code: "SETTINGS_NOT_CONFIGURED",
    message: "Business settings are not configured.",
  });
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function changedFields(
  current: PublicBusinessSettings,
  next: Record<EditableField, unknown>,
): readonly EditableField[] {
  return EDITABLE_FIELDS.filter(
    (field) => stableValue(current[field]) !== stableValue(next[field]),
  );
}

export function createSettingsService(input: {
  readonly repository: SettingsRepository;
  readonly transaction: SettingsTransactionRunner;
}): SettingsService {
  return {
    async get(actor) {
      requireCapability(actor, "settings:update");
      const settings = await input.repository.findSingleton();
      if (settings === null) throw notConfigured();
      return settings;
    },

    async update(actor, rawInput, context) {
      requireCapability(actor, "settings:update");
      const parsed = updateBusinessSettingsSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new AppError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "Invalid business settings.",
        });
      }

      return input.transaction(async (repositories) => {
        const current = await repositories.settings.findSingleton();
        if (current === null) throw notConfigured();
        const changes = changedFields(current, parsed.data);
        if (changes.length === 0) return current;

        const updated = await repositories.settings.updateSingleton({
          ...parsed.data,
          updatedById: actor.id,
        });
        await repositories.auditLog.append({
          actorId: actor.id,
          action: SETTINGS_AUDIT_ACTION,
          targetType: "business_settings",
          targetId: "1",
          metadata: {
            correlationId: context.correlationId,
            changedFields: [...changes],
          },
          ipHash: context.ipHash,
        });
        return updated;
      });
    },
  };
}
