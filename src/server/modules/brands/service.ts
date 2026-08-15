import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";
import { AppError } from "@/server/http/errors";
import type { AuditContext } from "@/server/modules/audit-log/context";
import type { AuditLogRepository } from "@/server/modules/audit-log/repository";
import type { AuthenticatedActor } from "@/server/modules/auth/capabilities";
import { requireCapability } from "@/server/modules/auth/capabilities";
import { toBrandDTO, type BrandDTO } from "@/server/modules/brands/dto";
import type { BrandRepository } from "@/server/modules/brands/repository";
import {
  brandParamsSchema,
  createBrandSchema,
  updateBrandSchema,
  type CreateBrandInput,
  type UpdateBrandInput,
} from "@/server/modules/brands/schemas";

export interface BrandTransactionRepositories {
  readonly brands: BrandRepository;
  readonly auditLog: AuditLogRepository;
}
export type BrandTransactionRunner = <T>(
  operation: (repositories: BrandTransactionRepositories) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
) => Promise<T>;
export interface BrandService {
  list(actor: AuthenticatedActor): Promise<readonly BrandDTO[]>;
  create(
    actor: AuthenticatedActor,
    input: CreateBrandInput,
    context: AuditContext,
  ): Promise<BrandDTO>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: UpdateBrandInput,
    context: AuditContext,
  ): Promise<BrandDTO>;
  remove(
    actor: AuthenticatedActor,
    id: string,
    context: AuditContext,
  ): Promise<BrandDTO>;
}
function invalid(message: string) {
  return new AppError({ status: 422, code: "VALIDATION_ERROR", message });
}
function notFound() {
  return new AppError({
    status: 404,
    code: "BRAND_NOT_FOUND",
    message: "Brand not found.",
  });
}
function unique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
async function audit(
  repository: AuditLogRepository,
  actor: AuthenticatedActor,
  brandId: string,
  action: string,
  metadata: Prisma.InputJsonObject,
  context: AuditContext,
) {
  await repository.append({
    actorId: actor.id,
    action,
    targetType: "brand",
    targetId: brandId,
    metadata: { correlationId: context.correlationId, ...metadata },
    ipHash: context.ipHash,
  });
}

export function createBrandService(input: {
  repository: BrandRepository;
  transaction: BrandTransactionRunner;
  suffix?: () => string;
  /**
   * Revalidate the public catalogue after a brand rename propagates. Invoked
   * only after the propagation transaction commits, and only when the rename
   * actually changed at least one vehicle's denormalized brand name. A failure
   * here never rolls back the committed rename.
   */
  revalidatePublicCatalogue?: () => void | Promise<void>;
  /** Report a post-commit revalidation failure without leaking private data. */
  reportCacheFailure?: (context: AuditContext) => void | Promise<void>;
}): BrandService {
  const suffix = input.suffix ?? (() => randomBytes(3).toString("hex"));

  async function revalidateAfterRename(context: AuditContext): Promise<void> {
    if (input.revalidatePublicCatalogue === undefined) return;
    try {
      await input.revalidatePublicCatalogue();
    } catch {
      if (input.reportCacheFailure !== undefined) {
        try {
          await input.reportCacheFailure(context);
        } catch {}
      }
    }
  }
  return {
    async list(actor) {
      requireCapability(actor, "content:manage");
      return (await input.repository.list()).map(toBrandDTO);
    },
    async create(actor, rawInput, context) {
      requireCapability(actor, "content:manage");
      const parsed = createBrandSchema.safeParse(rawInput);
      if (!parsed.success) throw invalid("Invalid brand details.");
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const slug =
          attempt === 1
            ? slugify(parsed.data.name)
            : `${slugify(parsed.data.name)}-${slugify(suffix())}`;
        try {
          const created = await input.transaction(
            async ({ brands, auditLog }) => {
              const brand = await brands.create({
                name: parsed.data.name,
                slug,
                logoUrl: parsed.data.logoUrl ?? null,
                sortOrder: parsed.data.sortOrder,
              });
              await audit(
                auditLog,
                actor,
                brand.id,
                "brand.created",
                { after: { name: brand.name, slug: brand.slug } },
                context,
              );
              return brand;
            },
          );
          return toBrandDTO(created);
        } catch (error) {
          if (!unique(error)) throw error;
          if (attempt === 3)
            throw new AppError({
              status: 409,
              code: "BRAND_CONFLICT",
              message: "A brand with that name or address already exists.",
            });
        }
      }
      throw new Error("Unreachable brand slug retry state.");
    },
    async update(actor, rawId, rawInput, context) {
      requireCapability(actor, "content:manage");
      const id = brandParamsSchema.safeParse({ id: rawId });
      const parsed = updateBrandSchema.safeParse(rawInput);
      if (!id.success || !parsed.success)
        throw invalid("Invalid brand update.");
      let propagatedPublicRename = false;
      try {
        const updated = await input.transaction(
          async ({ brands, auditLog }) => {
            if (!(await brands.lock(id.data.id))) throw notFound();
            const current = await brands.findById(id.data.id);
            if (current === null) throw notFound();
            const nameChanged =
              parsed.data.name !== undefined &&
              parsed.data.name !== current.name;
            const next = await brands.update(id.data.id, {
              ...(parsed.data.name === undefined
                ? {}
                : { name: parsed.data.name, slug: slugify(parsed.data.name) }),
              ...(parsed.data.logoUrl === undefined
                ? {}
                : { logoUrl: parsed.data.logoUrl }),
              ...(parsed.data.sortOrder === undefined
                ? {}
                : { sortOrder: parsed.data.sortOrder }),
            });
            const propagatedVehicles = nameChanged
              ? await brands.propagateVehicleBrandName(next.id, next.name)
              : 0;
            propagatedPublicRename = nameChanged && propagatedVehicles > 0;
            await audit(
              auditLog,
              actor,
              next.id,
              "brand.updated",
              {
                before: { name: current.name, slug: current.slug },
                after: { name: next.name, slug: next.slug },
                propagatedVehicles,
              },
              context,
            );
            return next;
          },
          { isolationLevel: "Serializable" },
        );
        // Revalidate the public catalogue only after the rename transaction
        // has committed, and only when it actually changed public vehicles.
        if (propagatedPublicRename) await revalidateAfterRename(context);
        return toBrandDTO(updated);
      } catch (error) {
        if (unique(error))
          throw new AppError({
            status: 409,
            code: "BRAND_CONFLICT",
            message: "A brand with that name or address already exists.",
          });
        throw error;
      }
    },
    async remove(actor, rawId, context) {
      requireCapability(actor, "content:manage");
      const id = brandParamsSchema.safeParse({ id: rawId });
      if (!id.success) throw invalid("Invalid brand ID.");
      const removed = await input.transaction(
        async ({ brands, auditLog }) => {
          if (!(await brands.lock(id.data.id))) throw notFound();
          const current = await brands.findById(id.data.id);
          if (current === null) throw notFound();
          if ((await brands.countVehicles(id.data.id)) > 0)
            throw new AppError({
              status: 409,
              code: "BRAND_IN_USE",
              message: "A brand used by vehicles cannot be deleted.",
            });
          const deleted = await brands.remove(id.data.id);
          await audit(
            auditLog,
            actor,
            deleted.id,
            "brand.deleted",
            { before: { name: deleted.name, slug: deleted.slug } },
            context,
          );
          return deleted;
        },
        { isolationLevel: "Serializable" },
      );
      return toBrandDTO(removed);
    },
  };
}
