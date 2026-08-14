import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { AdminRole } from "@/generated/prisma/enums";
import { InMemoryEmailSender } from "@/server/integrations/email-sender/in-memory";
import { InMemoryErrorReporter } from "@/server/integrations/error-reporter/in-memory";
import { deliverPurchaseInquiryNotification } from "@/server/modules/inquiries/notification";
import { createPrismaInquiryRepository } from "@/server/modules/inquiries/repository";
import { createInquiryService } from "@/server/modules/inquiries/service";

import { setupDatabaseSuite } from "../support/lifecycle";

const suite = setupDatabaseSuite();

function client(): PrismaClient {
  return suite.getClient();
}

async function publishedVehicle() {
  const brand = await client().brand.create({
    data: { name: "Toyota", slug: "toyota-inquiry", sortOrder: 1 },
  });
  return client().vehicle.create({
    data: {
      brandId: brand.id,
      brandName: brand.name,
      model: "Prado Inquiry",
      slug: "toyota-prado-inquiry-2025",
      year: 2025,
      bodyType: "suv",
      condition: "foreign_used",
      transmission: "automatic",
      fuelType: "diesel",
      driverOption: "without_driver",
      listingState: "published",
      isForSale: true,
      saleStatus: "available",
      salePrice: BigInt(145_000_000),
      description: "A published vehicle used by the inquiry integration test.",
      publishedAt: new Date("2026-08-14T00:00:00.000Z"),
    },
  });
}

describe("purchase inquiry integration", () => {
  it("persists the immutable purchase subject and leaves vehicle state unchanged", async () => {
    const vehicle = await publishedVehicle();
    const repository = createPrismaInquiryRepository(client());
    const service = createInquiryService({
      repository,
      createReference: () => "CRR-ABCDEFGH",
    });
    const before = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
      select: { listingState: true, saleStatus: true, updatedAt: true },
    });
    const submission = await service.submitPurchaseInquiry(
      {
        vehicleId: vehicle.id,
        customerName: "Asha Mrema",
        customerPhone: "0712345678",
        customerEmail: "ASHA@EXAMPLE.TEST",
        message: "Please call me.",
      },
      { correlationId: "correlation" },
    );

    const stored = await client().inquiry.findUniqueOrThrow({
      where: { reference: submission.reference },
    });
    expect(stored).toMatchObject({
      reference: "CRR-ABCDEFGH",
      type: "purchase",
      status: "new",
      vehicleId: vehicle.id,
      packageId: null,
      preferredViewingAt: null,
      customerPhone: "+255712345678",
      customerEmail: "asha@example.test",
    });
    expect(stored.subjectSnapshot).toEqual(submission.subject);
    expect(await client().inquiry.count()).toBe(1);
    const after = await client().vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
      select: { listingState: true, saleStatus: true, updatedAt: true },
    });
    expect(after).toEqual(before);

    const admin = await service.listAdmin(
      { id: "actor", role: AdminRole.manager },
      { page: 1, limit: 20 },
    );
    expect(admin.items).toHaveLength(1);
    expect(admin.items[0]).toMatchObject({
      reference: "CRR-ABCDEFGH",
      subject: { brandName: "Toyota", model: "Prado Inquiry" },
    });
  });

  it("keeps the committed row when notification delivery fails", async () => {
    const vehicle = await publishedVehicle();
    const service = createInquiryService({
      repository: createPrismaInquiryRepository(client()),
      createReference: () => "CRR-BCDEFGHJ",
    });
    const submission = await service.submitPurchaseInquiry(
      {
        vehicleId: vehicle.id,
        customerName: "Neema John",
        customerPhone: "+255713000000",
      },
      { correlationId: "correlation" },
    );
    const sender = new InMemoryEmailSender();
    sender.failNext({ code: "TEST_FAILURE", reason: "simulated" });
    await deliverPurchaseInquiryNotification({
      emailSender: sender,
      errorReporter: new InMemoryErrorReporter(),
      recipients: ["inquiries@example.test"],
      submission,
      correlationId: "correlation",
    });
    expect(
      await client().inquiry.count({ where: { reference: "CRR-BCDEFGHJ" } }),
    ).toBe(1);
  });

  it("retries an existing unique reference and creates exactly one new row", async () => {
    const vehicle = await publishedVehicle();
    const repository = createPrismaInquiryRepository(client());
    await repository.createPurchaseInquiry({
      reference: "CRR-ABCDEFGH",
      vehicleId: vehicle.id,
      subjectSnapshot: {
        vehicleId: vehicle.id,
        slug: vehicle.slug,
        brandName: vehicle.brandName,
        model: vehicle.model,
        year: vehicle.year,
        salePrice: 145_000_000,
        driverOption: vehicle.driverOption,
      },
      customerName: "Existing",
      customerPhone: "+255710000000",
      customerEmail: null,
      message: null,
    });
    const references = ["CRR-ABCDEFGH", "CRR-CDEFGHJK"];
    const service = createInquiryService({
      repository,
      createReference: vi.fn(() => references.shift() ?? "CRR-DEFGHJKL"),
    });
    const submitted = await service.submitPurchaseInquiry(
      {
        vehicleId: vehicle.id,
        customerName: "New Customer",
        customerPhone: "0714000000",
      },
      { correlationId: "correlation" },
    );
    expect(submitted.reference).toBe("CRR-CDEFGHJK");
    expect(await client().inquiry.count()).toBe(2);
  });
});
