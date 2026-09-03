//
// Verify every published cycle, or one named cycle.
//
//   npm run verify                      # every cycle
//   npm run verify -- "September 2026"  # one cycle
//   npm run verify -- 2026-09           # same cycle, by id
//
// Exits non-zero if any cycle fails, so this is usable in CI.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildHistory, serialise } from "./history.js";
import { buildBlock, cycleLabel, inject, latestCycle, START } from "./readme.js";
import { verifyCycle } from "./verify-cycle.js";

const CYCLES = resolve(process.cwd(), "data/cycles");

/** "2026-09" -> "September 2026", shared with the README generator. */
const label = cycleLabel;

const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, "");

async function main() {
  if (!existsSync(CYCLES)) {
    console.error(`No data/cycles directory at ${CYCLES}. Run this from the repository root.`);
    process.exit(2);
  }

  const all = readdirSync(CYCLES)
    .filter((name) => statSync(join(CYCLES, name)).isDirectory())
    .sort();

  if (all.length === 0) {
    // Still check the README: with no cycles the table must say so, and a
    // rankings table standing over no data is exactly what wants catching.
    console.log("\nNo cycles published yet.\n");
    if (!verifyReadme()) {
      console.log("");
      process.exit(1);
    }
    console.log("");
    return;
  }

  // Match on directory name or on the human label derived from it, so both
  // `2026-09` and `September 2026` find the same bundle.
  const query = process.argv[2];
  const selected = query
    ? all.filter((id) => norm(id) === norm(query) || norm(label(id)) === norm(query))
    : all;

  if (query && selected.length === 0) {
    console.error(`\nNo cycle matching "${query}". Published cycles:`);
    for (const id of all) console.error(`  ${id}  (${label(id)})`);
    console.error("");
    process.exit(2);
  }

  const failed = [];
  for (const id of selected) {
    console.log(`\n\x1b[1m${label(id)}\x1b[0m  ·  data/cycles/${id}\n`);
    const failures = await verifyCycle(join(CYCLES, id));
    if (failures > 0) failed.push(id);
  }

  // Cross-cycle history is only meaningful over the full set, so it is checked
  // once here rather than inside any single cycle — and only on a full run,
  // since it cannot be judged from one cycle in isolation.
  let derivedFailed = false;
  if (!query) {
    console.log(`\n\x1b[1mHistory\x1b[0m  ·  data/humanizers\n`);
    const historyOk = verifyHistory();
    console.log(`\n\x1b[1mREADME\x1b[0m  ·  rankings table\n`);
    const readmeOk = verifyReadme();
    derivedFailed = !historyOk || !readmeOk;
  }

  console.log("");
  if (failed.length > 0 || derivedFailed) {
    if (failed.length > 0) {
      console.log(`\x1b[31mFAILED\x1b[0m — ${failed.length} of ${selected.length} cycle(s) did not verify: ${failed.join(", ")}`);
    }
    if (derivedFailed) console.log(`\x1b[31mFAILED\x1b[0m — derived files do not match the published cycles.`);
    console.log("");
    process.exit(1);
  }
  console.log(
    `\x1b[32mVerified ${selected.length} cycle${selected.length === 1 ? "" : "s"}.\x1b[0m ` +
      `Prompts were fixed before each run, and every published number re-derives\nfrom the published data using that cycle's own scorer.\n`,
  );
}

/**
 * Check 7: the committed history files are exactly what the published cycles
 * produce. History is derived data, so publishing it without this would mean
 * shipping numbers nothing verifies — a bad generator run or a hand edit would
 * be invisible while every per-cycle check still passed.
 *
 * @returns {boolean} true if history is correct or absent-and-expected
 */
function verifyHistory() {
  const expected = buildHistory(CYCLES);
  const dir = resolve(process.cwd(), "data/humanizers");

  if (expected.size === 0) {
    console.log("  \x1b[33m-\x1b[0m no cycles to aggregate — skipping");
    return true;
  }
  if (!existsSync(dir)) {
    console.log(`  \x1b[31m✗\x1b[0m data/humanizers is missing; run \`npm run build-history\``);
    return false;
  }

  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const problems = [];

  for (const [slug, entry] of expected) {
    const path = join(dir, `${slug}.json`);
    if (!existsSync(path)) {
      problems.push(`${slug}.json: missing`);
      continue;
    }
    if (readFileSync(path, "utf8") !== serialise(entry)) {
      problems.push(`${slug}.json: does not match the published cycles`);
    }
  }
  for (const f of onDisk) {
    if (!expected.has(f.replace(/\.json$/, ""))) {
      problems.push(`${f}: no such humanizer in any cycle`);
    }
  }

  if (problems.length > 0) {
    console.log(`  \x1b[31m✗\x1b[0m history does not match the cycles:`);
    for (const p of problems.slice(0, 8)) console.log(`      ${p}`);
    console.log(`      run \`npm run build-history\` and commit the result`);
    return false;
  }

  const cycleCount = new Set([...expected.values()].flatMap((e) => e.points.map((p) => p.cycle))).size;
  console.log(`  \x1b[32m✓\x1b[0m ${expected.size} humanizer histories re-derive from ${cycleCount} cycle(s)`);
  return true;
}

/**
 * Check 8: the rankings table in the README is the latest cycle's leaderboard.
 * It is the most-read thing here and the easiest to leave stale, so it is
 * derived and checked like everything else rather than maintained by hand.
 *
 * @returns {boolean} true if the committed README matches a regeneration
 */
function verifyReadme() {
  const path = resolve(process.cwd(), "README.md");
  if (!existsSync(path)) {
    console.log("  \x1b[33m-\x1b[0m no README.md — skipping");
    return true;
  }
  const current = readFileSync(path, "utf8");
  if (!current.includes(START)) {
    console.log("  \x1b[33m-\x1b[0m README has no rankings markers — skipping");
    return true;
  }
  if (inject(current, buildBlock(CYCLES)) !== current) {
    const latest = latestCycle(CYCLES);
    console.log(
      latest
        ? `  \x1b[31m✗\x1b[0m the rankings table does not match ${cycleLabel(latest.id)}`
        : `  \x1b[31m✗\x1b[0m the README shows a rankings table, but no cycle has been published`,
    );
    console.log(`      run \`npm run build-readme\` and commit the result`);
    return false;
  }
  const latest = latestCycle(CYCLES);
  console.log(
    latest
      ? `  \x1b[32m✓\x1b[0m rankings table matches ${cycleLabel(latest.id)}`
      : `  \x1b[32m✓\x1b[0m no cycles published, and the table correctly says so`,
  );
  return true;
}

main().catch((err) => {
  console.error("\nverify crashed:", err);
  process.exit(2);
});
