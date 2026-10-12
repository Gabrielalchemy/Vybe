import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("instrument trials need active hand control and show gate totals", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("heading", { name: "Instrument trials" })).toBeVisible();
  await expect(dialog.getByText("0 (gate: at least 500)")).toBeVisible();
  await dialog.getByRole("button", { name: "Start accuracy trial" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Turn the camera on, calibrate and press Start playing before running a trial." })).toBeVisible();
  await expect(page.locator(".trial-bar")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
