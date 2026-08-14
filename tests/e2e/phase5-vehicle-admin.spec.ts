import { expect, test, type Route } from "@playwright/test";
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
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function deployMigrations(directUrl: string) {
  await execFileAsync(process.execPath, [prismaBin, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: directUrl,
      DIRECT_DATABASE_URL: directUrl,
    },
  });
}

test.describe("Phase 5 vehicle administration", () => {
  test.describe.configure({ mode: "serial" });

  test("creates, resumes, publishes, manages, renames, archives, and restores a dual-mode vehicle", async ({
    page,
  }, testInfo) => {
    test.setTimeout(480_000);
    const config = loadTestDatabaseConfig();
    await deployMigrations(config.directUrl);
    const db = new Pool({ connectionString: config.databaseUrl });
    const marker = `${testInfo.project.name.replaceAll(/[^a-z0-9]/gi, "-")}-${Date.now()}`;
    const email = `phase5-${marker}@example.test`;
    const password = "Local-E2E-Password-123!";
    const originalBrand = `Royal Motors ${marker}`;
    const renamedBrand = `Crown Motors ${marker}`;
    const registration = `T ${marker.slice(-6).toUpperCase()}`;
    const chassis = `CHASSIS-${marker.toUpperCase()}`;
    let adminId: string | undefined;
    let brandId: string | undefined;
    let vehicleId: string | undefined;
    let uploadNumber = 0;
    let currentPublicId = "";

    try {
      adminId = randomUUID();
      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });
      await db.query(
        `INSERT INTO admin_users
          (id, email, password_hash, name, role, is_active, must_change_password,
           session_version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, 'Phase 5 Owner', 'owner', true, false, 1, NOW(), NOW())`,
        [adminId, email, hash],
      );
      await db.query(
        `INSERT INTO business_settings
          (id, business_name, whatsapp_number, primary_phone, secondary_phone,
           email, address, opening_hours, social_links, hero_headline,
           hero_subheadline, inquiry_notification_emails, updated_at)
         VALUES (1, 'Crown and Royal Rides', '+255712345678', '+255712345678', NULL,
           'hello@example.test', 'Dar es Salaam', '{}'::jsonb, '{}'::jsonb,
           'Premium vehicles', 'Travel in comfort', ARRAY[]::text[], NOW())
         ON CONFLICT (id) DO UPDATE SET inquiry_notification_emails = ARRAY[]::text[], updated_at = NOW()`,
      );

      await page.route("**/api/admin/media/signature", async (route) => {
        uploadNumber += 1;
        currentPublicId = `vehicles/vehicle/${vehicleId}/phase5-${uploadNumber}`;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authorization: {
              uploadUrl: "https://uploads.test.invalid/direct",
              apiKey: "public-test-key",
              timestamp: 1_700_000_000,
              signature: "fixture-signature",
              publicId: currentPublicId,
              uploadPublicId: `phase5-${uploadNumber}`,
              folder: `vehicles/vehicle/${vehicleId}`,
              allowedFormats: ["jpg", "jpeg", "png", "webp"],
              maxBytes: 10 * 1024 * 1024,
              transformation: "c_limit,w_2400,h_2400",
            },
          }),
        });
      });
      await page.route("https://uploads.test.invalid/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            public_id: currentPublicId,
            version: 1,
            signature: "fixture-response",
          }),
        }),
      );
      await page.route(
        "**/api/admin/vehicles/*/images",
        async (route: Route) => {
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          const body = route.request().postDataJSON() as {
            upload: { publicId: string };
            altText: string;
          };
          const count = await db.query<{ count: string }>(
            "SELECT COUNT(*)::int AS count FROM vehicle_images WHERE vehicle_id = $1::uuid",
            [vehicleId],
          );
          const position = Number(count.rows[0]?.count ?? 0);
          const imageId = randomUUID();
          const url = `https://res.cloudinary.com/e2e/image/upload/${body.upload.publicId}.png`;
          await db.query(
            `INSERT INTO vehicle_images
            (id, vehicle_id, public_id, secure_url, width, height, format,
             byte_size, alt_text, sort_order, is_cover, created_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, 1, 1, 'png', 100, $5, $6, $7, NOW())`,
            [
              imageId,
              vehicleId,
              body.upload.publicId,
              url,
              body.altText,
              position,
              position === 0,
            ],
          );
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ image: { id: imageId } }),
          });
        },
      );
      await page.route("https://res.cloudinary.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
      );

      await page.goto("/admin/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

      await page.goto("/admin/brands");
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Name").fill(originalBrand);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText("Brand created.")).toBeVisible();
      const brandRow = await db.query<{ id: string }>(
        "SELECT id FROM brands WHERE name = $1",
        [originalBrand],
      );
      brandId = brandRow.rows[0]?.id;
      expect(brandId).toBeTruthy();

      await page.goto("/admin/vehicles/new");
      await page.getByLabel("Brand").selectOption({ label: originalBrand });
      await page.getByLabel("Model").fill(`Majesta ${marker}`);
      await page.getByLabel("Year").fill("2022");
      await page.getByLabel("Condition").selectOption("foreign_used");
      await page.getByLabel("Drivetrain").selectOption("awd");
      await page.getByLabel("Location").fill("Dar es Salaam");
      await page
        .getByRole("button", { name: "Create draft and continue" })
        .click();
      await expect(page).toHaveURL(
        /\/admin\/vehicles\/[0-9a-f-]+\/edit\?step=2$/,
        { timeout: 30_000 },
      );
      vehicleId = page.url().match(/\/vehicles\/([0-9a-f-]+)\/edit/)?.[1];
      expect(vehicleId).toBeTruthy();

      await page.getByText("Offer this vehicle for sale").click();
      await page.getByLabel("Sale price (TZS)").fill("125000000");
      await page.getByText("Offer this vehicle for rent").click();
      await page.getByLabel("Daily rental price (TZS)").fill("350000");
      await page.getByLabel("Minimum rental days").fill("2");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=3$/);
      await page.reload();
      await page.getByRole("button", { name: /Modes and pricing/ }).click();
      await expect(page.getByLabel("Sale price (TZS)")).toHaveValue(
        "125000000",
      );
      await expect(page.getByLabel("Daily rental price (TZS)")).toHaveValue(
        "350000",
      );
      await page.getByRole("button", { name: "Save and continue" }).click();

      await page.getByLabel("Driver arrangement").selectOption("with_driver");
      await page
        .getByLabel("Driver note")
        .fill("Professional chauffeur available by arrangement.");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await page.getByLabel("Mileage (km)").fill("58000");
      await page.getByLabel("Engine capacity (cc)").fill("3500");
      await page.getByLabel("Engine description").fill("Twin-turbo V6");
      await page.getByLabel("Seats").fill("5");
      await page.getByLabel("Doors").fill("4");
      await page.getByLabel("Exterior colour").fill("Royal black");
      await page.getByLabel("Interior colour").fill("Cream leather");
      await page.getByLabel("Registration number").fill(registration);
      await page.getByLabel("Chassis number").fill(chassis);
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=5$/);
      await page
        .getByLabel("Description")
        .fill(
          "A complete dual-mode luxury vehicle prepared for reliable sale and chauffeur rental service in Tanzania.",
        );
      const featureInput = page.getByRole("textbox", { name: "Features" });
      if (testInfo.project.name === "desktop-chromium") {
        await featureInput.focus();
        await page.keyboard.type("Air conditioning");
        await page.keyboard.press("Enter");
      } else {
        await featureInput.fill("Air conditioning");
        await page.getByRole("button", { name: "Add", exact: true }).click();
      }
      await expect(
        page.getByText("Air conditioning", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Save and continue" }).click();

      const fileInput = page.getByLabel("Add images");
      await fileInput.setInputFiles({
        name: "front.png",
        mimeType: "image/png",
        buffer: PNG_1X1,
      });
      await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(
        1,
        { timeout: 30_000 },
      );
      await fileInput.setInputFiles({
        name: "rear.png",
        mimeType: "image/png",
        buffer: PNG_1X1,
      });
      await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(
        2,
        { timeout: 30_000 },
      );
      await page
        .getByRole("button", { name: /Move .* later/ })
        .first()
        .click();
      await page
        .getByRole("button", { name: /Set .* as cover/ })
        .first()
        .click();
      const alt = page.getByLabel("Description").last();
      await alt.fill("Luxury vehicle rear three-quarter view");
      await page
        .getByRole("button", { name: "Save description" })
        .last()
        .click();
      await expect(page.getByText("Alternative text saved.")).toBeVisible();
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=7$/);
      await expect(
        page.getByText("Every server requirement is satisfied."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Publish vehicle" }).click();
      await expect(
        page.getByText("Vehicle published successfully."),
      ).toBeVisible();

      const vehicleRow = await db.query<{ slug: string }>(
        "SELECT slug FROM vehicles WHERE id = $1::uuid",
        [vehicleId],
      );
      const slug = vehicleRow.rows[0]?.slug as string;
      await page.goto(`/admin/vehicles/${vehicleId}`);
      await page.getByRole("button", { name: "Still available" }).click();
      await expect(page.getByText(/Availability verified/)).toBeVisible();
      await page.getByRole("button", { name: "Feature vehicle" }).click();
      await expect(page.getByText("Vehicle featured.")).toBeVisible();

      const beforeInquiry = await db.query(
        `SELECT listing_state, sale_status, rental_status, is_featured,
                last_verified_at, updated_at
         FROM vehicles WHERE id = $1::uuid`,
        [vehicleId],
      );
      const inquiryStatus = await page.evaluate(async (id) => {
        const response = await fetch("/api/inquiries/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: id,
            customerName: "Phase Five Customer",
            customerPhone: "0712345678",
          }),
        });
        return response.status;
      }, vehicleId);
      expect(inquiryStatus).toBe(201);
      const afterInquiry = await db.query(
        `SELECT listing_state, sale_status, rental_status, is_featured,
                last_verified_at, updated_at
         FROM vehicles WHERE id = $1::uuid`,
        [vehicleId],
      );
      expect(afterInquiry.rows[0]).toEqual(beforeInquiry.rows[0]);

      await page.getByRole("button", { name: "Sold", exact: true }).click();
      await page.getByRole("button", { name: "Confirm Sale sold" }).click();
      await expect(page.getByText("For sale")).toHaveCount(0);
      await expect(page.getByText("For rent", { exact: true })).toBeVisible();
      const commercial = await db.query<{
        sale_status: string;
        rental_status: string;
      }>(
        "SELECT sale_status, rental_status FROM vehicles WHERE id = $1::uuid",
        [vehicleId],
      );
      expect(commercial.rows[0]).toEqual({
        sale_status: "sold",
        rental_status: "available",
      });
      const publicResponse = await page.request.get(`/cars/${slug}`);
      expect(publicResponse.status()).toBe(200);
      const publicHtml = await publicResponse.text();
      expect(publicHtml).not.toContain(registration);
      expect(publicHtml).not.toContain(chassis);

      await page.goto("/admin/brands");
      const row = page.getByRole("listitem").filter({ hasText: originalBrand });
      await row.getByRole("button", { name: "Edit" }).click();
      const editingRow = page.getByRole("listitem").filter({
        has: page.getByRole("button", { name: "Cancel" }),
      });
      await editingRow.getByLabel("Name").fill(renamedBrand);
      await editingRow.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(/Brand updated/)).toBeVisible();
      await page.goto(
        `/admin/vehicles?search=${encodeURIComponent(renamedBrand)}`,
      );
      await expect(
        page
          .getByText(new RegExp(renamedBrand))
          .filter({ visible: true })
          .first(),
      ).toBeVisible();

      await page.goto(`/admin/vehicles/${vehicleId}`);
      await page.getByRole("button", { name: "Unfeature" }).click();
      await expect(
        page.getByText("Vehicle removed from featured vehicles."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Archive" }).click();
      await page.getByRole("button", { name: "Confirm Archive" }).click();
      await expect(
        page.getByText("Archived", { exact: true }).first(),
      ).toBeVisible();
      expect((await page.request.get(`/cars/${slug}`)).status()).toBe(404);
      await page.getByRole("button", { name: "Restore to draft" }).click();
      await expect(
        page.getByText("Draft", { exact: true }).first(),
      ).toBeVisible();
      expect((await page.request.get(`/cars/${slug}`)).status()).toBe(404);
    } finally {
      if (vehicleId !== undefined) {
        await db.query("DELETE FROM inquiries WHERE vehicle_id = $1::uuid", [
          vehicleId,
        ]);
        await db.query(
          "DELETE FROM media_deletion_queue WHERE public_id LIKE $1",
          [`vehicles/vehicle/${vehicleId}/%`],
        );
        await db.query(
          "DELETE FROM vehicle_images WHERE vehicle_id = $1::uuid",
          [vehicleId],
        );
        await db.query("DELETE FROM vehicles WHERE id = $1::uuid", [vehicleId]);
      }
      if (brandId !== undefined)
        await db.query("DELETE FROM brands WHERE id = $1::uuid", [brandId]);
      if (adminId !== undefined) {
        await db.query(
          "DELETE FROM admin_audit_log WHERE actor_id = $1::uuid",
          [adminId],
        );
        await db.query("DELETE FROM admin_users WHERE id = $1::uuid", [
          adminId,
        ]);
      }
      await db.end();
    }
  });
});
