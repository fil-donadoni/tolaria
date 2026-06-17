# vs-AI #2 — on-the-play win-rate: noise, not a bug

Issue #243 · self-play harness (`src/lib/ai/selfplay/`) · blocked by #240 (harness
loop hardening — needed to run a long match without a single crash aborting it)

## Question

A 20-game self-play match reported an **on-the-play win-rate of 35%** — below the
≥50% the player who goes first should enjoy. On 20 games that 35% is well inside
the sampling noise (a 95% interval for 7/20 spans roughly 18–57%), so the slice
was: gather enough data to decide **noise vs. real bug**, and if real, root-cause
and fix it.

To isolate the first-player effect from deck strength, the match must be a
**mirror** (same deck both seats) so the only asymmetry left is who goes first.

## Method

- **Harness:** `runMatch` / `runHeadlessGame` — the same production decision
  stack the live bot uses, no Convex runtime. The on-the-play seat **alternates**
  every game (seat A on even games, B on odd), so first-player advantage is
  measured directly rather than baked into either seat's win-rate.
- **Match:** `mono-red-burn` mirror, **100 games**, seeds 1–100, search budget
  `{ iterations: 40 }` per seat.
- **Metric:** `onThePlayWinRate` = (games won by whichever seat was on the play) /
  (decisive games). Guard stops (`stall` / `max-plies` / `resolution-error` /
  `search-error`) are excluded — they are harness health, not MTG outcomes.
- Reproduce:

    ```
    SELFPLAY=1 SELFPLAY_DECK_A=mono-red-burn SELFPLAY_DECK_B=mono-red-burn \
      SELFPLAY_GAMES=100 SELFPLAY_ITER=40 SELFPLAY_SEED=1 \
      bunx vitest run src/lib/ai/selfplay/harness.test.ts --disableConsoleIntercept
    ```

## Results

| metric                   | value                         |
| ------------------------ | ----------------------------- |
| games                    | 100                           |
| **decisive**             | **100 / 100** (0 guard stops) |
| end reasons              | life = 98, decked = 2         |
| **on-the-play win-rate** | **46.0% (46 / 100)**          |
| avg turns                | 28.4                          |
| wall-clock               | ~22 min (~13 s/game)          |

The whole match was decisive — **zero** guard stops — which is also the first
confirmation that #240's hardening holds over a long run.

**95% Wilson interval for 46/100 ≈ [36.5%, 55.8%]** — it straddles 50%. The
running estimate's trajectory makes the noise explicit:

| after N games | on-the-play win-rate |
| ------------: | -------------------- |
|            10 | 90.0%                |
|            20 | 55.0%                |
|            50 | 54.0%                |
|            80 | 50.0%                |
|           100 | 46.0%                |

That is textbook regression to the mean: an early small-sample swing (90% at
N=10 — the exact window the first short pilots saw) decays toward ~50% as N
grows. The original **35% on 20 games sits inside this same noise band.**

## Verdict: **NOISE** — no first-player disadvantage

On a mirror at 100 games the on-the-play win-rate is statistically
indistinguishable from 50% (point estimate 46%, CI includes 50%). There is **no
systematic disadvantage** to going first; the 35% from a single 20-game run was
sampling noise. **No engine change is warranted.**

### The two named suspects were checked and cleared

1. **Turn-1 draw skip (CR 103.8).** The player on the play skips their first
   draw step. This is modeled — `drawStep` in `convex/gre/phases.ts` returns
   early when `state.turn === 1` — and covered by the existing test
   _"skips draw on turn 1 (CR 103.8)"_ in `convex/gre/__tests__/phases.test.ts`.
   The on-the-play seat is always `players[0]` (`createInitialGameState` sets
   `activePlayerId = playersState[0].id`, `turn = 1`), so the skip lands on the
   right player.

2. **Seat/turn accounting in the match report.** `runMatch` alternates the
   on-the-play seat each game and credits `onThePlayWins` to whichever seat
   actually started — not always seat A. This is now pinned by a deterministic
   unit test (`src/lib/ai/selfplay/runMatch.test.ts`): with an injected game
   runner where the on-the-play seat always wins, `onThePlayWinRate` is 100% and
   A/B stay even (50/50) because each was on the play half the games; the mirror
   case (on-the-draw always wins) reports 0%; guard-stop games are excluded from
   both win-rates.

To make that accounting testable without driving a full ISMCTS game, `runMatch`
now takes an **optional, defaulted** game-runner parameter (`GameRunner`,
defaults to `runHeadlessGame`) — production callers are unchanged.

## Scope notes

- No GRE / game-rules change. The only code change is the injectable
  `runGame` seam on `runMatch` plus its unit test — both in the self-play harness
  (`src/lib/ai/selfplay/`), which never crosses into `convex/gre/`.
- Result is budget- and deck-specific by construction (mono-red mirror,
  40 iterations). It answers the question asked — "is going first a
  disadvantage?" — and the answer is no. It is **not** a claim about absolute
  play strength at higher budgets, which is the subject of separate tuning work.
