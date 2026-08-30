---
title: An ability's stack item freezes its source's colours, so announcement and resolution can disagree
discoveredBy: 2942
status: draft
confidence: medium
---

**What is wrong.** An activated/triggered ability's stack item is a
`structuredClone` of its source permanent taken at activation time
(`buildActivatedAbilityStackItem`). Every source-quality gate that runs at
RESOLUTION reads that frozen clone, while the same gate at ANNOUNCEMENT reads
the LIVE battlefield permanent (`pendingTargetingSource`, `kind: "ability"`).
So a colour change to the source between activation and resolution
(Chaoslace, Sleight of Mind, any layer-5 override) is invisible to the
resolution side. It cuts both ways: a source recoloured INTO a quality the
target is protected from still resolves (fail-open), and one recoloured OUT of
it is still treated as illegal (illegality the gate cannot actually prove).

**Evidence.** `convex/gre/state.ts` — `targetStillTargetableBySource` projects
the source off `item`, the clone, not off the live permanent
`item.id` names. The pre-existing CR 702.16e damage leg reads the same clone
(the `isProtectedFromSource(found.card, item, …)` call in `applyDamage`), so
this is not new with issue #2942 — that change only made the skew observable on
one more gate. The announcement side is `convex/gre/rules.ts`
`pendingTargetingSource`, which does `state.players…battlefield.find(...)` for
`kind: "ability"` and therefore always sees current colours.

**Why it may not deserve its own issue.** Reaching it needs a colour-changing
effect resolved in the window between an ability's activation and its
resolution, on a source whose colour is load-bearing for a protection quality
the target has — a narrow line, and the fix is a design question (does CR 608.2b
re-read the source live, or is the activation-time snapshot correct?) rather
than a bug with an obvious answer. Note the snapshot is the RIGHT answer for a
control change after activation (CR 603.3a pins the controller), so "just read
the live permanent" is not a safe blanket fix.
