import { expect, test } from "@playwright/test";

/**
 * Layout shell tests.
 *
 * These assert stable, semantic behavior of the shared header, footer, and
 * homepage across all three configured projects (desktop-chromium, pixel-5,
 * iphone-13). Responsive expectations branch on the active project name rather
 * than hard-coding viewport values, so Playwright remains the single source of
 * device configuration.
 */

const DESKTOP_PROJECT = "desktop-chromium";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("exposes the shared, named landmarks exactly once", async ({ page }) => {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  await expect(main).toHaveCount(1);

  // Every navigation landmark must carry an accessible name.
  await expect(
    page.locator("nav:not([aria-label]):not([aria-labelledby])"),
  ).toHaveCount(0);
});

test("provides a working keyboard skip link", async ({ page }) => {
  const skipLink = page.getByRole("link", { name: "Skip to main content" });

  // The skip link is the first focusable element and is revealed on focus.
  await page.keyboard.press("Tab");
  const focusedViaTab = await skipLink.evaluate(
    (element) => element === document.activeElement,
  );
  if (!focusedViaTab) {
    // WebKit omits links from the Tab order by default; focus it directly to
    // exercise the same reveal-and-activate behavior.
    await skipLink.focus();
  }
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator("#main-content")).toHaveCount(1);
});

test("links only to routes that exist", async ({ page }) => {
  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href")),
    );

  const allowed = new Set(["/", "#main-content"]);
  for (const href of hrefs) {
    expect(href, `unexpected link target: ${href}`).not.toBeNull();
    expect(allowed.has(href ?? ""), `unexpected link target: ${href}`).toBe(
      true,
    );
  }

  // No empty-fragment or unimplemented-route links anywhere in the DOM.
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(
    page.locator(
      'a[href="/cars"], a[href="/rentals"], a[href="/packages"], a[href="/about"], a[href="/contact"], a[href="/admin"]',
    ),
  ).toHaveCount(0);
});

test("shows the navigation appropriate to the viewport", async ({
  page,
}, testInfo) => {
  const primaryNav = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const menuTrigger = page.getByRole("button", {
    name: "Open navigation menu",
  });

  if (testInfo.project.name === DESKTOP_PROJECT) {
    await expect(primaryNav).toBeVisible();
    await expect(menuTrigger).toBeHidden();
  } else {
    await expect(menuTrigger).toBeVisible();
    await expect(primaryNav).toBeHidden();
  }
});

test("opens an accessible mobile menu and restores focus", async ({
  page,
}, testInfo) => {
  const menuTrigger = page.getByRole("button", {
    name: "Open navigation menu",
  });

  if (testInfo.project.name === DESKTOP_PROJECT) {
    // Desktop uses inline navigation; the mobile trigger is not rendered.
    await expect(menuTrigger).toBeHidden();
    return;
  }

  await expect(menuTrigger).toBeVisible();
  await menuTrigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/Crown and Royal Rides/);
  await expect(dialog.getByRole("link", { name: "Home" })).toBeVisible();

  // Escape closes the sheet (Radix) and focus returns to the trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menuTrigger).toBeFocused();

  // Selecting Home also closes the sheet.
  await menuTrigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("link", { name: "Home" }).click();
  await expect(dialog).toBeHidden();
});

test("mobile menu trigger meets the 44x44 touch target", async ({
  page,
}, testInfo) => {
  const menuTrigger = page.getByRole("button", {
    name: "Open navigation menu",
  });

  if (testInfo.project.name === DESKTOP_PROJECT) {
    await expect(menuTrigger).toBeHidden();
    return;
  }

  const box = await menuTrigger.boundingBox();
  if (!box) {
    throw new Error("mobile menu trigger has no bounding box");
  }
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test("does not overflow horizontally", async ({ page }) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  // Allow a single-pixel subpixel rounding tolerance.
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test("renders an honest homepage without starter or internal content", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // No leftover Next.js / Vercel starter branding.
  await expect(
    page.locator('img[src*="next.svg"], img[src*="vercel.svg"]'),
  ).toHaveCount(0);

  const bodyText = (await page.locator("body").innerText()).toLowerCase();
  const forbidden = [
    "deploy now",
    "read our docs",
    "get started by editing",
    "phase 0",
    "foundation ready",
    "tests passing",
    "under construction",
  ];
  for (const phrase of forbidden) {
    expect(bodyText, `unexpected content: ${phrase}`).not.toContain(phrase);
  }

  // No invented contact links.
  await expect(
    page.locator(
      'a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"], a[href*="whatsapp"]',
    ),
  ).toHaveCount(0);
});
