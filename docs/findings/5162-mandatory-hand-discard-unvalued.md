---
title: A mandatory own-hand discard pick is answered unvalued, outside the search
discoveredBy: 5162
status: draft
confidence: medium
---

**What is wrong.** A `choose-hand-card` pending choice with `min > 0` (Frantic
Search's "discard two", Mind Rot's "target player discards two" when the Bot is
the target) is not a decision node: `handPickIsSearchable`
(`convex/gre/ai/choiceCandidates.ts`) admits only `min === 0`, so
`decidingPlayer` (`convex/gre/search.ts`) returns no decider. The Brain then
answers it in `src/lib/ai/brain.ts` with `candidates.slice(0, min)` — the
first `min` cards in hand order, with no valuation at all. The Bot can pitch
its best card and keep a blank.

**Evidence.** Found while looking for a blade position where the hand price of
Wheel of Fortune (issue #5162) decides something: a Frantic Search cast by the
Bot, resolved, with Wheel of Fortune and six Grizzly Bears in hand, makes the
blade runner throw `BladeDeciderError` ("the decision belongs to no one") —
the discard pick is never searched.

**Why it may not deserve its own issue.** The pick may be deliberately left to
the minimal-legal default (ADR 0016) because a mandatory discard has no
"decline" branch to weigh; a `worstFirst` ordering by `cardValue` (the shape
`choose-damage-target` already uses) may be a one-line change rather than a
ticket.
