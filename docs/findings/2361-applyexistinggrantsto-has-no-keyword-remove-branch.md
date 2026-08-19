---
title: applyExistingGrantsTo has no keyword-remove branch, so a permanent entering under a live stripper keeps the keyword
discoveredBy: 2361
status: draft
confidence: high
---

**What is wrong.** `applyExistingGrantsTo` is the entry-side recompute that
re-applies every live continuous effect to a permanent as it enters the
battlefield. It branches on `keyword-grant`, `activated-grant`,
`triggered-grant`, `type-add`, `color-grant`, `subtype-set`, `subtype-add`,
`supertype-set` and `ability-loss` — but **not** on `keyword-remove`. A
permanent that enters while a `keyword-remove` source is already on the
battlefield therefore keeps the keyword the source is supposed to strip, and no
`removedKeywords` hold is recorded for it.

**Evidence.** `convex/gre/state.ts:7361-7556` is the branch chain; the last
branch is `effect.kind === "ability-loss"` at `convex/gre/state.ts:7538`, and
the loop ends without a `keyword-remove` arm. The only shipped producer today is
Gravity Sphere (`convex/cards/sets/leg/red.ts:18`, "All creatures lose flying").
Measured on this branch: with a Gravity Sphere already on the battlefield, a
Serra Angel entering through `applyExistingGrantsTo` keeps `staticAbilities`
`["flying","vigilance"]` with `removedKeywords` undefined — flying is never
stripped and no hold is recorded. The same is true after a
bounce-and-recast, which is how the gap surfaced during the review of PR #2572:
`resetBattlefieldTransientState` correctly hands the held occurrence back when
the creature leaves (CR 400.7), and nothing re-takes it on re-entry.

The strip only ever lands through `applySourceStaticEffects` — i.e. when the
Sphere itself enters or is recomputed — so the current behaviour is
"snapshot at the stripper's timestamp", not the continuous effect CR 611.2
describes. The narrow fix is a `keyword-remove` arm in `applyExistingGrantsTo`
mirroring the source-side arm at `convex/gre/state.ts:6936` (splice one
occurrence out of `staticAbilities`, push a `removedKeywords` hold keyed to the
source and its `staticSeq`) — the shape the `ability-loss` arm already has. The
inline body there wants extracting into a named helper first, so the two sites
cannot drift.

**Why it may not deserve its own issue.** It is a pre-existing gap with exactly
one shipped producer, and that producer's practical exposure is small: Gravity
Sphere is a symmetric static that players read as "no flying", and the
`unapplySourceStaticEffects` teardown is correct, so no state gets _stuck_
wrong — a later recompute of the Sphere fixes it. It is also plausibly one
instance of a broader "entry-side recompute lags the source-side apply" class
(the branch chain is a hand-maintained duplicate of `applySourceStaticEffects`'s
switch, with no drift guard), in which case the right ticket is the drift guard
rather than this one arm.
