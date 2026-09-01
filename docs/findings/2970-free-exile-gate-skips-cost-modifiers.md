---
title: the free-exile cast gate probes an unmodified {} while announceCast folds cost modifiers onto it — a cost increase makes the offered cast park unpayable
discoveredBy: 2970
status: triaged
issue: 2981
confidence: high
---

**What is wrong.** `getLegalActions`'s FREE-exile branch (CR 601.3, the
`castFromExileWithoutPayingManaCost` waiver — Dauthi Voidwalker) probes
affordability with `canPotentiallyPayCost(caster, card, {}, state)` and no
`foldCostModifiers`, so it reports the cast affordable unconditionally. The
real payment path does fold: `castRawManaCost` returns `{}` for the waived
cast, and `announceCast`'s no-target branch then runs
`applyCostModifiers(manaCost, getCostModifiers(state, cardInHand, "spell"))`
over that empty cost.

So with any `costIncrease` static on the board — Thalia (`dka/white.ts`),
Gloom (`lea/black.ts`), Sapphire Leech (`inv/blue.ts`), Aura of Silence
(`wth/white.ts`) — a "cast it without paying its mana cost" from exile is
offered by the gate at zero and then owes real mana at the payment step. Since
the executor announces FIRST and taps afterwards, the cast parks in
`pendingCast` and the only exit is abort-announce-re-enumerate: the bot-freeze
shape, and for a human a Cast button that leads nowhere.

**Evidence.**

- `convex/gre/rules.ts` — the `isFreeExileCast` branch:
  `canPotentiallyPayCost(caster, card, {}, state)`, no `opts`, and the branch
  `return`s, so the alternative-cost branch that DOES fold (issue #2970) is
  never reached for these cards.
- `convex/game.ts` — `castRawManaCost`'s
  `if (zone === "exile" && card.castFromExileWithoutPayingManaCost) return {};`,
  and the no-target commit branch's `applyCostModifiers` over the resulting
  `{}`.
- `applyCostModifiers` (`convex/gre/state.ts`) adds increases to any cost,
  including an empty one — `{}` plus Thalia's `{X:1}` is `{X:1}`, not `{}`.

This is the mirror image of #2970: there the gate and the payment agreed on the
same WRONG number (both unmodified, so the spell was merely undercharged);
here they disagree, which is the worse failure of the two.

**Whether CR 118.9d even wants the fold here.** Arguably not, and that is the
part worth deciding before ticketing: 118.9d applies increases to an
_alternative cost_, while a waiver ("without paying its mana cost") means no
mana cost is paid at all — CR 601.2f's increases still apply to the _total
cost_, so Thalia does tax a free cast. If that reading holds, the GATE is the
side that must move. If it does not, the PAYMENT side is the bug and the fold
should be skipped for a waived cost. Either way the two sides must stop
disagreeing.

**Why it may not deserve its own issue.** Reaching it needs a shipped
free-exile grant AND a live cost increase on the same board, and the shipped
free-cast grants are few (Dauthi Voidwalker's opponent-exile cast, the
`withoutPayingManaCost` rider on `grantCastFromExile`). It may be better folded
into whichever ticket next audits the remaining `canPotentiallyPayCost` branches
that omit `foldCostModifiers` (flashback, escape, madness, retrace, the
graveyard permissions) — the finding is really "one gate branch per cast
mechanism, and only three of them fold", not "free-exile is special".
