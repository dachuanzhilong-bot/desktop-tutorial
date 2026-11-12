import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

test.describe("learning path", () => {
  test("the home screen offers the next lesson; reading and marking moves the path on", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("next-lesson");
    await expect(card).toContainText("0 / 9 完了");
    await expect(card).toContainText("ポジションを知る");
    await card.click();
    await expect(page).toHaveURL(/\/learn\/#positions/);
    const lesson = page.getByTestId("lesson");
    await expect(lesson).toContainText("UTG → HJ → CO → BTN → SB → BB");
    await expect(lesson).toContainText("数字は目安");

    // mark as done: the list shows it, the progress counts it, and the home card moves to the next lesson
    await page.getByTestId("lesson-done").click();
    await expect(page.getByTestId("lesson-done")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("lesson-back").click();
    await expect(page.getByTestId("learn-progress")).toHaveText("1 / 9 完了");
    await expect(page.getByTestId("lesson-positions")).toContainText("完了");
    await page.reload();
    await expect(page.getByTestId("learn-progress")).toHaveText("1 / 9 完了");
    await page.goto("/");
    await expect(page.getByTestId("next-lesson")).toContainText("最初にレイズする");
  });

  test("a lesson sends you to the screen where it can be tried, and the next lesson follows", async ({ page }) => {
    await page.goto("/learn/#potodds");
    await expect(page.getByTestId("lesson")).toContainText("25%");
    await expect(page.getByTestId("lesson-next")).toContainText("オープンへの対応");
    await page.getByTestId("lesson-next").click();
    await expect(page.getByTestId("lesson")).toContainText("3つ");
    await page.getByTestId("lesson-try").first().click();
    await expect(page).toHaveURL(/\/practice\/#seat=5&spot=vsOpen/);
    // the preset reaches the Practice screen: the BB seat is chosen
    await expect(page.getByRole("button", { name: "BB", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("in English, and an unknown address shows the list", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true, lang: "en" })));
    await page.goto("/learn/#potodds");
    await expect(page.getByTestId("lesson")).toContainText("Pot odds and the equity you need");
    await expect(page.getByTestId("lesson")).toContainText("bet / (pot + 2 x bet)");
    await page.goto("/learn/#nothing");
    await expect(page.getByTestId("lesson-list")).toBeVisible();
  });

  test("all the lessons are listed, in order, and the page fits the phone", async ({ page }) => {
    await page.goto("/learn/");
    await expect(page.getByTestId("lesson-list").getByRole("listitem")).toHaveCount(9);
    const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(w).toBeLessThanOrEqual(0);
    await page.getByTestId("lesson-icm").click();
    const w2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(w2).toBeLessThanOrEqual(0);
  });

  test("the progress is in the backup file", async ({ page }) => {
    await page.goto("/learn/#mixed");
    await page.getByTestId("lesson-done").click();
    await expect(page.getByTestId("lesson-done")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/stats/");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /書き出し/ }).click()]);
    const blob = JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8"));
    expect(blob.meta["learn.done"].map((x: { id: string }) => x.id)).toEqual(["mixed"]);
  });
});
