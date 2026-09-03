// Frozen scoring for one cycle.
//
// PLAIN JAVASCRIPT ON PURPOSE, same reasoning as select-placeholders.js: this
// exact file ships in the public bundle AND the runner imports it, so the
// published scorer is provably the one that produced the leaderboard. A TS
// implementation with a separately published JS copy could drift.
//
// It takes the PUBLISHED artifacts as input — tests.json and
// detector-scores.json — rather than the runner's in-memory state. That is
// deliberate: if the runner can compute the leaderboard from nothing but the
// published files, those files are provably sufficient for anyone else to do
// the same. An auditor runs:
//
//   node -e "Promise.all([
//     import('./scoring.js'),
//     import('node:fs').then(fs => [
//       JSON.parse(fs.readFileSync('tests.json')),
//       JSON.parse(fs.readFileSync('detector-scores.json'))])
//   ]).then(([m,[t,d]]) => console.log(m.computeLeaderboard(t, d)))"
//
// NO MODEL CALLS. meaning_preservation and readability are frozen per-test in
// tests.json; this file only averages them. That is what lets anyone reproduce
// the leaderboard without an OpenAI or Anthropic key.
//
// composite_raw = 42*bypass + 32*meaning + 16*readability + 10*consistency
// composite     = clamp(composite_raw - penalties, 0, 100)

const WEIGHTS = { bypass: 42, meaning: 32, readability: 16, consistency: 10 };

const PENALTY_RULES = [
  { code: "severe_meaning_drift", per: 1.0, cap: 10.0 },
  { code: "length_inflation", per: 1.0, cap: 10.0 },
  { code: "length_deflation", per: 1.0, cap: 10.0 },
  { code: "identical_to_input", per: 2.0, cap: 10.0 },
  { code: "refusal_in_output", per: 1.0, cap: 10.0 },
];

const MEANING_DRIFT_THRESHOLD = 0.85;
const LENGTH_INFLATION_RATIO = 1.4;
const LENGTH_DEFLATION_RATIO = 0.6;
/** Meaning arrives as cosine similarity, which is compressed near 1; rescale
 *  [0.75, 1.0] onto [0, 1] so the weight is spread over the range that varies. */
const MEANING_FLOOR = 0.75;

/**
 * A tool with at least this share of ACCESS failures is excluded from the
 * ranking rather than scored, and recorded separately with its attempt counts.
 *
 * The distinction that matters: status "error" means we could not exercise the
 * tool (endpoint down, quota gone, access blocked), so ranking it on whichever
 * runs happened to succeed would measure our luck rather than the tool.
 * "refusal" and "identical" are the opposite — the tool ran and returned
 * something poor, so those keep their per-occurrence penalties and stay in the
 * ranking. Excluding on quality failures would reward a tool for failing.
 */
const UNAVAILABLE_ERROR_RATE = 0.5;

