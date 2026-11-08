import { expect, test } from "@playwright/test";
import { H_40BB } from "../src/lib/__tests__/fixtures/hands";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

test.describe("stack depths", () => {
  test("Study switches between the 20 / 40 / 60 / 100 / 200bb solutions and links to a depth", async ({ page }) => {
    await page.goto("/study/");
    await page.waitForSelector(".cell");
    await expect(page.getByTestId("depth-100")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("depth-40").click();
    await expect(page.getByTestId("depth-40")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("header p").first()).toContainText("40bb", { timeout: 15_000 });
    await expect(page).toHaveURL(/#d=40&n=0/);
    await expect(page.locator(".cell")).toHaveCount(169);

    // a deep link to another depth and node, then back to 100bb
    await page.goto("/study/#d=20&n=0");
    await expect(page.locator("header p").first()).toContainText("20bb", { timeout: 15_000 });
    await page.getByTestId("depth-200").click();
    await expect(page.locator("header p").first()).toContainText("200bb", { timeout: 15_000 });
    await page.getByTestId("depth-100").click();
    await expect(page.locator("header p").first()).toContainText("100bb", { timeout: 15_000 });
  });

  test("Practice asks questions from the selected depth", async ({ page }) => {
    await page.goto("/practice/");
    await page.getByTestId("depth-20").click();
    await expect(page.getByTestId("depth-20")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("start-practice").click();
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
    // the table shows the stack of this depth
    await expect(page.getByTestId("session")).toContainText("20");
    await page.locator('[data-testid^="action-"]').first().click();
    await expect(page.getByTestId("result")).toBeVisible();
  });

  test("Analyze grades a 40bb hand against the 40bb solution and links to it", async ({ page }) => {
    await page.goto("/analyze/");
    await page.getByTestId("hh-file").setInputFiles({ name: "h.txt", mimeType: "text/plain", buffer: Buffer.from(H_40BB) });
    const hand = page.getByTestId("hh-hand").first();
    await expect(hand).toBeVisible();
    await expect(hand).toContainText("大ミス");
    const href = await hand.getByRole("link", { name: "Studyで見る" }).getAttribute("href");
    expect(href).toMatch(/#d=40&n=\d+/);
    await hand.getByRole("link", { name: "Studyで見る" }).click();
    await expect(page.locator("header p").first()).toContainText("40bb", { timeout: 15_000 });
    // the practice set of this hand uses the 40bb solution too
    await page.goto("/analyze/");
    await page.getByTestId("hh-make-set").click();
    await expect(page).toHaveURL(/practice\/#set=/);
    await expect(page.getByTestId("session-title")).toContainText("40bb", { timeout: 20_000 });
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
  });
});
