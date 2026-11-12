import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

test.describe("postflop study", () => {
  test("navigates flop -> turn and shows the combos of a chart cell", async ({ page }) => {
    await page.goto("/study/postflop/");
    await expect(page.locator(".cell")).toHaveCount(169);
    await expect(page.getByTestId("pf-actor")).toContainText("BB");
    // OOP checks, IP bets (first bet size), OOP calls -> a turn card is dealt
    await page.getByTestId("pf-next-1").click();
    await expect(page.getByTestId("pf-actor")).toContainText("BTN");
    await page.getByTestId("pf-next-2").first().click();
    await page.getByTestId("pf-next-1").click();
    const cards = page.getByTestId("deal-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    await cards.first().click();
    await expect(page.locator(".cell")).toHaveCount(169);
    // board now has four cards
    await expect(page.getByLabel("board").first().locator("[role=img]")).toHaveCount(4);
    await page.locator('[data-cls="14"]').click();
    await expect(page.getByTestId("pf-hand-panel")).toBeVisible();
    await expect(page.getByTestId("pf-hand-panel").locator("tbody tr")).not.toHaveCount(0);
  });

  test("hand-type filter dims cells and the flop / scenario can be switched", async ({ page }) => {
    await page.goto("/study/postflop/");
    await page.getByTestId("flop-1").click();
    await expect(page.getByLabel("board").first().locator("[role=img]")).toHaveCount(3);
    await page.getByRole("button", { name: "フラッシュドロー" }).click();
    const lit = await page.locator('.cell[data-dim="false"]').count();
    expect(lit).toBeGreaterThanOrEqual(0);
    expect(lit).toBeLessThan(169);
    await page.getByRole("button", { name: "すべて", exact: true }).click();
    await expect(page.locator('.cell[data-dim="true"]')).toHaveCount(0);
    const scenarios = page.locator('[data-testid^="scenario-"]');
    if ((await scenarios.count()) > 1) {
      await scenarios.nth(1).click();
      await expect(page.locator(".cell")).toHaveCount(169);
    }
  });

  test("'practise this flop' opens the drill pre-filled with the flop", async ({ page }) => {
    await page.goto("/study/postflop/#s=srp-btn-bb&f=2&n=0");
    await page.getByTestId("practice-this-flop").click();
    await expect(page).toHaveURL(/practice\/#mode=postSpot&scenario=srp-btn-bb&flop=2/);
    await expect(page.getByTestId("mode-postSpot")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/フロップ: /)).toBeVisible();
    await page.getByTestId("start-practice").click();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 25_000 });
    // the board of the drill is the chosen flop (Q♠ J♦ 6♠)
    await expect(page.getByTestId("post-table")).toContainText("Q");
  });

  test("deep link restores scenario, flop and node", async ({ page }) => {
    // the flop by its board (flop 2 = "Qs Jd 6s", cards in any order), the node by its line: BB checks, BTN to act
    await page.goto("/study/postflop/#s=srp-btn-bb&p=QsJd6s@X");
    await expect(page.getByTestId("flop-2")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pf-actor")).toContainText("BTN", { timeout: 20_000 });
    // a flop or a line today's data does not have opens a root instead of failing
    await page.goto("/study/postflop/#s=srp-btn-bb&p=QsJd6s@X-B999");
    await page.reload();
    await expect(page.getByTestId("flop-2")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
    await page.goto("/study/postflop/#s=srp-btn-bb&p=AsAhAd@root");
    await page.reload();
    await expect(page.getByTestId("flop-0")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  });

  test("an address written before position keys (flop and node numbers) is still read, and rewritten with the key", async ({ page }) => {
    await page.goto("/study/postflop/#s=srp-btn-bb&f=2&n=0");
    await expect(page.getByTestId("flop-2")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/study\/postflop\/#s=srp-btn-bb&p=QsJd6s@root$/, { timeout: 20_000 });
  });
});

test.describe("aggregate report", () => {
  test("groups the solved flops by texture and links back to the study", async ({ page }) => {
    await page.goto("/study/report/");
    const bars = page.getByTestId("rep-bars").locator("li");
    await expect(bars.first()).toBeVisible();
    const before = await bars.count();
    await page.getByRole("button", { name: "スート", exact: true }).click();
    await expect(page.getByTestId("rep-bars").locator("li").first()).toContainText(/レインボー|ツートーン|モノトーン/);
    await page.getByRole("button", { name: "つながり", exact: true }).click();
    expect(before).toBeGreaterThan(1);
    const rows = page.getByTestId("rep-table").locator("tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(8);
    await rows.first().getByRole("link").click();
    await expect(page).toHaveURL(/study\/postflop\/#s=/);
    await expect(page.locator(".cell")).toHaveCount(169);
  });
});

test.describe("postflop practice", () => {
  test("spot drill: pick a postflop spot, answer and see the EV loss", async ({ page }) => {
    await page.goto("/practice/");
    await page.getByTestId("mode-postSpot").click();
    await page.getByTestId("start-practice").click();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("post-table")).toBeVisible();
    await page.locator('[data-testid^="action-"]').first().click();
    await expect(page.getByTestId("result")).toBeVisible();
    await expect(page.getByTestId("ev-loss")).toHaveText(/^(0\.00|−\d+\.\d\d)$/);
    await page.getByTestId("next-hand").click();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 25_000 });
    // the postflop attempts show up in the stats heat-map column
    await page.goto("/stats/");
    await expect(page.getByTestId("today-count")).toHaveText("1");
  });

  test("play-through: the opponent acts and the hero decides street by street", async ({ page }) => {
    await page.goto("/practice/");
    await page.getByTestId("mode-post").click();
    await page.getByTestId("hero-oop").click();
    await page.getByTestId("start-practice").click();
    for (let i = 0; i < 4; i++) {
      await expect(page.locator('[data-testid^="action-"], [data-testid="hand-end"]').first()).toBeVisible({ timeout: 25_000 });
      if (await page.getByTestId("hand-end").isVisible()) {
        await page.getByTestId("hand-end").getByRole("button").click();
        continue;
      }
      // check/call (keeps the hand going)
      const call = page.getByTestId("action-1");
      await ((await call.count()) ? call.first() : page.locator('[data-testid^="action-"]').first()).click();
      await expect(page.getByTestId("result")).toBeVisible();
      await page.getByTestId("next-hand").click();
    }
    await expect(page.getByTestId("hands-count")).toContainText(/[1-9]/);
  });

  test("a preflop play-through that reaches a BTN-vs-BB flop continues with the same hand on the flop", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/practice/");
    await page.getByTestId("mode-hand").click();
    await page.getByTestId("seat-BB").click();
    await page.getByTestId("start-practice").click();
    let linked = false;
    for (let i = 0; i < 30 && !linked; i++) {
      await expect(page.locator('[data-testid^="action-"], [data-testid="hand-end"]').first()).toBeVisible({ timeout: 25_000 });
      if (await page.getByTestId("hand-end").isVisible()) {
        await page.getByTestId("hand-end-next").click();
        continue;
      }
      // call whenever there is something to call, otherwise check (this closes the action heads-up)
      const call = page.getByTestId("action-1");
      await ((await call.count()) ? call.first() : page.locator('[data-testid^="action-"]').first()).click();
      await expect(page.getByTestId("result")).toBeVisible();
      linked = (await page.getByTestId("next-hand").innerText()).includes("フロップへ");
      if (!linked) await page.getByTestId("next-hand").click();
    }
    expect(linked, "no BTN-vs-BB single raised pot within 30 hands").toBe(true);
    await page.getByTestId("next-hand").click();
    // now on the flop: a board of three cards and the hero's own seat is the big blind (out of position)
    await expect(page.getByTestId("post-table")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("post-table").getByText("BB", { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 25_000 });
  });

  test("the RNG mode works for postflop spots", async ({ page }) => {
    await page.goto("/practice/");
    await page.getByTestId("mode-postSpot").click();
    await page.getByTestId("toggle-rng").click();
    await page.getByTestId("start-practice").click();
    await expect(page.getByTestId("rng-panel")).toBeVisible({ timeout: 25_000 });
  });
});
