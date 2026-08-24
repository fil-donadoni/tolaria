# Gate lanes narrow which projects a diff is admitted to skip — #2431 stands unmodified, #2655 is deliberately narrowed

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
  (PR #2737, commit `fc8b9672`) added `--project dom` to `check:guards` so it
  runs on **every** diff, unconditionally. That is an ADMISSION fix, not a
  content one: there was no filtered/partial `dom` state before it to widen
  back to whole — `dom` simply did not run in the light gate at all. This
  point matters enough to its own section below, because an earlier draft of
  this ADR filed #2655 under the wrong axis.

Both decisions share one lesson: **a catalogue/census guard's job is to
notice something the diff didn't touch** (a keyword nobody registered, a
component nobody resized, a barrel export nobody renamed). Filtering a test
project down to the files a diff changed is exactly the operation that defeats
a census guard, because the guard's whole value is independent of what
changed. #2431 closed off a filtering axis for `node` — once it runs, it runs
in full, never diff-scoped. #2655 closed off an admission gap for `dom` — it
now runs on every diff, never conditionally. Different axes, same direction:
both moves widened, never narrowed, and by the time `check:pr` reached its
current form neither project's participation varied with the diff.

Now PRD #2738 asks the opposite-sounding question: skip the bot fast lane
entirely on a diff that cannot reach `convex/**`, skip `dom` entirely on a
diff that cannot reach `src/**`. Read carelessly, that looks like undoing
#2431/#2655 — narrowing back to something diff-derived. **For #2431 that
reading is wrong outright: `check:lane` never diff-filters a project's own
file list, so #2431 stays completely intact. For #2655 that reading is
partially right, and this ADR exists to say exactly how much — not to wave
the question away.**

## The distinction that makes both things true at once

There are two different axes, and they do not split along the #2431/#2655
line the way an earlier draft of this ADR claimed.

**Axis 1 — CONTENT: once a project is going to run, how much of it runs.**
This is what #2431 fixed, and it stays fixed — precisely: no `--project`
invocation in `classifyLane`'s `run` array is ever scoped to a DIFF-DERIVED
subset of a project's tests. No lane computes "which files inside this
project did the diff touch" and hands vitest only those. The `engine` lane
runs the WHOLE `node` project — every file under `convex/**`, `scripts/**`
and every DOM-free `src` test — even though the triggering diff might touch
only one file in `convex/gre/`. The `skin` lane runs the WHOLE `dom` project,
not the subset of component tests that import the changed file. The one
exception, and it is a declared one, is the `skin` lane's `node[src,scripts]`
(`bunx vitest run --project node src/ scripts/`): it DOES carry a path
argument. That argument is a fixed, literal scope written into the lane
definition — `src/ scripts/`, never a list built from `changedPaths` or
`presentPaths` — and the sibling `node[convex]` skip entry in the same lane
records exactly what that static scope excludes and why. So the accurate
statement is narrower than "never a path argument": no `run` command's path
argument is ever COMPUTED FROM THE DIFF; where one exists, it is static and
declared, and its matching skip entry says what is thereby not run.

**Axis 2 — ADMISSION: whether a project runs AT ALL.** This is the axis
#2655 actually operated on, and it is also the axis `check:lane` operates on
— the same axis, not a different one, which is the correction this section
exists to make. #2655 (PR #2737, commit `fc8b9672`) moved `dom` from "never
runs in the light gate" to "runs on every diff, unconditionally": a pure
admission decision, since there was no partial or filtered `dom` state before
it to widen back to whole — only an absence to fill. `check:lane`'s `engine`
lane makes the opposite move on that SAME axis: it narrows `dom`'s admission
from "every diff" back down to "every diff that can reach `src/**`"
(symmetrically, `skin` narrows the bot fast lane and `node`'s `convex/**`
half to "every diff that can reach `convex/**`"). For a diff that genuinely
is `skin`-only or `engine`-only, narrowing is safe by construction — a
`src/**`-only diff cannot make `mechanicsRegistry.test.ts` go red, so
skipping `node`'s `convex/**` half loses nothing real.

**The direction this ADR has to be honest about is the other one.** For a
diff `check:lane` classifies `engine`, `dom` is skipped — including for a
diff that touches only `convex/**`. PRD #2738's own count is that 179 of 437
`src` tests import `convex/**`, so a convex-only diff CAN turn a `src`-side
test red, and under the `engine` lane that failure no longer surfaces before
review — it resurfaces at the merge-train, on the integrated tree, which is
the exact symptom #2655 was filed to fix. This work does not revert #2655's
fix — no diff lands without a `dom` run somewhere in its history, see the
backstops below — but for the `engine`-lane slice of diffs it does move that
run later in the pipeline than #2655 put it, deliberately.

The two axes commute in one direction only, which is the whole point:
**narrowing Axis 2 is safe precisely because Axis 1 stayed fixed, and because
narrowing Axis 2 is never the same as removing the check — every diff still
runs `dom` somewhere, backstopped in between.** If the `engine` lane both
skipped `dom` (Axis 2) AND ran `node` filtered to the diff's own files
(Axis 1), it would reintroduce #2431's exact failure mode — a catalogue guard
the diff never touched, silently unrun, with nothing downstream to catch it
either. `check:lane` never does the second thing: no `PlannedCheck.command` in
`classifyLane` (`scripts/check-lane.ts`) that names a `--project` invocation
scopes it to a DIFF-DERIVED subset. `format(diff)`/`lint(diff)` do carry a
path list built from the diff, but those are tools with no catalogue-guard
concept to defeat in the first place. The `skin` lane's `node[src,scripts]`
also carries a path argument on a `--project` invocation — but it is the
lane's own fixed declaration (`src/ scripts/`), not the diff's file list, and
the paired `node[convex]` skip entry names exactly what that declaration
excludes. That static exception is the one place Axis 1 and Axis 2 touch the
same command; it does not reopen #2431's failure mode because it is not a
diff-derived filter.

