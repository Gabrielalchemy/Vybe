import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("finger flick is the default play gesture; the choice is remembered", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const flick = dialog.getByRole("radio", { name: /Finger flick/ });
  const pinch = dialog.getByRole("radio", { name: /^Pinch/ });
  await expect(flick).toBeChecked();
  await expect(dialog.getByRole("group", { name: "Flick sensitivity" })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Normal" })).toBeChecked();

  await pinch.check();
  await expect(dialog.getByRole("group", { name: "Flick sensitivity" })).toBeHidden();
  const results = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: /^Pinch/ })).toBeChecked();
  // Restore the default for other tests sharing this origin's storage.
  await page.getByRole("dialog").getByRole("radio", { name: /Finger flick/ }).check();
});

test("sensitivity choice is remembered", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "More" }).check();
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "More" })).toBeChecked();
  await page.getByRole("dialog").getByRole("radio", { name: "Normal" }).check();
});
