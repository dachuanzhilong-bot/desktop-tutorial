import { expect, test } from "@playwright/test";

// The app on a sub-path (a GitHub Pages project site: https://<user>.github.io/<repo>/).
// Run with `npm run e2e:subpath`, which builds with NEXT_PUBLIC_BASE_PATH and serves the export under that path;
// every request outside the path is a 404 there, so a hand-written "/…" URL shows up as a failure below.
const BASE = process.env.E2E_BASE_PATH ?? "";
const ORIGIN = "http://localhost:3200";
const url = (p: string) => `${ORIGIN}${BASE}${p}`;

test.skip(!BASE, "only with E2E_BASE_PATH (npm run e2e:subpath)");

test("a first visit, every kind of data and both workers work under a sub-path, and so does offline", async ({ page, context }) => {
  const bad: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => m.type() === "error" && bad.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));

  // first visit: the tour is there, and leads on
  await page.goto(url("/"));
  const tour = page.getByTestId("onboarding");
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "スキップ" }).click();
  await expect(tour).toBeHidden();

  // navigation (Next's own links) stays under the path
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "スタディ" }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/study/`));
  await expect(page.locator(".cell")).toHaveCount(169);

  // solution chunks, the flop worker and its data
  await page.goto(url("/study/postflop/"));
  await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  await expect(page.locator(".cell")).toHaveCount(169);

  // the WebAssembly solver in the bundled solver worker (it finds the .wasm under the base path)
  await page.goto(url("/icm/"));
  await page.getByTestId("icm-quick-bubble").click();
  await page.getByTestId("icm-acc-fast").click();
  await page.getByTestId("icm-run").click();
  await expect(page.getByTestId("icm-result")).toBeVisible({ timeout: 60_000 });

  // the service worker installs for this path only, and the app then works offline
  await page.goto(url("/"));
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toBe(url("/"));
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const name = (await caches.keys()).find((k) => k === "tessera-data");
          return name ? (await (await caches.open(name)).keys()).length : 0;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(8);
  await page.reload();
  // everything so far came without a single failed request or console error (offline, the browser reports its own)
  expect(bad, bad.join("\n")).toEqual([]);
  await context.setOffline(true);
  await page.goto(url("/practice/"));
  await page.getByTestId("start-practice").click();
  await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});

test("the manifest and its icons are under the path, and the address without the slash redirects", async ({ request }) => {
  const res = await request.get(url("/manifest.webmanifest"));
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.start_url).toBe(`${BASE}/`);
  expect(m.scope).toBe(`${BASE}/`);
  for (const icon of m.icons) {
    expect(icon.src.startsWith(`${BASE}/`), icon.src).toBe(true);
    expect((await request.get(`${ORIGIN}${icon.src}`)).ok(), icon.src).toBe(true);
  }
  expect((await request.get(`${ORIGIN}/solutions/index.json`)).status(), "nothing is served outside the path").toBe(404);
  expect((await request.get(url("/solutions/index.json"))).ok()).toBe(true);
});
