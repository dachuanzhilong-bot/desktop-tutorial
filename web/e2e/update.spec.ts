import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

/** the page is running under the service worker (a reload after the first visit) */
async function controlled(page: Page) {
  await page.goto("/settings/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const swapIn = (page: Page) => page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));

test.describe("update notice", () => {
  test("every build stamps its own worker, so a deployed update is noticed", async ({ request }) => {
    const sw = await (await request.get("/sw.js")).text();
    expect(sw).toMatch(/const BUILD = "[0-9a-f]{10}";/);
  });

  test("a first visit that the worker claims is not an update", async ({ page }) => {
    await page.goto("/settings/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await swapIn(page);
    await page.waitForTimeout(200);
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  });

  test("a new version taking over a running page shows the banner; Reload loads it", async ({ page }) => {
    await controlled(page);
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
    await swapIn(page);
    const banner = page.getByTestId("update-banner");
    await expect(banner).toBeVisible();
    const res = await new AxeBuilder({ page }).include("[data-testid=update-banner]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(res.violations.map((v) => v.id)).toEqual([]);
    for (const id of ["update-reload", "update-later"]) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    await page.getByTestId("update-reload").click();
    // the page was really reloaded: the marker set on the old document is gone, and the banner with it
    await expect.poll(() => page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept ?? false)).toBe(false);
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  });

  test("Later hides it and it does not come back for the same page", async ({ page }) => {
    await controlled(page);
    await swapIn(page);
    await page.getByTestId("update-later").click();
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
    await swapIn(page);
    await page.waitForTimeout(200);
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  });
});
