# The Bot-play sweep leaves the PR: sharded over worker threads, a session plays only its graduations, the base replays drift after each merge; a RED is reverted first and fixed forward as an ordinary pass

## Status

**accepted** — owner's decision of 2026-10-24, on the pipeline telemetry
report for 2026-10-21 → 10-24 ("ragiona anche con pensiero laterale … tutto
quello che si può cachare con sicurezza … fintanto che il processo rimane
lineare"; the three questions answered "a. stesso account? b. spiega meglio
c. ok"). Extends ADR 0157 (the base writes derived whole-file state) to the
Bot-reach verdicts; amends ADR 0156 § "A RED base is repaired by a bounded
ladder" rungs 4–5 and CLAUDE.md § Quality gates "fix-forward FIRST". Tickets:
issue #6686 (§ 1), issue #6687 and issue #6688 (§ 2), issue #6689 and issue
#6690 (§ 3); issue #6653 retouched (§ 4).

## Context

### What the report measured (77.7 h, both machines)

- `oracle:compile` held the heavy/job mutex **21.1 h = 27 %** of the window
  (32 holds, median 40 min, max 62 min). `land` waited 2335 s and 3287 s
  behind a pass's compile; one health run took 84 min wall for 16 min of
  gating; four exit-77 saturations and one SIGTERM were compile-adjacent.
- Inside AFK passes, `oracle:compile` / `oracle:report` was **37 %** of
  wall-clock (17.2 h of 46.3 h). Twelve passes with > 20 min of compile
  account for 16 of those 17.2 h.
- **No pass rebased before its expensive verify** (27 of 33). About 216 min of
  compile was redone after a late rebase, 337 min of first-compile time
  thrown away (issue #5215: 57 min, rebase, 49 min; issue #5218: 97 min,
  rebase, 58 min, then the 180-min bound).
- The post-merge Bot-play replay (`derive:sync --replay-bot`, 39–48 min each,
  8 in 24 h) failed 6 of 10 long runs, holding a `lane` runner each time; 17
  `seed` jobs and 43 `housekeeping` runs failed downstream of it.
- RED of 2026-10-23: culprit named **60 s** after the RED (bisect, 3 probes);
  GREEN **5 h 03 min** later, after three successive fix-forwards (search-cost
  pins, a weight refit, eval-value pins). PRs opened in that window waited
  5.8–10.1 h for their first queue draft; about 147 PR-hours over the window
  line up with RED holds.

### Where the time is

The compiler is **5 s** (`oracle:compile --check`, ADR 0157 § What
regeneration costs). The 40 min is the **Bot-play sweep**: 6,707 cards
compile `ready`, 6,631 are played, ~0.36 s each, **one core**, a sequential
loop (`playingBotReach`, `scripts/lib/oracle-bot-reach.ts`). The `gate.ts
job` tier grants it the heavy worker count and it uses one.

The verdict cache has the wrong shape for the PR path:

- its key is the exact `JSON.stringify(definition)` (`cachedVerdict`). A
  compiler change that touches one field of every definition — a grammar PR's
  usual shape — is 6,700 misses, and the session plays them all under the
  mutex. The cards the PR actually graduates are a few hundred at most;
- it lives only in the committed lockfile, so a verdict earned in one
  worktree is invisible to every other pass until that PR lands, and a
  rebase that moves the base's rows discards it;
- `botHash` covers all of `gre/ai/**`: any Bot edit → whole-catalogue replay.

### What is already decided

ADR 0157 moved the lockfile header hashes and `data/catalogue/*` out of the
PR: the base writes them after each merge (`derive:sync`), the queue
regenerates them in the draft's tree, PRs carry rows only. Issue #6463 made a
session's bare compile carry the committed verdicts whatever the Bot hash
says, so a **carried (stale) verdict window** between a Bot change and its
replay already exists by design. This record extends both to definition
drift.

The eight tickets of 2026-10-24 (issue #6647 → issue #6654) are queue
mechanics: rebase-first, ratchets, serialization, incremental re-verify,
`pr-refresh`, repair under RED, runner labels, hygiene. They cut the waste
_around_ the sweep; none touches the sweep. They are second-order while the
40-min step stays in the path.

## Decision

### § 1 — The sweep is sharded over worker threads (issue #6686)

`playBotReach` is pure, seeded and `iterations`-bounded, so N workers give
the same verdicts as one. The miss set is partitioned over `W` Bun workers,
`W` = the heavy tier's worker count (`min(ncpu − 1, 4)`, RAM-capped by
machine admission). The lockfile is byte-identical across worker counts,
pinned by test. Expected: 40 min → ~10 on the MacBook; the post-merge
replay from 8 × 40 min to 8 × 10. No semantic change; the first thing to
land.

### § 2 — Bot-reach verdicts are written by the base, like the header

**2a. A session plays only its graduations (issue #6688).** The probe
classifies a miss as a **graduation** (a row that becomes `ready` in this
tree and was not `ready` with a verdict in the committed lockfile) or
**drift** (`ready` before and after, definition changed). A bare
`oracle:compile` plays graduations — the Bot-reachability doctrine of the PR
stays whole: a card a PR brings to `ready` carries its verdict in that PR —
and **carries** the committed verdict for drift rows. The re-exec under
`gate.ts job`, `LOCK_FREE_MISSES` and the `admit` path retire: a pass never
takes the heavy mutex for a sweep again. `--replay-bot` is unchanged.
_As built (issue #6688, on the owner's contract from issue #6687):_ the
base's drift sweep plays its whole miss set with the `--play-misses` flag,
which keeps `LOCK_FREE_MISSES` and the `admit` path, so a whole-catalogue
sweep on the base stays admitted; no bare run reaches them. A carried row
is marked `botStale`, so the probe reads it as a miss, and graduation is
judged against the merge-base's lockfile, not the disk file a first run
already wrote.

**2b. The base replays drift after each merge (issue #6687).** Post-merge
`derive:sync` computes the miss set on the tip and plays exactly those rows
(sharded, § 1), committing rows and header in its ONE derive commit; zero
misses → nothing beyond today. A card the sweep turns `frozen` leaves
`ready`, and pool, index and catalogue are regenerated in the same commit —
the unfreeze path already does this. Coalescing as ADR 0157: a refused push
is dropped, the newer tip's run replays from scratch.

**What the window holds.** Between a merge and its derive commit, the base's
drift rows carry a verdict for a definition that moved — **stale, never
missing**. This is the window issue #6463 already accepts for every Bot-hash
move, now covering definition drift too; its length is the post-merge job's
latency (minutes), the hourly `housekeeping` the backstop. Health judges a
stale-verdict tip `pending` for one housekeeping period and `RED` with cause
`derive:sync` past it (ADR 0157's grace, same predicate family). The
deployment predicate (`derive:sync --fresh`) keeps treating carried verdicts
as fresh: a stale Bot verdict never holds the deployment — a card the Bot
cannot yet play breaks no game, it is a card the Bot plays badly.

**Why the lockfile is the cache, and no bucket.** Once only the base writes
verdicts, the committed lockfile on the base _is_ the content-addressed cache
(key: oracle id + definition), shared by both machines and every worktree at
the next fetch. A bucket keyed by `defHash ‖ botHash` would add hits only on a
reverted Bot change or two passes graduating the same card — rare — and a
second source of truth to the process the owner wants linear. The Verdict
Store's accounts are no help either: the reader is `objectViewer`, the writer
key lives on the production deployment by rule (ADR 0128, owner 2026-09-16).
Not adopted; re-measure after § 2 lands (§ 4).

### § 3 — A RED is reverted first (issue #6689, issue #6690)

Amends ADR 0156 rungs 4–5 and CLAUDE.md "fix-forward FIRST (`bun run
health:fix`), the ladder's revert after": once rung 3 names a culprit, the
ladder's next action is **the revert** (`health-revert`, through the queue as
the RED's repair, Amendment II's receipt rule standing). The culprit's issue
reopens with the evidence and the dispatcher's labels; fix-forward is that
issue's ordinary pass, landing the culprit again _with_ its fix in one PR,
under no RED. `health:fix` remains for the cases a revert cannot serve: the
revert conflicts (today's `stuck`) or the bisect names no single culprit.

Rationale in this context: one owner, an AFK loop, a queue that holds on RED.
The base's linearity is worth more than a first attempt at a fix: a revert
is ~15 min and mechanical; the 2026-10-23 fix-forward was 5 h and three
rounds, each round a new RED from a pin the previous one had not moved. Issue
#6690 makes a refit move every pin it obliges in one PR, so the re-landed
culprit does not RED again on a pin; preference pins become orderings or
bands, the ADR 0124 reproducibility guard stays byte-exact.

Target for the next report: RED → GREEN p50 under 30 min when a culprit is
named.

### § 4 — Not adopted, and why

- **A cross-machine verdict cache in a bucket** — see § 2; re-measure once
  § 2 has landed: if a pass still replays more than its graduations, the
  next lever is a _semantic_ definition hash (the fields the Bot reads), not
  a store.
- **Incremental Bot-play replay by import graph** (issue #6653's second
  acceptance line, retouched): a search or eval edit reaches nearly every
  card; the hit rate would be ~0 and the ticket would spend a session
  documenting "unsound". The replay is sharded (§ 1), runs on a maintenance
  runner (issue #6653's label half), and a Bot-hash move stays a whole
  sweep.
- **Batch / speculative merge queue** (Mergify `batch_size`,
  `speculative_checks`): two `lane` runners, a 12-min lane, ~14 % red lanes —
  batch bisection costs more than it returns until § 2 has removed the
  expensive step. Re-evaluate on the next report.
- **A third `lane` runner**: the MacBook is RAM-bound (swap 3.5–7 GB in
  bursts, 37 memory-pressure refusals); no.
- **Sharding the sweep onto hosted runners**: needs the corpus reader key and
  the GRE off the owner's machines; a later phase, not this record.
- **Re-verify only what the base changed** (issue #6650): loses most of its
  value when the expensive verify is gone; held until the post-§ 2 report
  says what a repair still re-proves.

## Consequences

- The heavy mutex serves health and the maintenance replay only; with
  issue #5656 ("Delete … the gate mutex") the remaining serialization is a
  runner label per machine, which converges with ADR 0156.
- A grammar PR's `oracle:compile` is seconds plus its graduations; the
  rebase-first preflight (issue #6647) stays useful for conflicts, no longer
  for a 40-min redo.
- A `frozen` verdict for a drift row arrives post-merge: the Bot Gap issue it
  files (today's `--replay-bot` path) is the signal, as it is for a Bot-hash
  move today.
- Reversal of ADR 0156's rung order: an automated revert lands within
  minutes of a named culprit; the culprit's author (a pass) sees the issue
  reopen with evidence instead of a fixer session on the base.
- CLAUDE.md § Quality gates "fix-forward FIRST" and the ADR 0156 rung text
  are updated by issue #6689, with `agents:build`.

## Implementation tickets

| Ticket      | Scope                                                                   | Blocked by               |
| ----------- | ----------------------------------------------------------------------- | ------------------------ |
| issue #6686 | § 1 sharded sweep, byte-identity across worker counts, measured         | —                        |
| issue #6687 | § 2b `derive:sync` plays drift misses on the base; health `pending`     | issue #6686              |
| issue #6688 | § 2a session plays graduations only, carries drift; no job re-exec      | issue #6687, issue #6686 |
| issue #6689 | § 3 revert first; `health:fix` for `stuck` / no culprit; CLAUDE.md line | —                        |
| issue #6690 | § 3 `bot:refit` moves every pin in one PR; preference pins → orderings  | —                        |

Order of landing: issue #6686 → issue #6687 → issue #6688, with issue #6689
and issue #6690 in parallel. Then a three-day re-measure with the report's
taxonomy before issue #6648 / issue #6650 / issue #6651 / issue #6652 are
picked — their numbers were taken with the sweep in the path.
