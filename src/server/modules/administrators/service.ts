import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AdminRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/http/errors";
import type { AuditContext } from "@/server/modules/audit-log/context";
import type { AuditLogRepository } from "@/server/modules/audit-log/repository";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import { hashPassword as defaultHashPassword } from "@/server/modules/auth/password";
import {
  createAdministratorSchema,
  administratorIdSchema,
  administratorListSchema,
  setAdministratorRoleSchema,
  type AdministratorListInput,
  type CreateAdministratorInput,
  type SetAdministratorRoleInput,
} from "@/server/modules/administrators/schemas";
import type {
  AdministratorPage,
  AdministratorRepository,
  PublicAdministrator,
} from "@/server/modules/administrators/repository";
import type { AdministratorRateLimiter } from "@/server/modules/administrators/rate-limit";
import { generateTemporaryPassword as defaultGenerateTemporaryPassword } from "@/server/modules/administrators/temporary-password";

export const ADMIN_AUDIT_ACTIONS = Object.freeze({
  created: "administrator.created",
  roleChanged: "administrator.role_changed",
  deactivated: "administrator.deactivated",
  reactivated: "administrator.reactivated",
  passwordReset: "administrator.password_reset",
} as const);

export interface AdministratorTransactionRepositories {
  readonly administrators: AdministratorRepository;
  readonly auditLog: AuditLogRepository;
}

export type AdministratorTransactionRunner = <T>(
  operation: (repositories: AdministratorTransactionRepositories) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
) => Promise<T>;

export interface TemporaryPasswordResult {
  readonly administrator: PublicAdministrator;
  readonly temporaryPassword: string;
}

export interface AdministratorService {
  list(
    actor: AuthenticatedActor,
    input: AdministratorListInput,
  ): Promise<AdministratorPage>;
  createAdmin(
    actor: AuthenticatedActor,
    input: CreateAdministratorInput,
    context: AuditContext,
  ): Promise<TemporaryPasswordResult>;
  setRole(
    actor: AuthenticatedActor,
    id: string,
    input: SetAdministratorRoleInput,
    context: AuditContext,
  ): Promise<PublicAdministrator>;
  deactivate(
    actor: AuthenticatedActor,
    id: string,
    context: AuditContext,
  ): Promise<PublicAdministrator>;
  reactivate(
    actor: AuthenticatedActor,
    id: string,
    context: AuditContext,
  ): Promise<PublicAdministrator>;
  resetPassword(
    actor: AuthenticatedActor,
    id: string,
    context: AuditContext,
  ): Promise<TemporaryPasswordResult>;
}

export interface AdministratorServiceDependencies {
  readonly repository: AdministratorRepository;
  readonly transaction: AdministratorTransactionRunner;
  readonly rateLimiter: AdministratorRateLimiter;
  readonly hashPassword?: (password: string) => Promise<string>;
  readonly generateTemporaryPassword?: () => string;
}

function validationError(message: string): AppError {
  return new AppError({ status: 422, code: "VALIDATION_ERROR", message });
}

function notFound(): AppError {
  return new AppError({
    status: 404,
    code: "ADMINISTRATOR_NOT_FOUND",
    message: "Administrator not found.",
  });
}

function lastActiveOwner(): AppError {
  return new AppError({
    status: 409,
    code: "LAST_ACTIVE_OWNER",
    message: "The last active owner cannot be deactivated or demoted.",
  });
}

function isDatabaseCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (isDatabaseCode(error, "P2034")) return true;
  if (!isDatabaseCode(error, "P2010")) return false;
  const meta = (error as { meta?: unknown }).meta;
  if (
    typeof meta !== "object" ||
    meta === null ||
    !("driverAdapterError" in meta)
  ) {
    return false;
  }
  const driverError = (meta as { driverAdapterError?: unknown })
    .driverAdapterError;
  if (
    typeof driverError !== "object" ||
    driverError === null ||
    !("cause" in driverError)
  ) {
    return false;
  }
  const cause = (driverError as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return false;
  const postgresCode = (cause as { originalCode?: unknown }).originalCode;
  return postgresCode === "40001" || postgresCode === "40P01";
}

function retryAfterHeaders(retryAfterMs: number | undefined) {
  return retryAfterMs === undefined
    ? undefined
    : { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) };
}

async function appendAudit(
  repository: AuditLogRepository,
  actor: AuthenticatedActor,
  targetId: string,
  action: string,
  metadata: Readonly<Record<string, Prisma.InputJsonValue>>,
  context: AuditContext,
): Promise<void> {
  await repository.append({
    actorId: actor.id,
    action,
    targetType: "administrator",
    targetId,
    metadata: {
      correlationId: context.correlationId,
      ...metadata,
    },
    ipHash: context.ipHash,
  });
}

/** Three total attempts, only for recognized serialization/deadlock conflicts. */
async function runSerializableWithRetry<T>(
  transaction: AdministratorTransactionRunner,
  operation: (repositories: AdministratorTransactionRepositories) => Promise<T>,
): Promise<T> {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (
        !isRetryableTransactionConflict(error) ||
        attempt === maximumAttempts
      ) {
        if (isRetryableTransactionConflict(error)) {
          throw new AppError({
            status: 409,
            code: "CONCURRENT_ADMIN_UPDATE",
            message: "The administrator changed concurrently. Try again.",
          });
        }
        throw error;
      }
    }
  }
  throw new Error("Unreachable serializable retry state.");
}

