//
// Cross-cycle history: one file per humanizer, tracking how it moved from
// cycle to cycle.
//
// These files are DERIVED. Everything in them comes from the per-cycle
// leaderboards, and nothing is added by hand — which is what makes them
// checkable. `npm run build-history` writes them; `npm run verify` regenerates
// them in memory and fails if the committed files disagree. Both call the
// function below, so the generator and the checker cannot drift apart.
//
// Publishing derived data that nothing verifies is the failure mode this
// avoids: a bad generator run, or an edit to a history file, would otherwise
// be invisible while every per-cycle check still passed.
//
// Output is deterministic — cycles in directory order, humanizers sorted by
// slug, fixed key order, two-space indent, trailing newline — so a regeneration
// is byte-identical to the committed file and the comparison can be exact.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Serialise exactly as the files on disk are written. */
export function serialise(entry) {
  return JSON.stringify(entry, null, 2) + "\n";
}

/**
 * Build every humanizer's history from the published cycles.
 *
 * @param {string} cyclesDir path to data/cycles
 * @returns {Map<string, object>} slug -> history object, sorted by slug
 */
export function buildHistory(cyclesDir) {
  if (!existsSync(cyclesDir)) return new Map();

  // Cycle ids are YYYY-MM, so lexicographic order is chronological. Sorting
  // here rather than trusting readdir keeps output stable across filesystems.
  const cycles = readdirSync(cyclesDir)
    .filter((name) => statSync(join(cyclesDir, name)).isDirectory())
    .sort();

  /** @type {Map<string, object[]>} slug -> points, oldest first */
  const points = new Map();
  const add = (slug, point) => {
    if (!points.has(slug)) points.set(slug, []);
    points.get(slug).push(point);
  };

  for (const cycle of cycles) {
    const path = join(cyclesDir, cycle, "leaderboard.json");
    if (!existsSync(path)) continue;
    const lb = JSON.parse(readFileSync(path, "utf8"));

    // results are published in composite order, so the index is the rank.
    (lb.results ?? []).forEach((r, i) => {
      add(r.slug, {
        cycle,
        rank: i + 1,
        composite: r.composite,
        bypassRate: r.bypassRate,
        meaningPreservation: r.meaningPreservation,
        readability: r.readability,
        consistency: r.consistency,
        perDetector: r.perDetector ?? {},
        perCategory: r.perCategory ?? {},
      });
    });

    // A tool excluded for unavailability still gets a point, so a gap in its
    // record is visible as a gap rather than as a cycle it quietly skipped.
    for (const e of lb.excluded ?? []) {
      add(e.slug, { cycle, unavailable: true });
    }
  }

  return new Map(
    [...points.keys()]
      .sort()
      .map((slug) => [slug, { slug, points: points.get(slug) }]),
  );
}
