import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (location.pathname.endsWith(".svg")) return;
    localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true }));
  });
});

/** a user who installed an earlier version keeps their records when the database schema grows (v1 -> v3) */
test("upgrades an existing v1 database without losing practice records", async ({ page }) => {
  // a same-origin page that does not run the app, so nothing holds the database open
  await page.goto("/icons/icon.svg");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const del = indexedDB.deleteDatabase("tessera");
        del.onsuccess = del.onerror = () => {
          const req = indexedDB.open("tessera", 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            const s = db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
            s.createIndex("ts", "ts");
            db.createObjectStore("srs", { keyPath: "key" });
            db.createObjectStore("meta");
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(["attempts", "srs"], "readwrite");
            tx.objectStore("attempts").add({ ts: 1_700_000_000_000, sessionId: "old", mode: "spot", solution: "cash6max-100bb", nodeId: 3, hand: 5, seat: 3, spot: "rfi", chosen: 1, best: 1, grade: "best", evLoss: 0, score: 100, ms: 800, rng: false, timeout: false, hint: false });
            tx.objectStore("srs").put({ key: "3:5", nodeId: 3, hand: 5, box: 2, due: 0, seen: 3, lapses: 0, lastGrade: "best", updated: 1_700_000_000_000 });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        };
      }),
  );
  // the app opens the database at the current version: the old rows must survive and the new stores must exist
  await page.goto("/analyze/");
  await expect(page.getByTestId("hh-file")).toBeAttached();
  const info = await page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; attempts: number; srs: number }>((resolve, reject) => {
        const req = indexedDB.open("tessera");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["attempts", "srs"]);
          const a = tx.objectStore("attempts").count();
          const s = tx.objectStore("srs").count();
          tx.oncomplete = () => {
            const out = { version: db.version, stores: [...db.objectStoreNames].sort(), attempts: a.result, srs: s.result };
            db.close();
            resolve(out);
          };
        };
      }),
  );
  expect(info.version).toBeGreaterThanOrEqual(3);
  expect(info.stores).toEqual(["attempts", "hands", "meta", "ranges", "solves", "srs"]);
  expect(info.attempts).toBe(1);
  expect(info.srs).toBe(1);
  // and the new stores work: import a hand
  const hand = `PokerStars Hand #1:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/03/02 20:15:01 ET
Table 'A' 6-max Seat #4 is the button
Seat 1: Alice ($100 in chips)
Seat 2: Hero ($100 in chips)
Seat 4: Dan ($100 in chips)
Seat 5: Eve ($100 in chips)
Eve: posts small blind $0.50
Alice: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: raises $1.50 to $2.50
Dan: folds
Eve: folds
Alice: folds
Uncalled bet ($1.50) returned to Hero
Hero collected $2.5 from pot
*** SUMMARY ***`;
  await page.getByTestId("hh-file").setInputFiles({ name: "h.txt", mimeType: "text/plain", buffer: Buffer.from(hand) });
  await expect(page.getByTestId("hh-report")).toContainText("新規 1");
});
