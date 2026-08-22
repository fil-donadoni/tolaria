---
title: br-reanimator vs uw-control guard-stops 100% of the time on resolution-error
discoveredBy: 2689
status: draft
confidence: medium
---

**What is wrong.** The R2 smoke null-run (`--rung R2 --tier smoke --baseSeed 1`,
issue #2689) shows the `br-reanimator` vs `uw-control` matchup hitting
`reason: "resolution-error"` in **all 8/8 games** (both seed pairs × both seat
orientations × both agent-seat assignments) — a 100% guard-stop rate, versus 0%
for the other two R2 matchups (`br-reanimator` vs `mono-r-aggro`,
`mono-r-aggro` vs `uw-control`) in the same run. That specificity (one matchup,
every game) points at a card interaction between the two decks the production
default resolution policy cannot settle, not run-to-run noise.

**Evidence.**

- Run file: `ladder-runs/2026-08-22-17-44-38-s1-smoke.jsonl`, `gameIndex` 108-115
  (pairingIndex 14, `br-reanimator` vs `uw-control`) — every record has
  `"reason":"resolution-error"`, `"winnerSeat":null`.
- `src/lib/ai/selfplay/playGame.ts:377-386` — a `resolution-error` fires when
  `resolvePending(state)` returns `false` or throws at a pending-choice node
  (the production default auto-resolve policy). No stack/message is captured
  in the ladder record itself (`ms`/`plies`/`turns` only), so the exact
  offending choice is not identified by this run alone.
- Candidate suspects (untested): `br-reanimator` carries Entomb (library
  search → graveyard, a card-selection choice) and Griselbrand/Archon of
  Cruelty (Archon's ETB has a target-selection choice plus an opponent discard
  choice); `uw-control` carries Absorb (counter + prevent-damage-choice +
  draw). Any of these combined with the OTHER deck's own choice-bearing cards
  is plausible; not isolated here.

**Why it may not deserve its own issue.** (1) The ladder-guard-stop path
already exists and excludes these games from the win-rate rather than
silently mis-scoring them — the harness is behaving as designed, just
surfacing a real gap. (2) Bot/engine changes are explicitly out of scope for
issue #2689 ("Any Bot change. These decks are measurement fixtures."), and
these are freshly-added decks whose combination of choice-bearing cards was
never exercised together before. (3) n=8 from one seed pair is a small
sample — worth a `decision`-tier (20-seed) rerun of just this pairing
(`--pairings br-reanimator:uw-control --tier decision`) to confirm it is
100% and not seed-cherry-picked, before spending time isolating the exact
card. If it reproduces at decision tier, it is worth a real ticket (probably
tagged `area:game-bot`) to pin the failing choice node with a blade scenario.
