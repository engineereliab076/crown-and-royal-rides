import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

import { loadTestDatabaseConfig } from "../integration/support/test-database-env";

/**
 * Phase 6 public-catalogue end-to-end journey against the guarded disposable
 * database. Vehicles and business settings are seeded directly with SQL (no
 * admin UI, no provider call); every Cloudinary delivery request is intercepted
 * and answered with a local 1×1 PNG so no real network traffic leaves the box.
 *
 * The spec proves the locked public behavior: featured/sale/rental sections,
 * catalogue navigation and pagination, the detail state/action matrix
 * (active sale, rental-only, reserved, sold-historical, archived), draft/missing
 * 404s, the sticky mobile action bar (Pixel/iPhone), desktop keyboard traversal,
 * gallery keyboard/swipe, non-empty image alts, the absence of private
 * identifiers in body HTML, the settings-backed About/Contact/Privacy pages, and
 * that browsing never mutates vehicle or inquiry state.
 */

const execFileAsync = promisify(execFile);
const requireFromTest = createRequire(__filename);
const prismaBin = requireFromTest.resolve("prisma/build/index.js");

// A minimal valid 1×1 PNG used for every intercepted Cloudinary delivery.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function deployMigrations(directUrl: string): Promise<void> {
  await execFileAsync(process.execPath, [prismaBin, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: directUrl,
      DIRECT_DATABASE_URL: directUrl,
    },
  });
}

const REGISTRATION = "T-PHASE6-PRIVATE-REG";
const CHASSIS = "PHASE6-PRIVATE-CHASSIS-NO";

interface VehicleSeed {
  readonly slug: string;
  readonly model: string;
  readonly bodyType?: string;
  readonly driverOption?: string;
  readonly listingState?: "draft" | "published" | "archived";
  readonly publishedAt?: string;
  readonly isForSale?: boolean;
  readonly saleStatus?: "available" | "reserved" | "sold";
  readonly salePrice?: number;
  readonly isForRent?: boolean;
  readonly rentalStatus?: "available" | "reserved" | "rented" | "unavailable";
  readonly rentalDailyPrice?: number;
  readonly minRentalDays?: number;
  readonly isFeatured?: boolean;
  readonly featuredAt?: string;
  readonly withImage?: boolean;
  readonly withPrivateIds?: boolean;
}

