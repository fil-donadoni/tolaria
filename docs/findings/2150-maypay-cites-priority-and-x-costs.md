---
title: The `mayPay` convention cites CR 117.3a/118.4, which say nothing about a resolution-time optional cost
discoveredBy: 2150
status: draft
confidence: high
---

**What is wrong.** Every card and comment describing "you may pay {cost}. If you
do, …" is annotated `CR 117.3a/118.4 optional additional-cost mayPay`. Both ids
resolve, so `cr:lint` is green, but neither rule says anything of the kind, and
each already has a ledger entry asserting a reader printed it and agreed.

**Evidence.** Printed from the vendored CR:

- `CR 117.3a` — "The active player receives priority at the beginning of most
  steps and phases…". Priority, not costs.
- `CR 118.4` — "Some costs include an {X} or an X. See rule 107.3." A different
  kind of cost entirely.
- The rule that DOES describe the shape is **`CR 118.12`**: "[A player] may [do
  something]. If [that player] [does, doesn't, or can't], [effect]. … The action
  [do something] is a cost, **paid when the spell or ability resolves**." The
  hybrid-mana case is `CR 118.13b`.
- "Additional cost" is also wrong: `CR 118.8` additional costs are paid **as the
  spell is cast**, which is exactly what `mayPay` is not.

The convention spans ~38 sites, including the `mayPay` executor itself
(`convex/gre/effects/interpreter.ts`, the `mayPay` case) and Dromar / Rith /
Treva (`convex/cards/sets/inv/multicolor.ts`). PR #4412 fixed only the four
lines it authored (Crosis, Darigaaz and their two test describes) and left the
rest, because re-wording 38 lines invalidates 38 ledger entries and is a
separate change.

**Why it may not deserve its own issue.** It changes no behaviour and no test —
it is documentation accuracy on a rule the engine implements correctly. But it
is the one failure mode the confirm-after-printing contract (ADR 0133) exists to
stop, and `cr:lint` structurally cannot catch it: the ids resolve. A sweep that
re-points all 38 to CR 118.12 and re-confirms them would be a single `docs`-lane
change.
