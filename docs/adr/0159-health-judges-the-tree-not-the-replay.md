# Health judges the tree, not the replay: a late Bot state is a line on the verdict and an issue past the grace, never RED or `pending`; the replay runs on the fast host and its push retries; the batch gate is dispatched by event

## Status

**accepted** — owner's decision of 2026-10-26 (issue #6990), on the RED of
2026-10-25. Reverses ADR 0158 § 2b "What the window holds" (a stale Bot
verdict judged `pending` within the grace and RED past it); extends ADR 0157
§ Option 1b "Health" (the grace now decides a filing for the Bot state, a
verdict only for the derived files); amends issue #5873's "no job requires
one host" with one exception (`HOST_PINNED_JOBS`); adds an event dispatch
to ADR 0154's batch cadence. Ticket: issue #6990 (all four sections, one
PR). Precondition for the lane diet (issue #6989).

## Context

### The 2026-10-25 timeline

- 11:27Z — the ladder's revert of the RED's culprit lands (ADR 0158 § 3).
  The revert edits a `BOT_SOURCE_FILES` module, so the lockfile header's
  `botHash` is no longer the tree's: `derive:sync --settled` answers stale,
  `health-main` records `pending` (ADR 0158 § 2b) and gates nothing.
- 11:30Z — `post-merge.yml`'s `bot-replay` picks `huawei-lane-1` (any
  `lane` runner, issue #5873). The sweep of 6,631 `ready` cards takes 75 min
  there (i7-8550U; 15 min on `macbook-lane-1`). Its push times out at
  `GIT_NET_TIMEOUT_MS` = 120 s, no retry: the sweep is discarded.
- 12:27Z — the grace (`DERIVED_GRACE_MS`, 60 min) passes: health is RED
  with cause `derive:sync`. `base-health` holds the queue.
- 12:50Z — the next replay, again on the Huawei, again 75 min, again a push
  timeout; discarded.
- 14:35Z — a hand re-dispatch lands the job on the MacBook; 15 min later
  its commit is on the base, the next health run is GREEN.

Three hours with no GREEN, every queued PR waiting, on a tree whose tests,
guards and blade were green the whole time. Nothing about the tree was
wrong; a maintenance job was late.

### What the predicate conflates

`--settled` (ADR 0158 § 2b) asks two questions and answers them with one
word:

1. **Is the tree consistent with itself?** The lockfile header's compiler,
   registry and pool hashes, and the four `data/catalogue/*` files, against
   what the tree generates. A disagreement is what `check:oracle` and
   `catalogue:check` red: the committed derived state is wrong for the
   source beside it. ADR 0157's grace (one housekeeping period for the
   derive commit) and its RED past it are right here.
