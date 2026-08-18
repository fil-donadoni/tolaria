---
title: The migration classifier calls a closure FREE on primitives alone, blind to control flow it cannot express
discoveredBy: 2382
status: draft
confidence: medium
---

**What is wrong.** `scripts/migration-classifier.mjs` buckets a `resolve()`
closure by which PRIMITIVES it calls: a closure calling only covered Ops lands
in `FREE (migratable now)`, and additionally in `of which AFK-ready` when the
card carries a per-card test. It never looks at the closure's CONTROL FLOW. So a
body whose every call is covered but whose shape is inexpressible in the DSL's
four frozen constructs (`bind` / `ref` / `if` / `forEach`) is reported as ready
to migrate when it is not. An AFK migration pass that trusts the bucket would
pick such a card up, find no way to write it, and burn a run discovering that.

**Evidence.** Sin, Spira's Punishment
(`convex/cards/sets/fin/multicolor.ts:162` `sinExileRandomPermanentAndCopy`)
calls `getGraveyardCards`, `pickAtRandom`, `moveCardById` and
`createTokenCopyOf` — all covered — inside a `for (;;)` that repeats while the
card it just exiled was a Land ("If the exiled card is a land card, repeat this
process"). `forEach` is bounded over a pre-enumerated collection and `if` does
not loop, so there is no Effect Script for it; adding the card moved the census
from 471/316/307 to 472/317/308
(`scripts/__tests__/migration-classifier.test.ts:1684`), i.e. straight into
FREE **and** AFK-ready. The same blindness applies to any conditional-repeat,
early-`return`-from-a-loop, or accumulate-across-iterations body.

**Why it may not deserve its own issue.** The classifier's own test header calls
the totals a drifting baseline snapshot, not a semantic guarantee, and its stated
purpose is "catch an accidental regression (e.g. the parser silently returning
0)", not to be a migration work-order. The wrong-bucket cost is one wasted
migration attempt per affected card, and the affected population may be tiny —
nobody has counted how many FREE closures contain a loop or an early return. A
cheap first step is a count, not a ticket: if it is one or two cards, an
`UNMIGRATABLE_CONTROL_FLOW` skip-list in the classifier is the whole fix and
belongs on the existing resolve()→effects migration tracker rather than in a
ticket of its own.
