---
title: activateAbility opens a target selection for a zero-resolved-count requirement; announceCast skips it
discoveredBy: 2870
status: draft
confidence: medium
---

**What is wrong.** The two announce paths disagree on whether a target
requirement whose RESOLVED count is zero opens a `PendingTarget` at all
(CR 601.2c). `announceCast` skips selection entirely — that is what
`requiresTargets` is for, and #2870 made it the shared
`announcedTargetCount(...) !== undefined`. `activateAbility` has no equivalent
gate: its whole targeted branch is `if (effectiveTargetReq)`, so a requirement
resolving to `0` / `{ min: 0, max: 0 }` still writes
`state.pendingTarget` and returns. Nothing then finalizes it — the auto-finalize
lives inside `applyOneTargetSelection`, which never runs because there is no
legal pick to make, and `confirmTargets` would be the only way out.

**Evidence.** `convex/game.ts:14204` (`if (effectiveTargetReq) {`) versus
`convex/game.ts:8316` (`const requiresTargets = resolvedCount !== undefined;`).
`convex/game.ts:14362` writes `count: abilityCount` unconditionally.
`convex/gre/pendingTargetOrigin.ts` `announcedTargetCount` is the shared
authority the cast path now reads; the ability path still derives
`abilityCount` itself (and applies the CR 601.2d divide cap in its own copy at
`convex/game.ts:14346`).

Bot-side consequence: the Move enumerator reads `announcedTargetCount`, which
returns `undefined` for a zero max, so `announcedTargetsNeedConfirm` declares
`confirmTargets: false` — the executor sends `activateAbility` and nothing else,
and the activation strands at an owed `"target"` input of announced origin.
That is the #2870 freeze shape, reached through a different door.

**Why it may not deserve its own issue.** Probably unreachable today. An
activated ability only learns a `chosenX` when X is in its own cost
(`convex/game.ts:14254`, `targetHasXInCost`), and `resolveTargetCount` is called
with `requireX: true`, so an `{ min: 0, max: "X" }` requirement on an ability
WITHOUT X in its cost throws rather than resolving to zero. That leaves a
literal `count: 0` or `{ min: 0, max: 0 }` written by hand, which no shipped
card does — the three shipped min-0 ability requirements (Teferi, Time
Raveler's −3, Sorin, Lord of Innistrad's −6, Minsc & Boo's +1) are all
`{ min: 0, max: 1 }`. So this is a fail-open divergence with no current
consumer: arguably a line on the cast/ability announce-parity work rather than
a ticket. It becomes live the moment an ability ships with an X-derived target
count, and the cheap close is to route the ability path through
`announcedTargetCount` too — which is a real refactor of a 200-line branch
whose cost validations sit INSIDE the gate, not the one-liner it looks like.

**Not introduced by #2870.** Before that change the enumerator's predicate was
`isVariableCount(req) && targets.length > 0`, which for a zero-max requirement
also yielded `false` (the tuple is empty). Same outcome, different reasoning.
