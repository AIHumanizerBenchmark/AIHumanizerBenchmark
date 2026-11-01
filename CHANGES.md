# Cycle changelog

One entry per published cycle, recording which version stamps moved and why.

Three version stamps travel with every cycle in `leaderboard.json`:

- **`methodology_version`** — how tools are selected, run, and measured
- **`scoring_version`** — the formula that turns per-test rows into a composite
- **`prompt_set_version`** — the templates and value banks prompts are drawn from

The point of recording these is that scores are only comparable across cycles
when the stamps match. If a tool's composite moves between two cycles with
identical stamps, the tool changed. If the stamps moved too, some of the
difference is us, and this file says how much.

Changing the scoring formula does not retroactively change old cycles. Each
cycle carries the `scoring.js` that produced it, and `npm run verify` checks
every cycle against its own scorer. An old cycle continues to verify under the
rules it was scored under.

Cycles are never edited after publication. If a published result turns out to
be wrong, the correction is a new entry here and a note on the affected cycle —
never a quiet edit.

---

## November 2026

- `methodology_version` **1.1.0 → 1.2.0**
- `scoring_version` **1.0.1** (unchanged)
- `prompt_set_version` **1.0.0** (unchanged)

**Methodology 1.2.0.**

- The detector panel changed: Pangram joined and Winston AI left. The panel
  is GPTZero, Originality.ai, Copyleaks, Pangram, ZeroGPT, QuillBot and
  Grammarly. Earlier cycles keep the panel they were scored with.
- Originality.ai verdicts come from its 5.0 model.
- Detector verdicts are recorded to the nearest percent, except ZeroGPT's.
- Rephrasy joined the humanizer roster. WriteHuman and AIHumanize could not
  be exercised this cycle, their endpoints having changed, and are not in it.
  The roster is ten tools.

**Data.** The grouped files stand on their own: each `data/<tool>.jsonl` row
carries `cycle_id`, `settings_used`, `plan_tier_used` and `detectors`, and
each `data/<detector>.jsonl` row carries `cycle_id` and `detector`.
`leaderboard.json` names the readability and embedding models as
`readability_model` and `embedding_model`. GPTinf's `settings_used` no longer
includes the vendor's model preset name.

## October 2026

- `methodology_version` **1.0.0 → 1.1.0**
- `scoring_version` **1.0.0 → 1.0.1**
- `prompt_set_version` **1.0.0** (unchanged)

**Methodology 1.1.0 — scores are not comparable with September.**

- Source texts are now written by six models from three providers instead of
  one. The roster is published in `commit.json` before the run and as
  `source-models.json` in the bundle. The cycle nonce decides which model
  writes which prompt, and every sample and test row records it as
  `source_model`.
- The 33 prompts are drawn as before: same templates, same value banks, three
  texts per template. Each provider writes 11 of them.
- Every tool is recorded as `plan_tier_used: "default"`: each is run
  through API calls on its default settings.

Scores are not comparable with September: the source texts changed, and the
detectors themselves change over time.

**Scoring 1.0.1 — comparable.** The composite is published to two decimals
instead of one. The formula is unchanged.

## September 2026

The first published cycle. All three stamps start here:

- `methodology_version` **1.0.0**
- `scoring_version` **1.0.0**
- `prompt_set_version` **1.0.0**

Nothing moved, because there is no earlier cycle to move from. This cycle is
the baseline later ones are compared against; when a stamp changes, the entry
above this one will say which, and what it means for comparability.
