---
title: solveSmartAutoTap's companion-summon path is a separate producer, also blind to non-tap mana abilities
discoveredBy: 2420
status: draft
confidence: medium
---

**What is wrong.** Issue #2420 fixed the bot's payment planner
(`planManaPayment`, `convex/gre/moves.ts`) so a `useStack: false` mana ability
with a `tapOtherFilter` or pure `cost.mana` cost (Urza, Lord High Artificer;
Farrelite Priest / Initiates of the Ebon Hand) is reachable when it funds a
spell's or an activated ability's cost. There is a SECOND, completely
independent auto-tap solver — `solveSmartAutoTap` (used to pay the fixed
`{3}` Companion-summon special action) — with the same blind spot: it only
ever marks `player.battlefield` entries tapped by `cardInstanceId`
(`convex/gre/applyMove.ts:735-750`, `convex/gre/search.ts:740-757`,
`convex/game.ts:5895-5910`, `convex/game.ts:11707` and one more site in
`convex/gre/state.ts:18868`), with no concept of a non-tap mana ability at
all.

**Evidence.** `convex/gre/applyMove.ts` and `convex/gre/search.ts` each carry
their own companion-summon block, both structured identically:

```ts
const plan = solveSmartAutoTap(
    player.manaPool,
    COMPANION_SUMMON_COST,
    subs,
    sources
);
if (plan) {
    for (const step of plan) {
        const src = player.battlefield.find((c) => c.id === step.cardId);
        if (src) src.isTapped = true;
    }
}
```

`buildAutoTapSources` (its source enumerator) is a third, unrelated function
from `getManaTapOptionsDetailed`/`getProducibleManaOptions` — it was never
touched by #2420's `isAutoPayableManaAbilityCost` allow-list, so Urza /
Farrelite Priest cannot fund a Companion summon today even though they can
now fund an ordinary spell or activated ability.

**Why it may not deserve its own issue yet.** No shipped Companion needs a
non-tap mana source to be affordable — Companion's cost is a flat `{3}`
generic, payable by any ordinary land/rock, and the summon is optional (a
player/bot missing the `{3}` simply doesn't summon it). This is a real gap in
the SAME bug class #2420 fixed, but it has no observable symptom today
(nothing currently plays a Companion deck where Urza/Farrelite are the only
untapped sources at the moment of summon). Worth a line on a future
mana-planner-parity tracker if one exists, or its own slice if a Companion
build actually needs it — not urgent enough to interrupt the queue for.
