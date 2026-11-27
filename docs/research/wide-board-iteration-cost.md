# Iteration cost on a wide late-game board (issue #10755)

> **Dated:** 2026-11-27, base `032aa0300` against this change at `e28f19108`,
> on the development MacBook (Apple M1 Pro, 8 cores, 16 GB) while it was also
> the pipeline's runner: load average 5.9–8.0 throughout. Node 24.21.0.
> **Every number below is as of those commits, that machine and that day.**
> Slice of PRD issue #10017, split off issue #10401.

**Question.** In a production game the Bot searched a 4-candidate root for
3341 ms and completed 8 of 1320 iterations (issue #10401: turn 21, the Bot at
1 life holding Yawgmoth's Will, thirty permanents on the battlefield). What
does one iteration cost on that board, where does it go, and how much of it
can be removed without changing a decision?

**Verdict up front.**

1. **One iteration costs 108–164 ms of CPU in V8 on that board** (the
   issue read 139–213 ms at an earlier sha), against a median of 1.7 ms on a
   blade board: two orders of magnitude.
2. **No card and no Op is the cause; three repeated derivations were, for
   about a seventh of it.** This change removes them and an iteration costs **0.80–0.89
   of what it did** (§ 3), with the same move chosen and the same iterations
   completed at every budget read. On the blade positions it is inside the
   noise floor: 0.992 median against 0.995 for the base against itself, 0 of
   54 choices moved.
3. **The rest is the board's width paid by the engine's ordinary work**
   (§ 4): the leaf evaluation (a third), state-based actions with their layer
   derivation (a quarter), move enumeration (a fifth) and state cloning. None
   of the four has a repeated derivation left that this profile shows; each
   is a slice of its own under PRD issue #10017.
4. **The live reading predates today's cap.** `8/1320 iters (time), 3341ms`
   was read under `expert`'s 3300 ms cap, about 418 ms per iteration in the
   browser Worker. Under today's 8300 ms cap (PR #10444) the same rate
   completes about 20 iterations; at 0.85 of the cost, about 23. A 4-candidate
   root is starved under 8 (`STARVED_ROOT_VISITS_PER_CHILD`), so the cap moved
   this root out of starvation and this change adds three iterations to it.
   Neither makes the search find the kill: the issue reads it missed at 120
   iterations, and that is a question about what a rollout probes, not about
   its cost (§ 5).

## 1. The position

`docs/research/scripts/brain-bench/positions/wide-board-issue-10755.json`: the
`spec` of Verdict `v1-e698f074…` (the same game, turn 19) with the four facts
the issue states for turn 21 applied to it — the Bot at 1 life against 2,
Yawgmoth's Will its only hand card (its two Swamps played, Slickshot Show-Off
in the graveyard), its Mountain tapped, turn 21. Ten permanents on the Bot's
side, twenty on the opponent's: Tolarian Academy, Candelabra of Tawnos,
Retrofitter Foundry, Karn, Scion of Urza and its Construct, Skullclamp,
Fastbond, Astrologian's Planisphere, a Servo, Vivi Ornitier and ten more
lands;
twelve cards in the Bot's graveyard and eleven in the opponent's. Everything
else is the Verdict's: which of the opponent's lands are tapped is turn 19's.

`entry.mjs`'s `runField` builds a fixture holding a `spec` the way a blade
entry is built, so the profilers and `compare.mjs` take it as they take a
field fixture.

## 2. Where an iteration goes, before

A V8 CPU profile of 46 iterations (the search settles there), shares of the
samples under `searchWithTrace`, inclusive and overlapping:

