//
// Print the GitHub release payload for the newest published cycle, as JSON.
//
//   node scripts/release-notes.js          # the full payload
//   node scripts/release-notes.js --tag    # just the tag, to check it exists
//
// Used by the release job in .github/workflows/verify.yml, which posts the
// output straight to the releases API. Every figure in the notes is read from
// that cycle's own leaderboard.json rather than typed by hand, for the same
// reason the README table is generated: a release note that disagrees with the
// data it announces is worse than no release note.
//
// Exits non-zero if there is no published cycle, so the workflow fails loudly
// rather than cutting an empty release.

import { resolve } from "node:path";
import { latestCycle, cycleLabel } from "./readme.js";

const CYCLES = resolve(process.cwd(), "data/cycles");

const cycle = latestCycle(CYCLES);
if (!cycle) {
  console.error("No published cycle found under data/cycles.");
  process.exit(1);
}

const { id, leaderboard: lb } = cycle;
const label = cycleLabel(id);

// The workflow asks for the tag first, so it can skip a cycle already released.
if (process.argv.includes("--tag")) {
  process.stdout.write(id);
  process.exit(0);
}

const humanizers = lb.results.length;
const detectors = lb.detectors.length;
const tests = lb.results.reduce((sum, r) => sum + (r.testsCompleted ?? 0), 0);
const excluded = (lb.excluded ?? []).length;

const body = [
  `The ${label} cycle of the AI Humanizer Benchmark.`,
  ``,
  `- ${humanizers} humanizers over ${tests} tests, each scored by ${detectors} detectors`,
  excluded ? `- ${excluded} tool(s) excluded as unavailable and left unscored` : null,
  `- Methodology \`${lb.methodology_version}\`, scoring \`${lb.scoring_version}\`, prompt set \`${lb.prompt_set_version}\``,
  `- Run ${String(lb.run_date).slice(0, 10)}`,
  ``,
  `Data for this cycle is under \`data/cycles/${id}/\`, including the prompts,`,
  `every humanizer output, every detector verdict, and the frozen scorer that`,
  `produced the leaderboard. This release was cut only after \`npm run verify\``,
  `passed in CI, so the tag points at a tree that verified against its own data.`,
  ``,
  `Recompute it yourself:`,
  ``,
  "```bash",
  `npm run verify -- "${label}"`,
  "```",
  ``,
  `Published cycles are never edited. Corrections land as a new cycle.`,
]
  .filter((line) => line !== null)
  .join("\n");

process.stdout.write(
  JSON.stringify({ tag_name: id, name: `${label} cycle`, body }),
);
