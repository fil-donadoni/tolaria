---
title: Every compiled "you may" trigger quarantines on the smoke gate, so the class can never reach ready
discoveredBy: 3022
status: draft
confidence: high
---

**What is wrong.** Issue #3022 taught the triggered slot to compile
`"…, you may <effect>."` onto `mayPay` (cost-free) + `if`. All 46 cards the
change moves land in `quarantine`, none in `ready` — and no card of this class
ever can, whatever the grammar later learns. `runGates` records a smoke
planner `skip` as a quarantine reason, and `planSmokeTest` skips
unconditionally on `mayPay` ("suspends for a Pay/Skip decision") and on `if`
("branches on a runtime predicate"). Both skips say the same thing: _covered by
the card's own tests_ — which is true for a hand-written card and false for a
compiled one, which has no tests of its own.

**Evidence.** `convex/oracle/gates.ts` — `if (plan.kind === "skip") reasons.push({ kind: "smoke-scenario", … })`;
`convex/gre/effects/scenarioGenerator.ts:735` (`mayPay`) and `:847` (`if`).
Reproduced: `"When this creature enters, you may draw a card."` compiles to the
exact intended Op pair and returns
`state: "quarantine"`, `reasons: [{ kind: "smoke-scenario", detail: 'Op "mayPay" suspends…' }]`.

**Why it may not deserve its own issue.** It is not new and not specific to
`mayPay`: `moveZone` already quarantines the same way ("changes zones on an
object/zone the canned generator does not model"), so this is one instance of a
standing question — what `ready` should mean for a script the canned generator
cannot smoke. That question belongs to PRD #2693's gate design, and the answer
is a judgement call (teach the generator to answer a canned Pay/Skip; or make a
skip a non-blocking note; or leave the class quarantined and say so in the
report), not a fix this ticket could have made.
