# Security and responsible disclosure

This repository is the audit record for the benchmark. The thing worth
protecting here is not a running service — it's whether the published numbers
can be trusted. Reports in three categories are in scope:

1. **Verifier bugs.** `scripts/verify-cycle.js` accepts a cycle it should
   reject, or rejects one that is actually valid. A verifier that passes
   tampered data is the most serious bug this project can have.
2. **Tampering evidence.** Signs that a published cycle was altered after
   release — file hashes that no longer match `manifest.json`, a bundle whose
   contents disagree with a timestamp anchor, or a `scoring.js` that doesn't
   match the methodology described for that cycle.
3. **Repository integrity.** Credentials committed by accident, malicious
   content in the data tree, or anything else that undermines the record.

## Reporting

Email **contact@aihumanizerbenchmark.com** with `[security]` in the subject.
Include the affected cycle, a minimal reproduction or chain of evidence, and
how you'd like to be credited (including "not at all").

You'll get an acknowledgement within three business days. We aim to fix or
publicly disclose within one cycle. If a report shows a published number is
wrong, we say so on the site and in `CHANGES.md` — we don't quietly correct
data, because a record that can be silently edited isn't a record.

For anything that isn't a security issue — a tool you think is ranked wrongly,
a stale entry, a typo — open a normal issue or use the
[dispute form](https://aihumanizerbenchmark.com/dispute). Those are welcome and
don't need private handling. Every published row ships with its input and
output, so most disagreements can be settled by pointing at a `test_id`.

## Out of scope

- Vulnerabilities in Node itself. Report those upstream; this repo has no other
  dependencies to report against.
- Vulnerabilities in the humanizers or detectors themselves. This repository is
  a record of how those products scored, not a channel to their engineering
  teams; report anything you find to the vendor concerned.

## No bounty

There's no paid bounty program. Credit is offered in `CHANGES.md` for anything
that changes a published result.
