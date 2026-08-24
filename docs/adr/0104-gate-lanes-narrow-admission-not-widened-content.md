# Gate lanes narrow which projects a diff is admitted to skip — #2431/#2655 stand

## Status

accepted

## Context

Two prior decisions each made `check:guards` run a test project **whole**
rather than filtered down to the files a diff touched:

- **#2431** — the `node` project's scope used to be filtered to
  `scripts/__tests__`, which left every backend catalogue guard
  (`effects/validate`'s Op-registry coverage, `mechanicsRegistry`,
  `divergenceMarkers`, `serialize`'s drift check) outside the light gate. A
  branch reached review with `validate.test.ts` red and a `check:pr` that
  exited 0. The fix widened `node` to run in full, every time `check:guards`
  runs it, pinned by `check-guards-scope.test.ts`.
- **#2655** — the `dom` project had no lane in `check:pr` at all; it ran only
  inside the heavy `test:app`, which `scripts/gate.ts` blocks inside an issue
  worktree, so a `src/` component/layout guard was invisible to an
  implement-subagent and surfaced for the first time at the merge-train.
  Issue #2584 died exactly there, on a shell-height CENSUS guard the failing
  diff never touched — a diff-derived subset would not have caught it. The fix
  added `dom` to `check:guards`, and it too runs **whole**, never filtered to
  changed files.

Both decisions share one lesson: **a catalogue/census guard's job is to
notice something the diff didn't touch** (a keyword nobody registered, a
component nobody resized, a barrel export nobody renamed). Filtering a test
project down to the files a diff changed is exactly the operation that defeats
a census guard, because the guard's whole value is independent of what
changed. So #2431 and #2655 each closed off a filtering axis: once a project
is going to run at all, it runs in full.

Now PRD #2738 asks the opposite-sounding question: skip the bot fast lane
entirely on a diff that cannot reach `convex/**`, skip `dom` entirely on a
diff that cannot reach `src/**`. Read carelessly, that looks like undoing
#2431/#2655 — narrowing back to something diff-derived. **It is not, and this
ADR exists because a future reader would otherwise conclude that it is.**

## The distinction that makes both things true at once

There are two different axes, and #2431/#2655 fixed one while #2738/#2743
operate on the other:

**Axis 1 — CONTENT: once a project is going to run, how much of it runs.**
This is what #2431 and #2655 fixed, and it stays fixed. `bun run check:lane`
(`scripts/check-lane.ts`) never filters a project's own test files by the
diff. The `engine` lane runs the WHOLE `node` project — every file under
`convex/**`, `scripts/**` and every DOM-free `src` test — even though the
triggering diff might touch only one file in `convex/gre/`. The `skin` lane
runs the WHOLE `dom` project, not the subset of component tests that import
the changed file. There is no line of `check-lane.ts` that narrows a project
to a diff-derived file list; `classifyLane`'s `run` array names whole
`--project` invocations (`bunx vitest run --project node`), never a path
argument computed from `git diff`.

**Axis 2 — ADMISSION: whether a project runs AT ALL.** This is what #2738 and
#2743 add, and it is new: a diff that cannot possibly reach `convex/**` (every
changed path classifies `skin`) is not merely given a smaller `node`/bot run —
it is given none. The `engine` lane, symmetrically, admits no `dom` run at
all. This was always implicitly true in principle (a `src/**`-only diff
cannot make `mechanicsRegistry.test.ts` go red because it changes no card
definition), but before `check:lane` existed, every diff paid every project
regardless, because there was no mechanical predicate an agent could trust to
draw that line safely — and getting it wrong in the unsafe direction is
exactly what #2431/#2655 were fixing.

The two axes commute in one direction only, which is the whole point:
**narrowing Axis 2 is safe precisely because Axis 1 stayed fixed.** If the
`engine` lane both skipped `dom` (Axis 2) AND ran `node` filtered to the
diff's own files (Axis 1), it would reintroduce #2431's exact failure mode —
a catalogue guard the diff never touched, silently unrun. `check:lane` never
does the second thing. Every `PlannedCheck.command` in `classifyLane`
(`scripts/check-lane.ts`) that names a vitest project passes no path filter;
the only place a path list reaches a command is `format(diff)`/`lint(diff)`,
tools with no catalogue-guard concept to defeat in the first place.

