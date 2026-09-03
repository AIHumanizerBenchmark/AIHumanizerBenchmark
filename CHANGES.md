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

<!-- No cycles published yet. The first entry lands here when cycle one closes. -->
