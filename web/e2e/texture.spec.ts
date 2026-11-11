import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const key = "tessera.settings.v1";
    const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...settings, onboarded: true }));
  });
});

test.describe("flop-reading drill", () => {
  test("asks about a flop, grades the answer, explains, keeps the score", async ({ page }) => {
    await page.goto("/study/report/");
    const card = page.getByTestId("texture-quiz");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("texture-quiz-score")).toContainText("0/0問");
    await page.getByTestId("texture-quiz-start").click();

    await expect(page.getByTestId("texture-quiz-board").locator("> *")).toHaveCount(3);
    await expect(page.getByTestId("texture-quiz-question")).not.toBeEmpty();
    const choices = page.getByTestId("texture-quiz-choice");
    expect(await choices.count()).toBeGreaterThanOrEqual(2);

    await choices.first().click();
    await expect(page.getByTestId("texture-quiz-result")).toBeVisible();
    await expect(page.getByTestId("texture-quiz-explanation")).not.toBeEmpty();
    // after answering the choices are locked and the score has counted one answer
    await expect(choices.first()).toBeDisabled();
    await expect(page.getByTestId("texture-quiz-score")).toContainText("/1問");
    // the right answer is marked, with a text mark that does not depend on colour
    await expect(card.getByText("✓")).toHaveCount(1);

    await page.getByTestId("texture-quiz-next").click();
    await expect(page.getByTestId("texture-quiz-result")).toBeHidden();
    await expect(choices.first()).toBeEnabled();
  });

  test("keeps counting across questions with a consistent score line", async ({ page }) => {
    await page.goto("/study/report/");
    await page.getByTestId("texture-quiz-start").click();
    for (let n = 1; n <= 4; n++) {
      await page.getByTestId("texture-quiz-choice").first().click();
      await expect(page.getByTestId("texture-quiz-score")).toContainText(`/${n}問`);
      await page.getByTestId("texture-quiz-next").click();
    }
    // the score line always agrees with itself: correct <= answered, and a streak never exceeds the correct answers
    const m = /(\d+)\/(\d+)問 · 連続正解 (\d+)回/.exec((await page.getByTestId("texture-quiz-score").textContent()) ?? "");
    expect(m).not.toBeNull();
    const [correct, answered, streak] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect(answered).toBe(4);
    expect(correct).toBeLessThanOrEqual(answered);
    expect(streak).toBeLessThanOrEqual(correct);
  });

  test("works in English", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true, lang: "en" })));
    await page.goto("/study/report/");
    await expect(page.getByTestId("texture-quiz")).toContainText("Flop-reading drill");
    await page.getByTestId("texture-quiz-start").click();
    await page.getByTestId("texture-quiz-choice").first().click();
    await expect(page.getByTestId("texture-quiz-result")).toContainText(/Correct|Not quite/);
  });
});
