import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

const num = (s: string | null) => Number((s ?? "").replace("%", ""));

test.describe("equity calculator", () => {
  test("opens with a worked example, then counts every runout for two hands", async ({ page }) => {
    await page.goto("/equity/");
    // A♥K♥ against a range: an estimate, with its error
    await expect(page.getByTestId("equity-basis")).toContainText("ランダムな配牌", { timeout: 20_000 });
    const hero = num(await page.getByTestId("equity-0").textContent());
    const opp = num(await page.getByTestId("equity-1").textContent());
    expect(hero).toBeGreaterThan(30);
    expect(hero).toBeLessThan(50);
    expect(hero + opp).toBeGreaterThan(99.8);
    expect(hero + opp).toBeLessThan(100.2);

    // the opponent holds one hand: every board is counted
    await page.getByTestId("seat-1-hand").click();
    await expect(page.getByTestId("equity-need")).toContainText("2枚");
    await page.getByTestId("pick-Qs").click();
    await page.getByTestId("pick-Qd").click();
    await expect(page.getByTestId("equity-basis")).toContainText("1,712,304", { timeout: 30_000 });
    const exact = num(await page.getByTestId("equity-0").textContent());
    expect(exact).toBeGreaterThan(44);
    expect(exact).toBeLessThan(48); // A♥K♥ against Q♠Q♦: a little under 46%

    // a flop: C(45,2) = 990 runouts
    for (const c of ["Kd", "7c", "2s"]) await page.getByTestId(`pick-${c}`).click();
    await expect(page.getByTestId("equity-basis")).toContainText("990通り", { timeout: 20_000 });
    expect(num(await page.getByTestId("equity-0").textContent())).toBeGreaterThan(70); // a pair of kings and an ace kicker against queens

    // a card taken out leaves a board of two: nothing to calculate
    await page.getByRole("button", { name: /ボード 3枚目/ }).click();
    await page.getByRole("button", { name: /ボード 2枚目/ }).click();
    await expect(page.getByTestId("equity-need")).toContainText("3〜5枚");
  });

  test("a third player, and a range that the board has used up", async ({ page }) => {
    await page.goto("/equity/");
    await page.getByTestId("equity-add").click();
    await expect(page.getByTestId("equity-2")).toBeVisible({ timeout: 20_000 });
    const sum = [0, 1, 2].map(async (i) => num(await page.getByTestId(`equity-${i}`).textContent()));
    const total = (await Promise.all(sum)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(99.7);
    expect(total).toBeLessThan(100.3);
    await page.getByRole("button", { name: "相手 2を外す" }).click();
    await expect(page.getByTestId("equity-2")).toHaveCount(0);

    // more precise: the error shrinks
    const text = async () => (await page.getByTestId("equity-basis").textContent()) ?? "";
    await expect(page.getByTestId("equity-basis")).toContainText("200,000回", { timeout: 20_000 });
    await page.getByTestId("equity-more").click();
    await expect(page.getByTestId("equity-basis")).toContainText("1,000,000回", { timeout: 60_000 });
    expect(await text()).toContain("標準誤差");

    // the opponent's range is AA and the board holds three aces: no combination is left
    await page.getByTestId("seat-1-range-preset").selectOption("");
    await page.getByTestId("seat-1-range").getByRole("textbox").fill("AA");
    for (const c of ["Ac", "Ad", "As"]) await page.getByTestId(`pick-${c}`).click();
    await expect(page.getByTestId("equity-result").getByRole("alert")).toContainText("重なって", { timeout: 20_000 });
  });

  test("works on a phone: nothing wider than the screen, cards 44px to take out", async ({ page }) => {
    await page.goto("/equity/");
    await expect(page.getByTestId("equity-0")).toBeVisible({ timeout: 20_000 });
    const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(w).toBeLessThanOrEqual(0);
    const slot = page.getByRole("button", { name: /あなた 1枚目/ });
    const box = await slot.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
