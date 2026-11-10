// Builds the static export for a sub-path (a GitHub Pages project site) and runs the sub-path checks against it.
//   npm run e2e:subpath            (path /desktop-tutorial)
//   E2E_BASE_PATH=/other npm run e2e:subpath
import { spawnSync } from "node:child_process";

const base = process.env.E2E_BASE_PATH ?? "/desktop-tutorial";
const env = { ...process.env, NEXT_PUBLIC_BASE_PATH: base, E2E_BASE_PATH: base };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("npm", ["run", "build"]);
run("npx", ["playwright", "test", "-c", "playwright.subpath.config.ts", "--trace", "off", ...process.argv.slice(2)]);
