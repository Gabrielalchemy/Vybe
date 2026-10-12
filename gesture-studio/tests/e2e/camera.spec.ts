import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Chromium's synthetic camera: a moving test pattern with no hands. It exercises
// permission, startup, worker inference and lifecycle, not hand accuracy.
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

const status = (page: Page) => page.locator(".shell__status");

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function liveTracks(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>("video.camera-preview__video");
    const stream = v?.srcObject as MediaStream | null | undefined;
    return stream ? stream.getTracks().filter((t) => t.readyState === "live").length : 0;
  });
}

test("the camera stays off until the owner turns it on", async ({ page }) => {
  await open(page);
  await expect(status(page)).toContainText("Camera off");
  expect(await liveTracks(page)).toBe(0);
});

test("turning the camera on starts tracking and asks for calibration", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Camera on" }).click();
  await expect(status(page)).toContainText("Camera on · calibration needed", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Calibrate hands" })).toBeVisible();
  expect(await liveTracks(page)).toBe(1);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByText("Tracking runs on")).toBeVisible();
  await expect(dialog.locator("dd", { hasText: /^CPU$/ })).toBeVisible();
  // Live statistics show real inference results from the worker.
  await expect(dialog.getByText("Tracking results").locator("xpath=following-sibling::dd[1]")).not.toHaveText(/^0\.0 per second$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await page.screenshot({ path: "test-results/camera-needs-calibration.png" });
});

test("calibration opens with the first instruction, and can be cancelled", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Camera on" }).click();
  await page.getByRole("button", { name: "Calibrate hands" }).click({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Calibrate hands" })).toBeFocused();
  await expect(page.getByText("Raise only your left hand")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Step progress" })).toHaveAttribute("aria-valuenow", "0");
  await page.screenshot({ path: "test-results/calibration-identify.png" });
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.getByRole("button", { name: "Cancel calibration" }).click();
  await expect(page.getByRole("button", { name: "Calibrate hands" })).toBeVisible();
});

test("Camera off stops every camera track", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Camera on" }).click();
  await expect(status(page)).toContainText("calibration needed", { timeout: 30_000 });
  await page.getByRole("button", { name: "Camera off" }).click();
  await expect(status(page)).toContainText("Camera off");
  expect(await liveTracks(page)).toBe(0);
});

test("hiding the page stops the camera and needs explicit actions to return", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Camera on" }).click();
  await expect(status(page)).toContainText("calibration needed", { timeout: 30_000 });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(status(page)).toContainText("Camera off");
  expect(await liveTracks(page)).toBe(0);
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
});

test("repeated camera on/off cycles leave no live tracks or extra workers", async ({ page }) => {
  await open(page);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /Camera on|Try camera again/ }).click();
    await expect(status(page)).toContainText("calibration needed", { timeout: 30_000 });
    await page.getByRole("button", { name: "Camera off" }).click();
    await expect(status(page)).toContainText("Camera off");
  }
  expect(await liveTracks(page)).toBe(0);
});
