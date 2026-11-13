import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

/** writes spaced-repetition records into the app's own database (the app has to have opened it once) */
async function seedSrs(page: Page, rows: object[]) {
  await page.goto("/stats/");
  await expect(page.getByRole("heading", { name: "成績" })).toBeVisible();
  await page.evaluate(
    (list) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tessera");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("srs", "readwrite");
          for (const r of list) tx.objectStore("srs").put(r);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    rows,
  );
}

const now = Date.now();
/** an item of the root decision (UTG) of a pre-flop solution, or of a post-flop position */
const srs = (solution: string, pos: string, hand: number, due: number) => ({ key: `k:${solution}:${pos}:${hand}`, solution, pos, nodeId: 0, hand, box: 1, due, seen: 2, lapses: 1, lastGrade: "mistake", updated: now - 10_000 });
const S100 = "cash6max-100bb";
const S40 = "cash6max-40bb";

test.describe("review queue", () => {
  test("shows what is due on the home screen and starts the round with one tap", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("review-card")).toHaveCount(0); // nothing due: no card
    await seedSrs(page, [
      srs(S100, "root", 0, now - 60_000), // UTG with AA, 100bb
      srs(S100, "root", 14, now - 30_000), // UTG with KK
      srs(S100, "root", 1, now + 3_600_000), // not due yet
      srs("post:srp-btn-bb", "QsJd6s@root", 100, now - 1000), // post-flop: not part of this review
    ]);
    await page.goto("/");
    await expect(page.getByTestId("review-count")).toContainText("2問");
    await page.getByTestId("review-go-100").click();
    await expect(page).toHaveURL(/\/practice\/#set=review/);
    await expect(page.getByTestId("session-title")).toContainText("復習 · 100bb");
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
  });

  test("a round at another stack depth switches to that depth", async ({ page }) => {
    await seedSrs(page, [srs(S40, "root", 0, now - 1000), srs(S40, "root", 1, now - 2000), srs(S100, "root", 0, now - 3000)]);
    await page.goto("/practice/");
    const card = page.getByTestId("review-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(2); // 40bb (2) first, then 100bb (1)
    await expect(card.getByRole("button").first()).toContainText("40bb");
    await page.getByTestId("review-go-40").click();
    await expect(page.getByTestId("session-title")).toContainText("復習 · 40bb");
    await expect(page.getByTestId("study-sub").or(page.locator('[data-testid^="action-"]').first())).toBeVisible({ timeout: 20_000 });
  });
});
