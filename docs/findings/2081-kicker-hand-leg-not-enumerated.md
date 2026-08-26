---
title: A future hand-leg Kicker is never enumerated as kicked (fail-closed gap, not a bug today)
discoveredBy: 2081
status: draft
confidence: high
---

**What is wrong.** `enumerateKickerVariants` (`convex/gre/kicker.ts`) never
offers a Kicker-payment combo whose legs include a `hand` leg ("Kicker — pay
{2} and discard a creature card", Dralnu's Pet-shaped): it fails CLOSED,
`continue`-ing past any combo where `kickerCostLegs(cardDef, canonical).some(
(leg) => leg.hand)`. The two search sandboxes (`applyMove.ts`'s
`applyKickerPermanentLegForSearch`, `search.ts`'s mirror call) never learned a
hand-leg branch either — only life (folded into the existing `payLife` Move
field) and permanent (sacrifice/return, cheapest-first) are paid.

**Evidence.** Catalogue census taken while scoping issue #2081 (44 `kickers:`
sites across 16 files): every one uses only `mana`, `permanent`, or `life`
legs. Zero use `hand` or `energy`. `convex/gre/kicker.ts`'s
`enumerateKickerVariants` doc comment records the same census and the
rationale for excluding it, right at the enumeration site.

**Why it may not deserve its own issue.** Nothing in the shipped catalogue
needs it — Guard A/B (`.claude/rules/gre-development.md`) don't fire because
no keyword ships silently inert; this is an unbuilt COMBINATION of an
already-implemented leg (`CostLegs.hand`, fully built for the alternative-cost
and additional-cost paths) with an already-implemented mechanic (Kicker), not
a missing primitive. The moment a set adds a hand-leg Kicker card, that card's
own PR is the right place to extend `enumerateKickerVariants` and the two
`applyKicker*ForSearch` helpers — the fail-closed shape means the bot will
simply never enumerate the kicked variant for that one card until then
(strictly worse play, never a stall or a silent mispayment), which is a
narrower and more honest failure mode than building unused machinery now.
