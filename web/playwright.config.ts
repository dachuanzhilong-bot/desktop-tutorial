import { defineConfig, devices } from "@playwright/test";

/** E2E runs against the static export (`npm run build` first): the same artefact that gets deployed. */
export default defineConfig({
  testDir: "e2e",
  // the sub-path checks need their own build and server: `npm run e2e:subpath`
  testIgnore: "subpath.spec.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://localhost:3100", trace: "off", screenshot: "off" },
  webServer: { command: "node scripts/serve-static.mjs 3100", env: { E2E_HOOKS: "1" }, url: "http://localhost:3100/study/", reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { viewport: { width: 1180, height: 820 } } },
  ],
});
