---
title: choose-graveyard-card and reorder-library have no bot choice-candidate generator
discoveredBy: 2381
status: draft
confidence: medium
---

**What is wrong.** `CHOICE_CANDIDATE_GENERATORS`
(`convex/gre/ai/choiceCandidates.ts:615-632`) registers seven kinds:
`may-pay`, `land-entry-tapped`, `draw-replacement`, `option-pick`,
`trigger-mode`, `search-library`, `random-reveal`, `choose-hand-card`. Two
kinds that shipped cards raise routinely are absent:

- `choose-graveyard-card` — Recall (LEG), Forgotten Lore (`ice/green.ts:596`), Exhume (`usg/black.ts:29`), Gaea's Blessing, and now Doomsday's graveyard half.
- `reorder-library` — Portent, Natural Selection (`lea/green.ts:907`), Diabolic Vision (`ice/multicolor.ts:370`), Elemental Augury, Drafna's Restoration (`atq/blue.ts:149`), and Doomsday's "in any order" step.

`isSearchableChoiceNode` returns false for both, so the ISMCTS search never
treats them as decision nodes and the bot lands on the driver's emergency
minimal-legal fallback. That is not a freeze (the fallback answers), but it
means the bot reanimates an arbitrary graveyard card and orders its own
library top arbitrarily — a decision that is often the whole point of the
card.

**Evidence.** `convex/gre/ai/choiceCandidates.ts:615-632` (the registry) and
`:672-676` (`isSearchableChoiceNode`). `searchLibraryCandidates` at `:395-514`
is the shape a graveyard generator would mirror almost exactly — the graveyard
is a public zone, so it needs no determinization handling at all, which makes
it strictly simpler than the library one that already ships.

**Why it may not deserve its own issue.** This is a pre-existing gap that long
predates Doomsday and is squarely inside the bot tranche work already tracked
(`choices-in-search`, #1255-1260) — it is plausibly already a line there
rather than a new ticket. It also degrades gracefully: no game freezes, only
weak play on a handful of cards. Against that: the affected card list keeps
growing (six-plus cards now), and `choose-graveyard-card` is the cheapest
generator left unwritten.