**Restated as the one paragraph a future reader needs:** #2431 and #2655
stand, unmodified and unreverted. Both made `check:guards` run its projects
**whole** rather than diff-filtered, and every project a lane runs today is
still whole — `check-lane.test.ts` pins that no `run` command carries a path
argument for a `--project` invocation. What changed is a different question
entirely: which projects a diff is **admitted** to skip. A diff that
structurally cannot reach `convex/**` was always going to leave
`mechanicsRegistry.test.ts` green; `check:lane` is the first place that
observation is turned into "so don't run it," fail-closed, and pinned by a
test — not "so run less of it."

## Decision

1. **`bun run check:lane` is the default pre-PR path** (CLAUDE.md § Quality
   gates); `check:pr` remains exactly as it is and is the fallback the
   classifier itself falls back to on any diff it cannot affirmatively place
   in `skin` or `engine` (`laneFor`'s `full` terminal case, `check-lane.ts`).
2. **Lane content is never diff-filtered.** Every check a lane's plan names
   for a `--project` invocation runs that project whole. This is the
   invariant the paragraph above defends, and it is why narrowing Axis 2 does
   not reopen #2431 or #2655.
3. **Lane admission is fail-closed.** `classifyPath` returns `full` for any
   path it does not affirmatively recognise, and `laneFor` treats a single
   `full`-classified path, or an unrecognised directory, as forcing the full
   gate for the whole diff. "Unknown" always means "run everything," never
   "run less."
4. **Batch composition gains lane as a key** (`scripts/lib/queue-plan.ts`,
   issue #2743): `PlannedIssue.lane` is computed from an issue's own
   `targetFiles` with the identical `classifyPath`/`laneFor` predicate
   `check:lane` runs against a real diff — never from the issue's `area:*`
   label. The label is the **hypothesis** a human writes before the code
   exists; the predicate over real files is the **authority**. A batch is
   admitted lane-homogeneous (all `skin`, all `engine`, or all `full`) so
   that the orchestrator's payoff — one shared `check:ui` for a `skin` batch,
   none at all for an `engine` one — holds for every issue actually in it. A
   mislabelled issue (say, `area:ui-ux` on an issue whose real target files
   also reach `convex/**`) simply computes `full` on its own account and is
   deferred as a lane mismatch like any other cross-lane candidate; it never
   invalidates the batch it was excluded from, because nothing about
   admitting the OTHER issues depended on the excluded one's label.
5. **The batch-level pixel receipt replaces one `check:ui` per PR.** A `skin`
   batch pays exactly one full `check:ui` run, on the integrated tree, before
   the merge-train — not one per issue. A red result blocks the whole batch
   until bisected to the responsible PR; it is never patched against an
   unattributed red. `/process-gh-issues` documents this in SKILL.md §4.

## Consequences

- A reader who sees `check:guards` running `node`/`dom` whole in one place and
  a diff skipping `node`/`dom` entirely in another now has one document that
  names both axes and says which decision is on which axis.
- `check-lane.test.ts`'s "names must be invokable" guard is also, incidentally,
  the guard that would catch a future regression on Axis 1: a `run` command
  built with a path filter still resolves to a real script/project, so that
  guard alone would not catch it — but `classifyLane`'s own construction (no
  path-filter branch exists for a `--project` command) is what holds the line,
  and any PR adding one is a deliberate, reviewable change to this ADR's
  central claim, not a silent one.
- Cost measurements for the `skin`/`engine` lanes live in
  `docs/agents/quality-gates.md`, not here — this record is about the
  invariant, not the stopwatch.

## What would change the answer

If a catalogue/census guard is ever added whose failure mode depends on
**which** files changed rather than on the catalogue as a whole (unlikely,
since that is the opposite of what a census guard is for), Axis 1 might
legitimately grow a diff-derived mode — and that change would need its own
ADR, because it is precisely the move #2431/#2655 ruled out for the guards
that exist today.

## Alternatives considered

**Filter lane content by the diff instead of narrowing which lanes run.**
Rejected outright — this is #2431/#2655's failure mode reintroduced on
purpose, and the entire reason this ADR exists is to make sure nobody
proposes it again believing it is what `check:lane` already does.

**Let an agent declare the lane with a flag.** Rejected in `check-lane.ts`
itself (see its header comment): a `--skin` flag is a hand-maintained list in
disguise, and the first agent that passes it out of habit on a diff touching
`convex/` gets a lying green. The lane is derived from the diff, always.

**Let the issue's `area:*` label decide batch lane instead of the real target
files.** Rejected for the same reason as the flag: a label is written by a
human before the diff exists, and treating it as authoritative would make an
honest mislabel (or a scope creep the author didn't anticipate) silently
narrow a gate. The label is kept only as a hypothesis a maintainer can read in
the queue; `planBatch` never consults it.
