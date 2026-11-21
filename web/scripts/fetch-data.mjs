// Puts the postflop solution files in public/postflop (REFACTOR_PLAN 4-5). They are not in git: they are attached to
// a GitHub Release (.github/workflows/data-release.yml), named by data.lock.json. public/postflop/index.json, which
// is in git, gives the build ID (the first 12 hex digits of the SHA-256) of every file, so each file is checked
// against it.
//
//   node scripts/fetch-data.mjs        (npm run data:fetch; npm runs it before test, validate:data and build)
//
// Nothing is downloaded when every file is already there and matches. Otherwise the release asset is downloaded with
// curl (it follows the proxy settings of the machine), checked against the SHA-256 in data.lock.json, and unpacked.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOf } from "./build-id.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(web, "public", "postflop");

/** the files of index.json that are missing or do not match their build ID */
function stale() {
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  const bad = [];
  for (const [key, build] of Object.entries(index.build ?? {})) {
    const file = join(dir, `${key}.bin.gz`);
    if (!existsSync(file) || buildOf([file]) !== build) bad.push(key);
  }
  return bad;
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const before = stale();
if (before.length === 0) {
  console.log("postflop data: up to date");
  process.exit(0);
}
const lock = JSON.parse(readFileSync(join(web, "data.lock.json"), "utf8")).postflop;
console.log(`postflop data: ${before.length} file(s) missing or changed, downloading ${lock.url}`);
const tmp = mkdtempSync(join(tmpdir(), "tessera-data-"));
try {
  const tar = join(tmp, "postflop.tar");
  execFileSync("curl", ["-fsSL", "--retry", "4", "--retry-delay", "2", "-o", tar, lock.url], { stdio: "inherit" });
  const got = sha256(tar);
  if (got !== lock.sha256) throw new Error(`postflop data: SHA-256 ${got}, data.lock.json says ${lock.sha256}`);
  execFileSync("tar", ["-xf", tar, "-C", dir], { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const after = stale();
if (after.length > 0) {
  console.error(`postflop data: ${after.length} file(s) still do not match index.json (first: ${after[0]}).`);
  console.error("The release in data.lock.json is not the one index.json was built from.");
  process.exit(1);
}
console.log("postflop data: downloaded and checked");
