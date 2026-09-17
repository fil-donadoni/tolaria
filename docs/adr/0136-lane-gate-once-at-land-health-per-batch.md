# The lane gate is paid once, at `land`, on the rebased tip; the full gate runs per batch of landings; a lane may run a fixed, content-classified partition of a project

## Status

accepted — amends ADR 0104 §2 (partitions), ADR 0110 §5 (the pre-PR gate) and
ADR 0116 (health cadence); retires the `check:lane` preflight of issue #3286
together with the pre-PR gate it protected. Grilled 2026-09-17; the numbers
below are that session's, re-derivable with `bun run telemetry:latency` and
the SQL on `.claude/telemetry/telemetry.db` quoted in
`docs/agents/quality-gates.md`. The decided flow and the three land/health
scenarios are drawn in `docs/guides/next-issue-flow.md`.

## Context

The pipeline of ADR 0110 was measured again over 2026-09-03 → 2026-09-17
(272 `/next-issue` sessions, 300 PRs merged into the base branch):

| Per `/next-issue` session (median)             |                                                       Value |
| ---------------------------------------------- | ----------------------------------------------------------: |
| wall                                           |                                                        83 m |
| machine (tool + model)                         |                                                        65 m |
| gate / test / build                            |                                                        17 m |
| review subagent (the session waits)            |                                                       8.9 m |
| model generation (126 turns)                   |                                                        18 m |
| `check:lane` runs                              |                                                           2 |
| `land` runs                                    |                                                        1.35 |
| cards-only PR, best observed (Dwarven Soldier) | 24 m wall = ~4 m implementing + 14 m gate + 6 m review/land |

Three mechanisms explain the gate block, and none is a slow test:

1. **The lane is paid three times per issue.** `/next-issue` §5 runs
   `check:lane` before the PR; the base branch receives 2.5 PR/h when seven
   sessions run, so the tip moves DURING that gate; the #3286 preflight then
   sends the session back — rebase, lane again — and `land` runs the same
   lane a third time after its own rebase, unconditionally
   (`buildLockedCommand`, `scripts/land.ts`). 2 × 309 s + 1.35 × 382 s ≈ 17
   min, exactly the measured gate block. `check:lane` went 273 s with no
   other session active to 500 s with four; `land` 296 → 507 s.
2. **224 of 300 PRs fell to the `full` lane** (`check:pr` whole): 40 only
   because `^data/` sits in `FULL_PATTERNS` and every card PR regenerates
   `data/card-index.json` and `data/cr/citations-ledger.json`; 75 only because
   an ADR or a guide travelled with code ("prose mixes with nothing", ADR 0104
   docs lane); 31 both. With those two rules changed, 109 PRs classify as
   `engine` instead of 34.
3. **The machine is RAM-bound, not core-bound.** M1 Pro, 8 cores, 16 GB:
   seven `claude` sessions (~1.6 GB), a browser at 5.2 GB, vitest workers at
   1.4 GB → swap 11 GB of 12, 77 M page-outs. Under that pressure a
   `git commit` through lint-staged exceeded 120 s 63 times (6.6 h), file
   edits hit the Bash tool's 600 s cap, and 204 gate spans in 126 sessions
   were promoted to the background at that cap. Throughput by concurrency,
   PRs merged per hour: 0.59 at one active session, 1.44 at three, 1.19 at
   four, 2.48 at seven-plus — parallelism still pays in aggregate, but the
   per-session yield halves past three.

The test processes themselves, from the last GREEN `health:main` (heavy tier,
4 workers): `test:app` 1459 files, 193 s wall, worker time **import 294 s ≈
tests 287 s**, environment (happy-dom, 410 files) 71 s, transform 66 s.
`test:bot` 106 s wall, bounded by ONE file — `ladder.bot.test.ts`, 92.5 s, a
full headless game, in the gated suite although the Bot rules reserve the
ladder for strength claims. 87 of the 134 `scripts/__tests__` files import
nothing from `convex/` and cost 179 s of the `node` project's 242 s of test
time; the `engine` lane paid them for diffs that cannot reach them.
`tsc -b --noEmit` averaged 56 s over 365 runs because its `incremental`
build info lives in `node_modules/.tmp/`, which a fresh worktree never has;
`eslint .` 69 s with no cache.

The user's stated risk posture: a defect that reaches the base branch is
acceptable — it is caught by the full gate before the release branch moves
(ADR 0116) — while a defect that reddens the base tip for every OTHER session
is not, because each of them then debugs a failure that is not theirs.

## Decision

1. **No pre-PR lane gate.** `/next-issue` §5 no longer runs `check:lane`
   before opening the PR; the session's own signal is its targeted vitest
   runs and the review round. The #3286 preflight is retired with it: its
   whole purpose was to stop a hand-run pre-PR gate on a stale tree, and there
   is no such gate any more. A hand-run `check:lane` stays available and
   ungated.
2. **`land` pays the lane once, on the rebased tip, inside the mutex** —
   the sequence of ADR 0110 §3 unchanged — and **skips it when the rebased
   tip's sha equals the head of a gate run recorded green against the same
   base sha** (`~/.cache/tolaria/gate-runs/*/head`): the re-land after a
   red fix, or a `land` retried after a transient merge refusal, never pays
   a gate the tree has already passed.
3. **Lane classification.** `data/**` classifies as `engine`: those files
   are generated artefacts, regenerated by `resolve-generated-artifacts`
   before the lane runs, and the guards that read them (`check:index`,
   `check:oracle`, `cr:lint`) are in every non-docs lane. Prose in a mixed
   diff no longer forces `full`: the code decides the lane and the docs
   lane's test list (`check:docs`'s node files, seconds) is appended to it.
