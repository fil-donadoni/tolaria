---
title: "`CR 114.1` is cited catalogue-wide for spell targeting, but rule 114 is EMBLEMS"
discoveredBy: 2708
status: draft
confidence: high
---

**What is wrong.** Every spell-target filter in the registry cites `CR 114.1`
for "you may target a spell or ability on the stack". Printed:

```
$ bun run cr 114.1
114.1. Some effects put emblems into the command zone. An emblem is a marker
used to represent an object that has one or more abilities, but usually no
other characteristics.
```

The rule meant is **CR 115.2** — "Only permanents are legal targets for spells
and abilities, unless a spell or ability … (b) targets an object that can't
exist on the battlefield, such as a spell or ability." A smaller one rides
along: **CR 109.3** (characteristics — which says outright that a controller is
NOT one) is cited where **CR 109.4** ("only objects on the stack or on the
battlefield have a controller") is meant.

**Evidence.** `convex/gre/targetFilters.ts` — the `spellTargetsInstanceIds`,
`spellTypeFilter`, `spellExcludeTypeFilter`, `spellCreaturePtFilter` and
`spellWouldDestroyLandYouControl` descriptors; their `TargetRequirement` doc
comments in `convex/cards/types.ts`; the `PendingTarget` carrier docs in
`convex/gre/state.ts`; and the card comments that copied them (Confound,
Mistfolk, Ward). `bun run cr:lint` cannot see any of it: the scan asks whether
an id RESOLVES, and 114.1 does — this is exactly the "resolvable but wrong"
blind spot its own documentation names, outside the 701/702 keyword scan.

Issue #2708 corrected only the lines it authored, so new code carries CR 115.2 /
109.4 while its neighbours still carry the old numbers — the drift is now
visible in one file, which is the cheapest moment to decide.

**Why it may not deserve its own issue.** Nothing executes a comment: no test,
no gate and no player behaviour changes. The cost is paid by the next author who
follows the citation to pick a filter and lands in the emblem section. If that
is judged cheap, this is a line on the CR-hygiene tracker rather than a ticket;
if a sweep is wanted it is mechanical (~15 lines) and could ride any later
targeting change.
