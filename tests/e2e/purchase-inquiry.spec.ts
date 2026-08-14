import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

import { loadTestDatabaseConfig } from "../integration/support/test-database-env";

const execFileAsync = promisify(execFile);
const requireFromTest = createRequire(__filename);
const prismaBin = requireFromTest.resolve("prisma/build/index.js");

async function deployE2EMigrations(directUrl: string): Promise<void> {
  await execFileAsync(process.execPath, [prismaBin, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: directUrl,
      DIRECT_DATABASE_URL: directUrl,
    },
  });
}

test.describe("purchase inquiry vertical slice", () => {
  test.describe.configure({ mode: "serial" });

  test("admin creates and publishes a vehicle, then a customer submits one purchase inquiry", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(120_000);

    const config = loadTestDatabaseConfig();
    await deployE2EMigrations(config.directUrl);
    const db = new Pool({ connectionString: config.databaseUrl });
    const marker = `${testInfo.project.name.replaceAll(/[^a-z0-9]/gi, "-")}-${Date.now()}`;
    const email = `owner-${marker}@example.test`;
    const password = "Local-E2E-Password-123!";
    let adminId: string | undefined;
    let brandId: string | undefined;
    let vehicleId: string | undefined;

    try {
      adminId = randomUUID();
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });
      await db.query(
        `INSERT INTO admin_users
          (id, email, password_hash, name, role, is_active, must_change_password,
           session_version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, 'E2E Owner', 'owner', true, false, 1, NOW(), NOW())`,
        [adminId, email, passwordHash],
      );
      brandId = randomUUID();
      const brandName = `Toyota ${marker}`;
      await db.query(
        `INSERT INTO brands (id, name, slug, sort_order, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, 1, NOW(), NOW())`,
        [brandId, brandName, `toyota-${marker}`.toLowerCase()],
      );
      await db.query(
        `INSERT INTO business_settings
          (id, business_name, whatsapp_number, primary_phone, secondary_phone,
           email, address, opening_hours, social_links, hero_headline,
           hero_subheadline, inquiry_notification_emails, updated_at)
         VALUES
          (1, 'Crown and Royal Rides', '+255712345678', '+255712345678', NULL,
           'hello@example.test', 'Dar es Salaam, Tanzania', '{}'::jsonb, '{}'::jsonb,
           'Premium vehicles', 'Travel in comfort', ARRAY['inquiries@example.test'], NOW())
         ON CONFLICT (id) DO UPDATE SET
           whatsapp_number = EXCLUDED.whatsapp_number,
           inquiry_notification_emails = EXCLUDED.inquiry_notification_emails,
           updated_at = NOW()`,
      );

      await page.goto("/admin/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/admin$/);

      await page.goto("/admin/vehicles/new");
      await page.getByLabel("Brand").selectOption({ label: brandName });
      await page.getByLabel("Model").fill(`Prado ${marker}`);
      await page.getByLabel("Year").fill("2025");
      await page.getByLabel("Location").fill("Dar es Salaam");
      await page
        .getByRole("button", { name: "Create draft and continue" })
        .click();
      await expect(page).toHaveURL(
        /\/admin\/vehicles\/[0-9a-f-]+\/edit\?step=2$/,
      );
      vehicleId = page.url().match(/\/vehicles\/([0-9a-f-]+)\/edit/)?.[1];
      expect(vehicleId).toBeTruthy();
      await page.getByText("Offer this vehicle for sale").click();
      await page.getByLabel("Sale price (TZS)").fill("145000000");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await page.getByRole("button", { name: "Save and continue" }).click();
      await page.getByLabel("Seats").fill("7");
      await page.getByLabel("Exterior colour").fill("Pearl white");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=5$/);
      await page
        .getByLabel("Description")
        .fill(
          "A verified E2E vehicle with enough descriptive text to pass publication.",
        );
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=6$/);
      await db.query(
        `INSERT INTO vehicle_images
          (id, vehicle_id, public_id, secure_url, width, height, format,
           byte_size, alt_text, sort_order, is_cover, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, 1600, 900, 'jpg', 4096, $5, 0, true, NOW())`,
        [
          randomUUID(),
          vehicleId,
          `vehicles/vehicle/${vehicleId}/inquiry-cover`,
          `https://media.test.invalid/assets/${vehicleId}.jpg`,
          "E2E vehicle verified cover image",
        ],
      );
      await page.route("https://media.test.invalid/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/jpeg",
          body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        }),
      );

      await page.reload();
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=7$/);
      await page.getByRole("button", { name: "Publish vehicle" }).click();
      await expect(
        page.getByRole("button", { name: "Published" }),
      ).toBeVisible();

      const createdVehicleResult = await db.query<{
        slug: string;
        listing_state: string;
        sale_status: string;
        updated_at: Date;
      }>(
        `SELECT slug, listing_state, sale_status, updated_at
         FROM vehicles WHERE id = $1::uuid`,
        [vehicleId],
      );
      const createdVehicle = createdVehicleResult.rows[0];
      if (createdVehicle === undefined) {
        throw new Error("E2E vehicle was not persisted.");
      }
      await page.goto(`/cars/${createdVehicle.slug}`);
      await expect(
        page.getByRole("heading", { name: new RegExp(`Prado ${marker}`) }),
      ).toBeVisible();
      await expect(page.getByText("TZS 145,000,000")).toBeVisible();
      await expect(page.getByText("Without driver")).toBeVisible();
      await expect(
        page.getByAltText("E2E vehicle verified cover image"),
      ).toBeVisible();

      await context.route("https://wa.me/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "handoff",
        }),
      );
      await page.getByLabel("Your name").fill("Asha E2E");
      await page.getByLabel("Phone number").fill("0712345678");
      const popupPromise = context.waitForEvent("page");
      await page
        .getByRole("button", { name: "Submit purchase request" })
        .click();
      const popup = await popupPromise;
      await expect(page.getByText(/Your reference is/)).toBeVisible();
      const reference = await page
        .locator("strong")
        .filter({ hasText: /^CRR-/ })
        .textContent();
      expect(reference).toMatch(/^CRR-[A-HJ-NP-Z2-9]{8}$/);
      await popup.waitForURL(/https:\/\/wa\.me\/255712345678\?text=/);
      const handoff = new URL(popup.url());
      const handoffText = handoff.searchParams.get("text");
      expect(handoffText).toContain(reference as string);
      expect(handoffText).toContain(`Prado ${marker}`);
      expect(handoffText).toContain("TZS 145,000,000");
      expect(handoffText).not.toContain("%0A");

      const inquiryResult = await db.query<{
        type: string;
        status: string;
        package_id: string | null;
        preferred_viewing_at: Date | null;
      }>(
        `SELECT type, status, package_id, preferred_viewing_at
         FROM inquiries WHERE vehicle_id = $1::uuid`,
        [vehicleId],
      );
      const inquiries = inquiryResult.rows;
      expect(inquiries).toHaveLength(1);
      expect(inquiries[0]).toMatchObject({
        type: "purchase",
        status: "new",
        package_id: null,
        preferred_viewing_at: null,
      });
      const vehicleAfterResult = await db.query<{
        listing_state: string;
        sale_status: string;
        updated_at: Date;
      }>(
        `SELECT listing_state, sale_status, updated_at
         FROM vehicles WHERE id = $1::uuid`,
        [vehicleId],
      );
      const vehicleAfter = vehicleAfterResult.rows[0];
      expect(vehicleAfter).toEqual({
        listing_state: createdVehicle.listing_state,
        sale_status: createdVehicle.sale_status,
        updated_at: createdVehicle.updated_at,
      });
    } finally {
      if (vehicleId !== undefined) {
        await db.query("DELETE FROM inquiries WHERE vehicle_id = $1::uuid", [
          vehicleId,
        ]);
        await db.query(
          "DELETE FROM vehicle_images WHERE vehicle_id = $1::uuid",
          [vehicleId],
        );
        await db.query("DELETE FROM vehicles WHERE id = $1::uuid", [vehicleId]);
      }
      if (brandId !== undefined) {
        await db.query("DELETE FROM brands WHERE id = $1::uuid", [brandId]);
      }
      if (adminId !== undefined)
        await db.query("DELETE FROM admin_users WHERE id = $1::uuid", [
          adminId,
        ]);
      await db.end();
    }
  });
});
