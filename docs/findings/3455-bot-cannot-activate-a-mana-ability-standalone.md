---
title: The bot cannot activate a `useStack: false` mana ability as a move of its own
discoveredBy: 3455
status: draft
confidence: high
---

**What is wrong.** `enumerateMoves` skips every non-stack ability outright —
`convex/gre/moves.ts`: `if (!ability.useStack) continue;` with the comment
"mana abilities are funded on demand by the cast planner, never activated
standalone". That is right for a land and a Mox, and wrong for a mana ability
whose activation is a PLAY in its own right: Ashnod's Altar and Krark-Clan
Ironworks convert a board into a pool, Skirge Familiar converts a hand into
one, and nothing the bot can generate reaches any of them.

The other half of the same seam is deliberate and should stay: the payment
planner is gated on `isAutoPayableManaAbilityCost`, and `sacrificeFilter` /
`discardFilter` are `autoPayable: false` in `COST_LEG_CLAIMS`
(`convex/gre/costLegClaims.ts`) — a planner must not spend a creature to fund a
spell. So the gap is not "the planner refuses it", it is "there is no move
that PROPOSES it, for the search to value".

**Evidence.** `convex/gre/moves.ts` (the `!ability.useStack` skip in the ability
enumerator); `convex/gre/constants.ts` `isAutoPayableManaAbilityCost` +
`NEVER_AUTO_PAYABLE_COST_LEGS`. Issue #3455 closed the ENGINE half — the
activation is now payable end to end from all three CR 605.3a windows — and
deliberately did not touch the bot: the seam is `convex/gre/moves.ts`, which is
`/bot-slice` territory, and the fix is class-wide (every mana ability whose
activation is a decision), not a property of the filtered give-up shape.

**Why it may not deserve its own issue.** It is pre-existing and class-wide, and
"the bot does not play sac-outlet engines" is not a regression anything
measures today. What argues for a ticket: it is a `must`-blade-shaped question
(a discriminating pair — a board where converting creatures into mana wins on
the spot vs. one where it throws the board away), and the shape is exactly the
kind the ISMCTS search is good at once a move exists to search over.