2. **Has the Bot-play state caught up?** A `ready` row without a verdict for
   the definition the tip compiles (the drift sweep's), the header's Bot
   hash not the tree's (the replay's). Neither says anything about the
   tree: the verdicts are a cached measurement of the Bot against the
   catalogue, carried by design across every Bot change (issue #6463) and
   every definition drift (ADR 0158 § 2a). A stale verdict is a card the
   Bot may play worse than the lockfile says, until a job replays it.

A derived artefact's freshness is not the tree's health. Holding GREEN on
question 2 made a 75-min sweep plus a 120 s network timeout into a
three-hour outage of the queue.

## Decision

### § 1 — Health judges the tree, never the replay's lateness

`verdictCurrency` (`scripts/lib/derive-sync.ts`) no longer returns a
freshness. It returns a **currency**: `current`, or `late` with the kind
(`drift` / `bot-hash`) and the reason. `derive:sync --settled`:

- still exits 1 with the `derived-stale` line on question 1 — `pending`
  within ADR 0157's grace, RED past it, as today;
- on question 2 exits **0** and prints a `derived state is late — stale
since <t>: <why>` line. `health-main` reads it (`derivePredicateAnswer`,
  `derivedTipVerdict` carry `late`) onto the GREEN record (`last.json`'s
  `derivedLate`, a `health-main: derived: stale since …` line) and gates
  the tip as any other;
- past `DERIVED_GRACE_MS` **files an issue** (`bug`, `area:workflow`, one
  title per Bot hash for a late replay, one standing title for a late drift
  sweep; idempotent by title on every later run) naming the Bot-hash commit
  range and the latest `post-merge` runs. `--no-file` keeps a by-hand run
  from filing. The grace counts from the commit that moved the Bot hash
  (not from the tip, whose age resets at every landing) for the replay, and
  from the tip's commit for the drift sweep.

Never `pending`, never RED, for question 2. The deployment predicate
(`--fresh`) is unchanged: it never asked.

### § 2 — The replay runs on the fast host

`post-merge.yml#bot-replay` is `runs-on: [self-hosted, lane, host:macbook]`.
Issue #5873's objection — a pinned host offline holds the job 24 h — is
answered by § 1: a held replay is a late replay, which is a line and an
issue, not a hold on anything. The structure guard's `host-pinned` rule
stands for every other job; `HOST_PINNED_JOBS` (`scripts/ci/workflow-
structure.ts`) names this one with its reason, and the guard's test pins
the set to exactly it.

The sweep's worker count stays the heavy tier's (`TOLARIA_SWEEP_WORKERS`
unset: `min(ncpu − 1, 4)`, RAM-capped — ADR 0158 § 4: the MacBook is
RAM-bound). Raising it is a measured change (`bun run machine measure` on
the sweep), stated in its own PR; this record does not raise it.

### § 3 — The push retries

`pushDerivedCommit` takes a `retry` — `PUSH_RETRY_BACKOFF_MS` = 15 s, 45 s,
90 s, so three retries over ~2.5 min — and retries a push whose refusal is
**transient** (`transientPushFailure`: a timeout, or git's and curl's
network lines) with the base unmoved. A moved base is coalesced as before
(`replayBot` re-bases the sweep onto the new tip up to `MAX_TIP_MOVES`
times, as it did); a hook's or a lease's refusal repeats and is never
retried. One pusher serves the derive commit and the replay commit, so both
retry. A push that still fails keeps the swept lockfile under
`$RUNNER_TEMP/bot-replay/` for the job's `bot-replay-lockfile` artifact
and files the same issue as § 1, with the push's reason.

### § 4 — GREEN by event

`health-early.yml`'s `classify` already dispatches `health.yml`'s `gate`
when a push merges a declared repair (issue #6553). It now also runs
`health:batch-due` (`scripts/lib/health-batch-due.ts`): due when the base
has landed `LANDINGS_PER_BATCH` = 20 landings (ADR 0154's cadence; a landing
is a commit whose subject ends in ` (#N)`, read through the compare
endpoint — a hosted checkout is shallow) since the newest verdict in the
store, and no run is in flight on the pivot (`pivotRunInFlight`). Any
unreadable fact answers "not due". The `50 */2` cron stays as the fallback,
not as the clock that decides when the next GREEN can exist. `health.yml#gate`
joins `SERIALISED_JOBS` (`concurrency: { group: health-gate,
cancel-in-progress: false }`): an event dispatch and a cron run never gate
one tip twice on two runners.

## Consequences

- A Bot-source merge is followed by a GREEN on the next gate whatever the
  replay's state; the replay's commit lands within one run on the MacBook
  (~15 min) and, when it cannot, an issue says so with the evidence instead
  of the queue stopping.
- `health-main`'s `pending` is now only ADR 0157's: the derive commit of
  the header and catalogue. `last.json` gains `derivedLate` on a GREEN.
- `docs/guides/github-pipeline.md` § post-merge and § health,
  `docs/agents/quality-gates.md` § The verdict is shared state, and ADR
  0158's status line record the reversal.
- The late issue is the signal a late job gives; `/next-ticket` picks it
  like any `area:workflow` bug. The replay's regression issue (issue #6463)
  is unchanged: a Bot that froze cards is still filed as a Bot regression,
  and the header stays on the previous Bot until it is fixed — and that
  standing issue keeps `--settled` current, as before.

## Not adopted

- **Dropping the grace for question 1 too.** A tree whose committed derived
  files disagree with its source is wrong in the way `check:oracle` reds;
  that stays RED on its own terms.
- **A longer `GIT_NET_TIMEOUT_MS`.** The two 2026-10-25 pushes were
  ~20 MB each over a timing-out connection; a longer wait would have waited
  longer. The retry with backoff is what lets a blip pass.
- **Keeping the replay on any runner with the Huawei's 75 min.** The slow
  sweep was half of the outage; the fast host costs nothing once nothing
  waits on it.
