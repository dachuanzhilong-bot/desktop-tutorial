import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (location.pathname.endsWith(".svg")) return;
    // (a test that sets its own settings keeps them)
    if (!localStorage.getItem("tessera.settings.v1")) localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true }));
  });
});

type Row = Record<string, unknown>;
interface Seed {
  version: number;
  attempts?: Row[];
  srs?: Row[];
  hands?: Row[];
  ranges?: Row[];
  solves?: Row[];
  meta?: Record<string, unknown>;
}

/**
 * Makes the database an earlier version of the app left behind: the stores that version had, with `seed` in them.
 * Run on a same-origin page that does not start the app, so nothing holds the database open.
 */
const makeOldDatabase = (page: Page, seed: Seed) =>
  page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const del = indexedDB.deleteDatabase("tessera");
        del.onsuccess = del.onerror = () => {
          const req = indexedDB.open("tessera", data.version);
          req.onupgradeneeded = () => {
            const db = req.result;
            const s = db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
            s.createIndex("ts", "ts");
            db.createObjectStore("srs", { keyPath: "key" });
            db.createObjectStore("meta");
            if (data.version >= 2) {
              db.createObjectStore("solves", { keyPath: "id" });
              db.createObjectStore("ranges", { keyPath: "id" });
            }
            if (data.version >= 3) db.createObjectStore("hands", { keyPath: "id" });
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction([...db.objectStoreNames], "readwrite");
            for (const a of data.attempts ?? []) tx.objectStore("attempts").add(a);
            for (const x of data.srs ?? []) tx.objectStore("srs").put(x);
            for (const x of data.hands ?? []) tx.objectStore("hands").put(x);
            for (const x of data.ranges ?? []) tx.objectStore("ranges").put(x);
            for (const x of data.solves ?? []) tx.objectStore("solves").put({ ...x, bytes: new Uint8Array([84, 83, 80, 49]) });
            for (const [k, v] of Object.entries(data.meta ?? {})) tx.objectStore("meta").put(v, k);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        };
      }),
    seed,
  );

interface Dump {
  version: number;
  stores: string[];
  attempts: Row[];
  srs: Row[];
  hands: Row[];
  ranges: Row[];
  solves: Row[];
  meta: Record<string, unknown>;
}

