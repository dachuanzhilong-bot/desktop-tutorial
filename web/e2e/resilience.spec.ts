import { expect, test } from "@playwright/test";

// Error boundaries, 404 and the offline notice: the app must never end on a blank screen.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem("tessera.settings.v1")) localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true }));
  });
});

test("an exception inside a screen shows the error view inside the app, and retry recovers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#e2e-crash-page");
  const view = page.getByTestId("route-error");
  await expect(view).toBeVisible();
  await expect(view.getByRole("heading", { name: "問題が起きました" })).toBeVisible();
  // the navigation stays usable
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await view.getByText("エラーの詳細（不具合の報告用）").click();
  await expect(view.getByText(/e2e crash probe \(page\)/)).toBeVisible();
  // remove the trigger, then retry renders the screen again
  await page.evaluate(() => history.replaceState(null, "", "/"));
  await view.getByRole("button", { name: "もう一度表示する" }).click();
  await expect(page.getByTestId("route-error")).toBeHidden();
  await expect(page.getByRole("link", { name: /練習/ }).first()).toBeVisible();
});

test("an exception in the app shell falls back to the global error page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (location.hash = "#e2e-crash-root"));
  await expect(page.getByRole("heading", { name: /問題が起きました/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /もう一度/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /ホーム/ })).toHaveAttribute("href", "/");
});

test("unknown addresses show a localized 404 with the navigation", async ({ page }) => {
  const res = await page.goto("/no-such-page/");
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.getByTestId("not-found").getByRole("link", { name: "練習" }).click();
  await expect(page).toHaveURL(/\/practice\/$/);
});

test("an offline notice appears and disappears with the connection", async ({ page, context }) => {
  await page.goto("/study/");
  await expect(page.locator(".cell")).toHaveCount(169);
  await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toContainText("オフライン");
  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).toHaveCount(0);
});

const ROUTES = ["/", "/practice/", "/study/", "/study/postflop/", "/study/report/", "/analyze/", "/solve/", "/icm/", "/builder/", "/stats/", "/settings/", "/glossary/", "/roadmap/"];

test("every screen renders without console errors (hydration, nesting, runtime)", async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  let at = "";
  page.on("pageerror", (e) => problems.push(`${at} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`${at} console: ${m.text()}`);
  });
  for (const r of ROUTES) {
    at = r;
    await page.goto(r);
    await expect(page.locator("main[data-ready=true]")).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  expect(problems).toEqual([]);
});
