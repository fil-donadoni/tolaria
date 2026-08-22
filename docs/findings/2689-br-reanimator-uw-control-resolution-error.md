---
title: br-reanimator vs uw-control guard-stops 100% of the time on resolution-error
discoveredBy: 2689
status: resolved
confidence: high
---

**Resolution (round-2 fixup, PR #2692).** The diagnosis below was wrong — none
of the four "candidate suspects" it originally named are at fault. The real
cause is a single missing branch in the self-play harness's zone-pick
candidate lister, `listCandidates` (`src/lib/ai/selfplay/playGame.ts`), shared
with the round-1 review's finding 1 (the R1 library-branch bug): the function
handled `zone: "hand"` and `zone: "battlefield"` correctly but had **no
`zone: "graveyard"` branch at all**. `br-reanimator`'s Exhume (CR 701.16
reanimate) raises a non-targeted `choose-graveyard-card` choice
(`zone="graveyard"`, `count=1`, `candidateIds=['24']` in the reproduction
below) that fell through to the no-zone fallback, which filters
`state.players.flatMap(p => p.battlefield)` by `candidateIds` — a graveyard
card is never on a battlefield, so this always returned `[]`, and the
resolver's default policy then threw `Select at least 1 card`.

Both this finding and the round-1 R1 finding are **one root cause**: a
candidate-lister with an incomplete zone census. The library branch
(`:129-130` at review time) ignored `head.candidateIds` and returned the whole
zone (fails a `look-distribute`-style allow-list, e.g. Impulse's top-4); the
graveyard zone had no branch (fails any non-targeted graveyard pick, e.g.
Exhume). Both are fixed in the same PR: the library branch now intersects with
`head.candidateIds` exactly like the pre-existing hand branch, and a graveyard
branch was added doing the same. The no-zone fallback also now throws loudly
instead of silently returning `[]` when a non-empty `candidateIds` resolves to
zero battlefield instances — the shape both bugs took — so a future missing
zone branch surfaces immediately instead of reading as a generic downstream
error.

Reproduced independently at `iterations=400`, both seat orientations, seed 57
(turns 15/16) before the fix, hitting exactly the graveyard branch described
above. After the fix landed, `bun run ladder --pairings br-reanimator:uw-control
--tier smoke --baseSeed 1` was re-run: **8/8 games decisive, 0 guard stops**,
aggregate 50.0% [21.5%–78.5%] — straddles 50% as expected for a null run, and
the resolution-error is gone.

**What was wrong (original diagnosis, kept for record).** The R2 smoke
null-run (`--rung R2 --tier smoke --baseSeed 1`, issue #2689) showed the
`br-reanimator` vs `uw-control` matchup hitting `reason: "resolution-error"`
in **all 8/8 games** (both seed pairs × both seat orientations × both
agent-seat assignments) — a 100% guard-stop rate, versus 0% for the other two
R2 matchups (`br-reanimator` vs `mono-r-aggro`, `mono-r-aggro` vs
`uw-control`) in the same run.

**Evidence (original).**

- Run file: `ladder-runs/2026-08-22-17-44-38-s1-smoke.jsonl`, `gameIndex`
  108-115 (pairingIndex 14, `br-reanimator` vs `uw-control`) — every record
  has `"reason":"resolution-error"`, `"winnerSeat":null`.
- `src/lib/ai/selfplay/playGame.ts:377-386` — a `resolution-error` fires when
  `resolvePending(state)` returns `false` or throws at a pending-choice node
  (the production default auto-resolve policy).
- ~~Candidate suspects (untested): Entomb, Griselbrand, Archon of Cruelty,
  Absorb.~~ **All four are innocent.** The actual trigger is Exhume's
  graveyard pick hitting the missing `listCandidates` branch above — none of
  the other cards' choices are on the failure path.
