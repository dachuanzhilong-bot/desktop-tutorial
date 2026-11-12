import AxeBuilder from "@axe-core/playwright";
import { expect, test, Page } from "@playwright/test";
import { H_BAD_3BET, H_CO_OPEN } from "../src/lib/__tests__/fixtures/hands";

/** Automated WCAG 2.1 A/AA audit (axe-core). Covers colour contrast in both themes and both palettes. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function audit(page: Page, label: string) {
  await page.waitForTimeout(350); // colour transitions (theme applied after hydration) must have finished
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
    for (const path of ["/", "/study/", "/study/postflop/", "/study/report/", "/study/saved/", "/learn/", "/practice/", "/solve/", "/builder/", "/icm/", "/equity/", "/odds/", "/analyze/", "/stats/", "/settings/", "/glossary/", "/roadmap/"]) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        if (path === "/study/" || path === "/study/postflop/") await page.waitForSelector(".cell");
        if (path === "/study/report/") await page.waitForSelector("[data-testid=rep-bars] li");
        if (path === "/practice/") await page.waitForSelector('[data-testid="start-practice"]');
        await audit(page, `${theme} ${path}`);
      });
    }
    test("solve result with the node-lock panel", async ({ page }) => {
      await page.goto("/solve/");
      await page.getByRole("button", { name: "クリア" }).click();
      for (const c of ["Ks", "7d", "2c", "9h", "3s"]) await page.getByTestId(`pick-${c}`).click();
      await page.getByTestId("range-oop-text").fill("QQ,JJ,AQs");
      await page.getByTestId("range-ip-text").fill("AA,KK,77,A5s");
      await page.getByTestId("acc-draft").click();
      await page.getByTestId("solve-run").click();
      await page.getByTestId("lock-panel").waitFor({ timeout: 45_000 });
      await audit(page, `${theme} solve result`);
    });
    test("range builder with the GTO comparison overlay", async ({ page }) => {
      await page.goto("/builder/");
      await page.getByTestId("range-text").fill("22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.5");
      await page.getByTestId("range-import").click();
      await page.getByTestId("ref-select").selectOption("btn-open");
      await page.getByTestId("compare").waitFor();
      await audit(page, `${theme} builder compare`);
    });
    test("icm result", async ({ page }) => {
      await page.goto("/icm/");
      await page.getByTestId("icm-quick-bubble").click();
      await page.getByTestId("icm-acc-fast").click();
      await page.getByTestId("icm-run").click();
      await page.getByTestId("icm-result").waitFor({ timeout: 60_000 });
      await page.locator('[data-cls="14"]').click();
      await audit(page, `${theme} icm result`);
      await page.getByTestId("icm-drill-start").click();
      await page.getByTestId("icm-drill-act").click();
      await page.getByTestId("icm-drill-result").waitFor();
      await page.waitForTimeout(600); // the cards flip in
      await audit(page, `${theme} icm drill`);
    });
    test("analyze with imported hands", async ({ page }) => {
      await page.goto("/analyze/");
      await page.getByTestId("hh-file").setInputFiles({ name: "h.txt", mimeType: "text/plain", buffer: Buffer.from([H_CO_OPEN, H_BAD_3BET].join("\n\n")) });
      await page.getByTestId("hh-hand").first().waitFor();
      await audit(page, `${theme} analyze list`);
    });
    test("study with a selected hand, EV mode", async ({ page }) => {
      await page.goto("/study/");
      await page.waitForSelector(".cell");
      await page.locator('[data-cls="14"]').click();
      await page.getByRole("tab", { name: "EV" }).click();
      await audit(page, `${theme} study EV`);
    });
    test("odds quiz question and answer feedback", async ({ page }) => {
      await page.goto("/odds/");
      const quiz = page.getByTestId("odds-quiz");
      await quiz.getByTestId("odds-quiz-start").click();
      await quiz.getByTestId("odds-quiz-question").waitFor();
      await audit(page, `${theme} odds quiz question`);
      await quiz.getByTestId("odds-quiz-choice").first().click();
      await quiz.getByTestId("odds-quiz-result").waitFor();
      await audit(page, `${theme} odds quiz answer`);
    });
    test("flop-reading drill question and answer feedback", async ({ page }) => {
      await page.goto("/study/report/");
      const quiz = page.getByTestId("texture-quiz");
      await quiz.getByTestId("texture-quiz-start").click();
      await quiz.getByTestId("texture-quiz-question").waitFor();
      await audit(page, `${theme} texture drill question`);
      await quiz.getByTestId("texture-quiz-choice").first().click();
      await quiz.getByTestId("texture-quiz-result").waitFor();
      await audit(page, `${theme} texture drill answer`);
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