| function                                       | share of the search |
| ---------------------------------------------- | ------------------- |
| `rollout`                                      | 94%                 |
| `selectRolloutMove` (the greedy pick's probes) | 55%                 |
| `evaluate`                                     | 35%                 |
| `enumerateMoves`                               | 26%                 |
| `applyMoveInSearch`                            | 26%                 |
| `checkStateBasedActions`                       | 19%                 |
| `getManaTapOptionsDetailed`                    | 18%                 |
| `enumerateAbilityMoves`                        | 16%                 |
| `tryGetDefinition`                             | 14%                 |
| `planManaPayment`                              | 12%                 |
| `deriveBoardWithSources` (layers 2–5)          | 10%                 |
| `graveyardCastMechanismForMember`              | 9%                  |
| `boardDerivedManaCount`                        | 8%                  |
| `cloneGameState`                               | 6%                  |

Calls per iteration, counted by instrumenting the bundle:

| per iteration                     | before  | after   |
| --------------------------------- | ------- | ------- |
| `enumerateMoves`                  | 57      | 57      |
| `evaluate`                        | 51      | 51      |
| rollout probes (`policyValue`)    | 51      | 51      |
| `cloneGameState`                  | 68      | 68      |
| `checkStateBasedActions`          | 166     | 166     |
| `deriveBoardWithSources`          | 231     | 231     |
| `planManaPaymentPass`             | 154     | 154     |
| `getProducibleManaSourceView`     | 1554    | 456     |
| `getManaTapOptionsDetailed`       | 4136    | 3039    |
| `graveyardCastMechanismForMember` | 3053    | 3053    |
| `liveStaticDefinition`            | 224,262 | 42,080  |
| `tryGetDefinition`                | 420,340 | 198,664 |

The engine's own work is unchanged, call for call. What moved is what each
call re-derived.

## 3. What was removed

Three derivations repeated a result the same position had already given.

1. **A mana source's options, once per enumeration.** `enumerateMoves` prices
   one cost per activated ability and per announceable X of each (the
   Candelabra's {X} alone is a plan per X), and every plan derived the mana
   options of every untapped permanent: 154 plans an iteration, each a walk of
   both battlefields per source. The options read the position and nothing
   else, so one enumeration now derives each source's once
   (`PlanSourceViewScope`, `convex/gre/moves.ts`), and never past the call.
2. **Three graveyard sweeps that resolved every permanent's definition.**
   Whether a graveyard card is castable asks the graveyard owner's battlefield
   for a granted escape, a granted retrace and a graveyard play permission,
   once per graveyard card, from the enumerator and twice from the leaf
   evaluation: most of the 420,000 definition lookups an iteration made. The
   registry now indexes the definitions declaring one of the three
   (`declaresGraveyardCastGrant`), the precheck the layer scans and the
   land-play lock already use.
3. **A board count that copied every permanent to count six.** Tolarian
   Academy's "for each artifact you control" built a layer-aware copy of all
   thirty permanents before testing any. The filter's type and controller
   conjuncts read fields the copy does not change, so a permanent either one
   refuses is passed over first (`boardPermanentsMatching`).

Base against head by `compare.mjs --position` (both bundles in one process,
alternating, five rounds after a warm-up, CPU clock):

| iterations asked | completed       | base CPU ms / iteration | head CPU ms / iteration | head / base | move |
| ---------------- | --------------- | ----------------------- | ----------------------- | ----------- | ---- |
| 8                | 8               | 143.0                   | 108.8                   | 0.843       | same |
| 16               | 16              | 164.0                   | 147.9                   | 0.894       | same |
| 48               | 46 (`settled`)  | 120.0                   | 107.1                   | 0.856       | same |
| 120              | 110 (`settled`) | 108.3                   | 83.6                    | 0.804       | same |

The absolute figures move with the machine's load between rows; the ratio is
read within a row. Wall-clock per search, mean of the five rounds: 965 → 813
ms at 8 iterations, 2813 → 2448 at 16, 6233 → 5148 at 48, 11,165 → 9117 at 120.

On the blade positions (`compare.mjs`, 54 searched positions of 60, 400
iterations, three rounds): head/base 0.948 / 0.992 / 1.092 (p10 / median /
p90), 0 of 54 choices moved. The base against itself the same hour reads
0.951 / 0.995 / 1.062: a blade board holds no dozen standing abilities and no
two dozen graveyard cards, and pays nothing for the scope either.

## 4. What bounds the rest

The same profile after the change, shares of the search:

| function                              | share |
| ------------------------------------- | ----- |
| `evaluate`                            | 33%   |
| `applyMoveInSearch`                   | 31%   |
| `checkStateBasedActions`              | 24%   |
| `enumerateMoves`                      | 19%   |
| `deriveBoardWithSources` (layers 2–5) | 13%   |
| `passInSearch`                        | 11%   |
| `policyProbeState`                    | 9%    |
| `cloneGameState`                      | 8%    |
| `getManaTapOptionsDetailed`           | 8%    |
| `tryGetDefinition`                    | 8%    |
| `enumerateDoomedManaFloatMoves`       | 5%    |

- **The leaf evaluation, a third.** 51 evaluations an iteration at about
  0.6 ms: the mana census, the graveyard reach, the mana-development and
  colour-coverage terms each walk the board once per seat. No term is
  repeated; each is linear in a board three times a blade board's.
- **State-based actions, a quarter**, half of it the layers 2–5 derivation,
  which rebuilds every permanent's view at each of 166 checks an iteration.
  PRD issue #10017 names it as the engine's first target.
- **Enumeration, a fifth.** What is left is the abilities themselves and one
  item with a shape: `enumerateDoomedManaFloatMoves` settles the top of the
  stack (a clone and a resolution) on every priority ply with a non-empty
  stack and an untapped mana source, 11 times an iteration, to learn almost
  always that the resolution removes no mana source. A sound test that skips
  the settle needs to know what a resolution can remove, which the engine
  does not state without resolving it
  (`docs/findings/10755-doomed-float-settle-per-stack-ply.md`).
- **Cloning, 8%**: 68 clones an iteration, one per probe.

## 5. What this does not answer

The issue's third direction — whether a rollout ply's probe set should always
hold a move whose settled result ends the game — is a rollout preference, not
a cost, and ADR 0186's freeze covers it until the Prototype gate is read. It
is the reason the kill stays unseen at 120 iterations on this board, and it is
left as the issue states it: a Verdict, the fit, then a report.

## 6. Reproduce

```bash
F=docs/research/scripts/brain-bench/positions/wide-board-issue-10755.json
# base against the working tree, at a fixed iteration count
node docs/research/scripts/brain-bench/compare.mjs 032aa0300 \
    --rounds 5 --iterations 16 --position "$F"
# the same on the blade positions, and the noise floor
node docs/research/scripts/brain-bench/compare.mjs 032aa0300 --rounds 3
node docs/research/scripts/brain-bench/compare.mjs 032aa0300 032aa0300 --rounds 3
# where the time goes
node docs/research/scripts/brain-bench/build.mjs /tmp/bench.js
node docs/research/scripts/brain-bench/profile.mjs /tmp/bench.js /tmp/profile.json \
    --iterations 48 "$F"
```
