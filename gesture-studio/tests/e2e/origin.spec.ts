import { expect, test } from "@playwright/test";

test("127.0.0.1 redirects to the canonical localhost origin that owns saved data", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4173/", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toBe("http://localhost:4173/");
});

test("an unexpected Host header is rejected", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4173/", { headers: { Host: "evil.example:4173" }, maxRedirects: 0 });
  // Vite dev rejects with 403 (allowedHosts); the production server answers 421.
  expect([403, 421]).toContain(response.status());
});
