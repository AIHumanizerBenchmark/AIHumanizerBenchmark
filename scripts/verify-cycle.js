//
// Verify one published cycle. Usually invoked through `npm run verify`, which
// walks every cycle; run it directly to check a single bundle:
//
//   node scripts/verify-cycle.js data/cycles/2026-09
//
// No install, no network, no API keys, no dependencies beyond Node itself.
// That is the point: a verification tool you have to trust our packaging for
// verifies nothing.
//
// It imports scoring.js and select-placeholders.js FROM THE CYCLE DIRECTORY,
// not from this repo's root. Each cycle ships the exact algorithms that ran, so
// verification uses those rather than whatever the current versions happen to
// be. A cycle from a year ago still verifies against the rules it was scored
// under, and changing today's scoring cannot retroactively validate old data.
//
// Seven independent checks:
//
//   1. Commitment   — the revealed nonce hashes to the value published before
//                     the run, so prompt selection could not have been steered
//                     after seeing which tools it favoured. Where a cycle
//                     rotates the model that writes its source texts, the
//                     roster in source-models.json is the one committed with
//                     the nonce.
//   2. Selection    — feeding that nonce through the frozen algorithm
//                     reproduces the published prompts exactly, and the model
//                     assigned to each.
//   3. Provenance   — each sample was written from a committed prompt by the
//                     model assigned to it, and each test fed a tool the
//                     published sample verbatim and names the same source
//                     model.
//   4. Scoring      — the frozen scorer, over the published per-test rows,
//                     reproduces the published leaderboard within 1e-4, every
//                     field included.
//   5. Completeness — every humanizer faced every sample and every test has
//                     an outcome from every detector, so no inconvenient rows
//                     were dropped before the averaging. An outcome is a
//                     score, null (no verdict for that text) or "error" (no
//                     verdict could be obtained); errors are counted in the
//                     output rather than hidden.
//   5b. Derived     — results.jsonl and the per-tool files say exactly what
//                     tests.json and detector-scores.json say.
//   6. Integrity    — every file matches the hash recorded in manifest.json,
//                     and the manifest's root hash recomputes.
//
// Together they form a chain: nonce -> prompts -> samples -> tests -> scores ->
// leaderboard. Each check ties one link to the next, which is the point — every
// individual file can be internally consistent while the chain between them is
// broken. Editing a score breaks (4) and (6) but not (1); swapping the nonce
// breaks (1) and (2) but not (4); rewriting the corpus from easier prompts
// breaks only (3); deleting rows breaks (5) even though what remains averages
// cleanly. No single edit satisfies all seven.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const TOLERANCE = 1e-4;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Compare one recomputed value against its published counterpart, recursing
 * through objects and arrays. Numbers compare within TOLERANCE; everything
 * else compares exactly. Differences are appended to `out` as readable lines.
 */
function diffField(path, mine, published, out) {
  if (typeof mine === "number" && typeof published === "number") {
    if (Math.abs(mine - published) > TOLERANCE) {
      out.push(`${path}: published ${published}, recomputed ${mine}`);
    }
    return;
  }
  if (Array.isArray(mine) || Array.isArray(published)) {
    const a = Array.isArray(mine) ? mine : [];
    const b = Array.isArray(published) ? published : [];
    if (a.length !== b.length) {
      out.push(`${path}: published ${b.length} entr(ies), recomputed ${a.length}`);
      return;
    }
    a.forEach((v, i) => diffField(`${path}[${i}]`, v, b[i], out));
    return;
  }
  if (mine && published && typeof mine === "object" && typeof published === "object") {
    for (const k of new Set([...Object.keys(mine), ...Object.keys(published)])) {
      diffField(`${path}.${k}`, mine[k], published[k], out);
    }
    return;
  }
  if (mine !== published) {
    out.push(`${path}: published ${JSON.stringify(published)}, recomputed ${JSON.stringify(mine)}`);
  }
}

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, base);
    return [relative(base, full).split(sep).join("/")];
  });
}

/**
 * Verify one cycle bundle.
 * @param {string} dir path to the cycle directory
 * @param {string|null} [expectedId] the cycle id the directory stands for, when
 *   the caller knows it; every id inside the bundle must then agree with it
 * @returns {Promise<number>} number of failed checks; 0 means verified.
 */
