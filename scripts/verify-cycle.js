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
// Six independent checks:
//
//   1. Commitment   — the revealed nonce hashes to the value published before
//                     the run, so prompt selection could not have been steered
//                     after seeing which tools it favoured.
//   2. Selection    — feeding that nonce through the frozen algorithm
//                     reproduces the published prompts exactly.
//   3. Provenance   — each sample was written from a committed prompt, and each
//                     test fed a tool the published sample verbatim.
//   4. Scoring      — the frozen scorer, over the published per-test rows,
//                     reproduces the published leaderboard within 1e-4, every
//                     field included.
//   5. Completeness — every humanizer faced every sample and every test was
//                     scored by every detector, so no inconvenient rows were
//                     dropped before the averaging.
//   6. Integrity    — every file matches the hash recorded in manifest.json.
//
// Together they form a chain: nonce -> prompts -> samples -> tests -> scores ->
// leaderboard. Each check ties one link to the next, which is the point — every
// individual file can be internally consistent while the chain between them is
// broken. Editing a score breaks (4) and (6) but not (1); swapping the nonce
// breaks (1) and (2) but not (4); rewriting the corpus from easier prompts
// breaks only (3); deleting rows breaks (5) even though what remains averages
// cleanly. No single edit satisfies all six.

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
 * @returns {Promise<number>} number of failed checks; 0 means verified.
 */
export async function verifyCycle(dir) {
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
  if (!existsSync(noncePath)) {
    bad("nonce.txt is missing — the cycle has been committed but not revealed");
  } else if (commit) {
    nonce = readFileSync(noncePath, "utf8").trim();
    const actual = sha256(nonce);
    check(
      actual === commit.nonce_sha256,
      `nonce matches the commitment published at cycle start (${actual.slice(0, 16)}…)`,
      `nonce does NOT match the commitment\n      committed ${commit.nonce_sha256}\n      actual    ${actual}`,
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
      const { selectPlaceholders } = await import(pathToFileURL(selector).href);
      const rederived = selectPlaceholders(nonce, templates, banks, prompts.length);
      const i = prompts.findIndex((p, n) => p.prompt !== rederived[n]?.prompt);
      check(
        i === -1,
        `all ${prompts.length} prompts re-derive from the nonce`,
        i === -1
          ? ""
          : `prompt ${i} does not re-derive\n      published  ${prompts[i].prompt}\n      re-derived ${rederived[i]?.prompt}`,
      );
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

    for (const s of samples) {
      const p = promptBySample.get(s.id);
      if (!p) {
        broken.push(`sample ${s.id}: no committed prompt with this id`);
        continue;
      }
      if (s.prompt !== p.prompt) broken.push(`sample ${s.id}: written from a different prompt than the one committed`);
      if (s.category !== p.category) broken.push(`sample ${s.id}: category ${s.category} but the prompt says ${p.category}`);
    }

    for (const t of tests) {
      const s = sampleById.get(t.sample_id);
      if (!s) {
        broken.push(`${t.test_id}: references unknown sample ${t.sample_id}`);
        continue;
      }
      if (t.input !== s.text) broken.push(`${t.test_id}: input is not the published sample text`);
      if (t.prompt !== s.prompt) broken.push(`${t.test_id}: prompt differs from its sample's prompt`);
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
      check(
        diffs.length === 0,
        `leaderboard recomputes for all ${leaderboard.results.length} tools, every field (tolerance ${TOLERANCE})`,
        `leaderboard does not recompute:\n      ${diffs.slice(0, 8).join("\n      ")}`,
      );

      // A tool excluded for unavailability must not also appear ranked.
      const excluded = new Set((leaderboard.excluded ?? []).map((e) => e.slug));
      const both = leaderboard.results.filter((r) => excluded.has(r.slug)).map((r) => r.slug);
      check(
        both.length === 0,
        `${excluded.size} tool(s) excluded for unavailability, none double-counted`,
        `tools appear in both results and excluded: ${both.join(", ")}`,
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
    check(
      unscored.length === 0 && shortRows.length === 0,
      `every test scored by all ${declared.length} detectors`,
      unscored.length
        ? `${unscored.length} test(s) have no detector scores: ${unscored.slice(0, 6).join(", ")}`
        : `${shortRows.length} test(s) missing a declared detector: ${shortRows.slice(0, 6).join(", ")}`,
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
      check(
        badFiles.length === 0,
        `all ${recorded.size} files match manifest.json`,
        `bundle does not match its manifest:\n      ${badFiles.slice(0, 8).join("\n      ")}`,
      );
    }
  } else {
    console.log("  \x1b[33m-\x1b[0m manifest.json absent — skipping integrity check");
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
