import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
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

const PUBLIC_DESCRIPTIONS = new Map([
  [
    "/",
    "Browse carefully presented vehicles for sale and rent with direct local assistance.",
  ],
  ["/cars", "Browse currently usable published vehicles for sale and rent."],
  ["/cars-for-sale", "Browse available and reserved vehicles for sale."],
  ["/cars-for-rent", "Browse available and reserved rental vehicles."],
  ["/about", "Learn about our vehicle sale and rental assistance in Tanzania."],
  [
    "/contact",
    "Contact Crown and Royal Rides about vehicle sales and rentals.",
  ],
  ["/privacy", "How customer information is handled when using this website."],
]);

function descriptionTags(html: string): string[] {
  return html.match(/<meta(?=[^>]*\bname=["']description["'])[^>]*>/gi) ?? [];
}

function expectDescriptionInHead(html: string, expected: string): void {
  const headEnd = html.toLowerCase().indexOf("</head>");
  expect(headEnd).toBeGreaterThan(0);
  const tags = descriptionTags(html);
  expect(tags).toHaveLength(1);
  expect(tags[0]).toContain(`content="${expected}"`);
  expect(html.indexOf(tags[0]!)).toBeLessThan(headEnd);
}

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

test.describe("Phase 7 URL-driven public search", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test("filters, shares, restores, and clears one authoritative catalogue state", async ({
    page,
    context,
  }, testInfo) => {
    const config = loadTestDatabaseConfig();
    await deployMigrations(config.directUrl);
    const db = new Pool({ connectionString: config.databaseUrl });
    const marker =
      `${testInfo.project.name.replaceAll(/[^a-z0-9]/gi, "-")}-${Date.now()}`.toLowerCase();
    const brandId = randomUUID();
    const brandName = `Royal Search ${marker}`;
    const brandSlug = `royal-search-${marker}`;
    const ids: string[] = [];
    const detailSlug = `phase7-navigator-${marker}-00`;
    const isMobile = testInfo.project.name !== "desktop-chromium";

    try {
      await db.query(
        `INSERT INTO business_settings
           (id, business_name, whatsapp_number, primary_phone, secondary_phone,
            email, address, opening_hours, social_links, hero_headline,
            hero_subheadline, inquiry_notification_emails, updated_at)
         VALUES
           (1, 'Crown and Royal Rides', '+255712345678', '+255712345678', NULL,
            'hello@example.test', 'Dar es Salaam, Tanzania', '{}'::jsonb,
            '{}'::jsonb, 'Find a vehicle', 'Local assistance', ARRAY[]::text[], NOW())
         ON CONFLICT (id) DO UPDATE SET
            business_name = EXCLUDED.business_name,
            whatsapp_number = EXCLUDED.whatsapp_number,
            primary_phone = EXCLUDED.primary_phone,
            email = EXCLUDED.email,
            address = EXCLUDED.address,
            updated_at = NOW()`,
      );
      await db.query(
        `INSERT INTO brands (id, name, slug, sort_order, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, 7, NOW(), NOW())`,
        [brandId, brandName, brandSlug],
      );

      for (let index = 0; index < 30; index += 1) {
        const id = randomUUID();
        ids.push(id);
        const slug = `phase7-navigator-${marker}-${index.toString().padStart(2, "0")}`;
        await db.query(
          `INSERT INTO vehicles
             (id, brand_id, brand_name, model, slug, year, body_type, condition,
              transmission, fuel_type, driver_option, drivetrain, listing_state,
              published_at, is_for_sale, sale_status, sale_price, is_for_rent,
              is_negotiable, is_featured, location, description, features,
              created_at, updated_at)
           VALUES
             ($1::uuid, $2::uuid, $3, 'Navigator', $4, $5, 'suv'::body_type,
              'foreign_used'::vehicle_condition, 'automatic'::transmission,
              'diesel'::fuel_type, 'without_driver'::driver_option, 'awd'::drivetrain,
              'published'::listing_state, $6::timestamptz, true,
              'available'::sale_status, $7, false, false, false, 'Dar es Salaam',
              $8, ARRAY['Air conditioning']::text[], NOW(), NOW())`,
          [
            id,
            brandId,
            brandName,
            slug,
            2025 - (index % 5),
            new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
            60_000_000 + index * 1_000_000,
            `Public Phase 7 Navigator fixture ${index}.`,
          ],
        );
        if (index === 0) {
          await db.query(
            `INSERT INTO vehicle_images
               (id, vehicle_id, public_id, secure_url, width, height, format,
                byte_size, alt_text, sort_order, is_cover, created_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, 1600, 900, 'png', 1024,
                     'Royal Search Navigator front view', 0, true, NOW())`,
            [
              randomUUID(),
              id,
              `phase7/${slug}`,
              `https://res.cloudinary.com/e2e/image/upload/phase7/${slug}.png`,
            ],
          );
        }
      }

      await context.route("https://res.cloudinary.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
      );

      for (const [route, description] of PUBLIC_DESCRIPTIONS) {
        const response = await page.request.get(route);
        expect(response.status()).toBe(200);
        expectDescriptionInHead(await response.text(), description);
      }
      const detailResponse = await page.request.get(`/cars/${detailSlug}`);
      expect(detailResponse.status()).toBe(200);
      expectDescriptionInHead(
        await detailResponse.text(),
        "Public Phase 7 Navigator fixture 0.",
      );

      await page.goto("/cars");
      await expect(
        page.getByRole("heading", { level: 1, name: "All vehicles" }),
      ).toBeVisible();
      const headingOutline = await page
        .locator("main h1, main h2, main h3, main h4, main h5, main h6")
        .evaluateAll((headings) =>
          headings
            .filter((heading) => {
              const style = getComputedStyle(heading);
              return style.display !== "none" && style.visibility !== "hidden";
            })
            .map((heading) => ({
              level: Number(heading.tagName.slice(1)),
              text: heading.textContent?.trim() ?? "",
            })),
        );
      expect(headingOutline[0]).toEqual({ level: 1, text: "All vehicles" });
      expect(headingOutline.filter(({ level }) => level === 1)).toHaveLength(1);
      for (let index = 1; index < headingOutline.length; index += 1) {
        expect(
          headingOutline[index]!.level - headingOutline[index - 1]!.level,
        ).toBeLessThanOrEqual(1);
      }

      if (isMobile) {
        // Use a project-unique normalized query so each profile gets fresh
        // server facets even though all profiles intentionally share one
        // compiled server and its tagged data cache.
        await page.goto(`/cars?q=${encodeURIComponent(brandName)}`);
        const trigger = page.getByRole("button", { name: /^Filters/ });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Filter vehicles" });
        await expect(dialog).toBeVisible();
        expect(
          await dialog.evaluate((node) =>
            node.contains(document.activeElement),
          ),
        ).toBe(true);
        await dialog.locator('select[name="brand"]').selectOption(brandSlug);
        await expect(
          dialog.getByRole("button", { name: "Apply filters" }),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Apply filters" }).click();
        await expect(page).toHaveURL(new RegExp(`\\?q=.*&brand=${brandSlug}$`));
        await expect(
          page.getByText("Showing 1–24 of 30 vehicles"),
        ).toBeVisible();

        await page.getByRole("button", { name: /^Filters/ }).click();
        const reopened = page.getByRole("dialog", { name: "Filter vehicles" });
        await page.keyboard.press("Escape");
        await expect(reopened).toBeHidden();
        await expect(
          page.getByRole("button", { name: /^Filters/ }),
        ).toBeFocused();
        await page.getByRole("button", { name: /^Filters/ }).click();
        await page
          .getByRole("dialog", { name: "Filter vehicles" })
          .getByRole("link", { name: "Clear all" })
          .click();
        await expect(page).toHaveURL(/\/cars$/);

        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        await page.goto(`/cars/${detailSlug}`);
        const sticky = page.locator('[aria-label="Vehicle actions"]');
        await expect(sticky).toBeVisible();
        const targets = await sticky.locator("a,button").evaluateAll((nodes) =>
          nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          }),
        );
        for (const target of targets) {
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
        }
      } else {
        const filters = page.getByRole("complementary", {
          name: "Catalogue filters",
        });
        await filters.locator('input[name="q"]').fill(`${brandName} Navigator`);
        await filters.getByRole("button", { name: "Apply filters" }).click();
        await expect(page).toHaveURL(
          `/cars?q=${encodeURIComponent(`${brandName} Navigator`).replaceAll("%20", "+")}`,
        );
        await expect(
          page.getByText("Showing 1–24 of 30 vehicles"),
        ).toBeVisible();

        const applied = page.getByRole("complementary", {
          name: "Catalogue filters",
        });
        await applied.locator('select[name="brand"]').selectOption(brandSlug);
        await applied.locator('select[name="bodyType"]').selectOption("suv");
        await applied
          .locator('select[name="condition"]')
          .selectOption("foreign_used");
        await applied.getByRole("button", { name: "Apply filters" }).click();
        await expect(page).toHaveURL(
          new RegExp(`brand=${brandSlug}&bodyType=suv&condition=foreign_used$`),
        );
        await expect(
          page.getByText("Showing 1–24 of 30 vehicles"),
        ).toBeVisible();

        const sorted = page.getByRole("complementary", {
          name: "Catalogue filters",
        });
        await sorted.locator('select[name="sort"]').selectOption("year_desc");
        await sorted.getByRole("button", { name: "Apply filters" }).click();
        await expect(page).toHaveURL(/sort=year_desc$/);
        await page.getByRole("link", { name: "Next catalogue page" }).click();
        await expect(page).toHaveURL(/sort=year_desc&page=2$/);

        const stateUrl = page.url();
        const pageTwoCards = page.locator(
          'ul[aria-label="All vehicles"] a[href^="/cars/"]',
        );
        await expect(pageTwoCards).toHaveCount(6);
        const cardHrefs = await pageTwoCards.evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")),
        );
        expect(cardHrefs).toHaveLength(6);
        await page.reload();
        await expect(page).toHaveURL(stateUrl);
        const refreshedHrefs = await page
          .locator('ul[aria-label="All vehicles"] a[href^="/cars/"]')
          .evaluateAll((nodes) =>
            nodes.map((node) =>
              (node as HTMLAnchorElement).getAttribute("href"),
            ),
          );
        expect(refreshedHrefs).toEqual(cardHrefs);
        await page.goto(stateUrl);
        await expect(
          page.locator('ul[aria-label="All vehicles"] a[href^="/cars/"]'),
        ).toHaveCount(6);

        await page
          .getByRole("link", { name: "Remove Condition: Foreign used" })
          .click();
        await expect(page).not.toHaveURL(/condition=/);
        await expect(page).not.toHaveURL(/page=/);
        await page.goBack();
        await expect(page).toHaveURL(/condition=foreign_used/);
        await expect(page).toHaveURL(/page=2/);
        await page
          .getByRole("region", { name: "Active filters" })
          .getByRole("link", { name: "Clear all" })
          .click();
        await expect(page).toHaveURL(/\/cars$/);

        await page.goto(`/cars/${detailSlug}`);
        await expect(
          page.locator('script[type="application/ld+json"]'),
        ).toHaveCount(1);
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement?.tagName),
        ).toMatch(/A|BUTTON/);
      }
    } finally {
      if (ids.length > 0) {
        await db.query(
          "DELETE FROM vehicle_images WHERE vehicle_id = ANY($1::uuid[])",
          [ids],
        );
        await db.query("DELETE FROM vehicles WHERE id = ANY($1::uuid[])", [
          ids,
        ]);
      }
      await db.query("DELETE FROM brands WHERE id = $1::uuid", [brandId]);
      await db.end();
    }
  });
});
