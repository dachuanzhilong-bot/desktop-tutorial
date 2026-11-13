import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE, withBase } from "../util/base";
import { startWorker } from "./workerHelper";

// The app can be hosted under a sub-path (GitHub Pages project site). A file named by hand with a leading "/"
// would then point at the host's root and 404: it has to go through withBase() (see lib/util/base.ts).
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("hosting under a sub-path", () => {
  it("withBase leaves paths alone by default and prefixes them when a base is set", () => {
    expect(BASE).toBe("");
    expect(withBase("/solutions/x")).toBe("/solutions/x");
  });

  it("no source file fetches, preloads, registers or starts a worker from a bare root-relative path", () => {
    const bad = /\b(fetch|preload|register|Worker)\(\s*["'`]\//;
    const hits: string[] = [];
    for (const f of sources(join(__dirname, "..", ".."))) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => bad.test(line) && hits.push(`${f.split("/src/")[1]}:${i + 1}: ${line.trim()}`));
    }
    expect(hits).toEqual([]);
  });

  it("the solver worker loads its .wasm under the base path, at the root and under a sub-path", async () => {
    for (const base of ["", "/desktop-tutorial"]) {
      const fetched: string[] = [];
      const call = startWorker(base, fetched);
      await call({ type: "init" });
      expect(fetched).toEqual([`${base}/wasm/tessera_solver.wasm`]);
    }
  });

  it("the service worker takes its base from where it is served, the bundled solver worker from the build", () => {
    const pub = join(__dirname, "..", "..", "..", "public");
    const sw = readFileSync(join(pub, "sw.js"), "utf8");
    // bundled under /_next/static: its own address says nothing about the base, the build's base path does
    const worker = readFileSync(join(__dirname, "..", "..", "workers", "solver.worker.ts"), "utf8");
    expect(sw).toContain("self.registration.scope");
    expect(worker).toContain("withBase(SOLVER_WASM)");
    // no fetch/cache call in either file names a root-relative file without the base
    expect(sw.match(/(fetch|\.add|\.put|\.match)\(\s*["'`]\//g) ?? []).toEqual([]);
    expect(worker.match(/fetch\(\s*["'`]\//g) ?? []).toEqual([]);
  });
});
