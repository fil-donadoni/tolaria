---
title: No cast-time "spend mana as though it were mana of any color" seam exists in the engine
discoveredBy: 1872
status: draft
confidence: high
---

**What is wrong.** Robber of the Rich's Oracle line ends "...you may cast that
card and **you may spend mana as though it were mana of any color** to cast that
spell." The clause is not modelled: the exiled card is castable only for its
normal, unfixed mana cost, so an off-colour exile is uncastable when the card
says it should not be. Issue #1872 finding 2 pre-declared this a stop-and-issue
case rather than a card-local patch, and the investigation below confirms why —
there is no almost-right primitive to generalize, so this is a new seam, not a
parametrization.

**Evidence — what exists.** The only mana-substitution shape in the engine is a
fixed `{ from, to }` pair carried by a **battlefield static effect**:

- `convex/gre/state.ts:19757` — `ManaSubstitution = { from, to }` (CR 609.4b).
- `convex/gre/state.ts:20776` — `getManaSubstitutions`, gathered off permanents
  on the battlefield. There is no per-cast grant channel at all.
- `convex/gre/state.ts:19770` — `payColoredRequirements` / `payHybridPips`: no
  wildcard branch; every path resolves a concrete colour.

The adjacent-looking things are not this. `convex/gre/tapManaBonus.ts:95,110,140,155`
— `kind: "anyColor"` is a **mana-ability production** bonus (what a land taps
for), not cast payment. `convex/gre/payWith.ts`, `convex/gre/paymentPicks.ts`,
`convex/gre/owedPayment.ts` are convoke/delve/improvise: fixed-shape alternative
payments, not a recolouring of ordinary mana.

**Evidence — where the seam would have to go.**

- `convex/game.ts:2739` — `castRawManaCost` is the ONE cost-computation site.
  It already branches on `castFromExileWithoutPayingManaCost`, Madness and
  Bolas's Citadel; a recolour branch would join them.
- `convex/gre/state.ts:1167` — the exile-cast permission record, and
  `convex/gre/state.ts:14568` `grantCastFromExile`, whose `opts` today carry only
  `withoutPayingManaCost` / `includesLand`. The permission is where a per-grant
  "any colour" flag would live.
- Readers that would ALL need the new signal, or silently fail open on it:
  `convex/gameProjections.ts:73,506,548,1088,1099,1337,1345`;
  `convex/gre/ai/opValuers.ts:656,735,749,1110,1271`; `src/types/game.ts:383-400`;
  `src/components/board/exile-cast-button.tsx:8,40`,
  `src/components/board/player-exile.tsx:131`,
  `src/components/board/board-battlefield-card.tsx:490`.

That is ~9 payment/affordability consumers across server, bot valuation and UI —
the shape the "cost-payment consumers span client+server" note warns about, where
a server-only fix reads as done and leaves the bot freezing or the client
offering a cast it cannot pay.

**Why it may not deserve its own issue.** Exactly one shipped card reaches the
clause today, and only in the minority line where the exiled card is off-colour;
the common in-colour case already works, so the observable cost is one dead
affordance on one card. A ticket is worth cutting when a SECOND card wants the
same clause — "spend mana as though it were mana of any color" is common on
Cascade-adjacent and treasure-adjacent designs, and the moment two cards need it
the seam pays for itself. Until then this is arguably a line on the #963 audit
tracker rather than a ticket of its own. The counter-argument: the seam is the
same one a per-cast cost modifier of any kind needs, so building it once unlocks
a category, and leaving it undone means the next card that wants it re-does this
investigation from scratch.
