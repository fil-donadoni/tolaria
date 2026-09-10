---
title: SpellContext.getManaValue ignores ManaCost.xFactor, so an {X}{X} spell on the stack reads one X too few (CR 202.3b)
discoveredBy: 3216
status: draft
confidence: high
---

**What is wrong.** `SpellContext.getManaValue`'s `"spell"` branch adds the
chosen X exactly ONCE, regardless of how many `{X}` pips the cost prints.
CR 202.3b computes a mana value from the whole cost, so `{X}{X}{U}` cast with
X = 3 has mana value 7, not 4. Every `{X}{X}` spell on the stack therefore
reports low to any effect that reads its mana value.

**Evidence.** `convex/gre/state.ts` — the branch is
`return base + (stackItem.chosenX ?? 0);`, one addition. The multiplicity is
already modelled elsewhere: `ManaCost.xFactor` (`convex/cards/types.ts`) exists
precisely to say "this cost prints X more than once", and
`manaCostsEquals`/`manaCostEquals` compares it. The fix is
`base + chosenX * (xFactor ?? 1)`, with `xFactor` read off the resolved
definition's `manaCost`.

**Why it may not deserve its own issue.** Nothing in the pool exercises it
today: the read is consumed by mana-value-comparing effects and by Cascade
(issue #3216), and no shipped `{X}{X}` card reaches either. It is also a
one-line change with a wide blast radius — every consumer of the `"spell"`
branch shifts at once — so it wants its own targeted test rather than riding
along with a card. If the pool never gains an `{X}{X}` spell whose mana value is
read on the stack, this is a line on a cost-system tracker rather than a ticket.
