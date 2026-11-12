import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

/** writes finished attempts into the app's own database (the screen has to have opened it once) */
async function seed(page: Page, rows: object[]) {
  await page.goto("/stats/");
  await expect(page.getByRole("heading", { name: "成績" })).toBeVisible();
  await page.evaluate(
    (list) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tessera");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("attempts", "readwrite");
          for (const r of list) tx.objectStore("attempts").add(r);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    rows,
  );
  await page.reload();
}

const base = { sessionId: "t", mode: "spot", chosen: 1, best: 0, score: 10, ms: 900, rng: false, timeout: false, hint: false };

test.describe("mistake notebook", () => {
  test("lists the latest big mistakes and opens the position in Study with the hand picked", async ({ page }) => {
    const now = Date.now();
    await seed(page, [
      { ...base, ts: now - 3000, solution: "cash6max-60bb", nodeId: 0, pos: "root", hand: 0, seat: 0, spot: "rfi", grade: "mistake", evLoss: 0.4 },
      { ...base, ts: now - 2000, solution: "cash6max-100bb", nodeId: 0, pos: "root", hand: 14, seat: 0, spot: "rfi", grade: "blunder", evLoss: 1.25 },
      { ...base, ts: now - 1000, solution: "cash6max-100bb", nodeId: 0, pos: "root", hand: 1, seat: 0, spot: "rfi", grade: "inaccurate", evLoss: 0.1 }, // not a big one
      { ...base, ts: now, mode: "postSpot", solution: "post:srp-btn-bb", nodeId: 0, pos: "QsJd6s@root", hand: 0, seat: 5, spot: "postFlop", grade: "mistake", evLoss: 0.7 }, // flop 2 = "Qs Jd 6s"
    ]);
    const nb = page.getByTestId("notebook");
    await expect(nb).toBeVisible();
    const rows = nb.getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("2c2d"); // the newest first: the post-flop combo (the first of the 1,326)
    await expect(rows.nth(1)).toContainText("大ミス");
    await expect(rows.nth(1)).toContainText("1.25bb");
    await expect(rows.nth(2)).toContainText("AA");
    await expect(nb).not.toContainText("不正確");

    // the oldest one: UTG with AA at 60bb
    await rows.nth(2).getByRole("link").click();
    await expect(page).toHaveURL(/\/study\/#d=60&p=root&h=0/);
    await expect(page.locator(".cell")).toHaveCount(169);
    await expect(page.getByTestId("hand-panel")).toContainText("AA");
    await expect(page.getByTestId("hand-panel")).toBeVisible();

    // and the post-flop one opens that flop
    await page.goBack();
    await page.getByTestId("notebook").getByRole("listitem").nth(0).getByRole("link").click();
    await expect(page).toHaveURL(/\/study\/postflop\/#s=srp-btn-bb&p=QsJd6s@root/);
    await expect(page.getByTestId("flop-2")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pf-actor")).toContainText("BB", { timeout: 20_000 });
  });

  test("a deep link with a hand opens the chart on that hand, at the same depth too", async ({ page }) => {
    await page.goto("/study/#d=100&p=root&h=0");
    await expect(page.getByTestId("hand-panel")).toContainText("AA");
    await page.goto("/study/#d=100&p=root&h=168");
    await page.reload();
    await expect(page.getByTestId("hand-panel")).toContainText("22");
  });

  test("says so when there is nothing to note", async ({ page }) => {
    const now = Date.now();
    await seed(page, [{ ...base, ts: now, solution: "cash6max-100bb", nodeId: 0, pos: "root", hand: 0, seat: 0, spot: "rfi", grade: "best", evLoss: 0 }]);
    await expect(page.getByTestId("notebook")).toContainText("大きなミスはまだありません");
  });
});
