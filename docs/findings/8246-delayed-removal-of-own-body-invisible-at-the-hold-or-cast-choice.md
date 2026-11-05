---
title: With its hand worth corrected, the Bot burns a reanimate-then-exile spell on a body that cannot connect
discoveredBy: 8246
status: draft
confidence: medium
---

**What is wrong.** Shallow Grave in hand, Grizzly Bears in the graveyard, two
Swamps, an untapped opposing Hill Giant, 20 life each: the hasty Bears cannot
attack profitably and is exiled at the end step, so casting spends a card for
nothing. Holding it looks right. The Bot casts it on every seed once the
script's own exile is priced as a cost.

**Evidence.** 400 iterations, eight seeds, measured on PR for issue #8246: 4
casts and 4 passes with the old `+169.7` delayed exile, 8 casts with the
corrected price. The old price was restraining the cast only by inflating the
hand worth. `convex/gre/evaluate.ts` holds no read of a scheduled delayed
trigger; `convex/gre/ai/pendingReturn.ts` covers the opposite shape, a delayed
RETURN. That the leaf scores the Bears as a lasting body is the likely cause,
not a measured one.

**Why it may not deserve its own issue.** It is one hand-built position, and
the old split was already a tie decided by rollout noise. Nine other positions
measured for issue #8246, lethal lines and pay-or-destroy among them, did not
move at all. It may be one line on the evaluation-reading work.
