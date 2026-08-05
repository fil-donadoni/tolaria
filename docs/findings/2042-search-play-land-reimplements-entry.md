---
title: search.ts reimplements play-land inline and skips both battlefield-entry hooks, so ISMCTS rollouts model land entry differently from the real engine
discoveredBy: 2042
status: triaged
issue: 2257
confidence: high
---

**What is wrong.** `applyMoveInSearch`'s `case "play-land"`
(`convex/gre/search.ts:539-558`) moves the card with a bare
`moveCard(player, move.cardInstanceId, "hand", "battlefield")` (`:540-545`)
instead of calling `applyPlayLand`. It therefore calls **neither**
`resetBattlefieldTransientState` **nor** `markEnteredThisTurn` — the two hooks
every real battlefield entry runs.

**Evidence.** The four real entry chokepoints and what each calls:

| chokepoint                                     | `resetBattlefieldTransientState`                | `markEnteredThisTurn`                 |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| `finalizeSpellResolution` `state.ts:5378`      | no (two fields cleared by hand at `:5528-5545`) | yes `:5492`                           |
| `stageReanimatedOnBattlefield` `state.ts:9624` | yes `:9663`                                     | yes `:9669`                           |
| `settleEnteredLand` `playLand.ts:245`          | yes `:264`                                      | yes `:272`                            |
| `createTokenPermanents` `state.ts:16039`       | n/a (new object)                                | equivalent inlined `:16118`, `:16122` |

`search.ts:539` is a fifth path that does neither. Its sibling
`applyMoveForSearch` (`convex/gre/applyMove.ts:295-303`, the bot's 1-ply mover)
correctly calls `applyPlayLand`, and every other move case in `search.ts`
(`"land-entry"` `:478`, `"cast-spell"`) routes through the real resolver — only
`"play-land"` drifted. So a land played inside a rollout has no `enteredOnTurn`
(CR 302.6 control continuity) and keeps any stale battlefield-transient state
from a prior life.

**Why it may not deserve its own issue.** The blast radius is search-only: it
cannot corrupt authoritative game state, and for a _land_ the two missing hooks
are mostly inert (lands do not care about summoning sickness, and a land
re-entering with stale transient state is rare in a rollout). The honest fix is
one line — delete the duplicate and call `applyPlayLand` — which makes it a
good candidate to fold into whatever bot ticket next touches `search.ts` rather
than a ticket of its own. It is filed here because the _class_ (a search-side
reimplementation silently drifting from the engine path it mirrors) is worth a
human deciding on, and because it would be the fifth write site any future
per-entry identity stamp had to remember.
