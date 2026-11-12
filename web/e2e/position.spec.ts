import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { loadManifest } from "../src/lib/__tests__/helpers";
import { resolvePreflopKey } from "../src/lib/solution/positionKey";

/**
 * Records carry a position key and a build ID (REFACTOR_PLAN step 1-3): what the practice screens write into
 * IndexedDB, and that the readers go by the position, not by the stored node id.
 */

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

type Row = Record<string, unknown>;

/** everything in one store of the app's database */
const readStore = (page: Page, store: string) =>
  page.evaluate(
    (name) =>
      new Promise<Row[]>((resolve, reject) => {
        const open = indexedDB.open("tessera");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as Row[]);
          };
          all.onerror = () => reject(all.error);
        };
      }),
    store,
  );

/** writes rows into the app's own database (the app has to have opened it once) */
async function seed(page: Page, store: "attempts" | "srs", rows: object[]) {
  await page.goto("/stats/");
  await expect(page.getByRole("heading", { name: "成績" })).toBeVisible();
  await page.evaluate(
    ({ name, list }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tessera");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(name, "readwrite");
          for (const r of list) tx.objectStore(name).put(r);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { name: store, list: rows },
  );
}

const getJson = (page: Page, url: string) => page.evaluate(async (u) => (await fetch(u)).json(), url);

test.describe("position keys in the records", () => {
  test("a pre-flop answer is saved with its position key and the build ID of the solution", async ({ page }) => {
    await page.goto("/practice/");
    await page.getByTestId("start-practice").click();
    await page.locator('[data-testid^="action-"]').first().click();
    await expect(page.getByTestId("result")).toBeVisible();

    await expect.poll(async () => (await readStore(page, "attempts")).length).toBe(1);
    const [a] = await readStore(page, "attempts");
    const index = (await getJson(page, "/solutions/index.json")) as { solutions: { id: string; build: string }[] };
    expect(a.solution).toBe("cash6max-100bb");
    expect(a.build).toBe(index.solutions.find((s) => s.id === "cash6max-100bb")!.build);
    expect(a.build).toMatch(/^[0-9a-f]{12}$/);
    // the key is the line of actions that leads to the decision that was asked
    expect(a.pos).toMatch(/^(root|[FCXRA][\d.]*(-[FCXRA][\d.]*)*)$/);
    expect(resolvePreflopKey(loadManifest(), a.pos as string)).toBe(a.nodeId);

    await expect.poll(async () => (await readStore(page, "srs")).length).toBe(1);
    const [s] = await readStore(page, "srs");
    expect(s).toMatchObject({ key: `k:cash6max-100bb:${a.pos}:${a.hand}`, solution: "cash6max-100bb", pos: a.pos, build: a.build, hand: a.hand });
  });

  test("a post-flop answer is saved with the flop's board and line, without the flop's index", async ({ page }) => {
    await page.goto("/practice/#mode=postSpot&scenario=srp-btn-bb&flop=2"); // flop 2 = "Qs Jd 6s"
    await page.getByTestId("start-practice").click();
    await page.locator('[data-testid^="action-"]').first().click({ timeout: 25_000 });
    await expect(page.getByTestId("result")).toBeVisible();

    await expect.poll(async () => (await readStore(page, "attempts")).length).toBe(1);
    const [a] = await readStore(page, "attempts");
    const index = (await getJson(page, "/postflop/index.json")) as { build: Record<string, string> };
    expect(a.mode).toBe("postSpot");
    expect(a.solution).toBe("post:srp-btn-bb");
    expect(a.pos).toMatch(/^QsJd6s@(root|[FXCBRA2-9TJQKcdhs\d.\/-]+)$/);
    expect(a.build).toBe(index.build["srp-btn-bb/2"]);

    await expect.poll(async () => (await readStore(page, "srs")).length).toBe(1);
    const [s] = await readStore(page, "srs");
    expect(s).toMatchObject({ key: `k:post:srp-btn-bb:${a.pos}:${a.hand}`, solution: "post:srp-btn-bb", pos: a.pos, build: a.build });
  });

  test("the mistake notebook links by the position key, not by the stored node id", async ({ page }) => {
    const base = { sessionId: "t", mode: "spot", chosen: 1, best: 0, score: 10, ms: 900, rng: false, timeout: false, hint: false, seat: 0, spot: "rfi", grade: "mistake", evLoss: 0.4 };
    const now = Date.now();
    const node = resolvePreflopKey(loadManifest(), "F-F-R2.5")!;
    expect(node).toBeGreaterThan(0);
    await seed(page, "attempts", [
      // the node ids are out of date (as after the data was generated again): only `pos` says where the records belong
      { ...base, ts: now - 1000, solution: "cash6max-100bb", nodeId: 99_999, hand: 0, pos: "F-F-R2.5", build: "000000000000" },
      // a flop that used to have another index, and a line with another node id
      { ...base, ts: now - 2000, mode: "postSpot", solution: "post:srp-btn-bb", nodeId: 99_999, hand: 0, seat: 5, spot: "postFlop", pos: "QsJd6s@root", build: "000000000000" },
      // a position today's data does not have: listed, without a link
      { ...base, ts: now - 3000, solution: "cash6max-100bb", nodeId: 3, hand: 14, pos: "F-F-R999", build: "000000000000" },
    ]);
    await page.reload();
    const rows = page.getByTestId("notebook").getByRole("listitem");
    await expect(rows).toHaveCount(3);
    // the links hold the position keys: no node number, no flop index
    await expect(rows.nth(0).getByRole("link")).toHaveAttribute("href", /\/study\/#d=100&p=F-F-R2\.5&h=0$/);
    await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", /\/study\/postflop\/#s=srp-btn-bb&p=QsJd6s@root$/);
    await expect(rows.nth(2)).toContainText("KK");
    await expect(rows.nth(2).getByRole("link")).toHaveCount(0);
    // all three count in the totals
    await expect(page.getByTestId("notebook")).toBeVisible();

    // Study looks the key up in the solution it loads: the seat that acts after UTG and HJ fold and CO opens to 2.5bb
    await rows.nth(0).getByRole("link").click();
    await expect(page).toHaveURL(/\/study\/#d=100&p=F-F-R2\.5&h=0/);
    await expect(page.getByTestId("hand-panel")).toContainText("AA");
    await expect(page.getByTestId("study-pot")).toContainText(loadManifest().players[loadManifest().nodes[node].actor]);
    await expect(page.getByTestId("study-pot")).not.toContainText("UTG");
  });

  test("a review round asks a new item at the node its position has now, and skips a position that is gone", async ({ page }) => {
    const now = Date.now();
    const item = (pos: string, hand: number, nodeId: number) => ({ key: `k:cash6max-100bb:${pos}:${hand}`, solution: "cash6max-100bb", pos, build: "000000000000", nodeId, hand, box: 0, due: now - 60_000, seen: 2, lapses: 1, lastGrade: "mistake", updated: now - 120_000 });
    await seed(page, "srs", [
      item("root", 0, 99_999), // UTG with AA; the stored node id does not exist
      item("F-F-R999", 14, 3), // not a position of today's data
    ]);
    await page.goto("/");
    await expect(page.getByTestId("review-count")).toContainText("2問");
    await page.getByTestId("review-go-100").click();
    await expect(page.getByTestId("session-title")).toContainText("復習 · 100bb");
    await page.locator('[data-testid^="action-"]').first().click({ timeout: 20_000 });
    await expect(page.getByTestId("result")).toBeVisible();

    // the answer went to the one question that can be asked, and updated its item in place
    await expect.poll(async () => (await readStore(page, "attempts")).length).toBe(1);
    const [a] = await readStore(page, "attempts");
    expect(a).toMatchObject({ solution: "cash6max-100bb", nodeId: 0, hand: 0, pos: "root" });
    await expect.poll(async () => ((await readStore(page, "srs")).find((s) => s.pos === "root") ?? {}).seen).toBe(3);
    const srs = await readStore(page, "srs");
    expect(srs).toHaveLength(2);
    expect(srs.find((s) => s.pos === "root")).toMatchObject({ key: "k:cash6max-100bb:root:0", nodeId: 0 });
  });
});
