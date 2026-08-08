---
title: The DSL smoke sweep's skip reasons claim a per-card test nothing verifies exists
discoveredBy: 2363
status: draft
confidence: high
---

**What is wrong.** `convex/gre/effects/scenarioGenerator.ts` reports an
un-scenarioizable Effect Script as an explicit skip with a reason, and most of
those reasons are a **coverage claim about a different file**:

- `Op "counter" targets a spell on the stack — covered by the card's own resolution test`
- `Op "mayPay" suspends for a Pay/Skip decision — covered by the card's own suspension/resume tests`
- `Op "pump" targets $source/$each — covered by the card's own per-card test`

Nothing checks that the named test exists. `.claude/rules/gre-development.md`
is explicit that an un-scenarioizable skip "is the signal to hand-write a test
after all", but the signal is printed to `console.info` inside a passing test
and read by nobody. A card can be skipped by the sweep, have no per-card test,
and read as covered in every artefact the loop produces.

**Evidence.** Measured on the #2363 branch. `effectScriptSmoke` reports
`334 ran, 941 skipped`. Cross-referencing the skipped sites against cards with
no test reference anywhere in the repo: **30 cards** whose ONLY DSL sites are
skipped had zero behaviour coverage, including four whose skip reason names a
resolution test that does not exist — Deathgrip, Order of the Sacred Torch,
Force of Negation, Remove Soul (`Op "counter" … covered by the card's own
resolution test`). The same shape holds for the mana sweep added in #2363: it
skips `manaChoices` abilities by design, and 12 cards were left with that as
their only claimed coverage.

Reproduce with `planSmokeTest` over `getAllCards()`: for each card, if every
DSL site returns `{ kind: "skip" }`, grep the repo's test files for the card's
id / symbol / quoted name.

**Why it may not deserve its own issue.** The cheap fix — assert in
`effectScriptSmoke.test.ts` that every fully-skipped card has at least one test
reference — needs a definition of "has a test" that does not itself become a
tautology (a registry-parity block listing the card's name is a reference and
proves nothing; #2363 found several). That is the same design problem as the
identity classifier, so it is arguably one job, not two. The counter-argument
for ticketing it: the skip reasons are written in the present tense about a
file that may never have existed, which makes them actively misleading to the
next reader, and rewording them costs nothing.
