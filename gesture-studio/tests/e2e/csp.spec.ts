import { expect, test } from "@playwright/test";

// Run against `npm run start` to exercise the production CSP; under the dev
// server this asserts there are no console errors either.
test("loads without CSP violations, console errors, or remote requests", async ({ page }) => {
  const problems: string[] = [];
  const remote: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.hostname !== "localhost" && url.protocol !== "data:" && url.protocol !== "blob:") remote.push(req.url());
  });
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.keyboard.down("Digit1");
  await page.keyboard.up("Digit1");
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "IBM Plex Sans"'))).toBe(true);
  expect(problems).toEqual([]);
  expect(remote).toEqual([]);
});
