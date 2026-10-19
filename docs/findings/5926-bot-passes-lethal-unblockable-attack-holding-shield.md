---
title: Bot passes on a lethal, unblockable attack while holding a combat-damage shield (material-tiebreak)
discoveredBy: 5926
status: draft
confidence: medium
---

**What is wrong.** Holder at 6 life, only body tapped, opponent attacks with
Craw Wurm (6/4), holder has Warning ({W}, prevent all combat damage dealt by
target attacking creature) and the mana. Passing is lethal. Over seeds
0xb1ade, 1, 2, 3, 4 at 400 iterations the Bot casts on seeds 2-4 and passes on
0xb1ade and 1, the pick falling to `material-tiebreak`.

**Evidence.** Blade entry "Warning: shields a lethal attacker it cannot block"
(`convex/gre/ai/blade/registry.ts`, tier `stretch`). On seed 1 the root
candidates read cast `meanReward` 0.219 / 215 visits / `meanMargin` -308 vs pass
0.203 / 185 visits / `meanMargin` -240; the static leaf `eval` for pass keeps
`hand` 70 and `flexibility` 7.15 that cast spends, with `life` equal (48)
on both. The unblocked swing is not visible in the leaf: the known combat
washout at the horizon (memory `project_combat_eval_washed_at_horizon`).

**Why it may not deserve its own issue.** One shipped card (Warning) rides
this shape, and the sweep pose added by issue #5926 now reads it `played` on
the default seeds. It becomes a ticket if a second damage-shield card shows the
same tiebreak, or if the fix is a leaf term for "lethal combat damage pending
against the holder" that other positions also need.
