# `check:ui` is an invariant gate: floors at zero and named assertions, never a numeric budget

## Status

accepted (2026-09-15, grill on issue #3638). Retires `scripts/ui-gate/budgets.json`,
`--record` and `--accept=`. Builds on ADR 0101 (the viewport matrix), ADR 0127
(a declared position), ADR 0131 (the diff-scoped run). Leaves the four
mandatory-verification norms untouched: the lane is still owed by every diff
that can reach the DOM, at five viewports, with a byte-exact receipt that
`land` re-derives.

## Context

The lane shipped on 2026-08-19 (issue #2580) as a **budget**: thirteen counts
per surface and viewport, compared as `measured > ceiling`, ceilings recorded
from a run and annotated in prose. A census of the 27 days since, run for issue
#3638 (three cells RED on a clean base tip with no UI diff), found:

- `budgets.json` at 283KB, 214KB of it `knownDebt` prose across 90 notes, most
  of them saying some form of "NOT DEBT, by construction". 38 commits touched
  the file; almost all were re-records, probe-semantics fixes or drift notes.
- Over 20 false-red or churn incidents in five classes: a nondeterministic
  subject (a live Bot in the measured tab, an unseeded coin toss, a dealt
  game, a pack mid-animation), shared account state (closed by issue #3626),
  machine load turning a backend timeout into `UNWALKED`, a probe-semantics
  change forcing a 20-cell re-record with hand-restored notes (PR #3326), and
  a `--record` that once banked an outlier as a ceiling (`lobby` 1440 `small`
  25 while four receipts in a row read 26).
- Genuine regressions the steady-state gate stopped in that window:
  **none found** in issue or PR history. The two real catches (PR #2583, issue
  #2593) came from exploratory probe runs while a surface was being built.
- Two coverage holes on the other side: the lobby walk asserted only that
  `<main>` exists (docs/findings/2726), and no walk opened a zone pile, so a
  contrast regression on eight CTA buttons shipped green through the lane and
  was caught by a source-text test (docs/findings/2900).

The counts that flapped are the counts that describe the screen **as
designed**: a fanned hand overlaps, a sheet covers the board under `lg`, a
scroll port is taller than its box. Their value moves with the position on the
screen, and a ceiling on them is a ceiling on the position. The counts that
never moved are the ones that describe a defect: a zero-size card, a control
clipped where no gesture reaches it, a serious axe violation, a page that
scrolls sideways. Those were at zero almost everywhere, and every nonzero
reading of them was a real bug or a probe bug.

## Decision

1. **Floors, not ceilings.** The lane gates nine counts, all at zero, on every
   walked surface and viewport, with no per-surface exception: `cardsZero`,
   `cardsStranded`, `cardsSquare`, `cardsSoft`, `ctrlsZero`, `ctrlsStranded`,
   `axeSerious`, `axeCritical`, `hOverflow`. They are constants in the lane's
   code. There is no number to record, so there is no budget file, no
   `--record` and no `--accept=`. A surface that cannot hold a floor is listed
   as unwalked in code with its reason and its issue — never budgeted.
2. **Shape readings are diagnostic.** `cardsOcc`, `ctrlsOcc`, `small` and
   `starved` are measured and printed on every receipt, and gated nowhere.
3. **Named assertions carry the positive half.** Every surface declares at
   least one `{ label, locator, check }` — `reachable` (Playwright's
   actionability check: visible, stable, the element that answers a pointer at
   its own centre), `visible`, or `contrast` on a subtree — checked at every
   viewport and printed by label. An offline guard in `check:all` refuses a
   surface with none. The entry points a surface's runbook names are its
   minimum.
4. **The subject is fixed.** Every game surface loads a declared position
   (ADR 0127) into the game the lane creates, with priority on the human seat,
   so the Bot does not move and the coin toss is irrelevant. Every surface is
   measured only once it is a **settled screen**: its own ready marker is up
   and, for a quiet window, nothing animates, nothing is in flight to the
   backend and no measured box has moved.
5. **Machine load is not the tree's fault.** A backend function past its
   execution limit, a server error or a navigation that never answered is an
   **infra verdict**, recognised by its console signature. The lane retries the
   surface, waiting for the load to drop; a verdict that stands is unproven —
   not landable, and never reported as a UI failure.
6. **The receipt has two blocks.** A **verdict block** (`surface viewport
PASS|FAIL|INFRA|UNWALKED`, broken floors, assertions by label) is
   deterministic and `land` re-derives it against the diff's scope. A
   **diagnostic block** (shape readings, load, infra signatures, wall time) is
   printed for the reader and ignored by `land`.

## Considered options

- **Keep the budget, add bands as data** (`{ ceiling, band }`, subject made
  deterministic). Rejected: it fixes the noise and keeps the gate blind where
  the real regressions passed; the prose and the re-records stay, because a
  ceiling on a shape reading is still a ceiling on the position.
- **Visual snapshot diffs** (`toHaveScreenshot`) as the gate. Not adopted as
  the gate: it needs the same fixed subject as 4 and adds a pixel baseline to
  re-record on every intentional change. It remains a candidate diagnostic once
  4 holds.
- **Fewer viewports on scoped runs.** Rejected: it reopens the three-viewport
  rule ADR 0101 retired. Speed comes from the scope (ADR 0131), from replacing
  fixed sleeps with the settle predicate, and later from viewport parallelism
  sized to the machine's load, with one lane account per browser context.

## Consequences

- `budgets.json` and its git history are the record of every number the old
  gate held; nothing migrates. The parts of its prose that explain probe
  semantics live in `probe.js` and the guide, where they mostly already were.
- The probe shrinks to what nothing off the shelf measures (the floors);
  reachability of a named control is Playwright's check, maintained upstream,
  so a probe-semantics change can no longer force a lane-wide re-record.
- Issue #3638's three cells are raised to their observed maxima as an interim,
  so the base is green while the slices land; the file they live in is
  retired by the third slice.
- Two surfaces currently hold a nonzero floor (`deck-builder` `ctrlsZero` 1,
  `deck-detail` 390 `axeSerious` 1). They are fixed before the floors are
  switched on, or listed unwalked with an issue — never carried.
