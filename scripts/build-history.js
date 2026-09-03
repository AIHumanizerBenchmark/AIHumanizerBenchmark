//
// Regenerate data/humanizers/ from the published cycles.
//
//   npm run build-history
//
// Run this after adding a cycle, then commit the result. `npm run verify`
// checks that the committed files match what this produces, so forgetting to
// run it fails the build rather than silently publishing stale history.
//
// Files for humanizers that no longer appear in any cycle are removed, so the
// directory always reflects the cycles rather than accumulating orphans.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildHistory, serialise } from "./history.js";

const CYCLES = resolve(process.cwd(), "data/cycles");
const OUT = resolve(process.cwd(), "data/humanizers");

const history = buildHistory(CYCLES);

if (history.size === 0) {
  console.log("\nNo cycles published yet, so there is no history to build.\n");
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });

let written = 0;
let unchanged = 0;
for (const [slug, entry] of history) {
  const path = join(OUT, `${slug}.json`);
  const next = serialise(entry);
  if (existsSync(path) && readFileSync(path, "utf8") === next) {
    unchanged++;
    continue;
  }
  writeFileSync(path, next);
  written++;
}

const expected = new Set([...history.keys()].map((s) => `${s}.json`));
const removed = readdirSync(OUT).filter((f) => f.endsWith(".json") && !expected.has(f));
for (const f of removed) rmSync(join(OUT, f));

console.log(`\nHistory rebuilt from ${history.size} humanizer(s) across the published cycles.`);
console.log(`  written    ${written}`);
console.log(`  unchanged  ${unchanged}`);
if (removed.length) console.log(`  removed    ${removed.length} (${removed.join(", ")})`);
console.log(`\n  ${OUT}\n`);
