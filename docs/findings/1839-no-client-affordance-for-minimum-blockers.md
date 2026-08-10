---
title: The board gives no affordance for minimum-blocker restrictions — the player only learns at confirm
discoveredBy: 1839
status: draft
confidence: medium
---

**What is wrong.** Minimum-blocker restrictions (menace, and now the
`minimum-blockers:N` rules-text form) are enforced ONLY at blocker-confirm, and
the client has no reader for them at all. `useBattlefieldVisualState` computes
per-blocker eligibility (flying/reach) to highlight legal blocks, but nothing
computes the count threshold, so the UI lets a defender assign one creature to a
Troll of Khazad-dûm, shows it as a legal-looking block, and only surfaces
"…can't be blocked except by 3 or more creatures" as a server rejection string
when they press Confirm. With N = 3 the dead end is three times as easy to walk
into as menace's N = 2, which is what made this visible.

**Evidence.** `src/hooks/useBattlefieldVisualState.ts:354-365` (the only
client-side block-legality computation — flying/reach only);
`src/hooks/useControllerActions.ts:103` (the rejection string is the entire
client-side feedback); enforcement at `convex/gre/combat.ts:229`
`validateMinimumBlockers` ← `convex/game.ts:11308`. The bot has the
corresponding reader (`convex/gre/moves.ts:1466` filters sub-threshold combos out
of its legal moves), so today the AI knows the rule and the human does not.

**Why it may not deserve its own issue.** It is a pre-existing menace behaviour,
not a regression, and it is a UX affordance rather than a rules bug — the
declaration is correctly rejected either way, so nothing illegal can be
committed. It may be better shaped as one line on a broader "combat declaration
affordances" ticket than as its own.
