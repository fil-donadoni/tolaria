---
title: Identity classifier flags domain pins — a constant a sibling test iterates
discoveredBy: 4490
status: draft
confidence: medium
---

**What is wrong.** The identity-test classifier (`scripts/lib/identity-test-classifier.ts`)
flags a block that pins a constant against a literal as identity — the
definition written twice. Five of the 62 blocks the purge (PR #4657) deleted on
that verdict were _domain pins_: the constant is the iteration domain of a
sibling `it.each` / `for … of` in the same file (`AMOUNT_KEYS`,
`V3_TOKEN_GROUPS`, `FLOORS`) or of a gate (`brokenFloors` over `FLOORS`), or a
partition `tsc` keeps total but cannot keep right (`NON_ZONE_CANDIDATE_SOURCE`,
the `structural` rows of `ROOT_RULE_ALLOWLIST`). Without the pin, an entry
dropped from the constant shrinks the sibling's sweep silently — the same
failure a stale allow-list entry hides. The review of PR #4657 caught them;
they were restored and allow-listed by name with a `Domain pin:` / `Partition
check:` reason.

**Evidence.** `scripts/lib/identity-test-allowlist.json`, the five entries whose
reason starts `Domain pin` or `Partition check`; the deleted blocks are in
PR #4657's review table, rows for `effectFieldKeySets.test.ts:153`,
`rootRuleMoratorium.bot.test.ts:62`, `nonZoneChoiceCandidates.bot.test.ts:30`,
`ui-gate-floors.test.ts:76`, `design-tokens.test.ts:265`.

**What a fix looks like.** A classifier rule, not more allow-list rows: a block
whose only asserted identifier is a constant that another block in the same file
iterates (`it.each(X)`, `for (… of X)`, `X.map/forEach`) is a domain pin and
clears the identity verdict (or lands in its own reported class). The allow-list
then loses those five entries. The rule needs the proof-of-failure pair the
classifier's tests use: a pin with an iterating sibling clears, the same pin
alone is still identity.

**Why it may not deserve its own issue.** Five entries in a 202-row allow-list,
each with a reason a reader can check; the census on `health`
(`check:test-hygiene`) already reports the next one with its `file:line`. It is a
line on the classifier's lineage (PRD #4481) unless the class keeps growing.
