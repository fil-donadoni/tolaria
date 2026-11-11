---
title: Nine card closures still read ctx.getAttachedToId() where `$host` may now serve
discoveredBy: 2016
status: draft
confidence: medium
---

**What is wrong.** The `$host` binding (issue #1341) names an Aura's or
Equipment's attachment host inside an Effect Script. Issue #2016 moved
Venarian Gold, Sleeping Potion, Cocoon and The Brute onto it. Nine `resolve()`
closures still read `ctx.getAttachedToId()` by hand, and several carry comments
saying "NOT DSL-migratable … no attached-host selector". That reason no longer
holds.

**Evidence.** Code sites (comments excluded), at the #2016 branch:

- `convex/cards/sets/drk/black.cards.ts:177`
- `convex/cards/sets/drk/blue.cards.ts:192`
- `convex/cards/sets/fem/black.cards.ts:531`, `:769`
- `convex/cards/sets/arn/blue.cards.ts:337`
- `convex/cards/sets/lea/red.cards.ts:222`
- `convex/cards/sets/leg/black.cards.ts:264`
- `convex/cards/sets/leg/blue.cards.ts:399`
- `convex/cards/sets/tmp/red.cards.ts:129`

Each comment that still says "no attached-host selector" is now stale.

**Why it may not deserve its own issue.** Some of these closures read the
host's _controller_ or combine the host with a choice, not just act on it. In
those cases the missing piece is a different one (a host-controller player
selector, for example) and `$host` alone does not migrate them. The sweep may
shrink to a few cards plus comment corrections, which could go in a
`/new-card` hand-tail pass rather than a separate ticket.

**Stale prose noticed in review.** `convex/gre/ai/blade/scenarios.ts:18575`
(note of the issue #5493 entry) and `convex/gre/ai/futileShield.ts:43` still
describe Sleeping Potion's enters trigger as a `resolve()` closure read through
an `aiEffects` shadow script. It is now an `effects` script on `$host`. Behaviour
is the same, because `futileShield.ts` reads `effects ?? aiEffects` and the
script still only taps.
