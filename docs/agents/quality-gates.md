# Quality gates — why each tier is shaped the way it is

Companion to `CLAUDE.md` § Quality gates, which carries the **norms**: what to
run, when, and what may never be skipped. This file carries the **reasoning and
the measurements** — the material that explains a rule but does not need to be
re-read on every request of every agent.

The split follows the residency finding in `context-residency-audit.md`:
CLAUDE.md is resident in every session and every subagent, so a token there is
paid a few thousand times; a token here is paid when someone asks why.

## Why `check:pr` may never be hand-picked

`check:pr` = format + lint + type-check + `check:index` + `check:stubs` +
`check:guards`. Omitting `check:index` once broke **every card-shipping PR at
the merge-train** — the failure is not local to the branch that skipped it.

## What `check:guards` actually runs, and why its scope is pinned

Three lanes:

1. **The bot suite's fast lane** (#1912) — `TOLARIA_BOT_FAST=1`, deny-list in
   `vitest.config.ts`, ~60-75s. Home of the catalogue-wide bot guards:
   `aiEffectsGuard`, `pickRatings`, `opValuerCoverage`, the censuses.
2. **The whole application suite — node AND dom, both WHOLE** —
   `vitest run --project node --project dom`. `node` is `convex/**` +
   `scripts/**` + every DOM-free `src` test (~30s at the light tier's 2
   workers: no dom env init and `isolate: false`, so the card registry is
   imported once per worker); `dom` (#2655) is every `src/**/*.test.{ts,tsx}`
   that genuinely needs one — component renders, layout guards, census tests
   like `shell-height-claims.guard.test.tsx`.
3. **`bun run cr:lint`** (#2429), ~1s — offline, reads only the vendored CR, so
   the gate's no-network contract holds.

**Lane 2's node half used to be filtered to `scripts/__tests__`.** That left
every backend catalogue guard outside the light gate — `effects/validate`'s
Op-registry/executor/schema coverage, `mechanicsRegistry`, `divergenceMarkers`,
`serialize`'s drift check. A branch reached review with `validate.test.ts` red
and a `check:pr` that exited 0. Fixed in #2431; scope now pinned by
`scripts/__tests__/check-guards-scope.test.ts`, and bot deny-list drift by
`bot-fast-lane.test.ts`. Widening or narrowing a lane means changing that
guard, which is the point.

**Lane 2 had no dom half at all until #2655.** `dom` ran only inside
`bun run test:app` (heavy tier), which `scripts/gate.ts` blocks by design
inside an issue worktree — so a `src/` component/layout guard was invisible
to an implement-subagent's `check:pr` and surfaced for the first time at the
merge-train, on the rebased tree, after review had already been paid for.
Issue #2584 died exactly there on a shell-height CENSUS guard the failing
diff never touched — a diff-derived subset would not have caught it, which is
why the fix runs the dom project WHOLE (same reasoning as the node half
above), not a changed-files filter. It costs nothing extra in tier: `dom`
joins the SAME `vitest run` invocation as `node`, inside the SAME
`check:guards` command `check:pr` already runs under `gate.ts light` — no
mutex, no worker-count change, no full-suite escape hatch. Scope pinned by the
same `check-guards-scope.test.ts` (a parallel describe block for `dom`).

## The dom project is need-classified, not directory-classified

`scripts/test-env-split.ts`, computed at config load: a `src/**/*.test.ts` with
no DOM global, no testing-library import, no jest-dom matcher and no
`vi.mock`/spy/fake-timer runs in the **node** project instead — 110 files
today, and a file that grows a DOM dependency moves back by itself (#2433).
`bun run test:app` went 190s → 108s at the heavy tier.

The partition is pinned by `scripts/__tests__/src-test-env-split.test.ts`. The
failure it exists to prevent is subtle: a file selected by **no** project runs
nowhere and the gate stays green.

### What genuinely needs a DOM — outside `check:all:inner`, inside `check:pr` since #2655

Issue #2435 swapped the environment to `happy-dom`, measured back-to-back on
the same tree with `TOLARIA_VITEST_WORKERS=2 bunx vitest run --project dom`
(252 files then, 2207 passed both ways):

| environment | wall    | `environment` phase |
| ----------- | ------- | ------------------- |
| happy-dom   | 119.35s | 44.33s              |
| jsdom       | 180.05s | 113.03s             |

~34% off wall, ~61% off the `environment` phase. Per-file environment init
still dominates, so no deny-list helps and `--pool=threads` measured identical.

**Still outside `check:all:inner`/`check:all`** — the heavy static-only gate
never ran any test project, `dom` included, and that is unchanged by #2655.
**No longer outside `check:pr`** — `check:guards`'s lane 2 now runs `dom`
whole, in the same `vitest run` invocation as `node`, on the light tier (no
mutex, no worker-count change, no `TOLARIA_ALLOW_FULL_SUITE`); before/after
wall-clock is in the issue's PR. Iterating still uses targeted runs
(`bunx vitest run <path>`) — `check:pr` is the whole-project backstop before a
PR opens, the same relationship the node project already had.

**Its one known cross-boundary breakage class** is caught statically instead of
by running it: a `vi.mock("@convex/cards")` factory going stale when a name
becomes barrel-internal (#2339 — 102 tests across 12 files, seen first at the
merge-train). `scripts/__tests__/convex-cards-barrel-mock.test.ts` runs in the
node lane and catches it at light-gate speed.

## `check:lane` — measured lane costs, what each lane skips, and why #2431/#2655 still stand

`bun run check:lane` (PRD #2738: #2739 tsconfig cache → #2740 classifier landed
inert → #2741 wiring/execution → #2743 batch homogeneity + this section) picks
a lane from the diff — `skin` (`src/**`/`public/**`/`index.html` only),
`engine` (no `src/**` at all) or `full` (anything else, fail-closed) — and
runs exactly that lane's checks. It is now the default pre-PR path
(CLAUDE.md § Quality gates); `check:pr` is the fallback the classifier itself
runs verbatim on a `full` diff.

**The axis it operates on is only partly the axis #2431/#2655 fixed — see
ADR 0104 for the full argument, including which of the two is narrowed
here.** In one sentence: no lane scopes a `--project` invocation to a
**diff-derived** subset of tests, which is the property #2431 established;
where a lane's `--project` command carries a path argument at all it is a
fixed literal written into the lane definition (`skin`'s
`node[src,scripts]` = `bunx vitest run --project node src/ scripts/`), with
a paired skip entry recording what that excludes. The only diff-derived
commands are `format(diff)` / `lint(diff)`, which are prettier and eslint,
not vitest projects. What a lane otherwise decides is whether a project runs
**at all**: `skin` never runs the bot fast lane or the `node` project's
`convex/**` half; `engine` never runs `dom` — and that last one **is** a
deliberate narrowing of #2655's admission decision, not a preservation of
it (ADR 0104 § Decision, with the three backstops that make it acceptable).

### Measurements — the like-for-like run, and why the first round was voided

**All three figures below were taken in one window on the same machine
(2026-08-24, 18:32–18:44, load average 4–11 and falling, no `ladder.ts` job
running), each exiting 0.** That is what makes them comparable; the first
round was not.

| lane                  | measured, like-for-like | PRD #2738 projection |     vs baseline |
| --------------------- | ----------------------: | -------------------: | --------------: |
| `check:pr` (baseline) |                    305s |                 330s |               — |
| `skin`                |                    222s |                ~188s |  **−83s (27%)** |
| `engine`              |                    175s |                ~175s | **−130s (43%)** |

**`engine` hit its projection exactly. `skin` did not** — 222s against ~188s,
a real 27% saving but 34s short. Recorded as measured rather than rounded
toward the projection. Two candidate explanations, neither yet separated: the
`skin` run happened at the highest load of the three (≈10 vs ≈4 for the
baseline), and `dom` is the single most expensive thing in that lane, so the
projection may simply have been optimistic about it. Anyone re-measuring
should run `skin` last, when the machine is quietest, before concluding the
projection was wrong.

**Why the first round was voided.** The lane costs recorded when #2741
shipped (`skin` 343.3s, `engine` 275.2s / reviewer re-run 264.9s) were
measured while a heavy 7-worker `ladder.ts` job saturated the machine, and
the 330s `check:pr` baseline they were compared against was measured on a
quiet one — so that comparison mixed a contended number against a quiet one
and proved nothing. A quiet re-run was then attempted for #2743 and blocked
again: a _second_ `ladder.ts --tier decision --variant placebo` job ran
continuously through the implementer's 35-minute window (evidence trail in
`docs/findings/2743-recurring-ladder-contention-during-measurement.md`).
Rather than relabel a second contended window "quiet", the figures stayed
marked unverified until the measurement above finally landed on an idle
machine.

**The load multiplier, established during that voided round and still
useful:** re-measuring two of this PRD's own baseline rows under the
contended load gave `node[src]` 24s vs 8s quiet (3.0x) and `node[scripts]`
72s vs 33s quiet (2.2x); 2.26x applied to `dom`'s 109s quiet baseline
reproduces the 246.2s `dom` figure inside the contended `skin` run almost
exactly. Contention, not lane content — as the like-for-like numbers above
now confirm.

### What each lane skips, and why each skip is safe

| check                 | skin                       | engine      |
| --------------------- | -------------------------- | ----------- |
| format + lint         | diff-scoped                | diff-scoped |
| `check:ts`            | `app` + `scripts` projects | whole       |
| `check:bundle`        | yes                        | yes         |
| `check:index`/`stubs` | no                         | yes         |
| `cr:lint`             | yes                        | yes         |
| bot fast lane         | no                         | yes         |
| `node` — `convex/**`  | no                         | yes         |
| `node` — `scripts/**` | yes                        | yes         |
| `node` — `src/**`     | yes                        | no          |
| `dom`                 | whole                      | no          |

Three rows are decisions, not oversights (PRD #2738 § Implementation
Decisions has the full reasoning; summarised here):

- **The `scripts/` project stays in BOTH lanes** — it is where
  `src-test-env-split.test.ts` lives, the guard against a new `src` test file
  landing in neither vitest project, and `skin` is precisely the lane that
  adds `src` test files.
- **`engine` keeps the WHOLE type-check** — `src/**` imports `convex/gre`
  (ADR 0074, the client-side Brain and the Draft Lab), so an engine diff can
  still break the app project; that type-check is one of three backstops (with
  `convex-cards-barrel-mock.test.ts` and the full gate at the merge-train)
  that make dropping `dom` safe for this lane.
- **`skin` keeps `check:bundle`** — 12s, and the only check that catches the
  duplicate-import class that crashes the app on cold load.

### Batch homogeneity and the batch-level `check:ui`

`scripts/lib/queue-plan.ts`'s `planBatch` (issue #2743) computes each
candidate issue's `lane` from its own declared/inferred `targetFiles`, with
the identical `classifyPath`/`laneFor` predicate `check:lane` runs against a
real diff — never from the issue's `area:*` label, which is a hypothesis a
human wrote before the code existed. A batch is admitted lane-homogeneous
(all `skin`, all `engine`, all `docs`, or all `full`); a candidate whose real lane
disagrees with the batch's is deferred as a lane mismatch, the same way an
overlapping target file is deferred today. `/process-gh-issues` runs exactly
one `check:ui` for a `skin` batch, on the integrated tree, before any of its
PRs merge, and bisects across the batch's PRs on red rather than patching an
unattributed failure — see `references/merge-train.md` (§ "Batch-level
`check:ui`") for the procedure, including the lane re-derivation from the
integration's real diff.

## Why `check:all` verifies formatting instead of repairing it

`format:check`, not `format`. #1807: a gate that repairs what it checks can
never fail. On drift, run `bun run format` and re-run.

## Why the suites are three separate invocations

`bun run test` = `test:app` (everything not `*.bot.test.ts`, ~580 files) →
`test:bot` (ISMCTS/eval/driver/self-play) → `test:blade` (must tier, own
config, ~42s). `test:bot` is a separate invocation so heavy episodes get an
uncontended run. Blade's stretch tier stays report-only and manual
(`bun run test:blade:stretch`).

## Why there is no CI

The three GitHub Actions workflows (`lint`, `test`, `blade`) were deleted
2026-08-08 (#2407). The plan's Actions minutes ran out, and with no branch
protection on this repo (`/branches/main/protection` → 403, needs Pro) they
gated nothing — every job duplicated a command the local gate already runs.

Consequences that are still live: nothing may be left to CI, and the
merge-train always takes Lane B (local full gate on the rebased tree).
**Re-adding a workflow only makes sense together with branch protection** —
otherwise it is a report nobody blocks on.

## `check:ui` — the headless browser lane, and why it stands outside `check:all`

`bun run check:ui` (issue #2580, base slice #2512) is the only check in this
repo that looks at pixels. It starts its own Vite on `127.0.0.1`, signs in
with the dev account, walks the runbook surfaces at the five ADR 0101
viewports, runs the occlusion probe plus axe-core, and compares the result
against `scripts/ui-gate/budgets.json`.

**It is deliberately NOT in `check:all` or `check:pr`.** Three reasons, in
order of weight:

1. `check:all` is offline by contract; this lane needs a live Convex
   deployment and a browser binary. A gate that can go red because a backend
   is not running is a gate people learn to route around.
2. `check:all` is the heavy, mutex-held tier. A browser boot taxes every
   session that never touches the DOM, and it holds a browser rather than
   `ncpu - 1` vitest workers, so neither tier fits it.
3. It is slower than the whole static gate — measured ~4 min for eight
   surfaces × five viewports on this machine, most of it axe.

So `check:ui` is a standalone command, and **its output is the receipt a UI PR
pastes**. The enforcement is the same as it was for the manual browser check
(`.claude/rules/chrome-debug.md`): a UI diff with no receipt and no "cannot
reach the DOM" line is not done. What changed is that the receipt is now
mechanical, reproducible, and available to a headless agent, which the manual
CDP procedure never was.

**Coverage is asserted, not assumed.** The lane exits non-zero for two
different reasons and never conflates them: `FAIL` (a number over its
budgeted ceiling) and `UNWALKED` (it could not measure the surface at all —
no budget entry, an absent debug-scenario row, a route blocked by an active
game). The pure comparison lives in `scripts/ui-gate/budgets.ts` and is unit
tested in `scripts/__tests__/ui-gate-budgets.test.ts`, because "a screen we
could not reach reported as green" is precisely the failure this lane exists
to make impossible. A surface may be skipped only by declaring it
`{"status": "unwalked", "reason": …}` in the budget file — which still prints,
and still shows in the coverage line.

**The budget file is the contract later slices tighten.** Ceilings start at
what each surface measures TODAY. Where today's number violates a hard floor
(zero occluded card tiles, zero stranded controls, no axe serious/critical)
the entry carries a `knownDebt` note naming the defect, printed under every
run — never a silently loosened floor.

## Hooks, and why they are tracked in git

`.husky/pre-commit` — lint-staged/prettier on staged files. A convenience;
skipped by merge/rebase/cherry-pick, so never rely on it.

`.husky/pre-push` — diff-scoped `prettier --check` on pushed commits. A push
updating the **default branch** also runs the full gate (#2203), skipped only
when the SHA is already in `.claude/telemetry/green-sha`, or explicitly via
`TOLARIA_SKIP_PUSH_GATE=1` (which prints a red banner).

Both are tracked in git and guarded by
`scripts/__tests__/worktree-bootstrap.test.ts`, because a missing husky hook is
silent — it vanished for six weeks once before anyone noticed.

## CPU admission control

`scripts/gate.ts`, because several sessions share this machine. A queued heavy
gate is not a hang; stale locks are auto-pruned.

The full gate is blocked inside an issue worktree (`feat/issue-N` /
`fix/issue-N` → exit 1): the merge-train runs it once per landing tree.
`TOLARIA_ALLOW_FULL_SUITE=1` is the orchestrator-only escape hatch.

### The heartbeat attests to progress, not to being alive (issue #2999)

The owner stamp is a heartbeat rather than an acquisition time because a
legitimately long hold exists: the bot ladder runs for hours (issue #1924), and
a fixed 45-minute staleness window would prune it. So the holder refreshes the
stamp every 5 minutes and only a holder that went silent for 45 minutes is
reclaimed.

Refreshed _by the gate process_, that heartbeat attested to nothing. Measured
2026-09-01:

|                                               |                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Holder                                        | `health:main` detached by a land, worktree `tolaria-health-27242`                    |
| Held for                                      | 2h13m, still heartbeating                                                            |
| Its `vitest run --project node --project dom` | **16.86 s of CPU in 2h13m**, RSS 45 MB, **zero worker children**                     |
| Blocked                                       | `docs:ship` (2h07m), a `land` (1h31m), and a third session's land that never started |
| Self-recovery                                 | none — freed by a manual `kill`                                                      |

`alive(pid)` was true, `Date.now() - owner.ts` never approached `STALE_MS`, and
so the reclaim branch could not fire. The reclaim machinery was correct; it was
being fed a tautology.

The fix keeps that machinery untouched and makes its input honest. Each beat
measures the **cumulative CPU time of the holder's descendants** (`ps -Ao
pid=,ppid=,time=`, summed over the subtree, the gate process itself excluded so
it cannot vouch for its own existence). The stamp is refreshed only while that
total is still advancing; after `STALL_BEATS` consecutive frozen beats (3 ≈
15 min at the default period) the holder logs loudly, stops refreshing for
good, and the ordinary staleness path reclaims the lock 45 minutes later.

Three properties are load-bearing:

- **Descendant CPU needs no cooperation from the wrapped command.** Anything
  the gate wraps — vitest, `tsc`, eslint, a `land` shell pipeline — burns CPU
  continuously; the only pauses are seconds-long API calls inside `land`, three
  orders of magnitude under the 15-minute window.
- **An unmeasurable subtree counts as progress.** If `ps` is missing or its
  output does not parse, the holder keeps beating: reclaiming a healthy holder
  is the worse failure, and the fallback is the pre-existing behaviour.
- **Nothing kills the wrapped command.** The gate only stops vouching for it.
  A holder that comes back to life still owns its own process; it simply no
  longer owns the mutex, and `release()` already refuses to delete a lock whose
  owner pid is not its own.

`TOLARIA_GATE_STALE_MS` and `TOLARIA_GATE_STALL_BEATS` join
`TOLARIA_GATE_HEARTBEAT_MS` as test-only overrides, which is what makes the
whole stall → silence → reclaim path observable in milliseconds
(`scripts/__tests__/gate.test.ts` § liveness) instead of in three quarters of
an hour.

### A waiter says who is blocking it

The second half of the same incident: three sessions sat blocked with no
indication of who held the lock, since when, or from which worktree, and the
diagnosis had to be rebuilt by hand from `owner.json` plus `ps`. Every field
was already being written and simply never shown.

A waiter now prints one line naming the holder's pid, how long it has held,
when it last attested to progress, its cwd and its command — immediately, again
whenever the holder changes, and on every 60-second retry rather than a bare
"still waiting". `bun run gate:who` prints the same line plus the holder's
measured descendant CPU and its time-to-reclaim, so the two-hour reconstruction
above is one command.

Reclaims are loud and typed, in stderr and in `.claude/telemetry/gate-lock.jsonl`:
a **dead** holder is an orphan, a **stalled** one is a live pid whose command is
still running and hung. A normal release logs nothing at all, so either reclaim
line in a log is a signal by itself.

## Worktree isolation, and the documentation lane

Measured over the 30 days to 2026-08-17: **~40 documentation-only commits
landed straight on `main`** — ADRs, PRDs, CONTEXT.md entries, findings notes,
several with messages like `update context` or `findings allineati`. Two of
those days also carry a `Merge branch 'main' of …`: local `main` had diverged
from origin and was reconciled with a merge commit. Meanwhile 31 worktrees had
accumulated, several dirty, several on already-merged branches.

The cost is not tidiness. **Markdown is gated**: `format:check` covers
`**/*.md`, `cr:lint` reads CR citations out of prose, and `adr-index`,
`resident-context-budget`, `findings`, `project-skills` and `action-space` all
read documentation files. So an unfinished ADR sitting in the shared checkout
reds `check:all` for every OTHER session on this machine, on a file unrelated
to their work — which under the green-main invariant they must stop and deal
with. The user-visible symptom is "I launch three sessions and they fight".

The rule "never work in the shared main checkout" already existed, but it lived
inside `.claude/skills/process-gh-issues/SKILL.md` — so `/process-gh-issues`
isolated every time and an ordinary discussion never did. It is now in
`CLAUDE.md`, and enforced:

- `deny-guard.sh` § 0 denies `Edit`/`Write`/`MultiEdit`/`NotebookEdit` on a
  **versioned** path in the main checkout. Gitignored paths (`.claude/telemetry`,
  `.claude/receipts`, `*.local`) stay writable — the loop writes `green-sha` and
  its receipts there by design. Linked worktrees are untouched. Per-session
  hatch: `TOLARIA_ALLOW_MAIN_EDIT=1 claude`.
- `deny-guard.sh` § 4 additionally denies `git add -A` / `git add .` there —
  `git commit -a` in two steps, and the same sweep of another session's work.
- Known hole, accepted: a `cat > file` heredoc in Bash still gets through.
  Matching redirections inside a command string is the false-denial shape § 4's
  header is about, and the authoring tools are what a model actually uses.
- `deny-guard.sh` § 1 denies `gh pr merge` **anywhere** (#2537), not just from
  an issue worktree: the gate mutex serialises gating, `land` extends it over
  the merge, and a merge typed by hand takes no lock at all — three did on
  2026-08-18, two of them from the main checkout as recovery after `land`
  failed. `land`'s own merge is a child process, invisible to the hook by
  design. Per-command hatch, naming the one merge it authorises:
  `TOLARIA_ALLOW_MANUAL_MERGE=1 gh pr merge <PR#> --squash`.
- **Still open, and unclosable from a hook: the GitHub web UI.** No hook sees a
  merge clicked in a browser, so nothing stops `main` moving that way. The only
  defence is not doing it; `land` exists so there is no reason to.
- Heredoc BODIES are stripped before any rule reads the command
  (`.claude/hooks/lib/strip-heredoc-bodies.awk`): a commit message, a PR body
  or a `python3 - <<'PY'` patch is data the shell never executes, and a
  substring scanner cannot tell it from a command. Widening § 1 made this
  load-bearing — a patch script that merely MENTIONED the merge was denied.

**The documentation lane** is the door beside that wall. A prose change cannot
break the engine, so it does not owe the heavy suite:

```
bun run wt:docs <slug>     # worktree + docs/<slug> branch off origin/main
… write the document …
bun run docs:ship          # check:docs → commit → rebase → push → PR → merge → teardown
bun run docs:ship --no-merge   # …but leave the PR open
```

`check:docs` = `format:check` + `cr:lint` + the five guards that read prose
(`DOC_GATE_TESTS` in `scripts/docs-lane.ts`). Seconds, `light` tier, no
machine-wide lock — which is what makes a PR per discussion affordable instead
of a tax people route around.

**Its MERGE, however, takes the lock** (#2537). Gating and merging are separate
acts: a docs merge moves `main` exactly as much as any other, and `main` moving
under a session mid-gate is what makes that session's verified tree stop being
the tree that lands. So `docs:ship` re-runs the rebase, `check:docs` and the
force-push _inside_ one `gate.ts heavy` invocation and merges there — paying
the queue for the seconds it merges in, and for nothing else. The cheap gate is
untouched; `bun run check:docs` on its own still takes no lock.

`docs:ship` refuses a changeset containing anything that is not `*.md` or under
`docs/`: a mixed change goes through the ordinary branch and the full gate.

**The list is the lane's weak point, so it is guarded.** `docs-lane.test.ts`
runs a census: any test under `scripts/__tests__` whose source reads a
documentation path must be either in `DOC_GATE_TESTS` or in
`DOC_GATE_TESTS_EXCLUDED` with a recorded reason, and `check:docs:inner` in
`package.json` must run exactly the covered set. A new doc guard that nobody
adds to the lane fails the census rather than silently narrowing the gate.

## Context hygiene — the measurement, and why it is not a gate

ADR 0110 moved an issue from an orchestrator fanning out to subagents into ONE
main-thread context. Per issue that trade paid (median $59 → $42), but it also
retired the doctrine that had kept the orchestrator's context small — delegate
read-only search, pipe noisy stdout — and put nothing in its place. Nothing in
the pipeline caps or prunes what accumulates, and a prompt is re-read as
cache-read by every turn that follows it, so the cost of a session grows
super-linearly in its own length.

**`bun run telemetry:context`** is what makes that visible:

```bash
bun run telemetry:context                                # last 7 days
bun run telemetry:context --from 2026-08-28 --to 2026-09-05
bun run telemetry:context --json                         # machine-readable
```

It reads the SQLite mirror (`bun run telemetry:ingest` fills it) from the
primary checkout, so it works unchanged from inside a worktree. A session is
taken WHOLE when any of its turns falls in the window — deciles are positions
within a session, and truncating one at the window edge would report its middle
as its start.

### The committed baseline — 2026-08-28 → 2026-09-05, 121 sessions

This is the state the hygiene contract in `.claude/skills/next-issue/SKILL.md`
was written against. Re-run the command over a later window to say whether it
held.

```
  decile   turns   mean $/turn   mean ctx
  0         1740       $0.0744        93k
  1         1680       $0.0834       140k
  2         1693       $0.0962       172k
  3         1686       $0.1094       200k
  4         1668       $0.1192       229k
  5         1702       $0.1308       253k
  6         1704       $0.1449       276k
  7         1675       $0.1612       303k
  8         1698       $0.1689       328k
  9         1635       $0.1855       353k

  last/first turn cost: 2.49x — back half = 62% of main-thread spend
  per API response (one response = one turn): $0.0744 → $0.1864 over 16868 turns

  bucket        calls   tok added   solo    tok/call     p90
  fs             7906     5158657    4707        960     2122
  other          5892     2983028    5074        551     1186
  gh              927      729439     702        919     2029
  git            1273      504301     864        512      846
  test            798      264235     608        386      676
  convex          345      213938     211        901     2573
  bun             451      206311     319        546     1277
  skill            36      134470      31       4058     5540
  gate            140       52822     112        449      769
  agent            95       22310      31        409      418
  task              6        6756       5       1220     1520

  untracked (Read/Edit/Grep/user text): 13111747 tok over 3247 intervals; 48 intervals dropped (context compacted)
```

**These are not the numbers issue #3078 quotes**, and the difference is not
noise. That issue was written against a store in which one API response was
billed once per content block, because `llm` was keyed on the transcript line
rather than on `message.id`; measuring the growth curve is what surfaced it, and
the same PR fixed the ingest and re-keyed the history. Reading the two side by
side:

|                          | as recorded before the fix |          after |
| ------------------------ | -------------------------: | -------------: |
| first decile             |              $0.0843 @ 88k |  $0.0744 @ 93k |
| last decile              |             $0.1989 @ 349k | $0.1855 @ 353k |
| last / first             |                      2.36x |          2.49x |
| back half's share        |                        62% |            62% |
| main-thread rows, window |                      24895 |          16452 |

The finding the contract rests on is **unchanged, and slightly stronger**: the
inflation was close to uniform across the deciles, so it moved the absolute
dollars and not the shape. Sessions whose transcripts are no longer on disk keep
their old keys — the response id cannot be recovered for them — so figures
reaching further back than the retained transcripts stay somewhat high.

### How to read it

The **decile table** is the headline: a turn in the last tenth of a session cost
2.49x one in the first, and the back half burned 62% of main-thread spend for
50% of the turns. Running the back half at the front half's context is worth
roughly a quarter of total spend.

The **bucket table** attributes context growth to the calls that caused it.
There is no record of how big any tool result was — the hook stores a command,
never its stdout — so growth is derived from the one thing that IS recorded,
each turn's prompt size: `added = ctx(i+1) - ctx(i) - out_tok(i)`, credited to
the spans whose pre-event falls between the two turns. `tokAdded` splits a
shared interval evenly; `tok/call` and `p90` are reported over SOLO intervals
only, where no split is needed and the number is a measurement rather than an
average of an average. The derivation, and the two things it deliberately
cannot see, are documented on `scripts/lib/telemetry-context.ts`.

`untracked` is the honest hole: the hook records spans for Bash, Agent, Skill
and Task only, so Read/Edit/Grep/Write and the user's own text have no span to
attribute to and are reported as a lump rather than folded into `other`. At 13.1M
tokens it is the largest single line in the table — worth naming, not hiding.

### Why prose and not a ratchet

Issue #3078 scoped enforcement out on purpose. A hook that refuses an unfielded
`gh` call, or a ratchet on tokens-per-issue, prices every legitimate exception
(an issue whose comments genuinely must be read in full) at the same rate as the
waste, and the pipeline already carries more mechanical gates than any single
session reads. The contract is three habits in the one document every
issue-closing session reads, and this command is how anyone checks, after the
fact, whether they took.

## Latency per issue — the measurement, and what it does to ADR 0110's target

ADR 0110 records a target it never checked: **"a median issue closes in 10-15
minutes"**. Nothing reported per-issue latency at all, so the figure survived as
folklore — and a session left open over lunch looked, in every existing view,
exactly like a session grinding the gate.

**`bun run telemetry:latency`** is what makes that visible:

```bash
bun run telemetry:latency                                # last 7 days
bun run telemetry:latency --from 2026-08-28 --to 2026-09-05
bun run telemetry:latency --json                         # machine-readable
bun run telemetry:latency --sessions 10                  # slowest sessions too
```

It reads the same SQLite mirror `telemetry:context` does (`bun run
telemetry:ingest` fills it) from the primary checkout, so it works unchanged
from inside a worktree. A session is taken WHOLE when any of its turns falls in
the window — wall clock is first-to-last message, and truncating a session at
the window edge would report a fragment of it as the whole issue. Sessions
longer than `--max-hours` (12 by default) are dropped as abandoned windows
rather than closed issues.

### The committed baseline — 2026-08-28 → 2026-09-05

```
latency per issue — 2026-08-28 → 2026-09-05 (sessions over 12h excluded)

  issue-closing sessions (landed ≥1 PR) — 72 sessions
  component                    median      p90     mean
  wall                          91.0m   504.4m   178.2m
  tool                          42.5m    90.6m    51.7m
    of which gate/test/build    27.3m    59.7m    29.7m
  model                         24.5m    45.2m    26.0m
  machine (tool + model)        70.1m   126.5m    77.7m
  idle                          22.8m   420.6m   100.5m

  /next-issue sessions (the ADR 0110 pipeline) — 58 sessions
  component                    median      p90     mean
  wall                          85.4m   369.9m   159.4m
  tool                          40.8m    82.9m    48.6m
    of which gate/test/build    26.6m    51.8m    26.0m
  model                         24.5m    46.1m    27.0m
  machine (tool + model)        67.3m   126.0m    75.6m
  idle                          14.3m   299.7m    83.8m

  all sessions in window — 113 sessions
  component                    median      p90     mean
  wall                          64.7m   329.6m   130.0m
  tool                          27.0m    79.5m    33.7m
    of which gate/test/build    11.9m    48.0m    19.1m
  model                         17.6m    41.4m    19.7m
  machine (tool + model)        47.4m   118.1m    53.4m
  idle                          12.2m   280.5m    76.6m
```

**These are not the numbers issue #3079 quotes** (93 sessions, 80m median wall,
35m median tool), and the divergence is definitional, not noise. Three reasons,
all of which make the finding stronger rather than weaker:

- **"Issue-closing" is now a stated predicate.** A session counts when it
  emitted at least one `pr-link` event — the only observable in the store that
  says work landed. The issue's cohort was an ad-hoc query that cannot be
  recovered.
- **Tool time is a UNION, not a sum.** Three parallel Bash calls in one turn are
  70 seconds of wall clock, not 150. Summing would have overstated it; the
  figure went UP anyway, because of the third reason.
- **`check:lane` and `land` were not classified as gates.** Both were bucketed
  as plain `bun`, which put the two single largest commands by wall time in the
  window (`check:lane` 334m over 80 runs, `land` 270m over 37) outside the
  gate/test/build block entirely. Fixed in `telemetry-db.ts`; the report
  classifies from `spans.cmd` at query time, so the whole history is
  reclassified rather than only the rows ingested afterwards.

### How to read it

`wall` is first-to-last main-thread message. `tool` is the union of the recorded
tool spans, clipped to the session. `model` is generation: a gap that follows a
tool result is machine time whole (nothing can interject once the loop is
running), and a gap with no tool call in it is split against a fitted estimator,
with the remainder becoming `idle`. The estimator, the ceiling that catches an
interrupted session, and the three things the derivation deliberately cannot see
are documented on `scripts/lib/telemetry-latency.ts`.

**Each component is summarised independently, so the medians do not add up to
the median wall** — the session in the middle of the wall distribution is not
the one in the middle of the idle distribution. The `mean` column is the one
reading where the parts do sum.

`machine` is the row that settles the target: tool plus model is the floor a
session cannot go below whatever the human does.

### The target, restated against the measurement

**10-15 minutes is not reachable in this pipeline's shape, and no change named
so far gets close.** At the median `/next-issue` session:

| Block                          | Median | Can it be cut?                                    |
| ------------------------------ | -----: | ------------------------------------------------- |
| gate / test / build            |  26.6m | Yes — the one real lever                          |
| tool, everything else          |  15.7m | Marginally: `gh`, `git`, greps, the worktree init |
| model generation               |  24.5m | Only by making the session shorter                |
| **machine floor (tool+model)** |  67.3m |                                                   |
| idle                           |  14.3m | Yes, but it is not the median session's problem   |
| **wall**                       |  85.4m |                                                   |

Delete the entire gate/test/build block — every check, every suite, `land`
included — and the median session still needs **40.4 minutes** of machine time.
Model generation alone is 24.5m and shrinks only if the session runs fewer
turns, which is the context-hygiene lever above, not a latency lever.

So the target recorded in ADR 0110 and repeated in
`.claude/skills/next-issue/SKILL.md` is replaced by the measured-supported pair:

- **Today: 85 minutes median wall, 67 minutes median machine**, for a
  `/next-issue` session.
- **Target: 60 minutes median wall**, which is what halving the gate/test/build
  block and removing the median session's idle would buy. Anything below ~40
  minutes needs a change to what a session does, not to how fast it does it.

Re-run the command over a later window to say whether that held. Note what the
`idle` column is NOT saying: its p90 of 300m is real, but it is the abandoned
long tail, not the median issue — which is exactly why this is reported as a
distribution and not as the mean the issue was first argued from.