export async function verifyCycle(dir, expectedId = null) {
  let failures = 0;
  const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  const bad = (msg) => {
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
    failures++;
  };
  const check = (cond, pass, fail) => {
    if (cond) ok(pass);
    else bad(fail);
    return cond;
  };
  const readJson = (name) => {
    const path = join(dir, name);
    if (!existsSync(path)) {
      bad(`${name} is missing`);
      return null;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      bad(`${name} is not valid JSON: ${err.message}`);
      return null;
    }
  };

  // --- 1. Commitment ------------------------------------------------------
  const commit = readJson("commit.json");
  const noncePath = join(dir, "nonce.txt");
  let nonce = null;
  // A commitment has to be a SHA-256 and has to say which cycle it is for —
  // checked even while the cycle is still awaiting its reveal, since this file
  // is the only thing published at that point.
  if (commit) {
    if (!/^[0-9a-f]{64}$/.test(String(commit.nonce_sha256))) bad("commit.json: nonce_sha256 is not a SHA-256 hash");
    if (expectedId && commit.cycle_id !== expectedId) {
      bad(`commit.json is for cycle "${commit.cycle_id}", but sits in ${expectedId}`);
    }
  }
  if (!existsSync(noncePath)) {
    // A cycle legitimately sits in this state while it runs: the commitment is
    // published first and the nonce only at close. That ordering is the entire
    // guarantee, so an in-flight cycle must not read as a failure. What MUST
    // fail is results appearing without the reveal — published numbers whose
    // prompts nothing can re-derive.
    const hasResults =
      existsSync(join(dir, "leaderboard.json")) || existsSync(join(dir, "tests.json"));
    if (commit && !hasResults) {
      const roster = Array.isArray(commit.source_models)
        ? `, ${commit.source_models.length} source models`
        : "";
      console.log(
        `  \x1b[33m-\x1b[0m committed, awaiting reveal — nothing to verify yet (commitment ${String(commit.nonce_sha256).slice(0, 16)}…${roster})`,
      );
      return failures;
    }
    bad("results are published but nonce.txt is missing — the reveal never happened");
  } else if (commit) {
    nonce = readFileSync(noncePath, "utf8").trim();
    const actual = sha256(nonce);
    check(
      actual === commit.nonce_sha256,
      `nonce matches the commitment published at cycle start (${actual.slice(0, 16)}…)`,
      `nonce does NOT match the commitment\n      committed ${commit.nonce_sha256}\n      actual    ${actual}`,
    );
  }

  // The source-model roster: which models write the source texts. The nonce
  // decides which model gets which prompt, and that only binds if the list it
  // was applied to was fixed before the run — otherwise the roster could be
  // reordered afterwards until the assignment suited. So the roster published
  // in the bundle must be the one published with the commitment. A cycle with
  // neither predates model rotation and has nothing to check here.
  const committedRoster = commit?.source_models ?? null;
  const models = existsSync(join(dir, "source-models.json")) ? readJson("source-models.json") : null;
  if (committedRoster || models) {
    check(
      JSON.stringify(models) === JSON.stringify(committedRoster),
      `source-model roster matches the one committed at cycle start (${models?.length ?? 0} models)`,
      !committedRoster
        ? "source-models.json is published but no roster was committed in commit.json before the run"
        : !models
          ? "commit.json commits to a source-model roster but source-models.json is missing"
          : "source-models.json is not the roster committed in commit.json",
    );
  }

  // --- 2. Selection -------------------------------------------------------
  const templates = readJson("templates.json");
  const banks = readJson("banks.json");
  const prompts = readJson("prompts.json");
  if (nonce && templates && banks && prompts) {
    const selector = join(dir, "select-placeholders.js");
    if (!existsSync(selector)) {
      bad("select-placeholders.js is missing from the cycle");
    } else {
      // The selector is the cycle's own file, so a broken one must fail this
      // cycle rather than stop the whole verification run.
      let rederived = null;
      try {
        const { selectPlaceholders } = await import(pathToFileURL(selector).href);
        rederived = selectPlaceholders(nonce, templates, banks, prompts.length, models ?? undefined);
      } catch (err) {
        bad(`select-placeholders.js could not re-derive the prompts: ${err.message}`);
      }
      if (rederived) {
        // The category and template are compared as well as the prompt text:
        // the scorer groups by category, so a prompt filed under a different
        // one would move a tool's consistency score.
        const i = prompts.findIndex(
          (p, n) =>
            p.prompt !== rederived[n]?.prompt ||
            (p.source_model ?? null) !== (rederived[n]?.model ?? null) ||
            p.category !== rederived[n]?.category ||
            p.template_slug !== rederived[n]?.templateSlug,
        );
        check(
          i === -1,
          `all ${prompts.length} prompts${models ? " and their model assignments" : ""} re-derive from the nonce`,
          i === -1
            ? ""
            : `prompt ${i} does not re-derive\n      published  ${prompts[i].prompt}  [${prompts[i].category}, ${prompts[i].source_model ?? "no model"}]\n      re-derived ${rederived[i]?.prompt}  [${rederived[i]?.category}, ${rederived[i]?.model ?? "no model"}]`,
        );
      }
    }
  }

  // Read once here: the remaining checks all draw on these, and the provenance
  // check below needs them before the scoring section would otherwise load them.
  const tests = readJson("tests.json");
  const samples = readJson("samples.json");
  const detectorScores = readJson("detector-scores.json");
  const leaderboard = readJson("leaderboard.json");

  // --- 3. Provenance ------------------------------------------------------
  // Links the committed prompts to the texts the tools actually saw. Without
  // it there is a break in the chain: prompts could be committed honestly and
  // the corpus then written from different, easier prompts, or the tools fed
  // something other than the published samples. Every other check would still
  // pass, because each is internally consistent with the file below it.
  if (prompts && samples && tests) {
    const promptBySample = new Map(prompts.map((p) => [p.sample_id, p]));
    const sampleById = new Map(samples.map((s) => [s.id, s]));
    const broken = [];

    // One sample per committed prompt, no more and no fewer. A prompt with no
    // sample is a text quietly left out of the cycle; a repeated id is a text
    // counted twice.
    if (sampleById.size !== samples.length) broken.push(`samples.json repeats a sample id`);
    if (promptBySample.size !== prompts.length) broken.push(`prompts.json repeats a sample id`);
    for (const p of prompts) {
      if (!sampleById.has(p.sample_id)) broken.push(`prompt ${p.sample_id}: committed, but no sample was published for it`);
    }

    for (const s of samples) {
      const p = promptBySample.get(s.id);
      if (!p) {
        broken.push(`sample ${s.id}: no committed prompt with this id`);
        continue;
      }
      if (s.prompt !== p.prompt) broken.push(`sample ${s.id}: written from a different prompt than the one committed`);
      if ((s.source_model ?? null) !== (p.source_model ?? null)) {
        broken.push(`sample ${s.id}: written by ${s.source_model ?? "no recorded model"}, but the nonce assigns ${p.source_model ?? "none"}`);
      }
      if (s.category !== p.category) broken.push(`sample ${s.id}: category ${s.category} but the prompt says ${p.category}`);
      if ((s.templateSlug ?? null) !== (p.template_slug ?? null)) {
        broken.push(`sample ${s.id}: template ${s.templateSlug} but the prompt says ${p.template_slug}`);
      }
    }

    for (const t of tests) {
      const s = sampleById.get(t.sample_id);
      if (!s) {
        broken.push(`${t.test_id}: references unknown sample ${t.sample_id}`);
        continue;
      }
      if (t.input !== s.text) broken.push(`${t.test_id}: input is not the published sample text`);
      if (t.prompt !== s.prompt) broken.push(`${t.test_id}: prompt differs from its sample's prompt`);
      // The scorer reads the category off the test row, so it has to be the
      // sample's: relabelling rows would change a tool's consistency score.
      if (t.category !== s.category) broken.push(`${t.test_id}: category ${t.category}, but its sample is ${s.category}`);
      // The source model is repeated on every test row so results can be
      // sliced without a join; the copies must agree with the sample.
      if ((t.source_model ?? null) !== (s.source_model ?? null)) {
        broken.push(`${t.test_id}: source_model differs from its sample's`);
      }
    }

    check(
      broken.length === 0,
      `every sample traces to a committed prompt, and every test to a published sample`,
      `the chain from committed prompts to tested inputs is broken:\n      ${broken.slice(0, 8).join("\n      ")}`,
    );
  }

  // --- 4. Scoring ---------------------------------------------------------
  if (tests && detectorScores && leaderboard) {
    const scorer = join(dir, "scoring.js");
    if (!existsSync(scorer)) {
      bad("scoring.js is missing from the cycle");
    } else {
      const { computeLeaderboard } = await import(pathToFileURL(scorer).href);
      const recomputed = computeLeaderboard(tests, detectorScores);
      const bySlug = new Map(recomputed.map((e) => [e.slug, e]));

      // Every field the scorer derives is compared, not just the headline
      // scores. perDetector and perCategory drive the breakdowns shown on the
      // site, and penalties change the composite — checking only the top-level
      // numbers would let a fabricated breakdown through beside a correct
      // composite.
      //
      // settings_used and plan_tier_used are recorded by the runner and cannot
      // be derived from the published rows, so they are the only exclusions.
      const RUNNER_RECORDED = new Set(["settings_used", "plan_tier_used"]);
      const diffs = [];
      for (const published of leaderboard.results) {
        const mine = bySlug.get(published.slug);
        if (!mine) {
          diffs.push(`${published.slug}: not produced by the published scorer`);
          continue;
        }
        // Union of both key sets, so a field invented in the published file is
        // caught as readily as a missing one.
        const keys = [...new Set([...Object.keys(mine), ...Object.keys(published)])];
        for (const k of keys) {
          if (RUNNER_RECORDED.has(k)) continue;
          diffField(`${published.slug}.${k}`, mine[k], published[k], diffs);
        }
      }
      // The ranking itself is recomputed too: which tools are ranked, and in
      // what order. Rank is read from position in this list by everything
      // downstream, so a reordered or shortened list with correct numbers in
      // it would otherwise pass.
      const rankedMine = recomputed.filter((e) => !e.unavailable).map((e) => e.slug);
      const rankedPublished = leaderboard.results.map((r) => r.slug);
      if (JSON.stringify(rankedMine) !== JSON.stringify(rankedPublished)) {
        diffs.push(`ranking: published ${rankedPublished.join(" > ")}, recomputed ${rankedMine.join(" > ")}`);
      }
      // The version stamps and cycle id are what a reader uses to decide
      // whether two cycles are comparable, so they must be the bundle's own.
      if (leaderboard.cycle_id !== commit?.cycle_id) {
        diffs.push(`cycle_id: leaderboard says ${leaderboard.cycle_id}, the commitment says ${commit?.cycle_id}`);
      }
      check(
        diffs.length === 0,
        `leaderboard recomputes for all ${leaderboard.results.length} tools, every field and the ranking order (tolerance ${TOLERANCE})`,
        `leaderboard does not recompute:\n      ${diffs.slice(0, 8).join("\n      ")}`,
      );

      // Exclusion is the scorer's decision, not a list that can be edited: the
      // excluded tools must be exactly the ones the scorer marks unavailable,
      // with the attempt counts it derives, and none may also appear ranked.
      const excluded = new Set((leaderboard.excluded ?? []).map((e) => e.slug));
      const both = leaderboard.results.filter((r) => excluded.has(r.slug)).map((r) => r.slug);
      const exclusionDiffs = [];
      for (const mine of recomputed.filter((e) => e.unavailable)) {
        const published = (leaderboard.excluded ?? []).find((e) => e.slug === mine.slug);
        if (!published) exclusionDiffs.push(`${mine.slug}: unavailable by the scorer, but not listed as excluded`);
        else diffField(`${mine.slug}.attempts`, mine.attempts, published.attempts, exclusionDiffs);
      }
      for (const slug of excluded) {
        if (!recomputed.some((e) => e.slug === slug && e.unavailable)) {
          exclusionDiffs.push(`${slug}: listed as excluded, but the scorer does not mark it unavailable`);
        }
      }
      check(
        both.length === 0 && exclusionDiffs.length === 0,
        `${excluded.size} tool(s) excluded for unavailability, none double-counted`,
        both.length
          ? `tools appear in both results and excluded: ${both.join(", ")}`
          : `the excluded list is not the scorer's:\n      ${exclusionDiffs.slice(0, 8).join("\n      ")}`,
      );
    }
  }

  // --- 5. Completeness ----------------------------------------------------
  // Every humanizer must face every sample, and every resulting test must be
  // scored by every detector the cycle claims to use. Without this, quietly
  // dropping the rows where a favoured tool did badly would still recompute
  // cleanly: the scorer would just average what remains.
  //
  // This is derived from the data rather than compared against a declared
  // count, so it cannot be satisfied by editing the count to match.
  if (tests && detectorScores && leaderboard && samples) {
    const humanizers = [...new Set(tests.map((t) => t.humanizer))].sort();
    const sampleIds = samples.map((s) => s.id);
    const seen = new Set(tests.map((t) => `${t.humanizer} ${t.sample_id}`));

    const missing = [];
    for (const h of humanizers) {
      for (const s of sampleIds) {
        if (!seen.has(`${h} ${s}`)) missing.push(`${h} × ${s}`);
      }
    }
    const expected = humanizers.length * sampleIds.length;
    check(
      missing.length === 0 && tests.length === expected,
      `every humanizer faced every sample (${humanizers.length} × ${sampleIds.length} = ${expected} tests)`,
      missing.length
        ? `${missing.length} humanizer/sample pair(s) missing from tests.json:\n      ${missing.slice(0, 8).join("\n      ")}`
        : `tests.json has ${tests.length} rows but the ${humanizers.length}×${sampleIds.length} grid needs ${expected}`,
    );

    // Duplicate test_ids would let a row be counted twice.
    const ids = tests.map((t) => t.test_id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    check(
      dupes.length === 0,
      `all ${ids.length} test ids are unique`,
      `duplicate test ids: ${dupes.slice(0, 8).join(", ")}`,
    );

    const scoredIds = new Set(detectorScores.map((r) => r.test_id));
    const unscored = ids.filter((id) => !scoredIds.has(id));
    const declared = leaderboard.detectors ?? [];
    const shortRows = detectorScores
      .filter((r) => declared.some((d) => !(d in r.scores)))
      .map((r) => r.test_id);

    // Every detector must have an entry on every test, and an entry is one of
    // three outcomes: a human-probability in [0, 1]; null, where the detector
    // has no verdict for that text; or "error", where no verdict could be
    // obtained — the detector could not be reached, or the humanizer returned
    // nothing to send it. An error is a recorded outcome, not a missing row:
    // it is published and counted here so it cannot pass unnoticed, and the
    // scorer leaves it out of that test's median.
    const isOutcome = (v) => v === null || v === "error" || (typeof v === "number" && v >= 0 && v <= 1);
    const invalid = [];
    let errors = 0;
    const gapsByTool = new Map(); // humanizer -> verdicts that are not a number
    for (const r of detectorScores) {
      for (const [name, value] of Object.entries(r.scores ?? {})) {
        if (!isOutcome(value)) invalid.push(`${r.test_id} ${name}=${JSON.stringify(value)}`);
        // A detector nobody declared would be scored without being listed.
        if (!declared.includes(name)) invalid.push(`${r.test_id}: undeclared detector ${name}`);
        if (value === "error") errors++;
        if (typeof value !== "number") gapsByTool.set(r.humanizer, (gapsByTool.get(r.humanizer) ?? 0) + 1);
      }
    }
    if (declared.length === 0) invalid.push("leaderboard.json declares no detectors");
    // Where the missing verdicts fall is printed, not judged: a tool scored on
    // fewer verdicts than the rest is something a reader should be able to see.
    const gaps = [...gapsByTool].sort().map(([tool, n]) => `${tool} ${n}`).join(", ");
    // A test whose humanizer call failed has no output, so no detector can
    // have scored it: anything but "error" there would be an invented verdict.
    const statusById = new Map(tests.map((t) => [`${t.humanizer}::${t.test_id}`, t.status]));
    const scoredWithoutOutput = detectorScores
      .filter((r) => statusById.get(`${r.humanizer}::${r.test_id}`) === "error")
      .filter((r) => Object.values(r.scores ?? {}).some((v) => v !== "error"))
      .map((r) => r.test_id);

    check(
      unscored.length === 0 && shortRows.length === 0 && invalid.length === 0 && scoredWithoutOutput.length === 0,
      gaps === ""
        ? `every test scored by all ${declared.length} detectors`
        : `every test has an outcome from all ${declared.length} detectors (${errors} recorded as "error"; verdicts without a score, by tool: ${gaps})`,
      unscored.length
        ? `${unscored.length} test(s) have no detector scores: ${unscored.slice(0, 6).join(", ")}`
        : shortRows.length
          ? `${shortRows.length} test(s) missing a declared detector: ${shortRows.slice(0, 6).join(", ")}`
          : invalid.length
            ? `${invalid.length} detector value(s) are not a probability, null or "error": ${invalid.slice(0, 6).join(", ")}`
            : `${scoredWithoutOutput.length} test(s) with no humanizer output carry a detector verdict: ${scoredWithoutOutput.slice(0, 6).join(", ")}`,
    );
  }

  // --- 5b. Derived files ---------------------------------------------------
  // results.jsonl and the per-tool files under data/ repeat what tests.json and
  // detector-scores.json already say, in the shapes people actually download.
  // They are not what the scorer reads, so without this they could say anything
  // while every check above passed.
  if (tests && detectorScores && leaderboard && samples) {
    const problems = [];
    const readLines = (rel) => {
      const path = join(dir, rel);
      if (!existsSync(path)) {
        problems.push(`${rel}: missing`);
        return null;
      }
      try {
        return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch (err) {
        problems.push(`${rel}: not valid JSON lines (${err.message})`);
        return null;
      }
    };
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const key = (humanizer, testId) => `${humanizer}::${testId}`;
    const testByKey = new Map(tests.map((t) => [key(t.humanizer, t.test_id), t]));
    const scoresByKey = new Map(detectorScores.map((r) => [key(r.humanizer, r.test_id), r.scores ?? {}]));
    const sampleById = new Map(samples.map((s) => [s.id, s]));
    const rankedBySlug = new Map(leaderboard.results.map((r) => [r.slug, r]));

    const rows = readLines("results.jsonl");
    if (rows) {
      if (rows.length !== tests.length) problems.push(`results.jsonl: ${rows.length} rows, but tests.json has ${tests.length}`);
      for (const row of rows) {
        const t = testByKey.get(key(row.humanizer, row.test_id));
        if (!t) {
          problems.push(`results.jsonl: ${row.test_id} is not in tests.json`);
          continue;
        }
        const wrong = [];
        for (const f of ["category", "prompt", "input", "output", "meaning_preservation", "readability", "status", "source_model"]) {
          if (!same(row[f], t[f])) wrong.push(f);
        }
        if (!same(row.template_slug, sampleById.get(t.sample_id)?.templateSlug)) wrong.push("template_slug");
        for (const f of ["cycle_id", "methodology_version", "scoring_version", "prompt_set_version"]) {
          if (!same(row[f], leaderboard[f])) wrong.push(f);
        }
        const scores = scoresByKey.get(key(row.humanizer, row.test_id)) ?? {};
        const listed = Object.fromEntries((row.detectors ?? []).map((d) => [d.name, d.human_prob]));
        if (!same(listed, scores) || (row.detectors ?? []).length !== Object.keys(scores).length) wrong.push("detectors");
        // Settings are recorded per ranked tool; an excluded tool has none to compare.
        const ranked = rankedBySlug.get(row.humanizer);
        if (ranked) {
          for (const f of ["settings_used", "plan_tier_used"]) if (!same(row[f], ranked[f])) wrong.push(f);
        }
        if (wrong.length) problems.push(`results.jsonl ${row.test_id}: ${wrong.join(", ")} differ from the scored data`);
      }
    }

    const humanizers = [...new Set(tests.map((t) => t.humanizer))];
    const declared = leaderboard.detectors ?? [];
    for (const slug of humanizers) {
      const lines = readLines(`data/${slug}.jsonl`);
      if (lines && !same(lines, tests.filter((t) => t.humanizer === slug))) {
        problems.push(`data/${slug}.jsonl: rows differ from tests.json`);
      }
    }
    for (const id of declared) {
      const lines = readLines(`data/${id}.jsonl`);
      const expected = detectorScores
        .filter((r) => id in (r.scores ?? {}))
        .map((r) => ({
          test_id: r.test_id,
          humanizer: r.humanizer,
          input: testByKey.get(key(r.humanizer, r.test_id))?.output ?? null,
          score: r.scores[id],
        }));
      if (lines && !same(lines, expected)) problems.push(`data/${id}.jsonl: rows differ from detector-scores.json`);
    }
    // A file for a tool or detector that is not in this cycle is a leftover.
    const expectedFiles = new Set([...humanizers, ...declared].map((n) => `${n}.jsonl`));
    const dataDir = join(dir, "data");
    const extra = existsSync(dataDir) ? readdirSync(dataDir).filter((f) => !expectedFiles.has(f)) : [];
    for (const f of extra) problems.push(`data/${f}: no such humanizer or detector in this cycle`);

    check(
      problems.length === 0,
      `results.jsonl and ${expectedFiles.size} per-tool files match the scored data`,
      `derived files do not match tests.json / detector-scores.json:\n      ${problems.slice(0, 8).join("\n      ")}`,
    );
  }

  // --- 6. Integrity -------------------------------------------------------
  if (existsSync(join(dir, "manifest.json"))) {
    const manifest = readJson("manifest.json");
    if (manifest) {
      const recorded = new Map(manifest.files.map((f) => [f.path, f.sha256]));
      const onDisk = walk(dir).filter((p) => p !== "manifest.json" && p !== "manifest.json.ots");
      const badFiles = [];
      for (const path of onDisk) {
        const expected = recorded.get(path);
        if (!expected) badFiles.push(`${path}: present but not in manifest`);
        else if (sha256(readFileSync(join(dir, path))) !== expected) badFiles.push(`${path}: hash differs`);
      }
      for (const path of recorded.keys()) {
        if (!onDisk.includes(path)) badFiles.push(`${path}: in manifest but missing`);
      }
      // The root hash is the single value that gets quoted and timestamped, so
      // it is recomputed rather than trusted: sha256 over the sorted
      // "sha256  path" lines, exactly as the manifest was built.
      const root = sha256(
        [...manifest.files]
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
          .map((f) => `${f.sha256}  ${f.path}`)
          .join("\n"),
      );
      if (root !== manifest.bundle_sha256) badFiles.push(`bundle_sha256: recorded ${manifest.bundle_sha256}, recomputed ${root}`);
      if (leaderboard && manifest.cycle_id !== leaderboard.cycle_id) {
        badFiles.push(`manifest is for cycle ${manifest.cycle_id}, the leaderboard for ${leaderboard.cycle_id}`);
      }
      check(
        badFiles.length === 0,
        `all ${recorded.size} files match manifest.json, and its root hash recomputes (${root.slice(0, 16)}…)`,
        `bundle does not match its manifest:\n      ${badFiles.slice(0, 8).join("\n      ")}`,
      );
    }
  } else {
    // A revealed cycle without a manifest has nothing pinning its files, so
    // "has anything changed since publication" would have no answer.
    bad("manifest.json is missing — nothing pins this cycle's files");
  }

  return failures;
}

// Direct invocation: node scripts/verify-cycle.js <dir>
if (process.argv[1] && basename(process.argv[1]) === "verify-cycle.js") {
  const dir = resolve(process.argv[2] ?? "");
  if (!process.argv[2] || !existsSync(dir)) {
    console.error("usage: node scripts/verify-cycle.js <path-to-cycle-directory>");
    process.exit(2);
  }
  console.log(`\nVerifying ${relative(process.cwd(), dir) || dir}\n`);
  const failures = await verifyCycle(dir);
  if (failures > 0) {
    console.log(`\n\x1b[31mFAILED\x1b[0m — ${failures} check(s) did not pass.\n`);
    process.exit(1);
  }
  console.log(`\n\x1b[32mVerified.\x1b[0m\n`);
}
