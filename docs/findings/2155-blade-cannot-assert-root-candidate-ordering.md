---
title: Blade cannot assert a root-candidate ORDERING, only the chosen move — tie-shaped bot bugs are unpinnable there
discoveredBy: 2155
status: draft
confidence: medium
---

## What I noticed

Issue #2155's defect has the "exact tie" shape: a cost-free activation whose
payoff the search also cannot see scores **numerically equal** to `pass`
(`meanReward` 0.9250200000000014 vs 0.9250200000000014, measured), so which one
the root picks is rollout noise, seed by seed.

The blade suite (`convex/gre/ai/blade/types.ts`) can only express assertions
about the **chosen move**:

- `moves` — chosen must match one matcher
- `forbidden` — chosen must match none
- `predicate: (move: Move | null, state: GameState) => boolean`

None of the three can see the root statistics. `searchWithTrace`
(`convex/gre/search.ts:2324`) already computes exactly what a tie-shaped bug
needs — `DecisionTrace.candidates[].meanReward` / `.meanMargin` / `.visits`
(`search.ts:1466-1499`) — and `runBladeScenario` **already calls it**
(`convex/gre/ai/blade/runner.ts:365`), destructuring only `{ move }` and
dropping the `trace`. So the missing piece is purely the expectation shape, not
the plumbing.

## Evidence

I wrote two `forbidden` blade entries for the #2155 field repros (Sylvan
Safekeeper `#2422`, Iron-Shield Elf `#2415`), then ran the whole must tier
against the **exact pre-fix baseline** (`applyMoveInSearch` reverted to tap
plan + unconditional source tap + graveyard `exileThis`):

- must tier, with the fix: **36 passed**
- must tier, pre-fix baseline: **36 passed** — including both new entries

Both entries were therefore vacuous: the buggy code satisfied them. The same
two positions asserted as `meanReward(activation) < meanReward(pass)` through
`searchWithTrace` are discriminating at every seed — 18/18 red against that
same baseline
(`convex/gre/__tests__/activationCostsInSearch.bot.test.ts`). I dropped the
blade entries rather than ship coverage that had never been seen to fail.

Two separate causes are tangled here, and only the first is blade's:

1. **No ordering assertion.** A `forbidden` entry passes whenever _some third
   move_ (here `declare-attackers`) outranks both candidates — which says
   nothing about the two that are tied.
2. **The built position drifts from the hand-built one.** The same nominal
   position (Safekeeper + 3 lands, turn 3, DECLARE_ATTACKERS) chose the
   activation pre-fix in a hand-built `makeState` at 6 of 8 seeds, and never
   chose it when built from a `ScenarioSpec` — the spec adds a library, a
   hand and a full opponent board that a hand-built fixture does not. That is
   arguably a feature (blade positions are more realistic), but it means a
   position proven discriminating in a unit test is not automatically
   discriminating as a blade entry, and nothing tells you.

## The obvious shape of a fix

Add a fourth expectation kind to `BladeExpectation`, e.g.
`ranking: { above: MoveMatcher; below: MoveMatcher }`, evaluated against the
`DecisionTrace` the runner already receives from `searchWithTrace` and
currently throws away. Cost: one field, one destructure, one branch in
`checkExpectation` — no change to existing entries.

## Why it might NOT deserve a ticket

- The gap is only visible for **tie-shaped** bugs. For the ordinary blade case
  ("the bot should cast Bolt here") the chosen move is the whole point, and an
  ordering assertion would be strictly weaker.
- There is a workable substitute today — a `*.bot.test.ts` calling
  `searchWithTrace` directly, which is what #2155 shipped. It costs the entry
  its place in the curated registry, not its determinism or its teeth.
- Adding a `ranking` shape invites entries that assert an ordering the bot
  satisfies for the wrong reason, and blade's value is that a human can say
  without hedging what the bot _ought to do_ — an ordering between two
  candidates is a harder thing to be sure about than a best move.
- Cause 2 (spec-built vs hand-built divergence) may be better addressed by
  #2148's `specFromState`, which would let a blade entry be lowered from the
  exact position a unit test proved.
