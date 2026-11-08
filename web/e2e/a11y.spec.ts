import AxeBuilder from "@axe-core/playwright";
import { expect, test, Page } from "@playwright/test";

/** Automated WCAG 2.1 A/AA audit (axe-core). Covers colour contrast in both themes and both palettes. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function audit(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.html.slice(0, 120)}`);
  expect(bad, `${label}\n${bad.join("\n")}`).toEqual([]);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

for (const theme of ["dark", "light"] as const) {
  test.describe(`axe ${theme}`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((th) => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true, theme: th })), theme);
    });
    for (const path of ["/", "/study/", "/study/postflop/", "/study/report/", "/practice/", "/stats/", "/settings/", "/glossary/", "/roadmap/"]) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        if (path === "/study/" || path === "/study/postflop/") await page.waitForSelector(".cell");
        if (path === "/study/report/") await page.waitForSelector("[data-testid=rep-bars] li");
        if (path === "/practice/") await page.waitForSelector('[data-testid="start-practice"]');
        await audit(page, `${theme} ${path}`);
      });
    }
    test("study with a selected hand, EV mode", async ({ page }) => {
      await page.goto("/study/");
      await page.waitForSelector(".cell");
      await page.locator('[data-cls="14"]').click();
      await page.getByRole("tab", { name: "EV" }).click();
      await audit(page, `${theme} study EV`);
    });
    test("postflop practice question and result", async ({ page }) => {
      await page.goto("/practice/");
      await page.getByTestId("mode-postSpot").click();
      await page.getByTestId("start-practice").click();
      await page.locator('[data-testid^="action-"]').first().waitFor({ timeout: 30_000 });
      await audit(page, `${theme} postflop question`);
      await page.locator('[data-testid^="action-"]').first().click();
      await page.getByTestId("result").waitFor();
      await page.waitForTimeout(500);
      await audit(page, `${theme} postflop result`);
    });
    test("practice question and result", async ({ page }) => {
      await page.goto("/practice/");
      await page.getByTestId("start-practice").click();
      await page.locator('[data-testid^="action-"]').first().waitFor({ timeout: 20_000 });
      await audit(page, `${theme} practice question`);
      await page.locator('[data-testid^="action-"]').first().click();
      await page.getByTestId("result").waitFor();
      await page.waitForTimeout(500);
      await audit(page, `${theme} practice result`);
    });
  });
}

test("colour-vision palette with patterns", async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true, palette: "cvd", pattern: true })));
  await page.goto("/study/");
  await page.waitForSelector(".cell");
  await audit(page, "cvd study");
});

test("onboarding dialog", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByTestId("onboarding")).toBeVisible();
  await audit(page, "onboarding");
  await ctx.close();
});
