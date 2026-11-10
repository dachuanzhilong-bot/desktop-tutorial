import { expect, test, Page } from "@playwright/test";

/** a tiny fake Supabase (GoTrue + PostgREST) behind page.route: the build is configured with https://e2e.supabase.test */
const HOST = "https://e2e.supabase.test";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-expose-headers": "*" };

function fakeSupabase(page: Page) {
  const tables: Record<string, Record<string, unknown>[]> = { attempts: [], srs_items: [], range_presets: [], icm_drill_log: [], study_bookmarks: [], user_settings: [] };
  const unique: Record<string, string[]> = {
    attempts: ["user_id", "client_id", "ts", "node_id", "hand"],
    srs_items: ["user_id", "key"],
    range_presets: ["user_id", "id"],
    icm_drill_log: ["user_id", "ts", "hand", "chosen"],
    study_bookmarks: ["user_id", "id"],
    user_settings: ["user_id"],
  };
  const log: string[] = [];
  return page.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: body === null ? "" : JSON.stringify(body) });
    log.push(`${req.method()} ${url.pathname}`);
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    if (url.pathname === "/auth/v1/otp") return json(200, {});
    if (url.pathname === "/auth/v1/verify")
      return body.token === "123456" ? json(200, { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u-1", email: body.email } }) : json(403, { msg: "Token has expired or is invalid" });
    if (url.pathname === "/auth/v1/logout") return json(204, null);
    const table = url.pathname.replace("/rest/v1/", "");
    if (!tables[table]) return json(404, {});
    if (req.method() === "POST") {
      const conflict = unique[table];
      const merge = req.headers()["prefer"]?.includes("merge-duplicates");
      for (const row of body as Record<string, unknown>[]) {
        const index = tables[table].findIndex((have) => conflict.every((key) => have[key] === row[key]));
        if (index < 0) tables[table].push(row);
        else if (merge) tables[table][index] = { ...tables[table][index], ...row };
      }
      return json(201, null);
    }
    return json(200, tables[table]);
  }).then(() => ({ tables, log }));
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

test.describe("login and cloud sync", () => {
  test("e-mail code login, then the practice records are uploaded; a wrong code is rejected", async ({ page }) => {
    const srv = await fakeSupabase(page);
    // one practice answer first, so there is something to upload
    await page.goto("/practice/");
    await page.getByTestId("start-practice").click();
    await page.locator('[data-testid^="action-"]').first().click();
    await expect(page.getByTestId("result")).toBeVisible();

    // saved positions and ICM answers are local until the user signs in
    await page.goto("/study/");
    await page.getByTestId("save-position").click();
    await expect(page.getByTestId("save-position")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/icm/");
    await page.getByTestId("icm-quick-hu").click();
    await page.getByTestId("icm-run").click();
    await expect(page.getByTestId("icm-result")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("icm-drill-start").click();
    await page.getByTestId("icm-drill-act").click();
    await expect(page.getByTestId("icm-drill-result")).toBeVisible();
    const savedIcmAnswers = () => page.evaluate(() => new Promise<number>((resolve) => {
      const request = indexedDB.open("tessera");
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("meta").objectStore("meta").get("icm.log");
        read.onsuccess = () => {
          resolve(Array.isArray(read.result) ? read.result.length : 0);
          db.close();
        };
        read.onerror = () => { db.close(); resolve(0); };
      };
      request.onerror = () => resolve(0);
    }));
    await expect.poll(savedIcmAnswers).toBe(1);

    await page.goto("/settings/");
    const panel = page.getByTestId("sync-panel");
    await expect(panel).toBeVisible();
    await page.getByTestId("sync-email").fill("me@example.com");
    await page.getByTestId("sync-send").click();
    await expect(page.getByTestId("sync-code")).toBeVisible();
    await page.getByTestId("sync-code").fill("000000");
    await page.getByTestId("sync-verify").click();
    await expect(panel.getByRole("alert")).toContainText(/invalid/i);

    await page.getByTestId("sync-code").fill("123456");
    await page.getByTestId("sync-verify").click();
    await expect(page.getByTestId("sync-user")).toContainText("me@example.com");
    await expect(panel).toContainText("送信 ", { timeout: 15_000 });
    expect(srv.tables.attempts.length).toBeGreaterThanOrEqual(1);
    expect(srv.tables.attempts[0]).toMatchObject({ user_id: "u-1", mode: "spot" });
    expect(srv.tables.icm_drill_log).toHaveLength(1);
    expect(srv.tables.icm_drill_log[0]).toMatchObject({ user_id: "u-1", hand: expect.any(Number) });
    expect(srv.tables.study_bookmarks).toHaveLength(1);
    expect(srv.tables.study_bookmarks[0]).toMatchObject({ user_id: "u-1", deleted: false, title: expect.any(String) });
    expect(srv.tables.user_settings).toHaveLength(0); // nothing was changed on this device, so nothing is overwritten

    // a settings change is uploaded by the next sync
    await page.getByRole("radio", { name: "English" }).click();
    await page.getByRole("button", { name: /Sync now|今すぐ同期/ }).click();
    await expect.poll(() => srv.tables.user_settings.length, { timeout: 15_000 }).toBe(1);
    expect(srv.tables.user_settings[0].data.lang).toBe("en");

    // the session survives a reload and can be ended
    await page.reload();
    await expect(page.getByTestId("sync-user")).toContainText("me@example.com");
    await page.getByRole("button", { name: /Sign out|ログアウト/ }).click();
    await expect(page.getByTestId("sync-email")).toBeVisible();
  });
});
