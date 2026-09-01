---
title: The whole order-top choice family (Scry / Surveil / Explore) is never an in-tree bot decision
discoveredBy: 2376
status: draft
confidence: high
---

**What is wrong.** Every `order-top` `PendingChoice` — Scry (CR 701.22),
Surveil (CR 701.25), Ponder-style reordering, and now Explore's
keep-or-bin tail (CR 701.44a) — is answered by a fixed greedy default, not by
the search. The bot therefore **never** sends a card to the bottom or to the
graveyard: `src/lib/ai/brain.ts:999` keeps every looked-at card on top,
best-projected-value first, and says so ("minimal-legal default (ADR 0016) …
Smart 'bottom the dead cards' scrying is deferred"). For Explore this is
visible as a concrete wrong play: a dead card revealed off a nonland explore is
always left on top, so the controller draws it next turn.

**Evidence.** `CHOICE_CANDIDATE_GENERATORS`
(`convex/gre/ai/choiceCandidates.ts:687-703`) registers eight kinds —
`may-pay`, `land-entry-tapped`, `draw-replacement`, `option-pick`,
`trigger-mode`, `search-library`, `random-reveal` and `choose-hand-card` — and
`order-top` is not among them, so `hasChoiceCandidateGenerator("order-top")` is
false, the choice never becomes an ISMCTS decision node, and `brain.ts`'s
default is the whole policy. Promoting it is **not** a valuer change: the `resolution-choice`
Move (`convex/gre/moves.ts:192`) carries a single `cardInstanceIds` list, while
an `order-top` submission needs BOTH the kept ids and `secondZoneIds`
(`convex/gre/pendingChoiceSubmit.ts:1038`). That is a Move-union widening, which
by the bot-slice seam table drags in `applyMove.ts`, `src/lib/ai/executor.ts`,
`describeMove.ts` and `botActionRealisation` in `src/hooks/useVsAiDriver.ts`.

**Why it may not deserve its own issue.** It is not an Explore regression — it
is the shipped, documented behaviour of a family that predates this work, and
Explore merely inherits it. If the deferred "smart scrying" item is already
tracked somewhere on the bot programme (#1254 / #1892), this is a line there
rather than a ticket. It earns its own slice only if the answer is that nothing
tracks the order-top family at all.
