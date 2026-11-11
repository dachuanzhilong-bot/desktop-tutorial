import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildStamp, stampServiceWorker } from "../../../scripts/stamp-sw.mjs";

const SW = 'const VERSION = "v9";\nconst BUILD = "dev";\nconst CORE = `tessera-core-${VERSION}-${BUILD}`;\n';

async function site(html: string, chunk = "app-abc123.js") {
  const root = await mkdtemp(join(tmpdir(), "tessera-sw-"));
  await mkdir(join(root, "_next", "static", "chunks"), { recursive: true });
  await mkdir(join(root, "solutions"), { recursive: true });
  await writeFile(join(root, "sw.js"), SW);
  await writeFile(join(root, "index.html"), html);
  await writeFile(join(root, "_next", "static", "chunks", chunk), "js");
  await writeFile(join(root, "solutions", "big.bin"), "data");
  return root;
}

test("writes the build fingerprint into the worker, and the same site gets the same one", async () => {
  const a = await site("<html>one</html>");
  const b = await site("<html>one</html>");
  try {
    const stamp = await stampServiceWorker(a);
    expect(stamp).toMatch(/^[0-9a-f]{10}$/);
    expect(await readFile(join(a, "sw.js"), "utf8")).toBe(SW.replace('"dev"', `"${stamp}"`));
    expect(await stampServiceWorker(b)).toBe(stamp);
    // stamping again (the worker file is not part of the fingerprint) changes nothing
    expect(await stampServiceWorker(a)).toBe(stamp);
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("a changed page or a renamed script gives a new fingerprint; solution data does not", async () => {
  const base = await site("<html>one</html>");
  const page = await site("<html>two</html>");
  const chunk = await site("<html>one</html>", "app-def456.js");
  try {
    const stamp = await buildStamp(base);
    expect(await buildStamp(page)).not.toBe(stamp);
    expect(await buildStamp(chunk)).not.toBe(stamp);
    await writeFile(join(base, "solutions", "big.bin"), "other data");
    expect(await buildStamp(base)).toBe(stamp);
  } finally {
    for (const r of [base, page, chunk]) await rm(r, { recursive: true, force: true });
  }
});

test("refuses a worker file that has no line to stamp", async () => {
  const root = await site("<html></html>");
  try {
    await writeFile(join(root, "sw.js"), "const VERSION = 1;");
    await expect(stampServiceWorker(root)).rejects.toThrow(/BUILD/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
