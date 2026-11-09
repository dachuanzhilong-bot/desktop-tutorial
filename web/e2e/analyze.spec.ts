import { expect, test } from "@playwright/test";
import { H_BAD_3BET, H_CO_OPEN, H_TOURNAMENT, SESSION_STARS } from "../src/lib/__tests__/fixtures/hands";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("tessera.settings.v1", JSON.stringify({ onboarded: true })));
});

const FILE = { name: "hands.txt", mimeType: "text/plain", buffer: Buffer.from([H_CO_OPEN, H_BAD_3BET, H_TOURNAMENT].join("\n\n\n")) };

test.describe("analyze", () => {
  test("imports hand histories, ranks the mistakes, builds a practice set and opens the flop in Solve", async ({ page }) => {
    await page.goto("/analyze/");
    await expect(page.getByTestId("hh-file")).toBeAttached();
    await page.getByTestId("hh-file").setInputFiles(FILE);

    const report = page.getByTestId("hh-report");
    await expect(report).toContainText("新規 2");
    await expect(report).toContainText("対象外 1");
    await expect(page.getByTestId("hh-summary")).toContainText("2");
    await expect(page.getByTestId("hh-weak")).toContainText("オープンへの対応");

    // the 72o 3-bet is a blunder and sits at the top of the list
    const first = page.getByTestId("hh-hand").first();
    await expect(first).toContainText("大ミス");
    await expect(first).toContainText("BTN");

    // importing the same file again adds nothing
    await page.getByTestId("hh-file").setInputFiles(FILE);
    await expect(page.getByTestId("hh-report")).toContainText("新規 0");
    await expect(page.getByTestId("hh-report")).toContainText("取り込み済み 2");

    // all hands (not only the ones with mistakes): the CO open has a heads-up flop that can be solved
    await page.getByRole("button", { name: "ミスのあるハンド" }).click();
    await expect(page.getByTestId("hh-hand")).toHaveCount(2);
    await page.locator('[data-testid="hh-solve"][title*="ポット 5.5bb"]').click();
    await expect(page).toHaveURL(/\/solve\/?$/);
    await expect(page.getByTestId("pot-input")).toHaveValue("5.5");
    await expect(page.getByTestId("range-oop-size")).not.toContainText("0コンボ");
    await expect(page.getByTestId("board-count")).toContainText("3/5");

    // the practice set: the mistake comes back as a question
    await page.goto("/analyze/");
    await page.getByTestId("hh-make-set").click();
    await expect(page).toHaveURL(/practice\/#set=/);
    await expect(page.getByTestId("session-title")).toContainText("ハンド履歴");
    await expect(page.locator('[data-testid^="action-"]').first()).toBeVisible({ timeout: 20_000 });
  });

  test("a text that is not a PokerStars history is reported, not crashed on", async ({ page }) => {
    await page.goto("/analyze/");
    await page.getByText("テキストを貼り付ける").click();
    await page.getByTestId("hh-paste").fill("hello world");
    await page.getByTestId("hh-run").click();
    await expect(page.getByTestId("hh-report")).toContainText("見つかりませんでした");
  });

  test("files without hands and unsupported hands are reported with the reason, in Japanese", async ({ page }) => {
    await page.goto("/analyze/");
    await page.getByTestId("hh-file").setInputFiles([
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just some notes\nnothing to see") },
      { name: "photo.txt", mimeType: "text/plain", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]) },
      { name: "session.txt", mimeType: "text/plain", buffer: Buffer.from([SESSION_STARS, H_TOURNAMENT].join("\n\n\n")) },
    ]);
    const report = page.getByTestId("hh-report");
    await expect(report).toContainText("新規 2");
    await expect(report).toContainText("ハンドが見つからなかったファイル: notes.txt, photo.txt");
    await report.getByText("対象外の理由").click();
    await expect(report).toContainText("トーナメントのハンドには対応していません × 1");
  });

  test("a large import shows progress, keeps the page responsive and can be stopped", async ({ page }) => {
    // 5,000 distinct hands (ids changed) – a few months of play
    const many = Array.from({ length: 5000 }, (_, i) => H_CO_OPEN.replace("230000000001", String(400000000000 + i))).join("\n\n\n");
    await page.goto("/analyze/");
    await page.getByTestId("hh-file").setInputFiles({ name: "big.txt", mimeType: "text/plain", buffer: Buffer.from(many) });
    const busy = page.getByTestId("hh-busy");
    await expect(busy).toBeVisible();
    // the main thread is not blocked: timers keep firing on time while the import runs (5 samples)
    const lags = await page.evaluate(async () => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++)
        out.push(
          await new Promise<number>((r) => {
            const t0 = performance.now();
            setTimeout(() => r(performance.now() - t0 - 50), 50);
          }),
        );
      return out;
    });
    expect(Math.max(...lags), `timer delays ${lags.map((x) => Math.round(x)).join(", ")} ms`).toBeLessThan(300);
    await expect(busy).toBeVisible(); // still importing: the samples were taken during the work
    await page.getByTestId("hh-cancel").click();
    await expect(busy).toBeHidden();
    await expect(page.getByTestId("hh-report")).toContainText("途中で中止しました");
    // what was analysed before stopping is kept
    await expect(page.getByTestId("hh-summary")).toBeVisible();
  });
});
