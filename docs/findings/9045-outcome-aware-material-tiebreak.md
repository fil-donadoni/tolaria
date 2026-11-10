---
title: The material tie-break ranks a certain loss by its surviving material — Edge.totalMargin counts a terminal loss as board
discoveredBy: 9045
status: draft
confidence: medium
---

**What is wrong.** Among outcome-equal root contenders (inside `outcomeEps`
on the blended score) `selectRootMove` picks the highest `meanMargin`
(`Edge.totalMargin / visits`, `convex/gre/search.ts`). `totalMargin`
accumulates the leaf's material margin whatever the leaf's OUTCOME: a
rollout that ends in the Bot's defeat with three creatures still on its board
contributes a better margin than one that ends with the Bot alive and one
creature. So when a line that loses for certain and a line that merely loses
most of the time fall inside the same reward band, the tie-break can prefer
the certain loss because its corpses are bigger. ADR 0176 § What was measured
item 2 saw exactly this under the compressive tail: Toxic Deluge's survivors
collapsed from 0.05 to 0.005, the suicide cast (paying to exactly 0 life)
came back inside `outcomeEps`, and the material tie-break took it. The hard
clip keeps a full `outcomeEps` between them today — by the clip's accident,
not by the tie-break's design.

**Evidence.** `convex/gre/search.ts`: `Edge.totalMargin` (accumulated in the
backprop beside `totalReward`), `meanMargin` in `selectRootMove`; ADR 0176
items 2 and 3 (the margin-point band that tried to fix it broke five other
entries); ADR 0177's result on the entry: "life X: Toxic Deluge never pays
to lethal" is green under the Root Heuristic Share λ = 0.1 on all five seeds,
verdict `material-tiebreak` each time — the blend did not change which rule
decides it, and the tie-break still ranks by surviving material. The
one-ply reading of paying to lethal is the loss band, so a larger λ WOULD
separate them; at 0.1 the entry's clearance is still the clip's, not λ's.

**The shape of a fix.** An outcome-aware margin: a leaf inside a terminal
band contributes the band's edge (a loss counts as "all material gone", a
win as "everything kept") rather than its board count, so `meanMargin`
orders by survival first and by material only among lines of the same
outcome. It changes every root rule that reads `meanMargin`, so it owes the
whole `must` tier and the held-out agreement before it lands, and ADR 0176's
item 3 says a hand-tuned band is the wrong instrument.

**Why it may not deserve its own issue.** Under the base vector's hard clip
no `must` entry is decided by it today, and the Root Heuristic Share gives
the loss band a direct voice at the root (the one-ply reading of a suicide
line is the floor). It becomes a ticket the day the reward tail
(`reward-soft-tail`) is made the default — ADR 0176 lists it as the first
design decision that change needs — or a position shows the tie-break
preferring a certain loss under the clip.