/** everything in the app's database, as it is now (opened without a version: nothing is upgraded by looking) */
const dump = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Dump>((resolve, reject) => {
        const req = indexedDB.open("tessera");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames].sort();
          const tx = db.transaction(names);
          const all = Object.fromEntries(names.map((n) => [n, tx.objectStore(n).getAll()]));
          const metaKeys = tx.objectStore("meta").getAllKeys();
          tx.oncomplete = () => {
            const rows = (n: string) => (all[n]?.result ?? []) as Row[];
            const meta = Object.fromEntries((metaKeys.result as string[]).map((k, i) => [k, all.meta.result[i]]));
            const out = { version: db.version, stores: names, attempts: rows("attempts"), srs: rows("srs"), hands: rows("hands"), ranges: rows("ranges"), solves: rows("solves").map((s) => ({ ...s, bytes: [...(s.bytes as Uint8Array)] })), meta };
            db.close();
            resolve(out);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

// ---- records as the versions before position keys wrote them (no `pos`), and as they are written since step 1-3
const answer = { sessionId: "old", mode: "spot", seat: 3, spot: "rfi", chosen: 1, best: 0, grade: "mistake", evLoss: 0.3, score: 30, ms: 800, rng: false, timeout: false, hint: false };
const OLD_ATTEMPTS = [
  { ...answer, ts: 1_700_000_000_000, solution: "cash6max-100bb", nodeId: 3, hand: 5 },
  { ...answer, ts: 1_700_000_001_000, mode: "postSpot", solution: "post:srp-btn-bb/3", nodeId: 40, hand: 1325, seat: 5, spot: "postFlop" },
];
const NEW_ATTEMPTS = [
  { ...answer, ts: 1_700_000_002_000, sessionId: "new", solution: "cash6max-100bb", nodeId: 99_999, hand: 0, pos: "F-F-R2.5", build: "000000000000" },
  { ...answer, ts: 1_700_000_003_000, sessionId: "new", mode: "postSpot", solution: "post:srp-btn-bb", nodeId: 99_999, hand: 0, seat: 5, spot: "postFlop", pos: "QsJd6s@root", build: "000000000000" },
];
const item = { box: 0, due: 0, seen: 3, lapses: 1, lastGrade: "mistake", updated: 1_700_000_000_000 };
const OLD_SRS = [
  { ...item, key: "3:5", nodeId: 3, hand: 5 },
  { ...item, key: "cash6max-40bb:7:9", nodeId: 7, hand: 9 },
  { ...item, key: "p:srp-btn-bb/3:40:1325", nodeId: 40, hand: 1325 },
];
const NEW_SRS = [
  { ...item, key: "k:cash6max-100bb:root:0", solution: "cash6max-100bb", pos: "root", build: "000000000000", nodeId: 99_999, hand: 0 },
  { ...item, key: "k:post:srp-btn-bb:QsJd6s@root:7", solution: "post:srp-btn-bb", pos: "QsJd6s@root", nodeId: 99_999, hand: 7 },
];
const decision = { nodeId: 3, seat: 2, spot: "rfi", handClass: 5, chosen: 0, chosenKind: 0, stats: [], best: 1, evLoss: 0.2, grade: "mistake", score: 40, sizeNote: null };
const withKey = { ...decision, pos: "F-F-R2.5" };
const stored = (id: string, analysis: Row) => ({ id, site: "x", ts: 1_700_000_000_000, importedAt: 1_700_000_000_500, hand: { id }, analysis: { id, status: "ok", offTree: [], evLoss: 0.2, flopLink: null, ...analysis } });
const OLD_HANDS = [
  stored("h-old", { solution: "cash6max-100bb", decisions: [decision], worst: decision }), // analysed before position keys
  stored("h-older", { decisions: [decision], worst: decision }), // … and before stack depths (no solution id)
  stored("h-mixed", { solution: "cash6max-100bb", decisions: [withKey, decision], worst: withKey }),
];
const NEW_HANDS = [
  stored("h-new", { solution: "cash6max-100bb", build: "000000000000", decisions: [withKey], worst: withKey }),
  stored("h-skipped", { solution: "cash6max-100bb", status: "skipped", reason: "fewer than two players", decisions: [], worst: null, evLoss: 0 }), // points at no position
];
const RANGES = [{ id: "r1", ts: 1_700_000_000_000, name: "BTN open", text: "AA,KK,AKs" }];
const SOLVES = [{ id: "s1", ts: 1_700_000_000_000, title: "As 7d 2c", board: [50, 21, 0], cfg: { pot: 5.5 }, oopName: "BB", ipName: "BTN", oopText: "AA", ipText: "KK", exploit: 0.2, iterations: 300, nodes: 12 }];
const ICM_LOG = [{ ts: 1_700_000_000_000, players: 3, pos: "BTN", stack: 8, facing: null, hand: 10, chosen: 1, grade: "best", evLoss: 0, score: 100 }];
const LESSONS = [{ id: "not-checked-here", ts: 1_700_000_000_000 }];
const KEPT_META = { "icm.log": ICM_LOG, "learn.done": LESSONS, "some.future.key": { v: 1 } };
const DROPPED_META = {
  "study.bookmarks": [{ id: "b1", created: 100, ts: 100, title: "BTN 100bb", note: "keep?", href: "/study/#d=100&n=3" }],
  "study.bookmarkDeletions": [{ id: "b0", ts: 50 }],
  "sync.state.u-1": { clientId: "c-1", pushedAttemptId: 2, pullAttemptTs: 1_700_000_000_000, lastSync: 1_700_000_000_000 },
  "sync.state.u-2": { clientId: "c-2", pushedAttemptId: 0, lastSync: 0 },
  "practiceSet:review": { title: "復習 · 100bb", solution: "cash6max-100bb", items: [{ nodeId: 3, hand: 5 }] },
  "practiceSet:a-1": { title: "Analyze", items: [{ nodeId: 7, hand: 9 }] },
};
const SETTINGS = { onboarded: true, theme: "light", labels: true };

/** the rows of a store without the auto-increment id */
const plain = (rows: Row[]) => rows.map(({ id: _id, ...r }) => r);
const byKey = (rows: Row[], key: string) => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));

/**
 * REFACTOR_PLAN step 1-4: opening a database of version 3 deletes the records made before position keys (they are
 * not converted) and keeps everything else. Before step 1-4 this file checked that such records survive an upgrade;
 * the owner does not need them, and they cannot be read once the solution data is generated again.
 */
