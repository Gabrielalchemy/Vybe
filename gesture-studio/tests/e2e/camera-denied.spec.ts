import { expect, test } from "@playwright/test";

// Simulates the owner denying camera permission: getUserMedia rejects with the
// same NotAllowedError the browser produces for a denial.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
});

test("a denied camera leaves a usable keyboard instrument and a clear retry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Camera on" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Camera access is off. Allow access to use hand control, or continue with the keyboard." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Try camera again" })).toBeVisible();
  await expect(page.locator(".shell__status")).toContainText("Camera problem");
  await page.keyboard.down("KeyA");
  await expect(page.locator('.lane--melody [data-target-id="melody-pc-0"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("KeyA");
});

test("a camera already in use gets its own message", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Device in use", "NotReadableError"));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Camera on" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The camera could not start. Close another camera app and try again." })).toBeVisible({ timeout: 15_000 });
});
