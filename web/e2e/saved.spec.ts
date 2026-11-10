import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

test.describe("saved positions", () => {
  test("save a position with a note, find it again, open it, and remove it", async ({ page }) => {
    await page.goto("/study/saved/");
    await expect(page.getByTestId("saved-empty")).toBeVisible();

    // pre-flop: pick a hand, go one step down the line, and save
    await page.goto("/study/");
    await expect(page.locator(".cell")).toHaveCount(169);
    await page.getByTestId("next-0").click(); // fold: the next seat is up (and no hand is picked any more)
    await page.locator('[data-cls="14"]').click(); // the cell at row 1, column 1 (KK)
    const save = page.getByTestId("save-position");
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await expect(save).toContainText("保存済み");

    // post-flop: the flop being looked at
    await page.goto("/study/postflop/");
    await expect(page.locator(".cell")).toHaveCount(169);
    await page.getByTestId("flop-3").click();
    await page.getByTestId("save-position").click();
    await expect(page.getByTestId("save-position")).toHaveAttribute("aria-pressed", "true");

    // the list, newest first, with a note kept when the field is left
    await page.getByRole("navigation", { name: "Study" }).getByRole("link", { name: "保存" }).click();
    await expect(page.getByTestId("saved-count")).toContainText("2件");
    const items = page.getByTestId("saved-item");
    await expect(items.nth(0).getByTestId("saved-title")).toContainText("BTN open");
    await expect(items.nth(1).getByTestId("saved-title")).toContainText("100bb");
    await items.nth(1).getByTestId("saved-note").fill("UTGのオープンに降りる側を覚える");
    await items.nth(1).getByTestId("saved-note").blur();
    await expect(items.nth(1).getByRole("status")).toContainText("メモを保存しました");
    await page.reload();
    await expect(page.getByTestId("saved-item").nth(1).getByTestId("saved-note")).toHaveValue("UTGのオープンに降りる側を覚える");

    // open the pre-flop one: same depth, node and hand
    await page.getByTestId("saved-item").nth(1).getByTestId("saved-open").click();
    await expect(page).toHaveURL(/\/study\/#d=100&n=\d+&h=14/);
    await expect(page.getByTestId("hand-panel")).toContainText("KK");
    await expect(page.getByTestId("save-position")).toHaveAttribute("aria-pressed", "true");

    // taking it out from the star, and from the list (with a question first)
    await page.getByTestId("save-position").click();
    await expect(page.getByTestId("save-position")).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("navigation", { name: "Study" }).getByRole("link", { name: "保存" }).click();
    await expect(page.getByTestId("saved-count")).toContainText("1件");
    await page.getByTestId("saved-delete").click();
    await expect(page.getByText("削除しますか？")).toBeVisible();
    await page.getByRole("button", { name: "やめる" }).click();
    await expect(page.getByTestId("saved-item")).toHaveCount(1);
    await page.getByTestId("saved-delete").click();
    await page.getByTestId("saved-delete-yes").click();
    await expect(page.getByTestId("saved-empty")).toBeVisible();
  });

  test("the saved positions are in the backup file and come back from it", async ({ page }) => {
    await page.goto("/study/");
    await expect(page.locator(".cell")).toHaveCount(169);
    await page.getByTestId("save-position").click();
    await expect(page.getByTestId("save-position")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/stats/");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /書き出し/ }).click()]);
    const text = await (await import("node:fs/promises")).readFile((await download.path())!, "utf8");
    const blob = JSON.parse(text);
    expect(blob.meta["study.bookmarks"]).toHaveLength(1);
    expect(blob.meta["study.bookmarks"][0].href).toMatch(/^\/study\/#d=100&n=0/);
  });
});
