import { expect, test, Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true }));
  });
});

/** the first visit fills both ranges from the preflop solution; wait for that before typing over them */
async function presetsLoaded(page: Page) {
  await expect(page.getByTestId("range-oop-size")).not.toContainText("0コンボ", { timeout: 15_000 });
  await expect(page.getByTestId("range-ip-size")).not.toContainText("0コンボ");
}

async function centre(page: Page, cls: number) {
  const box = await page.locator(`[data-cls="${cls}"]`).first().boundingBox();
  if (!box) throw new Error("cell not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("range builder", () => {
  test("drag-paints cells, edits the text, compares with GTO and saves", async ({ page }) => {
    await page.goto("/builder/");
    await expect(page.locator(".cell")).toHaveCount(169);
    await expect(page.getByTestId("builder-stats")).toContainText("0コンボ");

    // drag over AA ... ATs
    await page.locator('[data-cls="0"]').scrollIntoViewIfNeeded();
    const a = await centre(page, 0);
    const b = await centre(page, 4);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("builder-stats")).toContainText("22コンボ");
    await expect(page.getByTestId("range-text")).toHaveValue("AA,ATs+");

    // the 50% brush paints a mixed cell
    await page.getByTestId("brush-50").click();
    const k = await centre(page, 14); // KK
    await page.mouse.click(k.x, k.y);
    await expect(page.getByTestId("range-text")).toHaveValue("AA,ATs+,KK:0.5");
    await expect(page.getByTestId("builder-stats")).toContainText("25コンボ");

    // tapping a painted cell with the same brush erases it again
    await page.mouse.click(k.x, k.y);
    await expect(page.getByTestId("range-text")).toHaveValue("AA,ATs+");

    // text import
    await page.getByTestId("range-text").fill("KK+,AKs");
    await page.getByTestId("range-import").click();
    await expect(page.getByTestId("builder-stats")).toContainText("16コンボ");
    await page.getByTestId("range-text").fill("QQ+,zzz");
    await page.getByTestId("range-import").click();
    await expect(page.getByRole("alert").filter({ hasText: "zzz" })).toBeVisible();

    // compare with the BTN open range
    await page.getByTestId("builder-clear").click();
    await page.getByTestId("range-text").fill("22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+");
    await page.getByTestId("range-import").click();
    await page.getByTestId("ref-select").selectOption("btn-open");
    await expect(page.getByTestId("compare")).toBeVisible();
    await expect(page.getByTestId("compare")).toContainText("一致度");

    // save and list
    await page.getByLabel("名前").fill("my range");
    await page.getByTestId("range-save").click();
    await expect(page.getByTestId("saved-ranges")).toContainText("my range");
  });

  test("sends the range to the Solve screen", async ({ page }) => {
    await page.goto("/builder/");
    await page.getByTestId("range-text").fill("AA,KK");
    await page.getByTestId("range-import").click();
    await page.getByTestId("use-oop").click();
    await expect(page).toHaveURL(/\/solve\/?$/);
    await expect(page.getByTestId("range-oop-text")).toHaveValue("KK+");
  });
});

test.describe("solve", () => {
  test("solves a river spot in the browser, locks a node, saves and opens it in Study", async ({ page }) => {
    await page.goto("/solve/");
    await expect(page.getByTestId("solve-run")).toBeVisible();
    await presetsLoaded(page);

    // board: K 7 2 9 3 (river)
    await page.getByRole("button", { name: "クリア" }).click();
    for (const c of ["Ks", "7d", "2c", "9h", "3s"]) await page.getByTestId(`pick-${c}`).click();
    await expect(page.getByTestId("board-count")).toContainText("5/5");

    await page.getByTestId("range-oop-text").fill("QQ,JJ,TT,AQs,AJs,KQs,KJs,QJs,JTs");
    await page.getByTestId("range-ip-text").fill("AA,KK,77,22,A5s,A4s,A3s,98s,87s,76s,65s");
    await page.getByTestId("pot-input").fill("10");
    await page.getByTestId("stack-input").fill("30");
    await page.getByTestId("acc-draft").click();

    await page.getByTestId("solve-run").click();
    await expect(page.getByTestId("solve-result")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("solve-exploit")).toContainText("Exploitability");
    await expect(page.getByTestId("solve-result").locator(".cell")).toHaveCount(169);

    // node lock: force the first player to check with the whole range
    await expect(page.getByTestId("lock-panel")).toBeVisible();
    await page.getByTestId("lock-slider-0").focus();
    await page.getByTestId("lock-slider-0").press("End");
    await page.getByTestId("lock-apply").click();
    await expect(page.getByTestId("lock-badge")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("lock-list")).toBeVisible();
    // unlock again
    await page.getByTestId("lock-unlock").click();
    await expect(page.getByTestId("lock-badge")).toHaveCount(0, { timeout: 60_000 });

    // save + open in Study
    await page.getByLabel("名前").fill("river test");
    await page.getByTestId("solve-open-study").click();
    await expect(page).toHaveURL(/study\/postflop\/#solve=/);
    await expect(page.getByTestId("saved-title")).toContainText("river test");
    await expect(page.locator(".cell")).toHaveCount(169);

    // it also shows up in the list on the Solve screen
    await page.goto("/solve/");
    await expect(page.getByTestId("saved-solves")).toContainText("river test");
  });

  test("keeps the inputs when leaving the page and coming back", async ({ page }) => {
    await page.goto("/solve/");
    await presetsLoaded(page);
    await page.getByTestId("pot-input").fill("12");
    await page.getByTestId("range-oop-text").fill("AA");
    await page.goto("/builder/");
    await page.goto("/solve/");
    await expect(page.getByTestId("pot-input")).toHaveValue("12");
    await expect(page.getByTestId("range-oop-text")).toHaveValue("AA");
  });

  test("the quick setup fills ranges from the preflop solution", async ({ page }) => {
    await page.goto("/solve/");
    await page.getByTestId("quick-3bp").click();
    await expect(page.getByTestId("range-oop-size")).not.toContainText("0コンボ", { timeout: 15_000 });
    await expect(page.getByTestId("range-ip-size")).not.toContainText("0コンボ");
    // the pot / stack of the 3-bet pot arrive once the postflop index has loaded
    await expect.poll(async () => Number(await page.getByTestId("pot-input").inputValue())).toBeGreaterThan(10);
  });
});
