import { expect, test } from "@playwright/test";

test("anonymous visitors are redirected from every implemented admin page", async ({
  page,
}) => {
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/audit-log",
    "/admin/settings",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: "Administrator sign in" }),
    ).toBeVisible();
  }
});

test("login page is accessible and usable at the configured viewport", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await expect(
    page.getByRole("heading", { name: "Administrator sign in" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main")).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  await page.getByLabel("Email").focus();
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
});
