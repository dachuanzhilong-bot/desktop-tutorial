import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

const text = async (page: import("@playwright/test").Page, id: string) => ((await page.getByTestId(id).textContent()) ?? "").trim();

test.describe("poker math", () => {
  test("opens with a worked example and follows what is typed", async ({ page }) => {
    await page.goto("/odds/");
    // pot 100, bet 50, equity 30%
    expect(await text(page, "odds-size")).toBe("ポットの50%");
    expect(await text(page, "odds-call")).toBe("50");
    expect(await text(page, "odds-win")).toBe("150");
    expect(await text(page, "odds-need")).toBe("25.0%");
    expect(await text(page, "odds-ratio")).toBe("3.00 : 1");
    expect(await text(page, "odds-mdf")).toBe("66.7%");
    expect(await text(page, "odds-bluff")).toBe("25.0%");
    expect(await text(page, "odds-alpha")).toBe("33.3%");
    expect(await text(page, "odds-ev")).toContain("+10");
    expect(await text(page, "odds-implied")).toContain("不要");

    await page.getByTestId("odds-eq").fill("20");
    expect(await text(page, "odds-ev")).toContain("降りたほうが得");
    expect(await text(page, "odds-implied")).toBe("50");

    // a comma for the decimal point is fine, nonsense gives a dash
    await page.getByTestId("odds-pot").fill("37,5");
    await page.getByTestId("odds-bet").fill("25");
    expect(await text(page, "odds-size")).toBe("ポットの67%");
    await page.getByTestId("odds-bet").fill("abc");
    expect(await text(page, "odds-need")).toBe("–");
    await page.getByTestId("odds-bet").fill("0");
    expect(await text(page, "odds-mdf")).toBe("–");
  });

  test("outs: a preset, the street, and a number typed by hand", async ({ page }) => {
    await page.goto("/odds/");
    await page.getByTestId("draw-flush").click(); // 9 outs
    expect(await text(page, "odds-next")).toBe("19.1%"); // 9 / 47
    expect(await text(page, "odds-river")).toBe("35.0%");
    expect(await text(page, "odds-rule")).toBe("36.0%");
    await page.getByTestId("street-turn").click();
    expect(await text(page, "odds-next")).toBe("19.6%"); // 9 / 46
    expect(await text(page, "odds-river")).toBe("19.6%");
    await page.getByTestId("odds-outs").fill("48");
    expect(await text(page, "odds-next")).toBe("–");
  });

  test("SPR with its reading", async ({ page }) => {
    await page.goto("/odds/");
    expect(await text(page, "odds-spr")).toBe("5.0");
    await expect(page.getByTestId("odds-spr-card")).toContainText("中くらい");
    await page.getByTestId("odds-stack").fill("120");
    await page.getByTestId("odds-pot2").fill("60");
    await expect(page.getByTestId("odds-spr-card")).toContainText("低い");
    await page.getByTestId("odds-stack").fill("900");
    await expect(page.getByTestId("odds-spr-card")).toContainText("高い");
  });

  test("the tab bar reaches every tool, also on a phone", async ({ page }) => {
    await page.goto("/odds/");
    const tabs = page.getByRole("navigation", { name: "Solve" });
    for (const [name, url] of [["勝率", /\/equity\//], ["Solve", /\/solve\//], ["計算機", /\/odds\//]] as const) {
      await tabs.getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
    }
    const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(w).toBeLessThanOrEqual(0);
  });
});
