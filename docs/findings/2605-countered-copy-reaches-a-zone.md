---
title: A COUNTERED copy of a spell reaches a real zone instead of ceasing to exist
discoveredBy: 2605
status: draft
confidence: high
---

**What is wrong.** CR 707.10a: "If a copy of a spell is in a zone other than the
stack, it ceases to exist." `SpellContext.counter` splices the stack item and
then, for a spell (no `abilityId`/`triggeredAbilityId`/`delayedTriggerId`),
routes it to a real zone — graveyard by default, or `exile` / `library-top` /
`hand` for the `destination` clause. It never checks `item.isCopy`, so
countering a COPY of a spell puts a non-card object into somebody's graveyard,
library or hand, where it is drawable, castable and millable.

**Evidence.** `convex/gre/state.ts` — `counter()`'s destination `switch` has no
`isCopy` guard, while every other stack-departure path in the same file does:
the resolution path (`if (item.isCopy) return;` before the owner lookup),
`exileSelf`, `shuffleSelfIntoLibrary`, and now `moveSpellFromStack`
(issue #2605, which added its own carve-out with the same CR citation). Nothing
compensates downstream: `convex/gre/sba.ts` has no CR 707.10a state-based
action, so a copy that reaches a hidden zone stays there.

**Why it may not deserve its own issue.** Reaching it needs a copy of a spell on
the stack AND a counter aimed at that copy, and the shipped copy producers are
few — it may be worth one line on an existing counter/copy tracker rather than a
ticket of its own. Note the fix is a one-line carve-out shared with the path
already written, so the cost side of that judgement is small. Issue #2605
explicitly scoped "any change to countering" out, which is why this is a draft
and not a fix.
