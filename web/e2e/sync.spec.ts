import { expect, test, Page } from "@playwright/test";

/** a tiny fake Supabase (GoTrue + PostgREST) behind page.route: the build is configured with https://e2e.supabase.test */
const HOST = "https://e2e.supabase.test";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-expose-headers": "*" };

function fakeSupabase(page: Page) {
  const tables: Record<string, any[]> = { attempts: [], srs_items: [], range_presets: [], user_settings: [] };
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
      tables[table].push(...(body as any[]));
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
