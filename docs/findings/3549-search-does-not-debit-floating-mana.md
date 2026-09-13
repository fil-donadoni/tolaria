---
title: The ISMCTS search never debits floating mana, so an in-tree plan can spend the same pool twice
discoveredBy: 3549
status: draft
confidence: high
---

**What is wrong.** `applyTapPlan` (`convex/gre/applyMove.ts`) marks a plan's
sources tapped and deliberately credits no mana — the probe's coarse model. It
also never DEBITS `manaPool` or `restrictedMana`. Mana already floating when the
tree was entered is therefore free inside it: two simulated casts in the same
branch can each draw on the same four red, and the bot's line reads as affordable
when only one of the two is.

**Evidence.** `planManaPayment` (`convex/gre/moves.ts`) models pool mana as a
zero-tap `PlanSource` — `cardInstanceId` is `undefined` by construction — so such
a source produces no `ManaTap` entry at all. `applyTapPlan` iterates `ManaTap`
entries, so there is nothing for it to charge against even in principle: closing
the gap means changing what a plan RECORDS, not adding a subtraction to that
loop.

**Why it is not a desync.** It fails in the optimistic direction only, and only
inside the search. Every real move goes through a public mutation and is
re-validated server-side (ADR 0074), and `getLegalActions` / `assertLegalAction`
price the live pool exactly, so the bot cannot submit a move the server refuses —
it can only prefer a line whose second half it will discover it cannot pay.

**Why it may not deserve its own issue.** It has been latent since the search
shipped, because floating mana is rare: the pool empties at every CR 500.5
boundary, so a root decision almost never starts with any. What changed is
firebending (CR 702.189a, issue #3235): four red arrive from an attack trigger
the bot cannot decline and survive to end of combat, so every attack with Avatar
Roku now enters the tree holding mana. That makes the gap routine rather than
theoretical, which is the argument FOR a ticket; the argument against is that the
fix is a plan-shape change on the ISMCTS hot path, for an error that only ever
makes the bot optimistic about its own line.
