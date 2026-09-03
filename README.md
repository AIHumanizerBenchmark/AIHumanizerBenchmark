# AI Humanizer Benchmark: AI humanizer rankings and public audit record

[![verify](https://github.com/AIHumanizerBenchmark/AIHumanizerBenchmark/actions/workflows/verify.yml/badge.svg)](https://github.com/AIHumanizerBenchmark/AIHumanizerBenchmark/actions/workflows/verify.yml)

**AI humanizers, ranked by a monthly benchmark.** Every tool is run
automatically on its default settings over an identical set of AI-written
texts, and every output is scored by seven commercial AI detectors alongside
meaning preservation, readability, and consistency.

Every score at **[aihumanizerbenchmark.com](https://aihumanizerbenchmark.com)** comes from
this repository. It holds the raw data behind each monthly cycle, plus the exact
scoring code that produced the published leaderboard, so anyone can recompute
the rankings without trusting us. The badge above is this repository verifying
its own published data on every push.

<!-- RANKINGS:START -->
## AI humanizer rankings: September 2026

| # | AI humanizer | Score / 100 | Bypass | Meaning | Readability | Consistency | Penalty |
|--:|--------------|:-----------:|:------:|:-------:|:-----------:|:-----------:|:-------:|
| 1 | [UndetectedGPT](https://aihumanizerbenchmark.com/humanizers/undetectedgpt) | 84.90 | 86% | 85% | 77% | 91% | 0 |
| 2 | [SmartHumanizer](https://aihumanizerbenchmark.com/humanizers/smarthumanizer) | 84.80 | 85% | 88% | 76% | 88% | 0 |
| 3 | [WriteHuman](https://aihumanizerbenchmark.com/humanizers/writehuman) | 81.60 | 90% | 76% | 72% | 86% | -1.0 |
| 4 | [GPTinf](https://aihumanizerbenchmark.com/humanizers/gptinf) | 78.30 | 80% | 76% | 77% | 82% | 0 |
| 5 | [AI Humanize](https://aihumanizerbenchmark.com/humanizers/aihumanize) | 76.10 | 83% | 71% | 75% | 68% | 0 |
| 6 | [HIX Bypass](https://aihumanizerbenchmark.com/humanizers/hix-bypass) | 73.80 | 73% | 81% | 64% | 70% | 0 |
| 7 | [StealthGPT](https://aihumanizerbenchmark.com/humanizers/stealthgpt) | 71.90 | 75% | 70% | 83% | 78% | -3.0 |
| 8 | [SuperHumanizer](https://aihumanizerbenchmark.com/humanizers/superhumanizer) | 68.50 | 71% | 77% | 74% | 73% | -5.0 |
| 9 | [Clever AI Humanizer](https://aihumanizerbenchmark.com/humanizers/cleverhumanizer) | 66.80 | 87% | 65% | 73% | 89% | -11.0 |
| 10 | [ReHumanize](https://aihumanizerbenchmark.com/humanizers/rehumanize) | 39.00 | 4% | 59% | 81% | 95% | -4.0 |
| 11 | [Undetectable AI](https://aihumanizerbenchmark.com/humanizers/undetectable-ai) | 38.20 | 0% | 90% | 72% | 100% | -12.0 |

_Composite out of 100, weighting detector bypass 42%, meaning preservation 32%, readability 16%, and consistency across writing categories 10%; the four columns after the score are those sub-scores. Penalty is the total deducted for quality failures, already reflected in the score. Every tool ran automatically on its default settings over the same 33 texts, each scored by 7 AI detectors. Every number here is reproducible from the data in this repository — run `npm run verify`. Full per-detector breakdowns at [aihumanizerbenchmark.com/leaderboard](https://aihumanizerbenchmark.com/leaderboard)._
<!-- RANKINGS:END -->

## How a cycle is produced

1. **Commit.** A random 32-byte nonce is generated and only its SHA-256 is
   published, as `commit.json`, before anything runs. The nonce itself stays
   private until the cycle closes.
2. **Select.** That nonce seeds which values fill the prompt templates, so the
   prompt set is fixed before any tool sees it.
3. **Write the corpus.** One AI-written text per prompt. Every humanizer gets
   the identical set.
4. **Run.** Each tool is exercised automatically on its default settings.
5. **Score.** Every output goes to all seven detectors, alongside meaning
   preservation and readability.
6. **Publish.** The nonce is revealed, the full bundle is written, and
   `manifest.json` pins every file under one root hash.

The ordering is the point: the commitment is public before the run, so the
prompt set cannot be reselected after seeing which tools it favours.

## How to verify

```bash
git clone https://github.com/AIHumanizerBenchmark/AIHumanizerBenchmark.git
cd AIHumanizerBenchmark
npm run verify
```

No install step, no API keys, no network access. The verifier uses nothing but
Node's standard library — a verification tool whose dependencies you have to
trust doesn't verify much.

```
September 2026  ·  data/cycles/2026-09

  ✓ nonce matches the commitment published at cycle start (35c1ba911e66a88c…)
  ✓ all 33 prompts re-derive from the nonce
  ✓ every sample traces to a committed prompt, and every test to a published sample
  ✓ leaderboard recomputes for all 11 tools, every field (tolerance 0.0001)
  ✓ 0 tool(s) excluded for unavailability, none double-counted
  ✓ every humanizer faced every sample (11 × 33 = 363 tests)
  ✓ all 363 test ids are unique
  ✓ every test scored by all 7 detectors
  ✓ all 30 files match manifest.json

History  ·  data/humanizers

  ✓ 11 humanizer histories re-derive from 1 cycle(s)

README  ·  rankings table

  ✓ rankings table matches September 2026
```

Verify a single cycle with `npm run verify -- "September 2026"` (or
`-- 2026-09`). Any failed check exits non-zero.

## What gets checked

Six checks per cycle, tracing one chain — **nonce → prompts → samples → tests →
scores → leaderboard** — with each check tying one link to the next. Two more
run across the whole repository, covering the files derived from those cycles.

| Check | Question it answers |
| --- | --- |
| **Commitment** | Were the prompts fixed before the run? `sha256(nonce.txt)` must equal the `nonce_sha256` we published at cycle start, before any tool was called. |
| **Selection** | Do those prompts follow from that nonce? Re-running the frozen selection algorithm must reproduce `prompts.json` exactly. |
| **Provenance** | Were those prompts the ones actually used? Every sample must have been written from a committed prompt, and every test must have fed a tool the published sample verbatim. |
| **Scoring** | Do the published numbers follow from the published data? Re-running the frozen scorer over `tests.json` and `detector-scores.json` must reproduce every field of `leaderboard.json` within 1e-4 — breakdowns and penalties included, not just the headline scores. |
| **Completeness** | Is anything missing? Every humanizer must have faced every sample, every test id must be unique, and every test must carry a score from every detector. |
| **Integrity** | Has anything changed since publication? Every file must match its SHA-256 in `manifest.json`, which is itself covered by a single root hash. |
| **History** | Do the cross-cycle trends follow from the cycles? Regenerating `data/humanizers/` from every published leaderboard must reproduce the committed files byte for byte. |
| **README** | Does the table above match the data? Regenerating it from the latest cycle must reproduce what is committed here. |

The last three exist because a file can be internally consistent while the
chain around it is broken:

- Commit the nonce honestly, publish correct prompts, then write the corpus
  from *different, easier* prompts. Commitment and selection both pass, and the
  leaderboard recomputes perfectly. Only **provenance** catches it.
- Drop the rows where a tool did badly and rescore. The scorer just averages
  what's left, so the leaderboard recomputes exactly. Only **completeness**
  catches it — which is why it derives the expected grid from the data instead
  of trusting a stated count.
- Publish a real composite beside a fabricated per-detector breakdown. Only
  comparing **every** scorer-derived field catches it.

The commitment check is the one that matters most. Prompt selection is seeded by
a random nonce whose hash we publish *before* the cycle runs and whose value we
publish *after*. That ordering is what stops us from generating prompts,
noticing they flatter a particular tool, and quietly reselecting.

Note that verification runs against the `scoring.js` and `select-placeholders.js`
shipped **inside each cycle directory**, not a shared copy at the repo root. Each
cycle carries the code that actually scored it, so a cycle from a year ago still
verifies under the rules it was scored under, and changing today's scoring cannot
retroactively validate old data.

## Layout

```
data/cycles/2026-09/
  commit.json              nonce hash, published at cycle start
  nonce.txt                the nonce, published at cycle close
  templates.json           prompt templates, frozen
  banks.json               placeholder value banks, frozen
  prompts.json             the resolved prompts the nonce selected
  samples.json             the AI-written source texts fed to every humanizer
  tests.json               one row per test: input, output, meaning, readability
  detector-scores.json     per-test, per-detector scores
  leaderboard.json         the published rankings
  results.jsonl            all of the above joined, one line per test
  data/<tool>.jsonl        the same rows grouped by humanizer
  data/<detector>.jsonl    the same rows grouped by detector
  scoring.js               the scorer that produced leaderboard.json
  select-placeholders.js   the selection algorithm that produced prompts.json
  manifest.json            SHA-256 of every file above, under one root hash

data/humanizers/
  <tool>.json              one file per humanizer: rank, composite, sub-scores
                           and breakdowns for every cycle it appeared in
```

Two things here are derived rather than written: `data/humanizers/` and the
rankings table at the top of this README. Both regenerate from the cycles, and
`npm run verify` fails if either disagrees with a fresh regeneration — so a
stale trend or an out-of-date table is caught rather than left standing. The
table is the most-read thing in the repository, which is exactly why it is
generated instead of maintained by hand.

```bash
npm run build-history   # rebuild data/humanizers/ from every cycle
npm run build-readme    # rebuild the rankings table from the latest cycle
```

Run both after adding a cycle, in that order — the README caption reports
counts the history build does not touch, but the site imports history, so
building it first keeps every downstream copy consistent.

Every humanizer sees the identical set of source texts, so the comparison is
like-for-like. `results.jsonl` is the convenient single file for analysis; the
grouped files under `data/` are the same rows sliced by tool or by detector.

### Scoring in brief

The composite weights bypass rate 42%, meaning preservation 32%, readability
16%, and consistency 10%, then applies penalties. A tool that fails to return
output on at least half its attempts is marked unavailable and excluded from the
ranking rather than scored — a service being down is not evidence about its
quality. Full detail, including the penalty table, is on the
[methodology page](https://aihumanizerbenchmark.com/methodology), and the
authoritative version is always the `scoring.js` in the cycle you are looking at.

## What we publish, and what we don't

The benchmark runs from a separate private repository — corpus generation,
detector integrations, humanizer adapters, credentials. This repository is what
that produces: every prompt, every source text, every humanizer output, every
detector verdict, and a frozen copy of the scoring code, for each cycle.

That split is worth being plain about, because it sets what this repository can
and cannot prove. It cannot prove a number was never touched between a vendor's
API and the bundle. What it does prove is that everything downstream of the
bundle holds together: the prompts were fixed before the run, the corpus came
from those prompts, the tools saw those texts, and the rankings follow from the
scores — enough to re-derive the leaderboard from scratch rather than
spot-check it. The detectors are also publicly available, so any individual
verdict can be checked by pasting a published output into one.

Recomputation runs entirely off the published files, which is the practical
proof they're sufficient — the verifier has no access to anything else.

We don't publish the transport details of how the tools were called: no
request or response envelopes, no credentials, no per-tool timings or call
counts. Those say nothing about how a tool performed and publishing them mainly
helps vendors detect and special-case benchmark traffic, which would make the
next cycle less honest, not more. Every tool is exercised on its **default
settings**, unmodified.

## Corrections

If you believe a result is wrong, open an issue or use the
[dispute form](https://aihumanizerbenchmark.com/dispute). Point at the
`test_id`. Because every row ships with its input and output, disagreements can
usually be settled by looking at the data rather than by arguing about it.

Cycles are never edited after publication. Corrections land as a new cycle with
a note explaining what changed, recorded in [CHANGES.md](CHANGES.md) along with
any movement in the methodology, scoring, or prompt-set version stamps — scores
are only comparable across cycles when those stamps match.

To report a verifier bug or evidence of tampering, see
[SECURITY.md](SECURITY.md).

## License

Code — `scripts/`, and the `scoring.js` / `select-placeholders.js` in each
cycle — is MIT ([LICENSE](LICENSE)). Cycle data under `data/` is CC BY 4.0
([LICENSE-DATA](LICENSE-DATA)): use it freely, including commercially, with
attribution.

Scores describe how specific tools behaved against specific detectors on
specific dates. Both sides of this contest change constantly; an old cycle is a
historical record, not a claim about today.
