---
title: The bot's Move enumerator still skips every ability with a canActivate predicate, so Ashen Ghoul stays invisible
discoveredBy: 2339
status: draft
confidence: medium
---

**What is wrong.** Issue #2339 removed one half of the bot's blindness to
graveyard-source activated abilities: `enumerateAbilityMoves` now scans the
activating player's own graveyard, not only the battlefield. But the OTHER
filter it passes through is unchanged — an ability carrying a `canActivate`
predicate is skipped outright — and Ashen Ghoul (the issue brief's stated
second beneficiary, "it un-blinds Ashen Ghoul too") declares exactly that.
So the graveyard scan un-blinds Eternalize, and Ashen Ghoul is still
enumerated zero times regardless of board state.

**Evidence.** `convex/gre/moves.ts:1030` —
`if (ability.canActivate || ability.getTargetRequirement) continue;` with the
comment "Conditional abilities need a runtime predicate we don't replicate;
leave them to a later slice". `convex/cards/sets/ice/black.ts:205` —
`canActivate: (source, state) => creatureCardsAboveInGraveyard(state, source) >= 3`.
The predicate's signature is `(PermanentView, TriggerStateView) => boolean`,
and the frontend already evaluates exactly this predicate against a view it
builds itself (`src/lib/card-utils.ts:1992` calls `a.canActivate(card, stateView)`
inside `getGraveyardStackAbilities`) — so "we don't replicate the runtime
predicate" is no longer accurate: a client-side reducer does it today. The
enumerator holds a full `GameState`, which is strictly more than the view the
predicate needs.

**Why it may not deserve its own issue.** The skip is deliberate, documented,
and conservative in the right direction (it can only make the bot pass, never
make it submit an illegal move — the server rejects those anyway). It is also
catalogue-wide rather than graveyard-specific: lifting it touches every
`canActivate` ability at once, which is a bigger, riskier slice than the
graveyard scan was, and it may belong on the same tracker as the search's
activate-ability payoff gap (#1920) — without that fix the bot would enumerate
these abilities and still never prefer one, so the visible behaviour would not
change. If #1920 is closed first, this becomes the obvious next step; on its
own it may be a line on that tracker rather than a ticket.
