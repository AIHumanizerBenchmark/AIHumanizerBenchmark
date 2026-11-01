//
// Cross-cycle schema check: the published schema only grows.
//
// Once a cycle has published a file, or a field on every row of a file, every
// later cycle must publish it too. Anything a consumer has built on keeps
// existing; a field is never quietly dropped between two cycles.
//
// The rule is stated once and derived from the data, so it needs no table of
// which version requires which field. A field introduced in one cycle is
// protected from the next cycle onward without touching this file.
//
// What it cannot catch is a field that was meant to be introduced and never
// was — there is no earlier cycle to compare against. A cycle that introduces
// fields does so with a version bump and an entry in CHANGES.md, which is
// where that is checked by reading.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Files whose rows are objects with a fixed set of fields. */
const ROW_FILES = [
  "samples.json",
  "prompts.json",
  "templates.json",
  "tests.json",
  "detector-scores.json",
];

/** Fields present on every row. Rows that are not objects contribute nothing. */
function commonFields(rows) {
  let common = null;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const keys = new Set(Object.keys(row));
    common = common === null ? keys : new Set([...common].filter((k) => keys.has(k)));
  }
  return common ?? new Set();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Rows of a JSON-lines file; a line that is not JSON contributes nothing. */
function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    });
}

/**
 * The schema one cycle publishes: its files, and the fields guaranteed on
 * every row of each. Only top-level fields are compared — nested maps such as
 * per-detector scores are keyed by the tools in the panel, which legitimately
 * change from cycle to cycle.
 *
 * @param {string} dir path to one cycle directory
 * @returns {Map<string, Set<string>>} group label -> names
 */
export function cycleSchema(dir) {
  const schema = new Map();

  // Per-tool files under data/ follow the roster, so the directory counts as
  // one entry rather than each file in it.
  const files = readdirSync(dir)
    .filter((name) => name !== "manifest.json.ots")
    .map((name) => (statSync(join(dir, name)).isDirectory() ? `${name}/` : name));
  schema.set("files", new Set(files));

  for (const name of ROW_FILES) {
    const rows = existsSync(join(dir, name)) ? readJson(join(dir, name)) : null;
    if (Array.isArray(rows)) schema.set(name, commonFields(rows));
  }

  const commit = existsSync(join(dir, "commit.json")) ? readJson(join(dir, "commit.json")) : null;
  if (commit) schema.set("commit.json", new Set(Object.keys(commit)));

  const leaderboard = existsSync(join(dir, "leaderboard.json")) ? readJson(join(dir, "leaderboard.json")) : null;
  if (leaderboard) {
    schema.set("leaderboard.json", new Set(Object.keys(leaderboard)));
    schema.set("leaderboard.json results", commonFields(leaderboard.results ?? []));
  }

  // The grouped files under data/ are one file per tool and one per detector,
  // so their rows are compared as two groups rather than file by file: the
  // fields every per-tool row carries, and the fields every per-detector row
  // carries. The detector panel in leaderboard.json says which file is which.
  const dataDir = join(dir, "data");
  if (leaderboard && existsSync(dataDir) && statSync(dataDir).isDirectory()) {
    const detectors = new Set(leaderboard.detectors ?? []);
    const groups = { "data/<tool>.jsonl": [], "data/<detector>.jsonl": [] };
    for (const name of readdirSync(dataDir)) {
      if (!name.endsWith(".jsonl")) continue;
      const group = detectors.has(name.slice(0, -".jsonl".length)) ? "data/<detector>.jsonl" : "data/<tool>.jsonl";
      groups[group].push(...readJsonl(join(dataDir, name)));
    }
    for (const [group, rows] of Object.entries(groups)) {
      if (rows.length) schema.set(group, commonFields(rows));
    }
  }

  const jsonl = join(dir, "results.jsonl");
  if (existsSync(jsonl)) schema.set("results.jsonl", commonFields(readJsonl(jsonl)));

  return schema;
}

/**
 * Compare every published cycle against all the cycles before it.
 *
 * @param {string} cyclesDir path to data/cycles
 * @returns {{cycles: number, problems: string[]}}
 */
export function checkSchemaGrowth(cyclesDir) {
  if (!existsSync(cyclesDir)) return { cycles: 0, problems: [] };

  // Cycle ids are YYYY-MM, so lexicographic order is chronological. A cycle
  // that is committed but not yet revealed has published nothing to compare.
  const cycles = readdirSync(cyclesDir)
    .filter((name) => statSync(join(cyclesDir, name)).isDirectory())
    .filter((name) => existsSync(join(cyclesDir, name, "leaderboard.json")))
    .sort();

  /** @type {Map<string, Map<string, string>>} group -> name -> cycle that introduced it */
  const seen = new Map();
  const problems = [];

  for (const cycle of cycles) {
    const schema = cycleSchema(join(cyclesDir, cycle));

    for (const [group, names] of seen) {
      const now = schema.get(group) ?? new Set();
      for (const [name, since] of names) {
        if (!now.has(name)) {
          problems.push(
            group === "files"
              ? `${cycle}: ${name} is missing (published since ${since})`
              : `${cycle}: ${group} no longer carries "${name}" on every row (published since ${since})`,
          );
        }
      }
    }

    for (const [group, names] of schema) {
      if (!seen.has(group)) seen.set(group, new Map());
      for (const name of names) {
        if (!seen.get(group).has(name)) seen.get(group).set(name, cycle);
      }
    }
  }

  return { cycles: cycles.length, problems };
}