test.describe("Phase 6 public catalogue", () => {
  // No retries: the web server (and its 300s tag-based data cache) is reused
  // across retries, so a retry that re-seeds under a fresh marker would read the
  // previous attempt's now-deleted, cached homepage. One attempt per fresh
  // server keeps the cached catalogue and the seeded fixtures in lockstep.
  test.describe.configure({ mode: "serial", retries: 0 });

  test("browses the public catalogue and detail state matrix without mutating state", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(300_000);

    const config = loadTestDatabaseConfig();
    await deployMigrations(config.directUrl);
    const db = new Pool({ connectionString: config.databaseUrl });
    const marker = `${testInfo.project.name.replaceAll(/[^a-z0-9]/gi, "-")}-${Date.now()}`;
    const isMobile = testInfo.project.name !== "desktop-chromium";

    const brandId = randomUUID();
    const brandName = `Phase6 Marque ${marker}`;
    const seededVehicleIds: string[] = [];

    async function insertVehicle(seed: VehicleSeed): Promise<string> {
      const id = randomUUID();
      seededVehicleIds.push(id);
      const listingState = seed.listingState ?? "published";
      const isForSale = seed.isForSale ?? false;
      const isForRent = seed.isForRent ?? false;
      const isFeatured = seed.isFeatured ?? false;
      const saleStatus = isForSale ? (seed.saleStatus ?? "available") : null;
      const salePrice = isForSale ? (seed.salePrice ?? 125_000_000) : null;
      const rentalStatus = isForRent
        ? (seed.rentalStatus ?? "available")
        : null;
      const rentalDailyPrice = isForRent
        ? (seed.rentalDailyPrice ?? 350_000)
        : null;
      const minRentalDays = isForRent ? (seed.minRentalDays ?? 2) : null;
      const publishedAt =
        listingState === "published"
          ? (seed.publishedAt ?? "2026-08-01T00:00:00.000Z")
          : null;
      await db.query(
        `INSERT INTO vehicles
           (id, brand_id, brand_name, model, slug, year, body_type, condition,
            transmission, fuel_type, driver_option, listing_state, published_at,
            is_for_sale, sale_status, sale_price, is_for_rent, rental_status,
            rental_daily_price, min_rental_days, is_negotiable, is_featured,
            featured_at, location, description, features,
            registration_number, chassis_number, created_at, updated_at)
         VALUES
           ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::body_type, 'foreign_used'::vehicle_condition,
            'automatic'::transmission, 'diesel'::fuel_type, $8::driver_option,
            $9::listing_state, $10::timestamptz, $11, $12::sale_status, $13, $14,
            $15::rental_status, $16, $17, false, $18, $19::timestamptz, 'Dar es Salaam',
            $20, ARRAY['Air conditioning','Leather seats']::text[], $21, $22, NOW(), NOW())`,
        [
          id,
          brandId,
          brandName,
          seed.model,
          seed.slug,
          2024,
          seed.bodyType ?? "suv",
          seed.driverOption ?? "without_driver",
          listingState,
          publishedAt,
          isForSale,
          saleStatus,
          salePrice,
          isForRent,
          rentalStatus,
          rentalDailyPrice,
          minRentalDays,
          isFeatured,
          isFeatured ? (seed.featuredAt ?? "2026-08-02T00:00:00.000Z") : null,
          `A carefully presented Phase 6 fixture vehicle for ${seed.model}.`,
          seed.withPrivateIds ? REGISTRATION : null,
          seed.withPrivateIds ? CHASSIS : null,
        ],
      );
      if (seed.withImage) {
        await db.query(
          `INSERT INTO vehicle_images
             (id, vehicle_id, public_id, secure_url, width, height, format,
              byte_size, alt_text, sort_order, is_cover, created_at)
           VALUES
             ($1::uuid, $2::uuid, $3, $4, 1600, 900, 'png', 1024, $5, 0, true, NOW()),
             ($6::uuid, $2::uuid, $7, $8, 1600, 900, 'png', 1024, $9, 1, false, NOW())`,
          [
            randomUUID(),
            id,
            `phase6/${seed.slug}/0`,
            `https://res.cloudinary.com/e2e/image/upload/phase6/${seed.slug}-0.png`,
            `${seed.model} front view`,
            randomUUID(),
            `phase6/${seed.slug}/1`,
            `https://res.cloudinary.com/e2e/image/upload/phase6/${seed.slug}-1.png`,
            `${seed.model} rear view`,
          ],
        );
      }
      return id;
    }

    try {
      // ── Seed valid public business settings (singleton row) ────────────────
      await db.query(
        `INSERT INTO business_settings
           (id, business_name, whatsapp_number, primary_phone, secondary_phone,
            email, address, opening_hours, social_links, hero_headline,
            hero_subheadline, inquiry_notification_emails, updated_at)
         VALUES
           (1, 'Crown and Royal Rides', '+255712345678', '+255712345678',
            '+255754000111', 'hello@crownroyalrides.test', 'Dar es Salaam, Tanzania',
            $1::jsonb, $2::jsonb, 'Discover your next vehicle',
            'Sale and rental vehicles with direct human assistance',
            ARRAY[]::text[], NOW())
         ON CONFLICT (id) DO UPDATE SET
            business_name = EXCLUDED.business_name,
            whatsapp_number = EXCLUDED.whatsapp_number,
            primary_phone = EXCLUDED.primary_phone,
            secondary_phone = EXCLUDED.secondary_phone,
            email = EXCLUDED.email,
            address = EXCLUDED.address,
            opening_hours = EXCLUDED.opening_hours,
            social_links = EXCLUDED.social_links,
            hero_headline = EXCLUDED.hero_headline,
            hero_subheadline = EXCLUDED.hero_subheadline,
            updated_at = NOW()`,
        [
          JSON.stringify({
            "Mon–Fri": "08:00 – 18:00",
            Saturday: "09:00 – 14:00",
          }),
          JSON.stringify({
            facebook: "https://facebook.com/crownroyalrides",
            instagram: "http://insecure.example.com/should-be-skipped",
          }),
        ],
      );

      await db.query(
        `INSERT INTO brands (id, name, slug, sort_order, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, 1, NOW(), NOW())`,
        [brandId, brandName, `phase6-${marker}`.toLowerCase()],
      );

      // ── Fixture matrix ─────────────────────────────────────────────────────
      const featuredSlug = `phase6-featured-${marker}`;
      const saleSlug = `phase6-sale-available-${marker}`;
      const reservedSlug = `phase6-sale-reserved-${marker}`;
      const rentalSlug = `phase6-rental-available-${marker}`;
      const dualSlug = `phase6-dual-mode-${marker}`;
      const soldSlug = `phase6-sold-sale-only-${marker}`;
      const archivedSlug = `phase6-archived-${marker}`;
      const draftSlug = `phase6-draft-${marker}`;

      await insertVehicle({
        slug: featuredSlug,
        model: `Featured Cruiser ${marker}`,
        isForSale: true,
        isFeatured: true,
        withImage: true,
        publishedAt: "2026-08-06T00:00:00.000Z",
      });
      await insertVehicle({
        slug: saleSlug,
        model: `Sale Sedan ${marker}`,
        isForSale: true,
        withImage: true,
        withPrivateIds: true,
        publishedAt: "2026-08-05T00:00:00.000Z",
      });
      await insertVehicle({
        slug: reservedSlug,
        model: `Reserved Coupe ${marker}`,
        isForSale: true,
        saleStatus: "reserved",
        withImage: true,
        publishedAt: "2026-08-04T00:00:00.000Z",
      });
      await insertVehicle({
        slug: rentalSlug,
        model: `Rental Van ${marker}`,
        driverOption: "with_driver",
        isForRent: true,
        withImage: true,
        publishedAt: "2026-08-03T00:00:00.000Z",
      });
      await insertVehicle({
        slug: dualSlug,
        model: `Dual Wagon ${marker}`,
        isForSale: true,
        isForRent: true,
        withImage: true,
        publishedAt: "2026-08-02T12:00:00.000Z",
      });
      await insertVehicle({
        slug: soldSlug,
        model: `Sold Pickup ${marker}`,
        isForSale: true,
        saleStatus: "sold",
        withImage: true,
      });
      await insertVehicle({
        slug: archivedSlug,
        model: `Archived Hatch ${marker}`,
        listingState: "archived",
        isForSale: true,
        withImage: true,
      });
      await insertVehicle({
        slug: draftSlug,
        model: `Draft Saloon ${marker}`,
        listingState: "draft",
        isForSale: true,
      });

      // Extra sale vehicles to force a second catalogue page (page size 12).
      for (let index = 0; index < 12; index += 1) {
        await insertVehicle({
          slug: `phase6-page-${marker}-${index.toString().padStart(2, "0")}`,
          model: `Page Filler ${index} ${marker}`,
          isForSale: true,
          publishedAt: `2026-07-${(index + 1).toString().padStart(2, "0")}T00:00:00.000Z`,
        });
      }

      // ── Intercept all Cloudinary delivery requests (no real network) ───────
      await context.route("https://res.cloudinary.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
      );

      // ── Homepage: settings-backed hero + featured/sale/rental sections ─────
      await page.goto("/");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Discover your next vehicle",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Browse vehicles" }).first(),
      ).toBeVisible();
      const featuredRegion = page.getByRole("list", {
        name: "Featured vehicles",
      });
      await expect(
        featuredRegion.getByText(`Featured Cruiser ${marker}`),
      ).toBeVisible();
      await expect(
        page
          .getByRole("list", { name: "Vehicles for sale" })
          .getByText(`Sale Sedan ${marker}`),
      ).toBeVisible();
      await expect(
        page
          .getByRole("list", { name: "Vehicles for rent" })
          .getByText(`Rental Van ${marker}`),
      ).toBeVisible();

      // Every rendered public image carries a non-empty alt.
      const homeAlts = await page
        .getByRole("img")
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLImageElement).alt),
        );
      expect(homeAlts.length).toBeGreaterThan(0);
      for (const alt of homeAlts) expect(alt.trim().length).toBeGreaterThan(0);

      // ── Navigation reaches the three catalogues ────────────────────────────
      await page.goto("/cars");
      await expect(
        page.getByRole("heading", { level: 1, name: "All vehicles" }),
      ).toBeVisible();
      await expect(page.getByText(`Sale Sedan ${marker}`)).toBeVisible();
      await expect(page.getByText(`Rental Van ${marker}`)).toBeVisible();
      // Reserved is visible in the catalogue; drafts/archived are excluded.
      await expect(page.getByText(`Reserved Coupe ${marker}`)).toBeVisible();
      await expect(page.getByText(`Draft Saloon ${marker}`)).toHaveCount(0);
      await expect(page.getByText(`Archived Hatch ${marker}`)).toHaveCount(0);

      await page.goto("/cars-for-sale");
      await expect(
        page.getByRole("heading", { level: 1, name: "Vehicles for sale" }),
      ).toBeVisible();
      await expect(page.getByText(`Sale Sedan ${marker}`)).toBeVisible();
      // Rental-only vehicles never appear in the sale catalogue.
      await expect(page.getByText(`Rental Van ${marker}`)).toHaveCount(0);

      await page.goto("/cars-for-rent");
      await expect(
        page.getByRole("heading", { level: 1, name: "Vehicles for rent" }),
      ).toBeVisible();
      await expect(page.getByText(`Rental Van ${marker}`)).toBeVisible();
      await expect(page.getByText(`Dual Wagon ${marker}`)).toBeVisible();

      // ── Pagination works without duplicates ────────────────────────────────
      async function pageHrefs(): Promise<string[]> {
        const cards = page.locator(
          'ul[aria-label="Vehicles for sale"] a[href^="/cars/"]',
        );
        await expect(cards.first()).toBeVisible();
        return cards.evaluateAll((nodes) =>
          nodes.map(
            (node) => (node as HTMLAnchorElement).getAttribute("href") ?? "",
          ),
        );
      }
      await page.goto("/cars-for-sale?page=1");
      const firstPageHrefs = await pageHrefs();
      expect(firstPageHrefs.length).toBe(12);
      await page.goto("/cars-for-sale?page=2");
      const secondPageHrefs = await pageHrefs();
      expect(secondPageHrefs.length).toBeGreaterThan(0);
      const combined = [...firstPageHrefs, ...secondPageHrefs];
      expect(new Set(combined).size).toBe(combined.length);

      // Empty paginated catalogue (a page past the end) still renders an
      // intentional empty state via the shared status region.
      await page.goto("/cars-for-sale?page=999");
      await expect(
        page
          .getByRole("status")
          .getByText("No sale vehicles are available right now"),
      ).toBeVisible();

      // ── Reserved detail: visible, price-labelled, no actions ───────────────
      await page.goto(`/cars/${reservedSlug}`);
      await expect(page.getByText("Reserved").first()).toBeVisible();
      await expect(
        page.getByText("TZS", { exact: false }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Purchase this vehicle" }),
      ).toHaveCount(0);
      await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveCount(0);

      // ── Active sale detail: gallery, price, specs, purchase action ─────────
      await page.goto(`/cars/${saleSlug}`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: `2024 ${brandName} Sale Sedan ${marker}`,
        }),
      ).toBeVisible();
      const gallery = page.getByRole("region", { name: /photos$/ });
      await expect(gallery).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Purchase this vehicle" }),
      ).toBeVisible();
      // Specification table is present.
      await expect(
        page.getByText("Body type", { exact: false }).first(),
      ).toBeVisible();
      // No private identifiers anywhere in the serialized page.
      const saleHtml = await page.content();
      expect(saleHtml).not.toContain(REGISTRATION);
      expect(saleHtml).not.toContain(CHASSIS);
      // Gallery keyboard/swipe behavior.
      await page.getByRole("button", { name: /Open .* photo viewer/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Image 1 of 2");
      if (isMobile) {
        if (testInfo.project.name === "iphone-13") {
          // WebKit: exercise the real touch-swipe handler (advance = swipe left).
          const box = await dialog.boundingBox();
          if (box !== null) {
            const y = box.y + box.height / 2;
            await dialog.dispatchEvent("touchstart", {
              touches: [{ clientX: box.x + box.width - 30, clientY: y }],
              changedTouches: [{ clientX: box.x + box.width - 30, clientY: y }],
            });
            await dialog.dispatchEvent("touchend", {
              touches: [],
              changedTouches: [{ clientX: box.x + 30, clientY: y }],
            });
            await expect(dialog).toContainText("Image 2 of 2");
          }
        } else {
          // Chromium mobile: advance through the accessible next control (the
          // Touch constructor there requires fields Playwright cannot supply).
          await dialog.getByRole("button", { name: "Next image" }).click();
          await expect(dialog).toContainText("Image 2 of 2");
        }
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      } else {
        await page.keyboard.press("ArrowRight");
        await expect(dialog).toContainText("Image 2 of 2");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(
          page.getByRole("button", { name: /Open .* photo viewer/ }),
        ).toBeFocused();
      }

      // ── Sticky mobile action bar (Pixel/iPhone) vs desktop keyboard ────────
      const stickyBar = page.locator('[aria-label="Vehicle actions"]');
      if (isMobile) {
        await expect(stickyBar).toBeVisible();
        const purchaseButton = stickyBar.getByRole("button", {
          name: "Purchase request",
        });
        await expect(purchaseButton).toBeVisible();
        await purchaseButton.click();
        await expect(
          page.getByRole("heading", { name: "Purchase this vehicle" }),
        ).toBeInViewport();
      } else {
        // Desktop: sticky bar is not shown; keyboard reaches the gallery viewer.
        await expect(stickyBar).toBeHidden();
        await page.keyboard.press("Tab");
        const activeTag = await page.evaluate(
          () => document.activeElement?.tagName ?? "",
        );
        expect(["A", "BUTTON"]).toContain(activeTag);
      }

      // ── Rental-only detail: rental contact, no purchase form ───────────────
      await page.goto(`/cars/${rentalSlug}`);
      await expect(
        page.getByRole("heading", { name: "Arrange this rental" }),
      ).toBeVisible();
      await expect(
        page.getByText(/does not take online bookings/),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Purchase this vehicle" }),
      ).toHaveCount(0);

      // ── Sold sale-only detail: historical page + related vehicles ──────────
      await page.goto(`/cars/${soldSlug}`);
      await expect(page.getByText("This vehicle has been sold")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Purchase this vehicle" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Other available vehicles" }),
      ).toBeVisible();
      const soldRobots = await page
        .locator('meta[name="robots"]')
        .getAttribute("content");
      expect(soldRobots).toMatch(/noindex/);
      expect(soldRobots).toMatch(/follow/);
      expect(soldRobots).not.toMatch(/nofollow/);

      // ── Archived detail: retired page, noindex,nofollow ────────────────────
      await page.goto(`/cars/${archivedSlug}`);
      await expect(page.getByText("No longer available").first()).toBeVisible();
      const archivedRobots = await page
        .locator('meta[name="robots"]')
        .getAttribute("content");
      expect(archivedRobots).toMatch(/noindex/);
      expect(archivedRobots).toMatch(/nofollow/);

      // ── Draft and missing slugs return 404 ─────────────────────────────────
      expect((await page.request.get(`/cars/${draftSlug}`)).status()).toBe(404);
      expect(
        (
          await page.request.get(`/cars/phase6-does-not-exist-${marker}`)
        ).status(),
      ).toBe(404);

      // ── Static pages render settings-backed details ────────────────────────
      await page.goto("/about");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Discover your next vehicle",
        }),
      ).toBeVisible();

      await page.goto("/contact");
      await expect(
        page.getByRole("link", { name: /WhatsApp: \+255712345678/ }),
      ).toBeVisible();
      const telHref = await page
        .getByRole("link", { name: "+255712345678", exact: true })
        .getAttribute("href");
      expect(telHref).toBe("tel:+255712345678");
      const waHref = await page
        .getByRole("link", { name: /WhatsApp: / })
        .getAttribute("href");
      expect(waHref).toMatch(/^https:\/\/wa\.me\/255712345678\?text=/);
      // Safe HTTPS social link is shown; the insecure one is skipped.
      await expect(page.getByRole("link", { name: "Facebook" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Instagram" })).toHaveCount(
        0,
      );
      // Opening hours render as text (never raw JSON).
      await expect(page.getByText("08:00 – 18:00")).toBeVisible();
      const contactHtml = await page.content();
      expect(contactHtml).not.toContain("should-be-skipped");

      await page.goto("/privacy");
      await expect(
        page.getByRole("heading", { level: 1, name: "Privacy policy" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /hello@crownroyalrides\.test/ }),
      ).toBeVisible();

      // ── Browsing did not mutate vehicle state ──────────────────────────────
      const stateAfter = await db.query<{
        listing_state: string;
        sale_status: string | null;
        rental_status: string | null;
      }>(
        `SELECT listing_state, sale_status, rental_status
         FROM vehicles WHERE slug = $1`,
        [saleSlug],
      );
      expect(stateAfter.rows[0]).toEqual({
        listing_state: "published",
        sale_status: "available",
        rental_status: null,
      });
      const inquiryCount = await db.query<{ count: string }>(
        "SELECT COUNT(*)::int AS count FROM inquiries WHERE vehicle_id = ANY($1::uuid[])",
        [seededVehicleIds],
      );
      expect(Number(inquiryCount.rows[0]?.count ?? 0)).toBe(0);
    } finally {
      if (seededVehicleIds.length > 0) {
        await db.query(
          "DELETE FROM inquiries WHERE vehicle_id = ANY($1::uuid[])",
          [seededVehicleIds],
        );
        await db.query(
          "DELETE FROM vehicle_images WHERE vehicle_id = ANY($1::uuid[])",
          [seededVehicleIds],
        );
        await db.query("DELETE FROM vehicles WHERE id = ANY($1::uuid[])", [
          seededVehicleIds,
        ]);
      }
      await db.query("DELETE FROM brands WHERE id = $1::uuid", [brandId]);
      await db.end();
    }
  });
});
