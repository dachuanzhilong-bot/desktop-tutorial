import { defineConfig, devices } from "@playwright/test";

/** the export built for a sub-path, served under it: `npm run e2e:subpath` */
const BASE = process.env.E2E_BASE_PATH ?? "/desktop-tutorial";
process.env.E2E_BASE_PATH = BASE;

export default defineConfig({
  testDir: "e2e",
  testMatch: "subpath.spec.ts",
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { trace: "off", screenshot: "off", ...devices["Pixel 7"] },
  webServer: { command: `node scripts/serve-static.mjs 3200`, env: { BASE_PATH: BASE }, url: `http://localhost:3200${BASE}/study/`, reuseExistingServer: false, timeout: 30_000 },
});
