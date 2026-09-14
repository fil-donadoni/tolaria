---
title: may-pay shares the CR 608.2g hole — its accept leg is pruned on an empty pool
discoveredBy: 3569
status: draft
confidence: high
---

**What is wrong.** Issue #3569 closed the CR 608.2g window for the PAYING
NUMERIC NOMINATION and asked, as a coda, whether `may-pay` shares the hole. It
does. `mayPayCandidates` (`convex/gre/ai/choiceCandidates.ts`) gates the whole
accept leg on `canPayMayPayCost`, whose mana leg is priced against
`spendablePoolForRestriction` — the FLOATING pool and nothing else
(`convex/gre/state.ts`). CR 500.5 / 106.4 empty the pool at the end of every
step and phase, so a cumulative upkeep's `may-pay`, an upkeep trigger's "you
may pay {2}" and every other mid-resolution mana question is asked with the
pool empty by rule: the generator returns the decline alone and the Bot
declines a cost it has six untapped lands for.

**Evidence.** `convex/gre/state.ts:26349` `canPayMayPayCost` →
`spendablePoolForRestriction(player, manaRestriction)` then `isManaCostCovered`;
`convex/gre/ai/choiceCandidates.ts:212` returns `[]` on its `false`. The live
engine already opens the window for this kind — `isManaPaymentChoiceWindow`
answers `true` for `may-pay` unconditionally — and the human client walks
through it by clicking a land, which is why nothing reds.

**Why it was not fixed in issue #3569.** Not scope creep avoidance — a
genuinely different shape, which is what that issue asked to be checked before
widening. The nomination's cost is a pure GENERIC leg, so the whole fix rides
on one scalar: `planManaPayment(state, payer, { X: amount })` plans it, and the
search credits the shortfall as colourless because CR 107.4b makes any type
of mana pay a generic pip. A `may-pay` cost is AUTHOR-FIXED and may carry coloured pips, so
neither half transfers: the ceiling question is "is this exact cost coverable",
not "how much", and the search's coarse mana model would have to know which
COLOURS each planned tap makes to float them before `canPayMayPayCost` re-reads
the pool. It also has four other legs (life, permanent, hand, energy) that a
floated pool does not help, so the affordability probe has to distinguish which
leg failed — and `planManaPayment` does not model the player-level
`getManaSubstitutions` that `canPayMayPayCost` does, so swapping one for the
other would silently DROP may-pay accepts the Bot takes today.

**Why it may not deserve its own issue.** It probably does — it is the second
and larger half of one bug class, and it is defensible without the card that
surfaced it. But it is the kind of change that wants its own discriminating
blade pair (a cost the lands cover, and one they do not), so it should be
scoped as work rather than appended to a landed slice.

**A third, smaller member of the same family.** `planManaPayment` models the
pool as zero-tap sources but folds in only `unrestrictedFloatingMana`, while
`spendableManaTotal` — and therefore the nomination's ceiling — counts every
restricted unit ELIGIBLE under the choice's own `manaRestriction` (CR 106.6).
A nomination fundable as "eligible restricted mana plus taps" therefore loses
its top candidate to a `null` plan, and where a plan does exist the Bot
over-taps, because the submit spends the restricted mana first
(`payManaCostForRestriction`) and leaves the extra land mana floating. Latent
today: no shipped card puts a `manaRestriction` on a `payVariableMana` head.
