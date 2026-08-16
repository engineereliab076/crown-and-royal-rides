import { performance } from "node:perf_hooks";

import { beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { parseVehicleFilters, type VehicleMode } from "@/lib/vehicle-filters";
import {
  createPrismaPublicVehicleRepository,
  type PublicVehicleRepository,
} from "@/server/modules/vehicles/public-repository";
import {
  createPublicVehicleService,
  type PublicVehicleCatalogueService,
} from "@/server/modules/vehicles/public-service";
import { setupDatabaseSuite } from "../support/lifecycle";
import { seedLargeCatalogue } from "../support/seed-catalogue";
import { truncateAllTables } from "../support/truncate";

/**
 * Phase 7, Group 1 — measured wall-clock regression budgets at realistic seeded
 * volume (~3000 vehicles). Timing wraps only repository/service query work:
 * seeding, ANALYZE, warm-ups, and connection establishment are all excluded.
 * Budgets are regression guards, not execution-plan assertions.
 */

const suite = setupDatabaseSuite({ truncateBeforeEach: false });

let repository: PublicVehicleRepository;
let service: PublicVehicleCatalogueService;
let usableDetailSlug: string;

function filtersFor(
  mode: VehicleMode,
  params: Record<string, string>,
) {
  return parseVehicleFilters(params, mode).filters;
}

interface Stats {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

async function measure(
  fn: () => Promise<unknown>,
  { warmups = 3, iterations = 30 } = {},
): Promise<Stats> {
  for (let i = 0; i < warmups; i += 1) await fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)]!;
  return { p50: at(0.5), p95: at(0.95), max: samples[samples.length - 1]! };
}

function report(label: string, stats: Stats, budget: number): void {
  console.log(
    `[perf] ${label.padEnd(28)} p50=${stats.p50.toFixed(1)}ms ` +
      `p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(1)}ms ` +
      `(budget p95<${budget}ms)`,
  );
}

describe("catalogue search performance (~3000 vehicles)", () => {
  beforeAll(async () => {
    const client: PrismaClient = suite.getClient();
    await truncateAllTables(client);
    const seeded = await seedLargeCatalogue(client, { vehicleCount: 3000 });
    usableDetailSlug = seeded.usableDetailSlug;
    // Give the planner fresh statistics; excluded from all timing below.
    await client.$executeRaw`ANALYZE "vehicles"`;
    await client.$executeRaw`ANALYZE "vehicle_images"`;
    await client.$executeRaw`ANALYZE "brands"`;
    // Establish the connection/pool before any measurement.
    await client.$queryRaw`SELECT 1`;
    repository = createPrismaPublicVehicleRepository(client);
    service = createPublicVehicleService({ repository });
  }, 120_000);

  it("meets the ordinary listing budget (p95 < 150ms)", async () => {
    const first = await measure(() =>
      service.executeCatalogueSearch({
        mode: "all",
        filters: filtersFor("all", {}),
        sort: "newest",
        page: 1,
      }),
    );
    report("listing newest p1", first, 150);
    expect(first.p95).toBeLessThan(150);

    const deep = await measure(() =>
      service.executeCatalogueSearch({
        mode: "all",
        filters: filtersFor("all", {}),
        sort: "newest",
        page: 20,
      }),
    );
    report("listing deep page 20", deep, 150);
    expect(deep.p95).toBeLessThan(150);
  });

  it("meets the listing budget under multiple filters (p95 < 150ms)", async () => {
    const sale = await measure(() =>
      service.executeCatalogueSearch({
        mode: "sale",
        filters: filtersFor("sale", {
          bodyType: "suv",
          condition: "foreign_used",
          yearMin: "2005",
          yearMax: "2022",
          priceMin: "10000000",
          priceMax: "150000000",
        }),
        sort: "price_asc",
        page: 1,
      }),
    );
    report("sale multi-filter", sale, 150);
    expect(sale.p95).toBeLessThan(150);

    const rental = await measure(() =>
      service.executeCatalogueSearch({
        mode: "rental",
        filters: filtersFor("rental", {
          bodyType: "sedan",
          transmission: "automatic",
          priceMin: "100000",
        }),
        sort: "newest",
        page: 1,
      }),
    );
    report("rental multi-filter", rental, 150);
    expect(rental.p95).toBeLessThan(150);
  });

  it("meets the search budget for full-text, typo, and relevance (p95 < 250ms)", async () => {
    const exact = await measure(() =>
      service.executeCatalogueSearch({
        mode: "all",
        filters: filtersFor("all", { q: "Corolla" }),
        sort: "newest",
        page: 1,
      }),
    );
    report("search exact full-text", exact, 250);
    expect(exact.p95).toBeLessThan(250);

    const typo = await measure(() =>
      service.executeCatalogueSearch({
        mode: "all",
        filters: filtersFor("all", { q: "corola" }),
        sort: "newest",
        page: 1,
      }),
    );
    report("search typo trigram", typo, 250);
    expect(typo.p95).toBeLessThan(250);

    const relevance = await measure(() =>
      service.executeCatalogueSearch({
        mode: "all",
        filters: filtersFor("all", { q: "Cruiser", bodyType: "suv" }),
        sort: "relevance",
        page: 1,
      }),
    );
    report("search + filters + relevance", relevance, 250);
    expect(relevance.p95).toBeLessThan(250);
  });

  it("meets the facet computation budget (p95 < 200ms)", async () => {
    const facets = await measure(() =>
      repository.getVehicleFacets({
        mode: "all",
        filters: filtersFor("all", { bodyType: "suv" }),
      }),
    );
    report("facets under filter", facets, 200);
    expect(facets.p95).toBeLessThan(200);
  });

  it("meets the detail + related budget (p95 < 100ms)", async () => {
    const detail = await measure(() => service.getPublicDetail(usableDetailSlug));
    report("detail + related", detail, 100);
    expect(detail.p95).toBeLessThan(100);
  });
});
