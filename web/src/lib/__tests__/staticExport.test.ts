import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { prepareStaticExport } from "../../../scripts/prepare-static-export.mjs";

test("copies nested Next route payloads to dotted static prefetch URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "tessera-export-"));
  try {
    const source = join(root, "study", "postflop", "__next.study", "postflop", "__PAGE__.txt");
    const alias = join(root, "study", "postflop", "__next.study.postflop.__PAGE__.txt");
    await mkdir(join(root, "study", "postflop", "__next.study", "postflop"), { recursive: true });
    await writeFile(source, "route payload");

    expect(await prepareStaticExport(root)).toBe(1);
    expect(await readFile(alias, "utf8")).toBe("route payload");
    expect(await prepareStaticExport(root)).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps an existing dotted route payload intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "tessera-export-"));
  try {
    const source = join(root, "practice", "__next.practice", "__PAGE__.txt");
    const alias = join(root, "practice", "__next.practice.__PAGE__.txt");
    await mkdir(join(root, "practice", "__next.practice"), { recursive: true });
    await writeFile(source, "nested payload");
    await writeFile(alias, "existing payload");

    expect(await prepareStaticExport(root)).toBe(0);
    expect(await readFile(alias, "utf8")).toBe("existing payload");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
