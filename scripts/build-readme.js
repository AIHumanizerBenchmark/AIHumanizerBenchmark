//
// Regenerate the rankings table in README.md from the latest published cycle.
//
//   npm run build-readme
//
// Run it after adding a cycle, then commit. `npm run verify` fails if the
// committed README disagrees with a fresh regeneration, so a stale table is
// caught rather than left sitting at the top of the repository.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBlock, inject, latestCycle, cycleLabel } from "./readme.js";

const CYCLES = resolve(process.cwd(), "data/cycles");
const README = resolve(process.cwd(), "README.md");

const current = readFileSync(README, "utf8");
const next = inject(current, buildBlock(CYCLES));

if (current === next) {
  console.log("\nREADME rankings already up to date.\n");
  process.exit(0);
}

writeFileSync(README, next);

const latest = latestCycle(CYCLES);
if (latest) {
  console.log(`\nREADME rankings updated to ${cycleLabel(latest.id)} (${latest.leaderboard.results.length} tools).\n`);
} else {
  console.log("\nREADME rankings cleared — no cycles published yet.\n");
}
