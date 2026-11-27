---
title: The doomed-mana-float enumerator settles the stack on every priority ply to learn nothing is doomed
discoveredBy: 10755
status: draft
confidence: medium
---

**What is wrong.** `enumerateDoomedManaFloatMoves`
(`convex/gre/ai/doomedManaFloat.ts`) asks, on every priority ply with a
non-empty stack and an untapped mana source, what the top of the stack leaves
behind: `settlements` clones the position and resolves the top item, once per
outcome. Only then does it test whether any outcome removes one of the mover's
mana sources — and on almost every ply none does, so the clone and the
resolution bought an empty list.

**Evidence.** On the wide board of issue #10755
(`docs/research/wide-board-iteration-cost.md` § 4) it is 5% of a search after
that issue's change: `settlements` runs 11 times an iteration, each a
`cloneGameState` and a `resolveTopOfStack` with its state-based actions, from
`enumerateMoves` inside the rollout. The rollout's probe cut (ADR 0184) then
keeps three candidates by kind, and a float Move ranks below every cast and
activation, so the Move this buys is rarely probed either.

**Why it may not deserve its own issue.** A sound test that skips the settle
has to know what a resolution can remove without resolving it, and the engine
states that nowhere today: a script-level reading ("this item's Ops cannot
move a permanent of the mover's off the battlefield") would be a new
derivation with its own stale-answer risk, for one twentieth of an iteration
on a board this wide and less on a narrow one. It belongs on PRD issue #10017
as a line beside the state-based-action and cloning targets, unless a field
profile shows it larger.
