import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const melody = (page: Page, id: string) => page.locator(`.lane--melody [data-target-id="${id}"]`);
const chord = (page: Page, id: string) => page.locator(`.lane--chord [data-target-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
});

test("opens Play with the Pop chord voicings and sound off until started", async ({ page }) => {
  await expect(chord(page, "chord-slot-0")).toContainText("C3 G3 C4 E4");
  await expect(chord(page, "chord-slot-3")).toContainText("F2 F3 A3 C4");
  await expect(chord(page, "chord-slot-4")).toContainText("Empty");
  await expect(page.locator(".shell__status")).toContainText("Sound off");
  await expect(page.getByRole("button", { name: "Start sound" })).toBeVisible();
});

test("keyboard melody key holds the note until the same key is released", async ({ page }) => {
  await page.keyboard.down("KeyD");
  await expect(melody(page, "melody-pc-4")).toHaveAttribute("aria-pressed", "true");
  await expect(melody(page, "melody-pc-4")).toContainText("Held");
  // A second key for the same hand is ignored and does not release the first.
  await page.keyboard.down("KeyF");
  await page.keyboard.up("KeyF");
  await expect(melody(page, "melody-pc-4")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("KeyD");
  await expect(melody(page, "melody-pc-4")).toHaveAttribute("aria-pressed", "false");
});

test("pointer press on a chord pad shows its exact pitches and releases on pointer up", async ({ page }) => {
  const target = chord(page, "chord-slot-2");
  const box = await target.boundingBox();
  if (!box) throw new Error("no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chord-context")).toContainText("Am");
  await expect(page.locator(".chord-context")).toContainText("A2 A3 C4 E4");
  // Moving while held keeps the latched pad (pointer capture).
  await page.mouse.move(box.x - 200, box.y + box.height / 2);
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect(target).toHaveAttribute("aria-pressed", "false");
});

test("sustain keeps a released chord as Pedal until Escape stops all", async ({ page }) => {
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("Digit1");
  await page.keyboard.up("Digit1");
  await expect(chord(page, "chord-slot-0")).toContainText("Pedal");
  await page.keyboard.press("Escape");
  await expect(chord(page, "chord-slot-0")).not.toContainText("Pedal");
  await page.keyboard.up("ShiftLeft");
});

test("Rest left releases chord voices including pedal-held ones; melody continues", async ({ page }) => {
  await expect(chord(page, "rest")).toHaveText("Rest left");
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("Digit2");
  await page.keyboard.up("Digit2");
  await page.keyboard.down("KeyA");
  await page.getByRole("button", { name: "Rest left" }).first().click();
  await expect(chord(page, "chord-slot-1")).not.toContainText("Pedal");
  await expect(melody(page, "melody-pc-0")).toHaveAttribute("aria-pressed", "true");
  await expect(chord(page, "rest")).toHaveText("Resting");
  await expect(melody(page, "rest")).toHaveText("Rest right");
  await page.keyboard.up("KeyA");
  await page.keyboard.up("ShiftLeft");
});

test("held and pedal states are visually distinct (screenshot for review)", async ({ page }) => {
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("Digit1");
  await page.keyboard.up("Digit1");
  await page.keyboard.down("Digit3");
  await page.keyboard.down("KeyE");
  await expect(chord(page, "chord-slot-0")).toContainText("Pedal");
  await expect(chord(page, "chord-slot-2")).toContainText("Held");
  await expect(melody(page, "melody-pc-3")).toContainText("Held");
  await page.screenshot({ path: "test-results/states-held-pedal.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.up("KeyE");
  await page.keyboard.up("Digit3");
  await page.keyboard.up("ShiftLeft");
});

test("an empty pad stays silent and is announced as empty", async ({ page }) => {
  await page.keyboard.down("Digit8");
  await expect(chord(page, "chord-slot-7")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".lane--chord .lane__state")).toHaveText("Closed on a silent target");
  await page.keyboard.up("Digit8");
});

test("octave change is refused while holding, then autosaved and restored after reload", async ({ page }) => {
  await page.keyboard.down("KeyA");
  await expect(page.getByRole("button", { name: "Raise melody octave" })).toBeDisabled();
  await page.keyboard.up("KeyA");
  await page.keyboard.press("BracketRight");
  await expect(melody(page, "melody-pc-0")).toContainText("C5");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(melody(page, "melody-pc-0")).toContainText("C5");
  await page.keyboard.press("BracketLeft");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 5000 });
});

test("hiding the page releases notes and requires an explicit Resume", async ({ page }) => {
  await page.keyboard.down("KeyG");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(melody(page, "melody-pc-7")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.up("KeyG");
  await page.keyboard.down("KeyG");
  await expect(melody(page, "melody-pc-7")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.up("KeyG");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.keyboard.down("KeyG");
  await expect(melody(page, "melody-pc-7")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("KeyG");
});

test("Settings opens as a labelled dialog, Escape stops audio and closes it, focus returns", async ({ page }) => {
  const settings = page.getByRole("button", { name: "Settings" });
  await settings.focus();
  await settings.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Storage" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
});

test("development simulator drives the pipeline and leaves nothing held", { tag: "@dev" }, async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Left hand lost under sustain" }).click();
  await expect(page.getByRole("dialog").getByText(/flushed \(|loss|lost/).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("dialog").getByRole("status").filter({ hasText: "Running" })).toBeHidden({ timeout: 5000 });
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".target.is-held, .target.is-pedal")).toHaveCount(0);
});

test("has no automatically detectable accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).join(" | ")}`)).toEqual([]);
});

