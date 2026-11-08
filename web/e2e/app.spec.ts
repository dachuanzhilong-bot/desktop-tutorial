import { expect, test, Page } from "@playwright/test";

const SETTINGS_KEY = "tessera.settings.v1";

test.beforeEach(async ({ context }) => {
  await context.addInitScript((k) => {
    if (!localStorage.getItem(k) && !location.search.includes("fresh")) localStorage.setItem(k, JSON.stringify({ onboarded: true }));
  }, SETTINGS_KEY);
});

async function startPractice(page: Page, opts: { rng?: boolean; hand?: boolean } = {}) {
  await page.goto("/practice/");
  if (opts.hand) await page.getByTestId("mode-hand").click();
  if (opts.rng) await page.getByTestId("toggle-rng").click();
  await page.getByTestId("start-practice").click();
  await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
}

test.describe("onboarding", () => {
  test("shows a 5 step tour on first launch and remembers it", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    const dlg = page.getByTestId("onboarding");
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 4; i++) await dlg.getByRole("button", { name: "次へ" }).click();
    await expect(dlg.getByText("5 / 5")).toBeVisible();
    await dlg.getByRole("button", { name: "練習をはじめる" }).click();
    await expect(page).toHaveURL(/\/practice\//);
    await page.goto("/");
    await expect(page.getByTestId("onboarding")).toBeHidden();
    await ctx.close();
  });
});

test.describe("study", () => {
  test("renders the 13x13 chart and walks the action tree", async ({ page }) => {
    await page.goto("/study/");
    await expect(page.locator(".cell")).toHaveCount(169);
    await expect(page.getByTestId("range-width")).toHaveText("100.0%");
    // AA is a pure raise at UTG
    await page.locator('[data-cls="0"]').click();
    const panel = page.getByTestId("hand-panel");
    await expect(panel).toContainText("AA");
    await expect(panel).toContainText("100%");
    // fold, fold, fold -> BTN to act ; then open
    for (let i = 0; i < 3; i++) await page.getByTestId("next-0").click();
    await expect(page.getByTestId("study-pot")).toContainText("BTN");
    const btnWidth = await page.getByTestId("range-width").innerText();
    expect(btnWidth).toBe("100.0%");
    // the BTN opens clearly more than UTG: raise share in the summary
    await expect(page.getByText(/レイズ/).first()).toBeVisible();
    // breadcrumbs jump back to the start
    await page.getByRole("button", { name: "最初から" }).click();
    await expect(page.getByTestId("study-pot")).toContainText("UTG");
  });

  test("view modes and filters work", async ({ page }) => {
    await page.goto("/study/");
    await page.getByRole("tab", { name: "エクイティ" }).click();
    await expect(page.locator('[data-cls="0"]')).toContainText("AA");
    await page.getByRole("tab", { name: "EV" }).click();
    await page.getByRole("button", { name: "スーテッドA" }).click();
    await expect(page.locator('.cell[data-dim="false"]')).toHaveCount(12); // AKs..A2s
    await page.getByRole("button", { name: "A", exact: true }).click(); // blocker A
    await expect(page.locator('.cell[data-dim="false"]')).toHaveCount(12);
  });

  test("deep link restores the node", async ({ page }) => {
    await page.goto("/study/#n=1");
    await expect(page.getByTestId("study-pot")).toContainText("HJ");
  });
});

test.describe("practice", () => {
  test("answering shows the EV loss, grade and stores the attempt", async ({ page }) => {
    await startPractice(page);
    await page.locator('[data-testid^="action-"]').first().click();
    const res = page.getByTestId("result");
    await expect(res).toBeVisible();
    await expect(page.getByTestId("ev-loss")).toHaveText(/^(0\.00|−\d+\.\d\d)$/);
    await expect(page.getByTestId("grade")).toBeVisible();
    await expect(page.getByTestId("hands-count")).toContainText("1");
    await page.getByTestId("next-hand").click();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
    // stats page sees the attempt (IndexedDB)
    await page.goto("/stats/");
    await expect(page.getByTestId("today-count")).toHaveText("1");
  });

  test("keyboard shortcuts answer and advance (desktop)", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard only");
    await startPractice(page);
    await page.keyboard.press("f");
    await expect(page.getByTestId("result")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
  });

  test("RNG mode shows a roll and a frequency bar", async ({ page }) => {
    await startPractice(page, { rng: true });
    await expect(page.getByTestId("rng-panel")).toBeVisible();
    const roll = Number(await page.getByTestId("rng-roll").innerText());
    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(100);
  });

  test("the time limit auto-folds", async ({ page }) => {
    await page.goto("/practice/");
    await page.getByTestId("timer-5").click();
    await page.getByTestId("start-practice").click();
    await expect(page.getByTestId("result")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("result")).toContainText("時間切れ");
  });

  test("play-through mode reaches a decision and ends hands", async ({ page }) => {
    await startPractice(page, { hand: true });
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-testid^="action-"]').first().click();
      await expect(page.getByTestId("result")).toBeVisible();
      await page.getByTestId("next-hand").click();
      await expect(page.locator('[data-testid^="action-"], [data-testid="hand-end"]').first()).toBeVisible({ timeout: 20_000 });
      if (await page.getByTestId("hand-end").isVisible()) await page.getByTestId("hand-end").getByRole("button").click();
      await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test("setup conditions restrict the spot", async ({ page }) => {
    await page.goto("/practice/#seat=5&spot=vsOpen");
    await page.getByTestId("start-practice").click();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("BB · あなたの番")).toBeVisible();
  });
});

test.describe("settings", () => {
  test("language, theme and palette switches apply immediately", async ({ page }) => {
    await page.goto("/settings/");
    await page.getByRole("radio", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: /Colour-vision/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-palette", "cvd");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("glossary tooltips open", async ({ page }) => {
    await page.goto("/study/");
    await page.getByRole("button", { name: /レンジ/ }).filter({ hasText: "レンジ幅" }).click();
    await expect(page.locator("[popover]:popover-open")).toContainText("頻度つき");
  });
});

test.describe("pwa", () => {
  test("manifest and icons are valid", async ({ page, request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.display).toBe("standalone");
    for (const icon of m.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  });

  test("works offline after the first visit", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // wait until the install step finished caching the solution files
    await expect
      .poll(async () => page.evaluate(async () => (await (await caches.open("tessera-data-v1")).keys()).length), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(8);
    await page.reload(); // now controlled by the SW
    await context.setOffline(true);
    await page.goto("/practice/");
    await page.getByTestId("start-practice").click();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid^="action-"]').first().click();
    await expect(page.getByTestId("result")).toBeVisible();
    await context.setOffline(false);
  });
});