export function createAdministratorService(
  deps: AdministratorServiceDependencies,
): AdministratorService {
  const hashPassword = deps.hashPassword ?? defaultHashPassword;
  const generateTemporaryPassword =
    deps.generateTemporaryPassword ?? defaultGenerateTemporaryPassword;

  return {
    async list(actor, rawInput) {
      requireCapability(actor, "admin:manage");
      const parsed = administratorListSchema.safeParse(rawInput);
      if (!parsed.success)
        throw validationError("Invalid administrator query.");
      return deps.repository.list(parsed.data);
    },

    async createAdmin(actor, rawInput, context) {
      requireCapability(actor, "admin:manage");
      const parsed = createAdministratorSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw validationError("Invalid administrator details.");
      }

      if (await deps.repository.findByEmail(parsed.data.email)) {
        throw new AppError({
          status: 409,
          code: "ADMIN_EMAIL_EXISTS",
          message: "An administrator with that email already exists.",
        });
      }

      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      try {
        const administrator = await deps.transaction(async (repositories) => {
          const created = await repositories.administrators.create({
            ...parsed.data,
            passwordHash,
            createdById: actor.id,
          });
          await appendAudit(
            repositories.auditLog,
            actor,
            created.id,
            ADMIN_AUDIT_ACTIONS.created,
            {
              after: {
                role: created.role,
                isActive: true,
                mustChangePassword: true,
              },
            },
            context,
          );
          return created;
        });
        return { administrator, temporaryPassword };
      } catch (error) {
        if (isDatabaseCode(error, "P2002")) {
          throw new AppError({
            status: 409,
            code: "ADMIN_EMAIL_EXISTS",
            message: "An administrator with that email already exists.",
          });
        }
        throw error;
      }
    },

    async setRole(actor, rawId, rawInput, context) {
      requireCapability(actor, "admin:manage");
      const id = administratorIdSchema.safeParse(rawId);
      const input = setAdministratorRoleSchema.safeParse(rawInput);
      if (!id.success || !input.success) {
        throw validationError("Invalid administrator role change.");
      }

      return runSerializableWithRetry(
        deps.transaction,
        async (repositories) => {
          const lockedOwners =
            await repositories.administrators.lockActiveOwners();
          const target = await repositories.administrators.findById(id.data);
          if (target === null) throw notFound();
          if (target.role === input.data.role) return target;
          if (
            target.isActive &&
            target.role === AdminRole.owner &&
            input.data.role === AdminRole.manager &&
            lockedOwners.length <= 1
          ) {
            throw lastActiveOwner();
          }
          const updated = await repositories.administrators.setRole(
            id.data,
            input.data.role,
          );
          await appendAudit(
            repositories.auditLog,
            actor,
            updated.id,
            ADMIN_AUDIT_ACTIONS.roleChanged,
            { before: { role: target.role }, after: { role: updated.role } },
            context,
          );
          return updated;
        },
      );
    },

    async deactivate(actor, rawId, context) {
      requireCapability(actor, "admin:manage");
      const id = administratorIdSchema.safeParse(rawId);
      if (!id.success) throw validationError("Invalid administrator ID.");

      return runSerializableWithRetry(
        deps.transaction,
        async (repositories) => {
          const lockedOwners =
            await repositories.administrators.lockActiveOwners();
          const target = await repositories.administrators.findById(id.data);
          if (target === null) throw notFound();
          if (!target.isActive) return target;
          if (target.role === AdminRole.owner && lockedOwners.length <= 1) {
            throw lastActiveOwner();
          }
          const updated = await repositories.administrators.deactivate(id.data);
          await appendAudit(
            repositories.auditLog,
            actor,
            updated.id,
            ADMIN_AUDIT_ACTIONS.deactivated,
            { before: { isActive: true }, after: { isActive: false } },
            context,
          );
          return updated;
        },
      );
    },

    async reactivate(actor, rawId, context) {
      requireCapability(actor, "admin:manage");
      const id = administratorIdSchema.safeParse(rawId);
      if (!id.success) throw validationError("Invalid administrator ID.");

      return deps.transaction(async (repositories) => {
        const target = await repositories.administrators.findById(id.data);
        if (target === null) throw notFound();
        if (target.isActive) return target;
        const updated = await repositories.administrators.reactivate(id.data);
        await appendAudit(
          repositories.auditLog,
          actor,
          updated.id,
          ADMIN_AUDIT_ACTIONS.reactivated,
          { before: { isActive: false }, after: { isActive: true } },
          context,
        );
        return updated;
      });
    },

    async resetPassword(actor, rawId, context) {
      requireCapability(actor, "admin:manage");
      const id = administratorIdSchema.safeParse(rawId);
      if (!id.success) throw validationError("Invalid administrator ID.");

      const decision = await deps.rateLimiter.checkPasswordReset({
        actorId: actor.id,
        targetId: id.data,
      });
      if (!decision.allowed) {
        throw new AppError({
          status: 429,
          code: "RATE_LIMITED",
          message: "Too many password reset attempts. Try again later.",
          headers: retryAfterHeaders(decision.retryAfterMs),
        });
      }

      // Generation and hashing happen only after the fail-closed limiter allows.
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const administrator = await deps.transaction(async (repositories) => {
        const target = await repositories.administrators.findById(id.data);
        if (target === null) throw notFound();
        const updated = await repositories.administrators.resetPassword(
          id.data,
          passwordHash,
        );
        await appendAudit(
          repositories.auditLog,
          actor,
          updated.id,
          ADMIN_AUDIT_ACTIONS.passwordReset,
          {
            before: { mustChangePassword: target.mustChangePassword },
            after: { mustChangePassword: true },
            sessionInvalidated: true,
          },
          context,
        );
        return updated;
      });
      return { administrator, temporaryPassword };
    },
  };
}