4. **A `cards` lane**, for a diff entirely under `convex/cards/sets/**` plus
   `data/**`: `tsc -b convex`, `check:index`, `check:stubs`, `check:oracle`,
   `cr:lint`, `convex/cards/__tests__` (node) with its three bot censuses
   (`bot-node`), and the touched set's own `__tests__`. Measured 90 s at
   load average 122; ~45 s expected alone. It skips `node` whole, the bot
   fast lane whole, `tsc[app,scripts]` and `dom`. A card on already-exercised
   Ops cannot reach any of them (ADR 0045's per-Op regime); a card that
   introduces an Op touches `convex/gre/**` and lands in `engine`.
5. **ADR 0104 §2 is amended: a lane may run a FIXED partition of a project,
   classified by content, never by the diff.** The partition is a directory
   glob or an import predicate, pinned by `check-guards-scope.test.ts` the
   way `src-test-env-split.test.ts` pins node/dom, and a file selected by no
   partition still fails that guard. Concretely: `node` splits into
   `node-engine` (`convex/**`, the DOM-free `src` tests, the
   `scripts/__tests__` files that import from `convex/`) and `node-tooling`
   (the rest of `scripts/__tests__`); the `engine` lane runs `node-engine`;
   `ladder.bot.test.ts` leaves the gated bot suite for the perf/ladder lane.
   What ADR 0104 forbids stays forbidden: a subset computed from the changed
   files.
6. **The full gate runs per batch, not per release.** `health:main` starts
   after the 5th landing since the last GREEN, or 2 h after the first
   un-healthed landing, whichever comes first; deduplicated by sha; gating
   the base tip CURRENT at its start, so one run covers everything landed
   meanwhile; it takes the heavy mutex only when no `land` is queued —
   **bounded**, because at 2.5 PR/h with three sessions there is frequently
   SOME land queued and an unbounded yield would mean the tip is never gated
   at all; past the bound (30 min) it takes the mutex with lands still queued
   — and is never interrupted once running. `bun run release` is unchanged and still
   requires GREEN on the exact tip. A RED marker **refuses the next pick**
   in `queue:plan` and spawns `/health-fix`; `land` warns and proceeds, so a
   session already mid-issue finishes and the fix-forward has a way in.
7. **Session admission.** `queue:plan` refuses a pick while live claims are
   at the cap: 3 now, 4 once the PR/h-by-concurrency row of
   `telemetry:latency` shows the knee moved. The cap is a measured number
   with its derivation in `docs/agents/quality-gates.md`, never a label.
8. **A short path for the `cards` lane in `/next-issue` §3**, decided by the
   diff's lane, not by the session: definition, scenario JSON, regenerated
   artefacts, `cr:ledger`; no hand-written test, no proof-of-failure, no bot
   or frontend walk. A session that finds itself writing a test for a
   `cards` diff has found an unexercised Op and stops. Review is unchanged on
   every lane (the user's call: it catches what tests cannot, and the price
   is accepted); its blocking-finding rate becomes a telemetry row derived
   from commits that follow the review span.
9. **Tooling.** `bootstrap-worktree` seeds `node_modules/.tmp/*.tsbuildinfo`
   from the primary checkout (tsc validates by hash, a stale file is safe);
   `lint` runs with `--cache`.

## Consequences

- Gate per landing: 19 min measured → ~6 min projected (`engine` 2.5–3 min at
  4 workers under `land`, `cards` ≤ 1 min, plus 10 min of health amortised
  over 5 landings). Worst-case wait for a `land` behind a running health:
  10 min + the lands queued ahead, ≤ 18 min at cap 3, at most once per 5
  landings.
- Exposure of a red base tip: from "until the next manual release" (1–2
  days observed) to ≤ 5 landings or 2 h, and no new worktree branches from
  a tip known red.
- Throughput target at cap 3: from 1.44 PR/h measured to ~3 PR/h, the gate
  no longer being the floor (model + non-gate tool ≈ 47 min/issue is).
  Judged by the same telemetry row that set the cap, not by feel.
- The `/next-issue` skill, `check-lane.ts`, `land.ts`, `queue-plan.ts`,
  `health-main.ts`, `bootstrap-worktree.ts`, `vitest.config.ts` and
  `check-guards-scope.test.ts` all change; reversing any one item is a
  script change, reversing the shape is not.
- Unchanged on purpose: the `check:ui` receipt per `skin` PR (ADR 0131/0132),
  the content of the release gate, the review round.
- Not decided here: the `dom` project's environment and transform cost and
  the catalogue import share. Both were tried before (issues #811, #2433,
  #2435/#2447, #2871); they get a measurement-first investigation of their
  own (issue #3770), not a lever in this record.

## Alternatives considered

- **No gate at `land` at all, release gate only.** Fastest; rejected because
  a broken type or a drifted card index on the base tip reds every worktree
  created from it, and the cost lands on sessions that did nothing wrong.
- **Health after every landing** (ADR 0110 §3). Rejected again by ADR 0116's
  own numbers: 213 mutex-minutes a day, 19% RED of which ≥ 40% were
  contention timeouts.
- **Keep the pre-PR gate, make `land` skip on an unchanged sha.** Rejected:
  at 2.5 PR/h the pre-PR tree is stale before its gate ends, so the skip
  would almost never fire and the third run would remain.
- **Non-blocking review, findings as later fixups.** Rejected by the user:
  code should reach its tests reviewed, and a review that does not block
  fills the queue the loop exists to drain.
- **RED blocks `land`.** Rejected: it walls off the fix-forward and discards
  finished work; blocking the pick costs one session's idle and nothing else.
