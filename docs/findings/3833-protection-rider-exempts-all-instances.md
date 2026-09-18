---
title: exemptFromProtectionDetach exempts an Aura from EVERY protection instance, not only its own grant
discoveredBy: 3833
status: draft
confidence: medium
---

**What is wrong.** The last sentence of CR 702.16n says that if the creature
has other instances of protection from the same quality, those instances
affect Auras as normal. `exemptFromProtectionDetach` is a card-level boolean
that `convex/gre/sba.ts` (~308) reads as "never detach this Aura for
protection". So a White Ward on a creature that also has printed protection
from white stays attached, when it should fall off (CR 704.5m).

**Evidence.** `convex/gre/sba.ts:308`. The hand-written Ward cycle
(`convex/cards/sets/lea/white.ts`, `makeColorWard`) already ships this way.
Since issue #3833 the compiler emits the same field for every "This effect
doesn't remove this Aura" line: the Wards, and any future card that prints
the rider.

**Why it may not deserve its own issue.** It needs two sources of the same
protection quality on one creature. No preset deck builds that, and the
hand-written behaviour predates the compiler.
