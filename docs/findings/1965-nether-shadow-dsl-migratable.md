---
title: Nether Shadow's "not DSL-migratable" self-reanimation blocker appears stale
discoveredBy: 1965
status: draft
confidence: medium
---

**What is wrong.** Nether Shadow's `resolve()` closure
(`convex/cards/sets/lea/black.ts:848-856`) carries a comment declaring the
card "NOT DSL-migratable (ADR 0045)": _"the generic `$source` object-ref path
… only resolves a battlefield permanent or (via the digToHand fallback) a
hand card — a graveyard-zone `$source` resolves to neither, so no `moveZone`
Op can reach it declaratively."_

That claim looks stale. Implementing issue #1965's Sword of the Meek
(`convex/cards/sets/fut/colorless.ts`) required the exact same shape — a
`zone: "graveyard"` **triggered** ability whose effect self-reanimates via
`{ op: "moveZone", target: { ref: "$source" }, to: "battlefield" }` gated by
a cost-free `mayPay` ("you may") — and it works: `resolveObjectRef`
(`convex/gre/effects/interpreter.ts:2509-2521`) has an unconditional
`$source` graveyard-recovery path, added for issue #737 (Ashen Ghoul) citing
the same "$source genuinely sits in a graveyard" case. Ashen Ghoul
(`convex/cards/sets/ice/black.ts:195-214`) already proves the Op works from
an **activated** graveyard-zone ability; Sword of the Meek now proves it also
works from a **triggered** one with a `mayPay`/`if` gate — Nether Shadow's own
shape (`phaseTrigger` + `resolve()`'s `requestMayPay` then
`returnToBattlefield`).

**Evidence.**

- `convex/cards/sets/lea/black.ts:848-856` — the stale "NOT DSL-migratable"
  comment and its `resolve()` closure.
- `convex/gre/effects/interpreter.ts:2509-2521` — the unconditional `$source`
  graveyard-recovery branch the comment says doesn't exist.
- `convex/cards/sets/ice/black.ts:195-214` (Ashen Ghoul) and
  `convex/cards/sets/fut/colorless.ts:122-163` (Sword of the Meek, this
  issue) — two independent working DSL cards using exactly the composition
  Nether Shadow's comment rules out.

**Why it may not deserve its own issue.** Nether Shadow already ships and
works correctly via `resolve()` — this is a pure code-quality migration
(DSL-first per ADR 0045), not a bug or a blocked card. It's also not risk-free
to just flip: Nether Shadow's `interveningIf` (`creatureCardsAboveInGraveyard(state, self) >= 3`)
would need to keep working unchanged, and the `mayPay` DSL Op's suspend/resume
shape needs to be checked against `phaseTrigger`'s `zone: "graveyard"` +
`interveningIf` combination specifically (Sword of the Meek's trigger has no
`interveningIf`). Worth a line on a future DSL-migration sweep rather than a
standalone ticket.
