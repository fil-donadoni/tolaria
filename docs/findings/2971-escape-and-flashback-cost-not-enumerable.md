---
title: the Bot cannot enumerate an Escape cast, or a Flashback cast with a non-mana cost — their cost park is built only inside announceCast and the cast-spell Move has no field to carry it
discoveredBy: 2971
status: draft
confidence: high
---

**What is wrong.** Issue #2971 gave the Bot a candidate set for every
cast-from-exile and cast-from-graveyard permission the engine ships, EXCEPT two,
which fail closed (`searchCanModelGraveyardCast`, `convex/gre/castCost.ts`):

- **Escape** (CR 702.138a) owes "exile N other cards from your graveyard" on top
  of its mana cost.
- **Flashback with a non-mana flashback cost** (CR 702.34a / 118.5) — Lava Dart's
  "Sacrifice a Mountain" (`ons/red.ts`) and the `flashbackExileFromGraveyard` X
  cost (`jud/blue.ts`, Deep Analysis' shape).

Both are real, shipped mechanics the Bot simply never plays.

**Why they could not ride along.** The cast-side park machinery has a clean
shape — `planCastCostPicks` (`gre/castCostPicks.ts`) computes ONE deterministic
victim plan per park (K=1, `gre/parkKinds.ts`), the enumerator hangs it on the
Move as `castCostPicks`, and both sandboxes charge it. Neither of these two costs
is in it:

- `planCastCostPicks` reads only `resolveAdditionalCosts(def.additionalCosts)`
  plus the board-wide static sacrifices. It has no branch for the escape exile
  or for `getFlashbackAdditionalCost`.
- The escape exile is assembled inside `announceCast` (`convex/game.ts`) as a
  `PendingCast.exileFromGraveyardChoice`, and `CastCostPicks` has no field for
  the picked graveyard ids.

So an enumerated escape cast would be priced as if the exile were free, and the
executor — which announces FIRST and pays afterwards — would park it unpayable
in `pendingCast`, leaving abort-announce-re-enumerate as the only exit. That is
the bot-freeze shape (#2283/#2284), which is why they fail closed instead.

**The slice.** Three pieces, in order, and none of them is large on its own:

1. Lift the escape exile and the flashback additional cost out of `announceCast`
   into a `gre/`-side builder, the way #2971 lifted `castRawManaCost` into
   `gre/castCost.ts` (same reason: `game.ts` imports the enumerator, so the
   enumerator can never import it back).
2. Give `CastCostPicks` an `exileFromGraveyardIds` field and teach
   `planCastCostPicks` the cheapest-first pick for it — `PARK_VARIANT_K` already
   lists `cast:exileFromGraveyardChoice` at K=1, so the shape is decided.
3. Delete the two branches of `searchCanModelGraveyardCast`, add the blade pair
   (an escape line that is the only non-losing move, plus its twin without the
   graveyard fodder), and charge the exile in both sandboxes so the search
   cannot model an escape creature as infinitely recurring.

**Why it may not deserve its own issue.** It is arguably one line on the bot
wayfinder tracker (#1254) rather than a ticket: the value depends on whether the
Bot's deck pool holds escape / non-mana-flashback cards (the cube does; the
preset decks mostly do not), and step 1 is a refactor whose benefit is shared
with anything else that ever needs to price a cast outside a mutation.
