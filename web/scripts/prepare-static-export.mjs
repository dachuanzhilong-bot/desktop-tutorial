import { copyFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

async function filesUnder(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

/**
 * Next's static export nests route payloads under __next.<route>/..., while its
 * client prefetch requests the equivalent dotted .txt URL. Copy the payload to
 * that URL so static hosts can serve it without rewrite rules.
 */
export async function prepareStaticExport(root = resolve("out")) {
  const absoluteRoot = resolve(root);
  let copied = 0;
  for (const source of await filesUnder(absoluteRoot)) {
    if (!source.endsWith(`${sep}__PAGE__.txt`)) continue;
    const parts = relative(absoluteRoot, source).split(sep);
    const rscIndex = parts.findIndex((part) => part.startsWith("__next."));
    if (rscIndex < 0) continue;

    const routeParts = [parts[rscIndex].slice("__next.".length), ...parts.slice(rscIndex + 1, -1)];
    if (routeParts.some((part) => !part || part === "__PAGE__")) continue;
    const aliasName = `__next.${routeParts.join(".")}.__PAGE__.txt`;
    const alias = join(absoluteRoot, ...parts.slice(0, rscIndex), aliasName);
    if (existsSync(alias)) continue;
    await mkdir(join(absoluteRoot, ...parts.slice(0, rscIndex)), { recursive: true });
    await copyFile(source, alias);
    copied++;
  }
  return copied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const copied = await prepareStaticExport(process.argv[2] ?? "out");
  console.log(`Prepared ${copied} static route payload URL${copied === 1 ? "" : "s"}.`);
}
