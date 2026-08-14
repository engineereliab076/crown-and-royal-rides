import { expect, test, type Route } from "@playwright/test";
import argon2 from "argon2";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

import { loadTestDatabaseConfig } from "../integration/support/test-database-env";

/**
 * Phase 4 vehicle-gallery end-to-end journey against the guarded disposable
 * database. No real Cloudinary request is made: the signature, the direct upload,
 * and the attach are intercepted, with attach persisting the row directly so the
 * subsequent reorder/cover/alt/delete exercise the real API against the real DB.
 * Compression runs in the browser before the intercepted upload.
 */

const execFileAsync = promisify(execFile);
const requireFromTest = createRequire(__filename);
const prismaBin = requireFromTest.resolve("prisma/build/index.js");

// A minimal valid 1x1 PNG so browser-image-compression can decode and re-encode.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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

test.describe("vehicle gallery vertical slice", () => {
  test.describe.configure({ mode: "serial" });

  test("admin builds a multi-image gallery; the public gallery matches", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

    const config = loadTestDatabaseConfig();
    await deployE2EMigrations(config.directUrl);
    const db = new Pool({ connectionString: config.databaseUrl });
    const marker = `${testInfo.project.name.replaceAll(/[^a-z0-9]/gi, "-")}-${Date.now()}`;
    const email = `owner-${marker}@example.test`;
    const password = "Local-E2E-Password-123!";
    let adminId: string | undefined;
    let brandId: string | undefined;
    let vehicleId: string | undefined;

    // Interception state (uploads are driven one-at-a-time, so no races).
    let signatureCalls = 0;
    let currentPublicId = "";
    let failNextUpload = false;

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

      // ── Interceptors ──────────────────────────────────────────────────────
      await page.route("**/api/admin/media/signature", async (route) => {
        signatureCalls += 1;
        currentPublicId = `vehicles/vehicle/${vehicleId}/asset-${signatureCalls}`;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authorization: {
              uploadUrl: "https://uploads.test.invalid/direct",
              apiKey: "public-test-key",
              timestamp: 1_700_000_000,
              signature: "e2e-signature",
              publicId: currentPublicId,
              uploadPublicId: `asset-${signatureCalls}`,
              folder: `vehicles/vehicle/${vehicleId}`,
              allowedFormats: ["jpg", "jpeg", "png", "webp"],
              maxBytes: 10 * 1024 * 1024,
              transformation: "c_limit,w_2400,h_2400",
            },
          }),
        });
      });

      await page.route(
        "https://uploads.test.invalid/**",
        async (route: Route) => {
          if (failNextUpload) {
            failNextUpload = false;
            await route.fulfill({ status: 500, body: "provider error" });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              public_id: currentPublicId,
              version: 1,
              signature: "e2e-response-signature",
            }),
          });
        },
      );

      // Persist the attach directly (bypassing provider verification), then let
      // reads and later mutations use the real API against the real rows.
      await page.route(
        "**/api/admin/vehicles/*/images",
        async (route: Route) => {
          const request = route.request();
          if (request.method() !== "POST") {
            await route.continue();
            return;
          }
          const body = request.postDataJSON() as {
            upload: { publicId: string };
            altText: string;
          };
          const countResult = await db.query<{ count: string }>(
            "SELECT COUNT(*)::int AS count FROM vehicle_images WHERE vehicle_id = $1::uuid",
            [vehicleId],
          );
          const count = Number(countResult.rows[0]?.count ?? 0);
          const id = randomUUID();
          const secureUrl = `https://media.test.invalid/${body.upload.publicId}.png`;
          await db.query(
            `INSERT INTO vehicle_images
              (id, vehicle_id, public_id, secure_url, width, height, format,
               byte_size, alt_text, sort_order, is_cover, created_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, 1, 1, 'png', 100, $5, $6, $7, NOW())`,
            [
              id,
              vehicleId,
              body.upload.publicId,
              secureUrl,
              body.altText,
              count,
              count === 0,
            ],
          );
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              image: {
                id,
                url: secureUrl,
                width: 1,
                height: 1,
                format: "png",
                altText: body.altText,
                sortOrder: count,
                isCover: count === 0,
                createdAt: new Date().toISOString(),
              },
            }),
          });
        },
      );

      await page.route("https://media.test.invalid/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          body: PNG_1x1,
        }),
      );

      // ── Sign in and create a vehicle ─────────────────────────────────────
      await page.goto("/admin/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      // The first credentials POST compiles the dev auth route and runs Argon2;
      // allow a generous cold-start window.
      await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

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
        { timeout: 30_000 },
      );
      vehicleId = page.url().match(/\/vehicles\/([0-9a-f-]+)\/edit/)?.[1];
      expect(vehicleId).toBeTruthy();

      await page.getByText("Offer this vehicle for sale").click();
      await page.getByLabel("Sale price (TZS)").fill("145000000");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=3$/);
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=4$/);
      await page.getByLabel("Seats").fill("7");
      await page.getByLabel("Exterior colour").fill("Pearl white");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=5$/);
      await page
        .getByLabel("Description")
        .fill(
          "A verified E2E gallery vehicle with enough descriptive text to publish.",
        );
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=6$/);

      const deleteButtons = page.getByRole("button", { name: /^Delete / });
      const fileInput = page.getByLabel("Add images");

      async function uploadOne(): Promise<void> {
        await fileInput.setInputFiles({
          name: "photo.png",
          mimeType: "image/png",
          buffer: PNG_1x1,
        });
      }

      // First image → becomes cover.
      await uploadOne();
      await expect(deleteButtons).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByText("★ Cover")).toBeVisible();

      // Second image.
      await uploadOne();
      await expect(deleteButtons).toHaveCount(2, { timeout: 30_000 });

      // Third image fails at the provider, then succeeds on retry with a fresh
      // authorization — the earlier successes are untouched.
      const signaturesBeforeFailure = signatureCalls;
      failNextUpload = true;
      await uploadOne();
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(deleteButtons).toHaveCount(2);
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(deleteButtons).toHaveCount(3, { timeout: 30_000 });
      // Retry requested at least two more authorizations (initial + retry).
      expect(signatureCalls).toBeGreaterThan(signaturesBeforeFailure + 1);

      // ── Reorder: exactly one batch PATCH ─────────────────────────────────
      let reorderPatches = 0;
      page.on("request", (request) => {
        if (
          request.method() === "PATCH" &&
          /\/images\/reorder$/.test(request.url())
        ) {
          reorderPatches += 1;
        }
      });
      const coverBefore = await db.query<{ id: string }>(
        "SELECT id FROM vehicle_images WHERE vehicle_id = $1::uuid AND is_cover = true",
        [vehicleId],
      );
      await page
        .getByRole("button", { name: /Move .* later/ })
        .first()
        .click();
      await expect
        .poll(
          async () => {
            const rows = await db.query(
              "SELECT id FROM vehicle_images WHERE vehicle_id = $1::uuid AND sort_order = 0",
              [vehicleId],
            );
            return rows.rows[0]?.id as string | undefined;
          },
          { timeout: 20_000 },
        )
        .not.toBe(coverBefore.rows[0]?.id);
      expect(reorderPatches).toBe(1);

      // ── Change cover to a non-cover image ────────────────────────────────
      const coverButton = page
        .getByRole("button", { name: /Set .* as cover/ })
        .first();
      await coverButton.click();
      await expect
        .poll(
          async () => {
            const rows = await db.query<{ count: string }>(
              "SELECT COUNT(*)::int AS count FROM vehicle_images WHERE vehicle_id = $1::uuid AND is_cover = true",
              [vehicleId],
            );
            return Number(rows.rows[0]?.count ?? 0);
          },
          { timeout: 20_000 },
        )
        .toBe(1);

      // ── Edit alt text ────────────────────────────────────────────────────
      const altInput = page.getByLabel("Description").last();
      await altInput.fill("An explicitly edited gallery description");
      await page
        .getByRole("button", { name: "Save description" })
        .last()
        .click();
      await expect(page.getByText("Alternative text saved.")).toBeVisible();

      // ── Delete the cover → the next image is promoted ────────────────────
      const coverIdRow = await db.query<{ id: string }>(
        "SELECT id FROM vehicle_images WHERE vehicle_id = $1::uuid AND is_cover = true",
        [vehicleId],
      );
      const removedCoverId = coverIdRow.rows[0]?.id;
      await page
        .getByRole("button", { name: /^Delete / })
        .first()
        .click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(deleteButtons).toHaveCount(2, { timeout: 30_000 });
      const promoted = await db.query<{ id: string; is_cover: boolean }>(
        "SELECT id, is_cover FROM vehicle_images WHERE vehicle_id = $1::uuid AND is_cover = true",
        [vehicleId],
      );
      expect(promoted.rows).toHaveLength(1);
      expect(promoted.rows[0]?.id).not.toBe(removedCoverId);

      // ── Publish ──────────────────────────────────────────────────────────
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/step=7$/);
      await page.getByRole("button", { name: "Publish vehicle" }).click();
      await expect(page.getByRole("button", { name: "Published" })).toBeVisible(
        { timeout: 20_000 },
      );

      // ── Public gallery matches the admin state ───────────────────────────
      const slugRow = await db.query<{ slug: string }>(
        "SELECT slug FROM vehicles WHERE id = $1::uuid",
        [vehicleId],
      );
      const slug = slugRow.rows[0]?.slug as string;
      await page.goto(`/cars/${slug}`);
      const gallery = page.getByRole("region", { name: /photos$/ });
      await expect(gallery).toBeVisible({ timeout: 20_000 });

      // Every rendered image has non-empty alt text.
      const alts = await gallery
        .getByRole("img")
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLImageElement).alt),
        );
      expect(alts.length).toBeGreaterThan(0);
      for (const alt of alts) expect(alt.trim().length).toBeGreaterThan(0);

      // Open the lightbox.
      await page.getByRole("button", { name: /Open .* photo viewer/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Image 1 of 2");

      if (testInfo.project.name === "desktop-chromium") {
        await page.keyboard.press("ArrowRight");
        await expect(dialog).toContainText("Image 2 of 2");
        await page.keyboard.press("ArrowLeft");
        await expect(dialog).toContainText("Image 1 of 2");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(
          page.getByRole("button", { name: /Open .* photo viewer/ }),
        ).toBeFocused();
      } else {
        // Touch swipe (iPhone/WebKit): swipe left advances.
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
        await page.keyboard.press("Escape");
      }

      // The vehicle remains published throughout.
      const finalState = await db.query<{ listing_state: string }>(
        "SELECT listing_state FROM vehicles WHERE id = $1::uuid",
        [vehicleId],
      );
      expect(finalState.rows[0]?.listing_state).toBe("published");
    } finally {
      if (vehicleId !== undefined) {
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
      if (brandId !== undefined) {
        await db.query("DELETE FROM brands WHERE id = $1::uuid", [brandId]);
      }
      if (adminId !== undefined) {
        await db.query("DELETE FROM admin_users WHERE id = $1::uuid", [
          adminId,
        ]);
      }
      await db.end();
    }
  });
});