test.describe("viewport sizes", () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 640 },
  ]) {
    test(`${size.width}x${size.height}: targets meet minimum size without a warning`, async ({ page }) => {
      await page.setViewportSize(size);
      await expect(page.getByText("Enlarge the window")).toBeHidden();
      for (const id of ["chord-slot-0", "chord-slot-7"]) {
        const box = await chord(page, id).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(88);
        expect(box!.height).toBeGreaterThanOrEqual(96);
      }
      for (const id of ["melody-pc-0", "melody-pc-1", "melody-pc-11"]) {
        const box = await melody(page, id).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(64);
        expect(box!.height).toBeGreaterThanOrEqual(76);
      }
      await page.screenshot({ path: `test-results/shell-${size.width}x${size.height}.png` });
    });
  }

  test("below the minimum, asks to enlarge the window and keeps keyboard input", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await expect(page.getByText("Enlarge the window to use both hand areas.")).toBeVisible();
    await page.keyboard.down("KeyA");
    await expect(melody(page, "melody-pc-0")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.up("KeyA");
  });
});

test("pointer hit geometry matches the drawn target near a boundary", async ({ page }) => {
  const c = await melody(page, "melody-pc-0").boundingBox();
  const d = await melody(page, "melody-pc-2").boundingBox();
  // A click 2px inside C's right edge presses C, 2px inside D's left edge presses D.
  await page.mouse.move(c!.x + c!.width - 2, c!.y + c!.height * 0.8);
  await page.mouse.down();
  await expect(melody(page, "melody-pc-0")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await page.mouse.move(d!.x + 2, d!.y + d!.height * 0.8);
  await page.mouse.down();
  await expect(melody(page, "melody-pc-2")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
});

test("component showcase renders every target state (development fixture)", { tag: "@dev" }, async ({ page }) => {
  await page.goto("/?showcase");
  await expect(page.getByRole("heading", { name: /Component showcase/ })).toBeVisible();
  for (const caption of ["Sounding, held", "Released with sustain", "Scale Guard blocked (Phase 5)", "Empty chord slot", "Resting"]) {
    await expect(page.getByRole("button", { name: caption })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/showcase.png", fullPage: true });
});