**Three backstops make narrowing `dom`'s admission on the `engine` lane an
accepted trade rather than an unguarded gap** (PRD #2738's own accounting,
carried here so this ADR is the one place a reader checks the claim):

1. **The `engine` lane keeps the WHOLE type-check** (`bun run check:ts`,
   `tsc[all]` in `classifyLane`) — `src/**` imports `convex/gre` (ADR 0074:
   the client-side Brain and the Draft Lab both do), so a `convex/**` change
   that breaks a type the frontend depends on is still caught, pre-PR, on
   every `engine` diff.
2. **`scripts/__tests__/convex-cards-barrel-mock.test.ts`**, kept because the
   `engine` lane keeps the whole `node` project, catches the one documented
   cross-boundary breakage class statically, without needing a DOM
   environment: a `convex/cards/**` rename or export change that a `src/**`
   suite's `vi.mock("@convex/cards")` factory goes stale against (#2339 — 102
   tests across 12 files, first seen at the merge-train before this guard
   existed).
3. **The merge-train's full gate** (`land`, SKILL.md §4 step 3) runs the
   complete suite — `node` AND `dom`, both whole — on the rebased tree before
   any PR actually merges.

**State the residual risk plainly, because that is what this ADR is for:** a
convex-only diff that reddens a `dom` test in a way the type-check and the
barrel-mock guard do not catch — a runtime behaviour change visible only to a
rendered component, not to `tsc` or to an import-graph census — is now caught
at the merge-train instead of pre-PR. That is **later** than #2655 put it:
#2655's whole point was moving the `dom` guard from "surfaces at the
merge-train" to "surfaces before review." For the `engine` lane's slice of
diffs, this work moves it back, on purpose, in exchange for not paying a
`dom` run's wall-clock on every diff that structurally cannot need one. The
trade is accepted, not hidden, and its cost is a bisect at the merge-train
(the existing procedure in `references/merge-train.md`) rather than a red
`check:pr` on the branch. If a real incident ever shows the three backstops
above missing something a `dom` run would have caught, the fix is narrower
than reverting this ADR: strengthen the backstop that missed it — most likely
`convex-cards-barrel-mock.test.ts`'s coverage — not restore `dom` to every
`engine` diff.

**Restated as the one paragraph a future reader needs:** #2431 fixed Axis 1
for `node` and stands unmodified — `check:lane` never scopes a project's own
file list to the diff; read `classifyLane` itself for that (no `run` command
anywhere in `check-lane.ts` computes a `--project` path argument from the
changed files — the `skin` lane's `node[src,scripts]` does carry a path
argument, but it is the fixed `src/ scripts/` written into the lane
definition, not one derived from the diff) rather than a test, since no test
currently pins it — see Consequences below. #2655 fixed Axis 2 for `dom`,
moving it from
never-admitted to always-admitted; this work **narrows that back down**,
deliberately, for exactly the slice of diffs (`engine`-classified) where the
three checks above stand in `dom`'s place. Both are true at once because they
are different claims about different projects on different axes — not
because #2655 was left untouched. It was not.

## Decision

1. **`bun run check:lane` is the default pre-PR path** (CLAUDE.md § Quality
   gates); `check:pr` remains exactly as it is and is the fallback the
   classifier itself falls back to on any diff it cannot affirmatively place
   in `skin` or `engine` (`laneFor`'s `full` terminal case, `check-lane.ts`).
2. **Lane content is never diff-derived.** No check in a lane's plan scopes a
   `--project` invocation to the files the triggering diff touched. Most
   `--project` commands run the project whole (`node[all]`, `dom`); the
   `skin` lane's `node[src,scripts]` is the one exception, and it is scoped
   to a fixed, declared subset (`src/ scripts/`) written into the lane
   itself — never to the diff — with the paired `node[convex]` skip entry
   recording what that static scope excludes. This is the invariant the
   paragraph above defends, and it is why narrowing Axis 2 does not reopen
   #2431's failure mode. It does narrow #2655's original fix for the
   `engine` lane's slice of diffs — see "The distinction that makes both
   things true at once" for the three backstops that make that an accepted
   trade rather than an unguarded gap.
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
- **No automated guard pins "no `--project` invocation is scoped to a
  diff-derived path argument."** `check-lane.test.ts`'s nearest test, `"every
--project X names a real vitest project"`, only checks that a project name a
  command references resolves to something real — a `run` command rebuilt
  with a path filter computed from the changed files (`--project node
  src/gre/foo.test.ts`) would still pass it, because `node` is still a real
  project name, and that test alone could not tell it apart from the `skin`
  lane's legitimate static `node[src,scripts]` scope. What holds the Axis-1
  invariant today is `classifyLane`'s own construction — every branch that
  attaches a path argument to a `--project` command writes a fixed, literal
  path list (`src/ scripts/`), never one built from the function's own
  `changedPaths`/`presentPaths` parameters — plus ordinary code review: a PR
  that makes a path argument diff-derived is a visible, reviewable change to
  this ADR's central claim, not a silently passing one. That is weaker than a
  pinned test, and is left that way deliberately in this revision rather than
  patched in as an afterthought; a future PR that wants the stronger
  guarantee should add the test directly (assert no `command` string in any
  `LanePlan.run` builds its `--project` path argument from `changedPaths` or
  `presentPaths` rather than a literal) rather than lean on this paragraph to
  stand in for it.
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
