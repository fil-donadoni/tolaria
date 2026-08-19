---
title: The Bot can never cast a Flashback or Escape card from its graveyard — enumerateMoves has no graveyard cast loop
discoveredBy: 2358
status: draft
confidence: high
---

**What is wrong.** `enumerateMoves` (`convex/gre/moves.ts`) has never fed a
graveyard card to `enumerateCastMoves`. The graveyard is scanned twice — once
for a land PLAY under `playsLandsFromGraveyard` (`moves.ts:1912-1917`) and once
for graveyard-source ACTIVATED abilities (`moves.ts:1993-1999`) — but never for a
keyword CAST. So every graveyard-cast mechanism the engine ships is invisible to
the play Bot: Flashback (CR 702.34), Escape (CR 702.138), the broad
`grantCastFromGraveyard` permission (Yawgmoth's Will), the per-card grant
(Malcolm), Hogaak's intrinsic permission, and Lurrus's once-per-turn permanent
permission. A Bot holding six shipped flashback cards plays none of them from the
graveyard, ever, and the omission is silent: `getLegalActions` correctly returns
`"cast"` for all of them, so nothing in the engine reports a disagreement.

**Evidence.**

- `convex/gre/moves.ts:1909-1911` — the comment asserts a graveyard/library CAST
  is "a separate mechanism (flashback/escape) enumerated elsewhere". There is no
  elsewhere: `enumerateCastMoves` is called from exactly three sites in
  `enumerateMoves` — `player.hand` (`:1898`), `libraryTop` (`:1972`), and the
  retrace loop this issue added (`:1937`).
- `convex/gre/applyMove.ts:~712` — the greedy sandbox's `castFromZone` resolved
  only `"hand"` / `"library"` before this issue; `convex/gre/search.ts:~730`
  hard-coded `"hand"` outright. A graveyard-cast Move would have thrown
  `Card <id> not found in hand`, which is why the enumerator gap and the executor
  gap have to be closed together.
- Neither sandbox knows the per-mechanism stack flags: Flashback needs
  `exileOnResolve` (CR 702.34a) and Escape needs `escaped` + its exile-N-others
  cost (CR 702.138a). Issue #2358 added `applyRetraceCastForSearch`
  (`applyMove.ts`) for retrace's own flags and cost; the other five mechanisms
  each need the same treatment or the search will model a flashback card as
  infinitely reusable — the exact unbounded-recast failure the retrace charge was
  written to prevent.

**Why it may not deserve its own issue.** It is arguably one line on the bot
wayfinder tracker (#1254) rather than a standalone ticket: the fix is not a bug
in a seam but a per-mechanism build-out across the enumerator plus two sandbox
executors, and its value depends entirely on whether the Bot's deck pool actually
contains graveyard-cast cards (today the cube does, the preset decks mostly do
not). It is also strictly a move-QUALITY gap, never a legality or freeze gap —
the server re-validates every real move, and a move the Bot never generates
cannot stall it.
