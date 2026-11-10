// Builds the static export with a (fake) Supabase project configured, then runs Playwright.
// The e2e tests intercept every request to that host, so no real project is needed.
// NEXT_PUBLIC_E2E=1 only enables the error-boundary probe (components/CrashProbe.tsx).
import { spawnSync } from "node:child_process";

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key", NEXT_PUBLIC_E2E: "1" };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("npm", ["run", "build"]);
run("npx", ["playwright", "test", "--trace", "off", ...process.argv.slice(2)]);
