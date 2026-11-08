import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

test.describe("ICM push/fold", () => {
  test("heads-up winner-take-all gives the chip-EV push/fold ranges", async ({ page }) => {
    await page.goto("/icm/");
    await page.getByTestId("icm-quick-hu").click();
    await page.getByTestId("icm-run").click();
    await expect(page.getByTestId("icm-result")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("icm-equity").locator("tbody tr")).toHaveCount(2);
    await expect(page.getByTestId("icm-equity")).toContainText("50.0%");
    // SB (acts first) jams about 58 % of the hands at 10bb
    const info = await page.getByTestId("icm-range-info").innerText();
    const pct = Number(/([\d.]+)%/.exec(info)![1]);
    expect(pct).toBeGreaterThan(54);
    expect(pct).toBeLessThan(63);
    await expect(page.getByTestId("icm-exploit")).toContainText("Exploitability");
    // a hand: AA always jams
    await page.locator('[data-cls="0"]').click();
    await expect(page.getByTestId("icm-hand")).toContainText("AA");
    await expect(page.getByTestId("icm-hand")).toContainText("100%");
    // the BB's call range is narrower than the SB's jam range
    await page.getByTestId("icm-view-1").click();
    const call = Number(/([\d.]+)%/.exec(await page.getByTestId("icm-range-info").innerText())![1]);
    expect(call).toBeGreaterThan(30);
    expect(call).toBeLessThan(pct);
  });

  test("the bubble: ICM equity differs from the chip share and an invalid prize list blocks the run", async ({ page }) => {
    await page.goto("/icm/");
    await page.getByTestId("icm-quick-bubble").click();
    await page.getByTestId("icm-acc-fast").click();
    await page.getByTestId("icm-payouts").fill("50, x");
    await expect(page.getByTestId("icm-run")).toBeDisabled();
    await page.getByTestId("icm-preset").selectOption("top3");
    await expect(page.getByTestId("icm-payouts")).toHaveValue("50, 30, 20");
    await page.getByTestId("icm-run").click();
    await expect(page.getByTestId("icm-result")).toBeVisible({ timeout: 60_000 });
    const rows = page.getByTestId("icm-equity").locator("tbody tr");
    await expect(rows).toHaveCount(4);
    // the shortest stack (9bb, BTN) holds ~15.5% of the chips but more of the prize pool
    const btn = rows.filter({ hasText: "BTN" });
    const cells = await btn.locator("td").allInnerTexts();
    const chips = parseFloat(cells[1]);
    const icm = parseFloat(cells[2]);
    expect(icm).toBeGreaterThan(chips + 2);
    // BB faces jams from three players
    await page.getByTestId("icm-view-3").click();
    await expect(page.getByTestId("icm-facing-0")).toBeVisible();
    await expect(page.getByTestId("icm-facing-2")).toBeVisible();
  });

  test("keeps the setup between visits", async ({ page }) => {
    await page.goto("/icm/");
    await page.getByTestId("icm-n-3").click();
    await page.getByTestId("icm-stack-0").fill("33");
    await page.goto("/settings/");
    await page.goto("/icm/");
    await expect(page.getByTestId("icm-stack-0")).toHaveValue("33");
    await expect(page.getByTestId("icm-stacks").locator("li")).toHaveCount(3);
  });
});
