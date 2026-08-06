---
title: ExpectedInput folds three different turn-based actions into `priority`
discoveredBy: 2284
status: draft
confidence: medium
---

## What I noticed

`computeExpectedInput` (`convex/gre/expectedInput.ts:39`) has six kinds, and
`priority` is a catch-all that covers at least four structurally different
windows:

- an ordinary CR 117 priority window (`passPriority` is legal);
- the pre-game **mulligan declaration** (`convex/gre/setup.ts:115` sets
  `priorityPlayerId = mulligan.declaringPlayerId`, and only `declareMulligan`
  makes progress — `passPriority` is not the answer);
- the **declare-attackers** turn-based action (CR 508.1) — `passPriority` is
  rejected until `confirmAttackers` lands
  (`convex/game.ts:10486`);
- the CR 510.1c **combat-damage assignment** sub-flow, which is explicitly
  documented as folding into `priority` with `anyPlayer: true`
  (`convex/gre/expectedInput.ts:116-133`) because the real actor is not
  `priorityPlayerId`.

Note the asymmetry: declare-BLOCKERS got its own kind (`blockers`), the attack
land tax got `sacrifice` and the attack mana tax got `attack-mana-tax` — but
declare-ATTACKERS and the mulligan declaration did not.

## Why it matters here

Issue #2284 makes the bot answer each Expected Input kind through a
compile-time-exhaustive switch. For five of the six kinds the kind alone
determines the answer. For `priority` it cannot: `decidePriorityAction`
(`src/lib/ai/brain.ts`) still has to re-inspect `phase`, `combat` and
`mulligan` to decide between `declareMulligan`, `confirmAttackers`,
`confirmDamage` and `passPriority`. That residual inspection is the last place
in the bot where a new waiting shape can be added without the compiler
noticing — every other kind is now guarded.

It also weakens the escalation ladder: `ESCALATION_POLICY.priority.canPass` is
`true`, yet a pass is illegal in three of the four windows the kind covers. The
ladder works around it by ordering `confirm-no-attackers` / `confirm-damage`
ahead of the pass, but the policy table is stating something that is only
true for one of the four.

## Why it might NOT deserve a ticket

- Splitting `priority` is an ENGINE change touching the gate every mutation
  routes through (`assertExpectedInput`, ~40 call sites in `convex/game.ts`),
  and the issue that surfaced it explicitly put "changing any engine waiting
  state, the Expected Input derivation, or its gate" out of scope.
- ADR 0047 chose the factored representation deliberately and argues a flatter
  enum re-embeds the composite fields. A `declare-attackers` kind is a smaller
  step than that, but the same argument partly applies.
- Nothing is broken today: every one of these windows is answered correctly,
  and the combat-damage fold is covered by `computeOwedPlayerIds`.

The cost is future-proofing, not correctness — which is exactly the kind of gap
that is cheap now and expensive after the next waiting shape lands.
