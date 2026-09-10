---
title: The hand term prices a card at full latent worth however far it is from castable
discoveredBy: 3388
status: draft
confidence: high
---

**What is wrong.** `playerTerms`' `hand` term sums `cardValue` over the hand with
no castability factor at all, so an eleven-drop held on two lands scores exactly
what it would score held on eleven. `latentValue` already carries a flat
`LATENT_DISCOUNT` for "in hand, not yet in play" — 0.85 on the creature body —
but nothing reads the gap between the card's mana value and the mana the player
actually has. That is the one axis every cheat-into-play line lives on: the card
is worth putting onto the battlefield for two mana precisely BECAUSE the hand
cannot cast it, and the evaluator cannot see that.

**Evidence.** Issue #3388's own reported position — turn 3, two lands, Flash plus
Worldspine Wurm in hand. With the settle fixed so the probe finally sees the
whole resolution, the branch that cheats the Wurm in settles to three 5/5
trample tokens (825 `creatures` + 15 `permanents`) with the Wurm shuffled back
into the library, against 932 for the branch that keeps the Wurm in hand — a
15/15 for {8}{G}{G}{G} that this player will not cast for another nine turns.
`materialMargin` therefore reads the cheat as −92 and `self-harm-removal`
correctly refuses a cast whose settled margin drops. Every other number in the
position is right; only the 932 is fiction. Measured deltas at the cast, same
position, one creature swapped: Vaultborn Tyrant (MV 7) +201.6, Lady Orca
(MV 7 vanilla) −58, Worldspine Wurm (MV 11) −58 — the Wurm lands on the vanilla
side of a rule that is otherwise reading the resolution correctly.

**Why it may not deserve its own issue.** It is one term feeding every ISMCTS
leaf in every position, so it is not a bug-fix slice: a discount steep enough to
move this position (the Wurm's hand worth has to fall below ~840) changes the
value of every card in every hand, and the calibration argument — how the factor
interacts with `manaDevelopment`, which already prices the base against the
hand's curve top — is the whole of the work. It wants its own PRD-sized decision
with its own blade evidence, not a line in a settle fix. Until then the position
is recorded as a `stretch` blade entry with `cause: "valuation"` (no `passesAt`:
a mis-valued subtree converges away from the right move as the budget rises).