function wordCount(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export function median(xs) {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function rescaleMeaning(x) {
  return Math.max(0, Math.min(1, (x - MEANING_FLOOR) / (1 - MEANING_FLOOR)));
}
function round(x, dp) {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

/**
 * Per-test bypass is the MEDIAN across the panel, not the mean.
 *
 * Some detectors binarise near 0 or 1, so with a mean a single extreme
 * detector could swing a test on its own. A detector we could not reach
 * (null) is omitted rather than counted as zero — an unreachable detector is
 * missing data, not a verdict of "AI".
 */
function bypassForTest(scores) {
  const values = Object.values(scores || {}).filter((v) => typeof v === "number");
  return median(values);
}

/**
 * Compute the full leaderboard for a cycle.
 *
 * @param {object[]} tests            tests.json
 * @param {object[]} detectorScores   detector-scores.json
 * @returns {object[]} leaderboard entries, ranked by composite descending
 */
export function computeLeaderboard(tests, detectorScores) {
  const scoresByTest = new Map();
  for (const row of detectorScores) {
    scoresByTest.set(`${row.humanizer}::${row.test_id}`, row.scores || {});
  }

  const byHumanizer = new Map();
  for (const t of tests) {
    if (!byHumanizer.has(t.humanizer)) byHumanizer.set(t.humanizer, []);
    const scores = scoresByTest.get(`${t.humanizer}::${t.test_id}`) || {};
    byHumanizer.get(t.humanizer).push({ ...t, scores, bypass: bypassForTest(scores) });
  }

  const entries = [];
  for (const [slug, rows] of byHumanizer) {
    entries.push(scoreHumanizer(slug, rows));
  }
  // Excluded tools sort last so entry[0] is always the top RANKED tool, whatever
  // composite an unavailable one happens to have computed.
  entries.sort((a, b) => {
    if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1;
    return b.composite - a.composite;
  });
  return entries;
}

/** Score one humanizer from its joined rows. Exported for spot-checking. */
export function scoreHumanizer(slug, rows) {
  const bypassRate = mean(rows.map((r) => r.bypass));
  const meaningPreservation = mean(rows.map((r) => rescaleMeaning(r.meaning_preservation)));
  const readability = mean(rows.map((r) => r.readability));

  // Consistency: how evenly a tool performs across categories. Under three
  // categories there is not enough spread to measure, so it is held neutral
  // rather than scored as perfect (stddev of one value is 0, which would hand
  // out full marks for having no data).
  const byCategory = new Map();
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category).push(r.bypass);
  }
  const categoryMeans = Array.from(byCategory.values()).map(mean);
  const consistency = categoryMeans.length < 3 ? 0.5 : Math.max(0, 1 - stddev(categoryMeans));

  const counts = {};
  const bump = (code) => { counts[code] = (counts[code] || 0) + 1; };
  for (const r of rows) {
    if (r.meaning_preservation < MEANING_DRIFT_THRESHOLD) bump("severe_meaning_drift");
    const ratio = wordCount(r.output) / (wordCount(r.input) || 1);
    if (ratio > LENGTH_INFLATION_RATIO) bump("length_inflation");
    if (ratio < LENGTH_DEFLATION_RATIO) bump("length_deflation");
    if (r.status === "identical") bump("identical_to_input");
    if (r.status === "refusal") bump("refusal_in_output");
  }
  const penalties = PENALTY_RULES
    .map(({ code, per, cap }) => ({
      code,
      occurrences: counts[code] || 0,
      delta: Math.min((counts[code] || 0) * per, cap),
    }))
    .filter((p) => p.occurrences > 0);
  const totalPenalty = penalties.reduce((a, p) => a + p.delta, 0);

  const compositeRaw =
    WEIGHTS.bypass * bypassRate +
    WEIGHTS.meaning * meaningPreservation +
    WEIGHTS.readability * readability +
    WEIGHTS.consistency * consistency;
  const composite = Math.max(0, Math.min(100, compositeRaw - totalPenalty));

  const perDetector = {};
  const detAcc = new Map();
  for (const r of rows) {
    for (const [name, value] of Object.entries(r.scores || {})) {
      if (typeof value !== "number") continue;
      if (!detAcc.has(name)) detAcc.set(name, []);
      detAcc.get(name).push(value);
    }
  }
  for (const [name, values] of detAcc) perDetector[name] = round(mean(values), 4);

  const perCategory = {};
  for (const [category, _] of byCategory) {
    const catRows = rows.filter((r) => r.category === category);
    perCategory[category] = round(
      WEIGHTS.bypass * mean(catRows.map((r) => r.bypass)) +
        WEIGHTS.meaning * mean(catRows.map((r) => rescaleMeaning(r.meaning_preservation))) +
        WEIGHTS.readability * mean(catRows.map((r) => r.readability)) +
        WEIGHTS.consistency * consistency,
      1,
    );
  }

  // Access failures vs quality failures — see UNAVAILABLE_ERROR_RATE.
  const errors = rows.filter((r) => r.status === "error").length;
  const unavailable = rows.length > 0 && errors / rows.length >= UNAVAILABLE_ERROR_RATE;

  return {
    slug,
    unavailable,
    attempts: { total: rows.length, errors },
    composite: round(composite, 1),
    bypassRate: round(bypassRate, 4),
    meaningPreservation: round(meaningPreservation, 4),
    readability: round(readability, 4),
    consistency: round(consistency, 4),
    penalties,
    perDetector,
    perCategory,
    testsCompleted: rows.length,
  };
}
