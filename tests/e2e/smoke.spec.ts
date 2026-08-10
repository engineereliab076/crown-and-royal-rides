import { expect, test } from "@playwright/test";

/**
 * Foundation smoke test.
 *
 * This intentionally asserts only stable, semantic properties of the document
 * so it stays valid after the generated starter page is replaced. It does not
 * assert any starter text, headings, metadata, or business features.
 *
 * The same test runs under all three configured projects (desktop-chromium,
 * pixel-5, iphone-13).
 */

const APP_ORIGIN = "http://localhost:3000";

test("home page serves a valid, semantic document", async ({ page }) => {
  // Capture problems before navigating so nothing is missed during load.
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });

  const failedDocumentRequests: string[] = [];
  page.on("requestfailed", (request) => {
    // Only same-origin main-document navigations matter here. Favicons,
    // cross-origin assets, and intentionally aborted non-document requests
    // are ignored to keep this check narrow and stable.
    if (request.resourceType() !== "document") return;
    let origin: string;
    try {
      origin = new URL(request.url()).origin;
    } catch {
      return;
    }
    if (origin !== APP_ORIGIN) return;
    failedDocumentRequests.push(request.url());
  });

  const response = await page.goto("/");

  // The main document must load successfully.
  expect(response, "navigation should produce a response").not.toBeNull();
  expect(
    response?.ok(),
    "main document should return a successful status",
  ).toBe(true);

  // A visible body implies the page rendered.
  await expect(page.locator("body")).toBeVisible();

  // The document has exactly one <html> element declared as English.
  await expect(page.locator("html")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // A visible <main> landmark must exist.
  await expect(page.locator("main")).toBeVisible();

  // No Next.js development error overlay is present. The dev-tools indicator
  // portal is always mounted in dev, so target the error overlay's own markers
  // (absent when there is no build/runtime error, and absent entirely in prod).
  await expect(
    page.locator(
      "[data-nextjs-dialog-overlay], [data-nextjs-dialog], #nextjs__container_errors",
    ),
  ).toHaveCount(0);

  // No uncaught page errors occurred during initial load.
  expect(pageErrors, "no uncaught page errors during load").toEqual([]);

  // No same-origin document request failed during initial navigation.
  expect(
    failedDocumentRequests,
    "no failed same-origin document requests",
  ).toEqual([]);
});
