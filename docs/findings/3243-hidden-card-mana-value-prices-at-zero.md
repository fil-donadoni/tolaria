---
title: A determinized placeholder resolves to no CardDefinition, so every hidden-card mana-value read prices at 0
discoveredBy: 3243
status: draft
confidence: medium
---

**What is wrong.** A cost scaled by the mana value of cards the bot has not
seen is invisible to the search. `determinize.ts` fills a non-observer seat's
unknown library slots with opaque placeholders, and a placeholder "resolves to
no `CardDefinition`" by design — so `getGraveyardCards` reports mana value 0
for every card milled off that library inside the tree. Palantír of Orthanc's
punisher ("that player loses life equal to the total mana value of those
cards") therefore evaluates as a free 0 in every determinization, and the bot
declines at any life total, including one where the real mill is lethal.

The zero is not a wrong-by-construction read: the mana value of a hidden card
IS unknown. What is wrong is that unknown is priced as **zero** rather than as
an expectation, which is not neutral — it is the most favourable possible
value for whoever is choosing, so every hidden-card-scaled cost reads as free
and every hidden-card-scaled benefit reads as worthless.

**Evidence.** `convex/gre/determinize.ts:352` — "opaque on purpose — a
placeholder resolves to no `CardDefinition`". Observed in a scratch run while
writing `convex/gre/ai/__tests__/opponentSideMayPay.bot.test.ts` (the fixture
was not kept, precisely because it asserts a bot answer that is correct given
what the bot can see): with three influence counters and a library of three
Colossus of Sardia (mana value 9 each), a bot at 4 life still answered
`may-pay: false` on every seed — it took 27 life loss over giving up one card.
Passing the offering seat's decklist as `deckKnowledge`
does not change it — that field selects which decklists seed the unknown-card
POOL, while the slots themselves stay opaque for every non-observer seat
"whatever the state holds and whatever `deckKnowledge` says"
(`determinize.ts:126`).

**Why it may not deserve its own issue.** Exactly one shipped card reads a
characteristic off cards milled from a hidden library today, and the honest
floor for an unknown card is genuinely debatable — an average mana value drawn
from the format would be a modelling choice, not a correctness fix. If it
stays one card, this is a line on the bot roadmap rather than a ticket. It
grows teeth the moment a second card prices anything off hidden-zone
characteristics, or if the same zero shows up on the BENEFIT side (a bot
undervaluing "draw a card for each X" over a hidden set).
