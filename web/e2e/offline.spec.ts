import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

// The service worker's two caches (public/sw.js): the app (tessera-core-<VERSION>-<BUILD>, one per deploy) and the
// solution data (tessera-data, kept across deploys). Both tests check the cache itself and do not depend on the
// viewport, so they run in one project only.
const ORIGIN = "http://localhost:3100";
const OUT = resolve("out");

test.beforeEach(async ({ context }, info) => {
  test.skip(info.project.name !== "desktop", "the service worker and its caches do not depend on the viewport");
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

/** every page of the built export, found here on its own (not with the build's list): <dir>/index.html → /<dir>/ */
function exportedPages(dir = OUT): { path: string; html: string }[] {
  const out: { path: string; html: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // Next's internals (_next, _not-found, __next.*) and the 404 page are not pages to open
      if (!e.name.startsWith("_") && e.name !== "404") out.push(...exportedPages(p));
    } else if (e.name === "index.html") {
      const rel = relative(OUT, dir).split(sep).filter(Boolean);
      out.push({ path: rel.length ? `/${rel.join("/")}/` : "/", html: readFileSync(p, "utf8") });
    }
  }
  return out;
}

/** a first visit: the worker has installed (pages and solution data cached), and the page is now under it */
async function firstVisit(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/**
 * A new deploy: the server now hands this browser a different sw.js (another VERSION and BUILD; the e2e hook of
 * scripts/serve-static.mjs), the browser installs it on update() and it takes over.
 */
async function deployNewWorker(page: Page, context: BrowserContext) {
  await context.addCookies([{ name: "tessera-e2e-sw", value: "next", url: ORIGIN }]);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const r = await navigator.serviceWorker.getRegistration();
          return !!r && !r.installing && !r.waiting && r.active?.state === "activated" && r.active.scriptURL.endsWith("/sw.js");
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  // the old app cache went with the old worker: the new one has really been activated
  await expect.poll(() => cores(page), { timeout: 30_000 }).toEqual([expect.stringMatching(/^tessera-core-v\d+-next-[0-9a-f]{10}-next$/)]);
}

const cores = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("tessera-core-")));

/** a file of a build the current index no longer lists (what a past generation of the data leaves behind) */
const STALE = `${ORIGIN}/postflop/srp-btn-bb/0.bin.gz?b=000000000000`;
const putStale = (page: Page) => page.evaluate(async (u) => (await caches.open("tessera-data")).put(u, new Response("old")), STALE);

const dataUrls = (page: Page) =>
  page.evaluate(async () => ((await caches.has("tessera-data")) ? (await (await caches.open("tessera-data")).keys()).map((r) => r.url) : []));

test("every page of the export opens offline after the first visit, with no page listed by hand", async ({ page, context }) => {
  const pages = exportedPages();
  expect(pages.length).toBeGreaterThanOrEqual(17);
  await firstVisit(page);
  const failed: string[] = [];
  page.on("requestfailed", (r) => {
    // a load cancelled by the next navigation (net::ERR_ABORTED) is not a missing file
    const error = r.failure()?.errorText ?? "";
    if (r.url().startsWith(`${ORIGIN}/_next/static/`) && !error.includes("ERR_ABORTED")) failed.push(`${r.url()} ${error}`);
  });
  page.on("pageerror", (e) => failed.push(`pageerror: ${e.message}`));
  await context.setOffline(true);
  for (const { path, html } of pages) {
    // the page itself is in the cache, not the home page standing in for it
    const cached = await page.evaluate(async (u) => (await caches.match(u))?.text() ?? null, path);
    expect(cached, `${path} is precached`).toBe(html);
    const res = await page.goto(path);
    expect(res?.ok(), path).toBe(true);
    const h1 = /<h1[^>]*>([^<]+)/.exec(html)?.[1];
    if (h1) await expect(page.locator("h1").first(), path).toContainText(h1);
  }
  // … and with its scripts and styles: nothing the pages load is missing
  expect(failed, failed.join("\n")).toEqual([]);
  await context.setOffline(false);
});

test("Solve runs offline without having been opened online: the bundled solver worker is precached", async ({ page, context }) => {
  await firstVisit(page);
  // the worker's files are in the app cache from the install step, not from a visit to /solve/
  const precached = await page.evaluate(async () => {
    const core = (await caches.keys()).find((k) => k.startsWith("tessera-core-"));
    return core ? (await (await caches.open(core)).keys()).map((r) => new URL(r.url).pathname) : [];
  });
  expect(precached.some((p) => /^\/_next\/static\/chunks\/turbopack-worker-[^/]+\.js$/.test(p)), precached.join("\n")).toBe(true);
  await context.setOffline(true);
  await page.goto("/solve/");
  await page.getByRole("button", { name: "クリア" }).click();
  for (const c of ["Ks", "7d", "2c", "9h", "3s"]) await page.getByTestId(`pick-${c}`).click();
  await page.getByTestId("range-oop-text").fill("QQ,JJ,AQs");
  await page.getByTestId("range-ip-text").fill("AA,KK,77,A5s");
  await page.getByTestId("acc-draft").click();
  await page.getByTestId("solve-run").click();
  await expect(page.getByTestId("solve-result")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("solve-error")).toHaveCount(0);
  await context.setOffline(false);
});

test("a flop opened once still opens offline after the app is updated; only data of an older build is dropped", async ({ page, context }) => {
  await firstVisit(page);
  await page.goto("/study/postflop/");
  await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  const before = await dataUrls(page);
  const flops = before.filter((u) => /\/postflop\/.*\.gz\?b=[0-9a-f]{12}$/.test(u));
  expect(flops.length).toBeGreaterThanOrEqual(1);
  const solutions = before.filter((u) => /\/solutions\/.*\.gz\?b=[0-9a-f]{12}$/.test(u));
  expect(solutions.length).toBeGreaterThanOrEqual(40);
  await putStale(page);
  const [oldCore] = await cores(page);
  expect(oldCore).toMatch(/^tessera-core-v\d+-[0-9a-f]{10}$/);

  await deployNewWorker(page, context);
  await expect.poll(async () => (await dataUrls(page)).includes(STALE), { timeout: 10_000 }).toBe(false);
  const after = await dataUrls(page);
  for (const u of [...flops, ...solutions]) expect(after, u).toContain(u);

  await context.setOffline(true);
  await page.goto("/study/postflop/");
  await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  await page.goto("/practice/");
  await page.getByTestId("start-practice").click();
  await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});

test("a worker that takes over without reaching the index files drops no solution data", async ({ page, context }) => {
  await firstVisit(page);
  await page.goto("/study/postflop/");
  await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  await putStale(page);
  const before = await dataUrls(page);
  // the network fails for the index files only: the new worker cannot tell which builds are current
  await context.route(/\/(solutions|postflop)\/index\.json/, (route) => route.abort());
  await deployNewWorker(page, context);
  const after = await dataUrls(page);
  for (const u of before) expect(after, u).toContain(u);
  expect(after).toContain(STALE);
});