test("upgrading a v3 database deletes the records without a position key and keeps ranges, solves, settings and records with one", async ({ page }) => {
  await page.goto("/icons/icon.svg");
  await page.evaluate((s) => localStorage.setItem("tessera.settings.v1", JSON.stringify(s)), SETTINGS);
  await makeOldDatabase(page, {
    version: 3,
    attempts: [OLD_ATTEMPTS[0], NEW_ATTEMPTS[0], OLD_ATTEMPTS[1], NEW_ATTEMPTS[1]],
    srs: [...OLD_SRS, ...NEW_SRS],
    hands: [...OLD_HANDS, ...NEW_HANDS],
    ranges: RANGES,
    solves: SOLVES,
    meta: { ...KEPT_META, ...DROPPED_META },
  });
  const before = await dump(page);
  expect(before.version).toBe(3);
  expect([before.attempts.length, before.srs.length, before.hands.length, Object.keys(before.meta).length]).toEqual([4, 5, 5, 9]);

  // the app opens the database: version 4
  await page.goto("/stats/");
  await expect(page.getByTestId("notebook")).toBeVisible();
  const after = await dump(page);
  expect(after.version).toBe(4);
  expect(after.stores).toEqual(["attempts", "hands", "meta", "ranges", "solves", "srs"]);

  // gone: every practice record, spaced-repetition item and imported hand without a position key …
  // kept: the ones with a position key, exactly as they were (their auto-increment ids too)
  expect(plain(after.attempts)).toEqual(NEW_ATTEMPTS);
  expect(after.attempts.map((a) => a.id)).toEqual([2, 4]);
  expect(byKey(after.srs, "key")).toEqual(byKey(NEW_SRS, "key"));
  expect(byKey(after.hands, "id")).toEqual(byKey(NEW_HANDS, "id"));
  // … and of `meta` the saved positions, their tombstones, the sync states and the prepared question lists. The stats
  // screen then adds its totals (`stats.daily.v1`, REFACTOR_PLAN step 2-7), made from the records that are left.
  const { "stats.daily.v1": totals, ...meta } = after.meta;
  expect(meta).toEqual(KEPT_META);
  expect(totals).toMatchObject({ v: 1, n: 2, lastId: 4 });
  for (const k of Object.keys(DROPPED_META)) expect(k in after.meta).toBe(false);
  // untouched: saved ranges, saved solves (with their data) and the settings
  expect(after.ranges).toEqual(RANGES);
  expect(after.solves).toEqual(SOLVES.map((s) => ({ ...s, bytes: [84, 83, 80, 49] })));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tessera.settings.v1") ?? "null"))).toMatchObject(SETTINGS);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // the screens show what is left: the two mistakes with a position key, linked by that key; no saved position
  const rows = page.getByTestId("notebook").getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", /\/study\/#d=100&p=F-F-R2\.5&h=0$/);
  await page.goto("/study/saved/");
  await expect(page.getByTestId("saved-empty")).toBeVisible();
  await page.goto("/builder/");
  await expect(page.getByTestId("saved-ranges").getByText("BTN open")).toBeVisible();

  // the clean-up belongs to the upgrade: it does not run again on a database that is already at version 4
  await page.goto("/icons/icon.svg");
  await page.evaluate(
    (row) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("tessera");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["attempts", "meta"], "readwrite");
          tx.objectStore("attempts").add(row);
          tx.objectStore("meta").put({ title: "x", solution: "cash6max-100bb", items: [] }, "practiceSet:later");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    OLD_ATTEMPTS[0],
  );
  await page.goto("/stats/");
  await expect(page.getByTestId("notebook")).toBeVisible();
  const again = await dump(page);
  expect(again.version).toBe(4);
  expect(again.attempts).toHaveLength(3);
  expect("practiceSet:later" in again.meta).toBe(true);
});

test("upgrading a v2 database (no hands store yet) deletes its old records and keeps its ranges and solves", async ({ page }) => {
  await page.goto("/icons/icon.svg");
  await makeOldDatabase(page, { version: 2, attempts: OLD_ATTEMPTS, srs: OLD_SRS, ranges: RANGES, solves: SOLVES, meta: { ...KEPT_META, "study.bookmarks": DROPPED_META["study.bookmarks"] } });
  await page.goto("/stats/");
  await expect(page.getByRole("heading", { name: "成績" })).toBeVisible();
  await expect.poll(async () => (await dump(page)).version).toBe(4);
  await expect.poll(async () => "stats.daily.v1" in (await dump(page)).meta).toBe(true);
  const after = await dump(page);
  expect(after.stores).toEqual(["attempts", "hands", "meta", "ranges", "solves", "srs"]);
  expect([after.attempts, after.srs, after.hands]).toEqual([[], [], []]);
  // the stats screen adds its totals (REFACTOR_PLAN step 2-7): of no records
  const { "stats.daily.v1": totals, ...meta } = after.meta;
  expect(meta).toEqual(KEPT_META);
  expect(totals).toMatchObject({ v: 1, n: 0, lastId: 0 });
  expect(after.ranges).toEqual(RANGES);
  expect(after.solves).toHaveLength(1);
});

/** a user who installed the first version: the schema grows (v1 -> v4), the records of that version are deleted, and the app works */
test("upgrades an existing v1 database: its old practice records are deleted, the new stores exist and work", async ({ page }) => {
  // a same-origin page that does not run the app, so nothing holds the database open
  await page.goto("/icons/icon.svg");
  await makeOldDatabase(page, { version: 1, attempts: [OLD_ATTEMPTS[0]], srs: [OLD_SRS[0]] });
  expect((await dump(page)).attempts).toHaveLength(1);
  // the app opens the database at the current version
  await page.goto("/analyze/");
  await expect(page.getByTestId("hh-file")).toBeAttached();
  const info = await dump(page);
  expect(info.version).toBe(4);
  expect(info.stores).toEqual(["attempts", "hands", "meta", "ranges", "solves", "srs"]);
  expect(info.attempts).toEqual([]);
  expect(info.srs).toEqual([]);
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
  // the hand that was just imported is stored in today's format: its decision has a position key
  const hands = (await dump(page)).hands as { analysis: { solution: string; decisions: { pos: string }[] } }[];
  expect(hands).toHaveLength(1);
  expect(hands[0].analysis.solution).toBe("cash6max-100bb");
  expect(hands[0].analysis.decisions.map((d) => d.pos)).toEqual(["F-F"]); // the two empty seats before the hero fold
});
