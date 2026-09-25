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

## September 2026

The first published cycle. All three stamps start here:

- `methodology_version` **1.0.0**
- `scoring_version` **1.0.0**
- `prompt_set_version` **1.0.0**

Nothing moved, because there is no earlier cycle to move from. This cycle is
the baseline later ones are compared against; when a stamp changes, the entry
above this one will say which, and what it means for comparability.
