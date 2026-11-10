import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// "Add to home screen" on the home screen: one tap on Android / Chrome, the share-menu steps on iOS Safari.
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

/** what Chrome does when the app becomes installable */
async function chromeSaysInstallable(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __prompts: number };
    w.__prompts = 0;
    const ev = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(ev, {
      prompt: async () => {
        w.__prompts++;
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(ev);
  });
}

test.describe("install card", () => {
  test("Android / Chrome: one tap opens the install dialog, then the card goes away", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("install-card")).toHaveCount(0);
    await chromeSaysInstallable(page);
    const card = page.getByTestId("install-card");
    await expect(card).toBeVisible();
    const res = await new AxeBuilder({ page }).include("[data-testid=install-card]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(res.violations.map((v) => v.id)).toEqual([]);
    const box = await page.getByTestId("install-go").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("install-go").click();
    expect(await page.evaluate(() => (window as unknown as { __prompts: number }).__prompts)).toBe(1);
    await expect(card).toHaveCount(0);
  });

  test("'later' puts the card away, also after a reload", async ({ page }) => {
    await page.goto("/");
    await chromeSaysInstallable(page);
    await page.getByTestId("install-later").click();
    await expect(page.getByTestId("install-card")).toHaveCount(0);
    await page.reload();
    await chromeSaysInstallable(page);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("install-card")).toHaveCount(0);
  });

  test("iPhone Safari: the share-menu steps, no button that cannot work", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
    const page = await ctx.newPage();
    await page.goto("/");
    const card = page.getByTestId("install-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("共有ボタン");
    await expect(card).toContainText("ホーム画面に追加");
    await expect(page.getByTestId("install-go")).toHaveCount(0);
    await ctx.close();
  });

  test("not on other screens, and not on Android until the browser says the app is installable", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("install-card")).toHaveCount(0);
    await page.goto("/study/");
    await chromeSaysInstallable(page);
    await expect(page.getByTestId("install-card")).toHaveCount(0);
  });
});
