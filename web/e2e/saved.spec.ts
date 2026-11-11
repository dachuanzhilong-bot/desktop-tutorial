import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const key = "tessera.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, onboarded: true }));
  });
});

test.describe("saved positions", () => {
  test("search controls have English accessible names", async ({ page }) => {
    await page.goto("/study/");
    await expect(page.locator(".cell")).toHaveCount(169);
    await page.getByTestId("save-position").click();
    await expect(page.getByTestId("save-position")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/study/saved/");
    await expect(page.getByTestId("saved-item")).toBeVisible();
    await page.evaluate(() => {
      const key = "tessera.settings.v1";
      const current = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...current, lang: "en" }));
    });
    await page.reload();

    await expect(page.getByRole("searchbox", { name: "Search titles and notes" })).toBeVisible();
    const sort = page.getByRole("combobox", { name: "Sort by saved date" });
    await expect(sort).toHaveValue("newest");
    await expect(sort.locator("option")).toHaveText(["Newest first", "Oldest first"]);
  });

  test("searches titles and notes, then sorts by the original saved date", async ({ page }) => {
    await page.goto("/study/saved/");
    await expect(page.getByTestId("saved-empty")).toBeVisible();
    await page.evaluate(
      (bookmarks) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("tessera");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("meta", "readwrite");
            tx.objectStore("meta").put(bookmarks, "study.bookmarks");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      [
        { id: "old", created: 100, ts: 100, title: "BTN 100bb", note: "Remember the turn bluff catch", href: "/study/#d=100&n=1" },
        { id: "middle", created: 200, ts: 200, title: "CO 60bb", note: "Open tighter", href: "/study/#d=60&n=2" },
        { id: "new", created: 300, ts: 300, title: "HJ open", note: "100bb review", href: "/study/#d=100&n=3" },
      ],
    );
    await page.reload();

    const items = page.getByTestId("saved-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).getByTestId("saved-title")).toHaveText("HJ open");
    const search = page.getByTestId("saved-search");
    await search.fill("btn");
    await expect(items).toHaveCount(1);
    await expect(items.first().getByTestId("saved-title")).toHaveText("BTN 100bb");
    await search.fill("turn bluff");
    await expect(items).toHaveCount(1);
    await expect(items.first().getByTestId("saved-title")).toHaveText("BTN 100bb");
    await search.fill("１００ｂｂ");
    await expect(items).toHaveCount(2);

    await page.getByTestId("saved-sort").selectOption("oldest");
    await expect(items.nth(0).getByTestId("saved-title")).toHaveText("BTN 100bb");
    await expect(items.nth(1).getByTestId("saved-title")).toHaveText("HJ open");
    await expect(page.getByTestId("saved-count")).toContainText("2件");

    await search.fill("nothing matches");
    await expect(items).toHaveCount(0);
    await expect(page.getByTestId("saved-no-results")).toBeVisible();
  });

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
