---
title: At the last window before its own turn, `pass` is scored a full round later than a cast
discoveredBy: 5029
status: draft
confidence: medium
---

**What is wrong.** In the opponent's end step, the root `pass` edge and a root
cast edge are not scored at the same game clock. Applying `pass` in the tree
crosses the turn boundary, so the rollout under it starts in the Bot's NEW turn
and plays a whole further round before the turn-boundary horizon stops it; the
rollout under a cast starts in the old turn and stops at the Bot's next turn
start. `pass` is therefore credited with one more natural draw and one more
turn of development than the cast it is compared with — and it can still cast
the card inside that extra round.

**Evidence.** Shimmering Mirage ("Target land becomes the basic land type of
your choice until end of turn. Draw a card."), Bot-play sweep position,
`OPPONENT_END_STEP` window, 48 iterations, seeds `0xb07` / `0x5eed`:

| Holder's library                  | `pass` meanMargin | cast meanMargin | picked             |
| --------------------------------- | ----------------- | --------------- | ------------------ |
| 8 Serra Angel + 20 basics (today) | 228 / 180         | 188 / 182       | cast (deferral)    |
| 28 Serra Angel (experiment)       | 390 / 391         | 276 / 276       | pass (mean reward) |

The 1-ply leaf favours the cast in both (297 vs 164). On the filler pile the
gap stays inside `outcomeEps` and `last-window-deferral` picks the cast; with
every natural draw worth a spell the extra round is worth one more Angel, the
gap leaves `outcomeEps` (0.690 vs 0.638) and `pass` wins on mean reward. The
three cast edges score an identical 276 on both seeds — the rollout under them
ends at once, before the next draw (`rollout`, `convex/gre/search.ts`: the
horizon is `turnChanged && activePlayerId === botId`, measured from the turn
the ROLLOUT starts in).

This is why issue #5029 stocked the whole library only for a draw paid for with
a creature (`paysBodyForDraw`, `convex/gre/ai/botReach.ts`): applied to every
draw pose, the richer library flipped Shimmering Mirage `played` → `ignored`
and nothing else among the 123 `ready` cards whose spell draws for its
controller.

**Why it may not deserve its own issue.** Measured on one generated position
and one window. In live play the same bias would make the Bot hold an
instant-speed cantrip at the opponent's end step whenever its library is rich,
but `last-window-deferral` covers the outcome-equal case and no blade entry or
in-play Verdict reports the hold today. If one does, the fix is in the horizon
(score both edges at the same turn start), not in a weight.
