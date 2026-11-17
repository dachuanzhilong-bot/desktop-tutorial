import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * REFACTOR_PLAN 3-3-6: the river of a `TSP1` v3 flop is solved on the device. The shipped data is still v2 (v3 comes with
 * 3-3-7), so these tests hand the browser a small v3 file in place of srp-btn-bb's As7d2c: the fixture written by the
 * solver's test `v3_e2e_fixture_for_the_web_tests` (src/lib/__tests__/fixtures, not part of the export). It is served
 * through the route below, the service worker caches it as it caches any flop file, and the solver worker, the
 * WebAssembly module and the solved rivers come from the app itself.
 */
const FIXTURE = gzipSync(readFileSync(resolve("src/lib/__tests__/fixtures/tsp1-v3-e2e.bin")));
/** the river card the tests pick (not on the board of any turn of the fixture) */
const CARD = "Kh";
/** the time limit of the plan: from the card to the river on screen, CPU 4x slower */
const LIMIT_MS = 5000;
/** RIVER_THROTTLE=1 measures the same without the slow-down (for docs/14 §12) */
const THROTTLE = Number(process.env.RIVER_THROTTLE ?? 4);

test.beforeEach(async ({ context }, info) => {
  test.skip(info.project.name !== "desktop", "the solve and its cache do not depend on the viewport (the viewer's layout is checked by the v2 tests)");
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
  await context.route(/\/postflop\/srp-btn-bb\/0\.bin\.gz(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "application/gzip", body: FIXTURE }));
});

/** a first visit: the service worker has installed and controls the page */
async function firstVisit(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** from the flop root to the river start after check-check on the flop and on the first turn card */
async function toRiverStart(page: Page) {
  await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  await expect(page.getByLabel("board").first().locator("[role=img]")).toHaveCount(3);
  await page.getByTestId("pf-next-1").click(); // BB checks
  await expect(page.getByTestId("pf-actor")).toContainText("BTN");
  await page.getByTestId("pf-next-1").click(); // BTN checks
  await page.locator('[data-testid="deal-card"]:not([disabled])').first().click(); // the turn
  await expect(page.getByLabel("board").first().locator("[role=img]")).toHaveCount(4);
  await expect(page.getByTestId("pf-actor")).toContainText("BB");
  await page.getByTestId("pf-next-1").click();
  await expect(page.getByTestId("pf-actor")).toContainText("BTN");
  await page.getByTestId("pf-next-1").click();
  await expect(page.getByTestId("river-deal")).toBeVisible();
  // every card that is not on the board can be dealt
  await expect(page.locator('[data-testid="river-deal"] [data-testid="deal-card"]')).toHaveCount(48);
}

const riverCard = (page: Page) => page.locator(`[data-testid="river-deal"] [data-testid="deal-card"][data-card="${CARD}"]`);

/**
 * The page's CPU `rate` x slower (DevTools' CPU throttling). Chrome throttles pages only: sent to a worker target,
 * `Emulation.setCPUThrottlingRate` answers "Operation is only supported for pages, not workers", so the solver worker
 * runs at full speed and its time is scaled by hand below.
 */
async function throttle(context: BrowserContext, page: Page, rate: number) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
}

