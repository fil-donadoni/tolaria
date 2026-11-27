---
title: a station striation's gated static effects will red counterGatedStatics.test.ts
discoveredBy: 10561
status: draft
confidence: high
---

**What is wrong.** `thresholdStatics` in `convex/cards/abilities/station.ts`
wraps a striation's `staticEffects[]` with `gateSectionStatic(effect, inForce)`
and stamps `dependsOnCounters: true` on the result. The wrapper's `applies`
source text is `inForce(source) && applies(...)`, and it never says `counters`.
`counterGatedStatics.test.ts` § "every declared dependency is on a static effect
that actually reads counters" decides from `Function.prototype.toString` on the
predicate, so it will flag the first shipped station card that prints a static
in a striation (Deep Space 9, issue #10552, or any Planet) as a stray
declaration, even though the declaration is correct.

**Evidence.** U.S.S. Voyager (issue #10561) hit the same failure on its keyword
grant. That PR fixed only the self predicate (`onSelf`), by writing the
charge-counter read out in full. The synthetic Planet in
`convex/cards/__tests__/station.helper.ts` is registered as a token, and
`getAllCards()` skips tokens, so this guard has never seen the gated path.

**Why it may not deserve its own issue.** It surfaces the moment the next
station card lands, inside that card's own pass, and the fix is local. One
option is to inline the charge read in the gated wrapper. The better option is
to give the guard a way to recognise a helper that reads counters, so it does
not depend on predicate source text.
