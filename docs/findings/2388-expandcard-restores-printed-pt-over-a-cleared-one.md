---
title: expandCard silently restores a printed P/T over an instance that deliberately has none
discoveredBy: 2388
status: draft
confidence: medium
---

**What is wrong.** `expandCard` decides whether an instance has a power/toughness
with `"power" in compact ? compact.power : def?.power`. `compactCard` writes
`out.power = card.power` whenever it differs from the definition — including
when `card.power` is `undefined`. An explicit `undefined` does not survive
`JSON.stringify`, so after a real DB round-trip the key is gone, the `in` test
reads false, and the definition fallback hands back the PRINTED value. Any
in-place mutation that makes a permanent stop being a creature therefore comes
back from a save/load as its printed body.

**Evidence.** `convex/gre/serialize.ts:177-178` (`if (card.power !== def?.power)
out.power = card.power;`) and `convex/gre/serialize.ts:545-551` (the
`"power" in compact` fallback). Bestow (CR 702.103b, issue #2388) is the first
producer to hit it — a bestowed permanent is an `Enchantment — Aura` with no
P/T — and is patched narrowly at `convex/gre/serialize.ts` in `expandCard`'s
`compact.bestowed` branch, which re-clears both fields after the fallback has
run. The in-memory `expandState(compactState(state))` round-trip does NOT
reproduce the drop (the key survives as `undefined`), so a test has to go
through `JSON.parse(JSON.stringify(...))` to see it — which is why this went
unnoticed: `convex/gre/__tests__/serialize.test.ts` uses the in-memory form
throughout.

**Why it may not deserve its own issue.** Bestow is the only shipped producer of
a P/T-less permanent today, and it now carries its own re-clear, so nothing is
currently broken. The general fix (a `null` sentinel in `compactCard`, or a
`hasPower` flag) touches the hottest serializer in the engine for a class with
exactly one member. It may be better as a line on the serialization tracker
than a ticket — but the next "becomes a noncreature in place" mechanic
(Humility-style type removal, an animate that ENDS) will hit it the same way
and, unlike bestow, may not have an obvious flag to hang the re-clear on.
