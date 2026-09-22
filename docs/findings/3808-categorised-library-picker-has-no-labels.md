---
title: The library grid picker renders no category labels, so a refused click has no explanation
discoveredBy: 3808
status: draft
confidence: medium
---

**What is wrong.** Issue #3808 gave the library picker its first CATEGORISED
picks — Gaea's Balance ("a land card of each basic land type") and Guided
Passage ("a creature card, a land card, and a noncreature, nonland card"). The
per-click gate works: `player-library.tsx` reads `head.categories` and refuses
an addition that `canAddCategorizedPick` rejects. What the chooser sees is a
flat, unlabelled grid in which the second Forest still carries its "eligible"
ring — `eligibleIds` is the whole categorised UNION, so every card in any
bucket looks pickable — and clicking it silently does nothing. Nothing on
screen says "the Forest seat is taken", and nothing names the Plains bucket the
player has no card for.

This is not a dead end. The prompt banner still shows the card's own prompt
(`pending-choice-prompt.tsx` suppresses neither kind), the Done gate is
correct, and the submission the picker can build is always one the server
accepts — so the mechanic is playable. It is the DIAGNOSIS that is missing.

**Evidence.** `src/components/board/player-library.tsx:332` passes `categories`
to `CardsPile` only under `isLookDistributeGridPick`; the categorised
`search-library` / `choose-library-card` picks reach the same grid through
`isLibraryPick` (`:148-153`) and so render with `categories` undefined. The
eligibility ring is computed at `:165-172` from `head.candidateIds`, which for
a categorised pick is `categorizedEligibleIds(categories)` — the union, never
the still-answerable subset. The one-line change would be
`isLibraryPick ? head!.categories : undefined`; whether `CardsPile` then groups
or merely labels is a design question this finding does not answer.

**Why it may not deserve its own issue.** It is one prop and a design call on
an existing component, so it is a natural rider on the next PR that touches
that picker rather than a ticket. Against that: it is reached by two shipped
cards today and by every later categorised library card for free, the failure
mode is a click that does nothing (which reads as a bug, not as a rule), and a
component change owes a `check:ui` receipt — which is exactly why the
discovering PR, whose diff otherwise cannot reach the DOM, did not take it.
