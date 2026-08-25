---
title: exile-from-graveyard-cost.test.ts re-implements game.ts instead of calling it
discoveredBy: 2232
status: draft
confidence: medium
---

**What is wrong.** The integration test for the `cost.exileFromGraveyard`
activation cost hand-copies the mutation's legality gate, its
`PendingActivation` construction and its commit step as local functions, then
asserts against those copies. That is shape 3 of the proof-of-failure
taxonomy (`.claude/rules/gre-development.md`): the test never reaches the code
it is named after, so a divergence introduced in `game.ts` cannot make it red.

**Evidence.** `convex/gre/__tests__/exile-from-graveyard-cost.test.ts` — local
`canPayExileFromGraveyard`, `activateWithExileCost` (a hand-built
`PendingActivation` literal) and `commitActivation`, all mirroring
`convex/game.ts`. Concretely: #2232 added a snapshot capture to the real
`tryAutoCommitPendingActivation` commit block, and this file stayed green
without ever executing the changed line. The file's own header says the mirror
is deliberate ("the project has no convex-test harness"), but that premise is
stale — `activateAbilityOnState`, `selectActivationExileCostOnState`,
`buildPendingActivation` and `tryAutoCommitPendingActivation` are all exported
from `convex/game.ts` and are what #2232's own tests call.

**Why it may not deserve its own issue.** It is a test-quality cleanup with no
user-visible behaviour behind it, and the real paths ARE now covered by the
tests added in #2232 (`convex/gre/__tests__/exileThisActivationCost.test.ts`,
the Necropolis block in `convex/cards/sets/drk/__tests__/colorless.test.ts`) —
so the mirror is redundant rather than dangerous. It may be worth folding into
a broader "tests that mirror game.ts" sweep instead of ticketing alone;
`sacrifice-cost-activation.test.ts` is named in the same header as a second
instance.
