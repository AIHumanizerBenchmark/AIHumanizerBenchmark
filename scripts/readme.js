//
// The rankings table shown at the top of the README.
//
// Like the history files, this is DERIVED: every number comes from the latest
// published leaderboard, and `npm run verify` fails if the committed README
// disagrees with a fresh regeneration. A README that quietly drifts from the
// data it summarises is the same unverified claim this repository exists to
// avoid, just in the most visible place.
//
// Display names are cosmetic — they change how a row is labelled and nothing
// else. Every number in the table is read straight from leaderboard.json.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const START = "<!-- RANKINGS:START -->";
export const END = "<!-- RANKINGS:END -->";

const SITE = "https://aihumanizerbenchmark.com";

/**
 * Slug to display name, needed only where title-casing the slug gets the
 * capitalisation wrong. Anything absent falls back to the title-cased slug.
 */
const DISPLAY_NAMES = {
  aihumanize: "AI Humanize",
  cleverhumanizer: "Clever AI Humanizer",
  gptinf: "GPTinf",
  "hix-bypass": "HIX Bypass",
  rehumanize: "ReHumanize",
  smarthumanizer: "SmartHumanizer",
  stealthgpt: "StealthGPT",
  superhumanizer: "SuperHumanizer",
  "undetectable-ai": "Undetectable AI",
  undetectedgpt: "UndetectedGPT",
  writehuman: "WriteHuman",
};

function displayName(slug) {
  return (
    DISPLAY_NAMES[slug] ??
    slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function cycleLabel(cycleId) {
  const m = /^(\d{4})-(\d{2})$/.exec(cycleId);
  if (!m) return cycleId;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : cycleId;
}

const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const totalPenalty = (r) => (r.penalties ?? []).reduce((s, p) => s + p.delta, 0);

/** The most recent published cycle, or null if there are none. */
export function latestCycle(cyclesDir) {
  if (!existsSync(cyclesDir)) return null;
  const ids = readdirSync(cyclesDir)
    .filter((n) => statSync(join(cyclesDir, n)).isDirectory())
    .filter((n) => existsSync(join(cyclesDir, n, "leaderboard.json")))
    .sort();
  if (ids.length === 0) return null;
  const id = ids[ids.length - 1];
  return {
    id,
    leaderboard: JSON.parse(readFileSync(join(cyclesDir, id, "leaderboard.json"), "utf8")),
  };
}

/** Render the rankings block, markers included. */
export function buildBlock(cyclesDir) {
  const latest = latestCycle(cyclesDir);
  if (!latest) {
    return [
      START,
      "<!-- The rankings table is generated here once the first cycle is published. -->",
      END,
    ].join("\n");
  }

  const { id, leaderboard } = latest;
  const rows = leaderboard.results.map((r, i) => {
    const penalty = totalPenalty(r);
    return (
      `| ${i + 1} | [${displayName(r.slug)}](${SITE}/humanizers/${r.slug}) | ` +
      `${r.composite.toFixed(2)} | ${pct(r.bypassRate)} | ${pct(r.meaningPreservation)} | ` +
      `${pct(r.readability)} | ${pct(r.consistency)} | ${penalty ? `-${penalty.toFixed(1)}` : "0"} |`
    );
  });

  const excluded = (leaderboard.excluded ?? []).map((e) => displayName(e.slug));
  const samples = leaderboard.results[0]?.testsCompleted ?? 0;

  const caption =
    `_Composite out of 100, weighting detector bypass 42%, meaning preservation 32%, ` +
    `readability 16%, and consistency across writing categories 10%; the four columns after ` +
    `the score are those sub-scores. Penalty is the total deducted for quality failures, ` +
    `already reflected in the score. Every tool ran automatically on its default settings ` +
    `over the same ${samples} texts, each scored by ${leaderboard.detectors.length} AI detectors. ` +
    `Every number here is reproducible from the data in this repository — run \`npm run verify\`.` +
    (excluded.length ? ` Excluded this cycle for unavailability: ${excluded.join(", ")}.` : "") +
    ` Full per-detector breakdowns at [aihumanizerbenchmark.com/leaderboard](${SITE}/leaderboard)._`;

  return [
    START,
    `## AI humanizer rankings: ${cycleLabel(id)}`,
    "",
    "| # | AI humanizer | Score / 100 | Bypass | Meaning | Readability | Consistency | Penalty |",
    "|--:|--------------|:-----------:|:------:|:-------:|:-----------:|:-----------:|:-------:|",
    ...rows,
    "",
    caption,
    END,
  ].join("\n");
}

/** Replace the rankings block in `readme`, leaving the rest untouched. */
export function inject(readme, block) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(`README is missing the ${START} / ${END} markers`);
  }
  return readme.slice(0, start) + block + readme.slice(end + END.length);
}
