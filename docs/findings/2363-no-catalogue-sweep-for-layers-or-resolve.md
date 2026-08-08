---
title: No catalogue-wide sweep exercises staticEffects layers or resolve() closures
discoveredBy: 2363
status: draft
confidence: medium
---

**What is wrong.** The per-card testing table leans on the catalogue regime to
cover cards with no hand-written test, and for two shapes that regime does not
exist. Effect Script cards get `effectScripts.test.ts` (static validation) plus
`effectScriptSmoke.test.ts` (a generated scenario through the real
`resolveTopOfStack`). Keywords get `mechanicsRegistry.test.ts` Guard A. But
**nothing catalogue-wide applies a `staticEffects[]` entry through the layer
system, and nothing catalogue-wide executes an imperative `resolve()` closure.**
Both shapes are covered only where a human happened to write a per-card test.

**Evidence.** Enumerated while triaging #2363's deletions:

- `convex/cards/__tests__/counterGatedStatics.test.ts` is the only
  `getAllCards()`-driven sweep touching `staticEffects[]`, and it is a
  `Function.prototype.toString` source-scan for `dependsOnCounters` correctness —
  it never calls `applySourceStaticEffects` / `getEffectivePower` /
  `getEffectiveToughness`.
- `convex/cards/__tests__/aiEffectsGuard.bot.test.ts` sweeps `resolve()` /
  `resolveSteps` / `effect` cards catalogue-wide, but only asserts each carries
  an `aiEffects` / `aiValue` annotation. The closure is never invoked.
- The gap is not hypothetical: of the 159 card symbols that lost their only
  per-card block in #2363, 13 carry `staticEffects[]` and 11 carry an imperative
  `resolve()`. Each needed a hand-written test precisely because no sweep would
  have caught a regression in it. A mana-ability sweep
  (`convex/cards/__tests__/manaAbility.catalogue.test.ts`) was added in that PR
  for the third such gap; these two remain.

**Why it may not deserve its own issue.** A `staticEffects[]` sweep is much
harder to make non-vacuous than the mana one: an `applies` predicate is
board-conditional, so a generic fixture either skips most entries or re-derives
the engine's own selection logic and asserts nothing. A `resolve()` sweep runs
into the same wall the smoke sweep already reports as explicit skips. It may be
that the honest answer is "these two shapes are exactly the ones that must keep
earning a hand-written test", which is what the testing table already says — in
which case this is a documentation line, not a ticket. The reason to look
anyway: the table's demand is currently enforced by nothing at all, so a card
shipping `staticEffects[]` with no test is silent.