test("a river of a v3 flop opens offline, CPU 4x slower within 5 s, and is solved only once (memory, then IndexedDB)", async ({ page, context }, info) => {
  test.setTimeout(120_000);
  await firstVisit(page);
  await page.goto("/study/postflop/");
  await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  // another flop as well (opened again below, offline)
  await page.getByTestId("flop-1").click();
  await expect(page.getByLabel("board").first().locator("[role=img]")).toHaveCount(3);
  await expect(page.locator(".cell")).toHaveCount(169);
  await page.getByTestId("flop-0").click();
  await expect(page.getByTestId("pf-actor")).toContainText("BB");
  // the v3 flop is in the service worker's data cache now: from here on there is no network
  await context.setOffline(true);
  await page.reload();
  await toRiverStart(page);

  // the first river: solved on the device (worker start, module, RIVER_ITERATIONS (1,000) iterations, export, the chart), timed with the CPU slowed
  const cdp = await throttle(context, page, THROTTLE);
  const t0 = Date.now();
  await riverCard(page).click();
  await expect(page.getByTestId("river-status")).toHaveAttribute("data-source", "solved", { timeout: 30_000 });
  await expect(page.locator(".cell")).toHaveCount(169);
  const ms = Date.now() - t0;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // the worker was not slowed: its time (worker start, module, iterations, export and the replies, as the layer
  // measured it) counts THROTTLE times in the estimate of a device that is THROTTLE times slower
  const solveMs = Number(await page.getByTestId("river-status").getAttribute("data-solve-ms"));
  expect(solveMs).toBeGreaterThan(0);
  const estimate = ms + (THROTTLE - 1) * solveMs;
  const shown = await page.getByTestId("river-status").innerText();
  info.annotations.push({ type: "river-ms", description: `${ms} ms from the card to the chart (page CPU x${THROTTLE}), worker ${solveMs} ms, estimate ${estimate} ms; "${shown}"` });
  if (process.env.RIVER_TIMING_OUT) writeFileSync(process.env.RIVER_TIMING_OUT, JSON.stringify({ ms, solveMs, estimate, throttle: THROTTLE, shown }) + "\n", { flag: "a" });
  expect(estimate, `river shown after ${ms} ms, worker ${solveMs} ms: ${estimate} ms with the worker ${THROTTLE}x slower`).toBeLessThan(LIMIT_MS);
  await expect(page.getByTestId("river-status")).toHaveAttribute("data-computed", "1");
  await expect(page.getByTestId("pf-actor")).toContainText("BB");
  await expect(page.getByLabel("board").first().locator("[role=img]")).toHaveCount(5);
  await expect(page.getByTestId("river-approx")).toBeVisible();
  // the address holds the river's position key: the line, the turn and the river card
  await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toMatch(new RegExp(`p=As7d2c@X-X/..\\/X-X/${CARD}$`));
  const deepLink = await page.evaluate(() => location.hash);

  // the same river again, from a freshly loaded flop (another flop and back): from memory, nothing solved
  await page.getByTestId("flop-1").click();
  await expect(page.locator(".cell")).toHaveCount(169);
  await page.getByTestId("flop-0").click();
  await toRiverStart(page);
  await riverCard(page).click();
  await expect(page.getByTestId("river-status")).toHaveAttribute("data-source", "memory");
  await expect(page.getByTestId("river-status")).toHaveAttribute("data-computed", "1");

  // after a reload (still offline; the address without the river's deep link): from IndexedDB, nothing solved by the new page
  await page.goto("/");
  await page.goto("/study/postflop/");
  await toRiverStart(page);
  await riverCard(page).click();
  await expect(page.getByTestId("river-status")).toHaveAttribute("data-source", "store");
  await expect(page.getByTestId("river-status")).toHaveAttribute("data-computed", "0");

  // a deep link into the river opens it (from IndexedDB)
  await page.goto("/");
  await page.goto(`/study/postflop/${deepLink}`);
  await expect(page.getByLabel("board").first().locator("[role=img]")).toHaveCount(5, { timeout: 20_000 });
  await expect(page.getByTestId("pf-actor")).toContainText("BB");
  const stored = await page.evaluate(
    () =>
      new Promise<number>((res) => {
        const r = indexedDB.open("tessera-river");
        r.onsuccess = () => {
          const q = r.result.transaction("rivers").objectStore("rivers").count();
          q.onsuccess = () => res(q.result);
        };
      }),
  );
  expect(stored).toBe(1);
  await context.setOffline(false);
});

test("the practice drill plays a hand of a v3 flop on to the river", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/practice/#mode=postSpot&scenario=srp-btn-bb&flop=0");
  await expect(page.getByTestId("mode-postSpot")).toHaveAttribute("aria-pressed", "true");
  // river spots only: the drill picks a river start, solves its river and asks a river decision
  await page.getByTestId("street-0").click();
  await page.getByTestId("street-1").click();
  await expect(page.getByTestId("street-2")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("street-0")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("start-practice").click();
  await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("post-table").getByLabel("board").first().locator("[role=img]")).toHaveCount(5);
});
