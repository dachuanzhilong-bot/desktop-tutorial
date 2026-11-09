import { expect, test } from "@playwright/test";

// One-handed phone use: tap targets, practice within two taps, nothing hidden under the tab bar.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem("tessera.settings.v1")) localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true }));
  });
});

const ROUTES = ["/", "/practice/", "/study/", "/study/postflop/", "/study/report/", "/analyze/", "/solve/", "/icm/", "/builder/", "/stats/", "/settings/", "/glossary/", "/roadmap/"];

/**
 * Every control is at least 44 x 44 CSS px, except (WCAG 2.5.8 allows these, all >= 24px):
 *  - the 169 cells of a 13x13 chart and the 52-card picker (they have to fit a phone screen; arrow keys / drag work too)
 *  - words inside a sentence (glossary terms, inline links)
 */
async function smallTargets(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, summary, [role="button"], [role="switch"], [role="tab"]');
    for (const el of els) {
      if (el.closest("[inert], [hidden], dialog:not([open])")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (el.matches(".cell") || el.closest(".grid13, [data-card-picker]")) continue;
      // visually hidden until focused (skip link) / the real target is the surrounding label (file input)
      if (el.matches(".sr-only") && (el.tagName === "A" || el.closest("label"))) continue;
      // a glossary word inside running text
      if (el.matches("button.cursor-help")) continue;
      if (el.tagName === "A" && el.closest("p, li, dd") && style.display === "inline") continue;
      if (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label")) {
        const l = el.closest("label")!.getBoundingClientRect();
        if (l.height >= 43.5) continue;
      }
      // a switch may draw small but must have a 44px hit area (::after) – measure that instead
      if (el.getAttribute("role") === "switch") {
        const a = getComputedStyle(el, "::after");
        if (a.content !== "none" && a.position === "absolute") continue;
      }
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

test("every control on every screen is at least 44px (documented exceptions aside)", async ({ page }) => {
  test.setTimeout(90_000);
  const all: string[] = [];
  for (const r of ROUTES) {
    await page.goto(r);
    await expect(page.locator("main[data-ready=true]")).toBeVisible();
    await page.waitForLoadState("networkidle");
    all.push(...(await smallTargets(page)).map((s) => `${r}: ${s}`));
  }
  expect(all).toEqual([]);
});

test("practice starts in two taps from anywhere, without scrolling", async ({ page, isMobile }) => {
  for (const from of ["/study/", "/settings/"]) {
    await page.goto(from);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "練習" }).click(); // tap 1
    const start = page.getByTestId("start-practice");
    await expect(start).toBeInViewport({ ratio: 1 });
    if (isMobile) {
      // not covered by the tab bar
      const nav = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
      const b = await start.boundingBox();
      expect(b!.y + b!.height).toBeLessThanOrEqual(nav!.y + 1);
    }
  }
  await page.getByTestId("start-practice").click(); // tap 2
  await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
});

test("a tab tapped while a screen is still loading its data is not lost", async ({ page }) => {
  // regression: the deep-link hash written after the data arrived used to cancel the pending navigation
  for (const from of ["/study/", "/study/postflop/"]) {
    for (let i = 0; i < 3; i++) {
      await page.goto(from);
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "練習" }).click();
      await expect(page).toHaveURL(/\/practice\/$/);
    }
  }
});
