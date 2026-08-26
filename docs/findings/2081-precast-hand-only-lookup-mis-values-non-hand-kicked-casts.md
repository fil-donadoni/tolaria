---
title: applyMove.ts / search.ts gate the Kicker permanent-leg payment on a HAND-only lookup, so a kicked cast off the library top (Bolas's Citadel) is valued as if its sacrifice/return leg were free
discoveredBy: 2081
status: draft
confidence: medium
---

**What is wrong.** Both search sandboxes' `"cast-spell"` case looks up the
card being cast with a HAND-only scan before deciding whether to pay the
Kicker's PERMANENT leg:

```ts
const preCastSpell = player.hand.find((c) => c.id === move.cardInstanceId);
...
if (move.kickerPayments && preCastSpell) {
    ...
    applyKickerPermanentLegForSearch(...)
}
```

(`convex/gre/applyMove.ts:891,927`; `convex/gre/search.ts:810,852` — both
comments already admit the constraint: "`preCastSpell` (found in player.hand
only) …"). When the cast being simulated is NOT from hand, `preCastSpell` is
`undefined`, the `if` is skipped, and the Kicker's permanent leg (sacrifice
lands / return a creature) is never applied — the mana leg still folds fine
(`foldKickerCosts`, keyed off `move.tapPlan`/`normCost`, not off this lookup),
so a kicked cast off a non-hand zone prices ONLY its mana leg and treats the
non-mana leg as free.

**Evidence.** `enumerateCastMoves` (`convex/gre/moves.ts:1200`) is called from
more than one zone — notably the library-top branch for Bolas's Citadel
(`moves.ts:2568`, shipped, `war/black.ts`), which passes
`lifeInsteadOfMana` and enumerates Kicker variants exactly like the hand
branch (`enumerateKickerVariants` doesn't care which zone `card` came from).
A kicked Bog Down or Magma Burst cast off the top of the library under
Citadel therefore reaches `applyMoveForSearch`/`applyMoveInSearch` with
`move.kickerPayments` set, `preCastSpell` `undefined` (the card is in
`player.library`, not `player.hand`), and the permanent leg silently unpaid
in the search's own model of the resulting state — the two lands/creature
never leave the board in the simulated world, so the search VALUES that line
as if the sacrifice/return never happened. This is a valuation divergence,
not a stall: the LIVE commit path (`game.ts`'s real `announceCast` /
`finalizeTargetSelection`) still parks and charges the leg correctly via the
unified sacrificeChoice layer regardless of zone — only the Bot's own
lookahead is wrong.

**Why it may not deserve its own issue yet.** Retrace is the only OTHER
non-hand cast branch this enumerator currently offers
(`docs/findings/2358-graveyard-cast-moves.md` — Flashback/Escape aren't
enumerated at all), and no shipped retrace card carries a permanent-leg
Kicker, so Bolas's Citadel + a permanent-leg-Kicker card in the library is
the only reachable trigger today — narrow, and it degrades play quality
(over-valuing a kicked cast it can't actually get for free) rather than
producing an illegal move or a stall. Fixing it cleanly means either widening
`preCastSpell`'s lookup to every zone `enumerateCastMoves` can source a card
from (hand, library, graveyard-retrace) in both sandboxes, or failing the
kicked variant closed for a non-hand cast at enumeration time (mirroring the
hand-leg fail-closed precedent, `kicker.ts`'s file-level bound comment) —
either is a real, scoped change to the same two hot paths #2081 already
touched, not a one-line fix riding along with the permanent-cost-slot-collision
fixup.

---

**Second, related gap (issue #2081 fixup, review round 2): the ENUMERATOR's
own collision check reads the wrong mana cost under the SAME Citadel
permission — but over-refuses, never over-offers.**

`kickerPermanentSlotWouldCollide` (`convex/gre/kicker.ts:570`, called from
`enumerateKickerVariants`) computes the mana cost it feeds Drought's
board-wide static-sacrifice scan with `getInstanceManaCost(card)`
(`convex/cards/registry.ts:647`) — a bare printed-cost lookup that knows
nothing about zone or any cast permission. The real mutation prices the
identical board-wide check with `castRawManaCost(state, card, castFromZone)`
(`convex/game.ts:2755`), which returns `{}` for a cast made under Bolas's
Citadel's `manaCostReplacement: "life-equal-to-mana-value"` permission
(`convex/game.ts:2775-2784`, issue #2398) — the whole mana cost, black pips
included, is replaced by a life payment, so Drought's "sacrifice a Swamp, one
per black mana symbol" (CR 118.8) owes NOTHING under that permission.

**Evidence.** Same trigger as the primary finding above: a permanent-leg
Kicker card reached via Citadel's library-top branch
(`moves.ts:2568`/`war/black.ts`), this time under Drought too. The mutation
side (`assertKickerAnnouncementLegal` → `getStaticAdditionalSacrifices` fed
`castRawManaCost`'s `{}`) sees zero black pips and therefore no board-wide
sacrifice requirement — no collision, the kicked cast is legal. The
enumerator side (`kickerPermanentSlotWouldCollide` fed `getInstanceManaCost`'s
full printed cost) sees the real black pips, computes a nonzero requirement,
and marks the pairing a collision — so `enumerateKickerVariants` silently
drops a kicked variant the server would have accepted.

**Why this is safe-direction, not a repeat of the primary finding.** The
primary finding above is a valuation gap (the search prices a leg as free
that the server charges) and the `kickerLegPermanentSlotWouldCollide`
fixup (round 2) is a legality gap (the enumerator offers a Move the server
rejects, reproducing the AC #3 stall). This one is neither: the enumerator
REFUSES a legal line — the Bot never tries it, so it never stalls and never
mis-values a board state that gets built, it just narrows the search's option
set on this one already-narrow trigger (Citadel + Drought + a permanent-leg
Kicker card on top of the library, at least as narrow as the primary
finding's own trigger). Not fixed alongside the round-2 leg-collision fixup:
threading `castFromZone`/the Citadel permission into
`kickerPermanentSlotWouldCollide` (currently `state, cardDef, card, payments`
only) means either duplicating `castRawManaCost`'s zone/permission branching
in `kicker.ts` (the same file-boundary reason `foldBuybackCost`'s own doc
comment gives for NOT importing from `game.ts`) or exporting a manaCost-source
seam from `game.ts` — real, scoped work sharing nothing with the
permanent-cost-slot collision this fixup round is about, and the batch this
issue is in explicitly does not touch `game.ts`.
