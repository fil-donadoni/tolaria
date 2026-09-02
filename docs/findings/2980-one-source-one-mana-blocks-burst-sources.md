---
title: The Bot's mana model counts one mana per source, so it can never cast anything off a Black Lotus
discoveredBy: 2980
status: triaged
issue: 3027
confidence: high
---

**What is wrong.** `planManaPayment` (`convex/gre/moves.ts:612`) builds one
`PlanSource` per permanent and maps it to **one** mana per colour, and says so:
_"Mirrors `canPotentiallyPayCost` (rules.ts) — same one-source-one-mana model"_.
A source that produces several mana at once (Black Lotus's "Add three mana of
any one color", and every other `manaChoices` burst) therefore pays for exactly
one pip, and the surplus is invisible. The Bot can never cast a spell costing
two or more mana off such a source, however much mana it really makes.

**Evidence.** Measured on a hand-built position (issue #2980 investigation): one
untapped Black Lotus on the battlefield, `Ancestral Recall` ({U}), `Brain Freeze`
({1}{U}) and `Counterspell` ({U}{U}) in hand. `enumerateMoves` offers the
Ancestral Recall cast and **nothing else** — `planManaPayment` returns `null` for
both two-mana costs. Swap the Lotus for two Islands and Brain Freeze is
enumerated with a two-land tap plan, so nothing but the source's yield differs.

The gate and the planner also disagree here, which is the more dangerous half:
`getLegalActions` returned `"cast"` for a `{1}{U}` spell in that same position
while `planManaPayment` could not build a plan for it. A human can make the cast;
the Bot is told it is legal and then cannot express it.

**Why it may not deserve its own issue.** It is one model shared by the
castability gate, the tap planner and the X ceiling (`maxAffordableX`), so the
fix is a real design change (a source needs a yield, and the plan needs to spend
a source across several pips), not a patch — that argues for a PRD rather than a
ticket. It is also invisible on an ordinary board: every land and every `{T}`
rock makes exactly one mana, which is why it has survived this long. What makes
it worth raising anyway is the class it blocks — every ritual-shaped burst source
in the cube, and with it every storm / Underworld Breach line the Bot could
otherwise reach now that graveyard casts are enumerable (#2971, #2980).
