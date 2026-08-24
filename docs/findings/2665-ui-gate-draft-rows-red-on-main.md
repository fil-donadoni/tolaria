---
title: check:ui is red on main for six draft-room rows — pre-existing, not a regression from #2665
discoveredBy: 2665
status: draft
confidence: medium
---

**What is wrong.** `bun run check:ui` cannot go green on this machine today,
before any diff. Six rows are over budget — `draft-pick` and `draft-pool-stop`
at `1440x900x2`, `820x1180x2` and `1180x820x2` — and they are over budget on
`main` itself. Nothing in issue #2665 touches them (that fix only changes the
`(orientation: landscape) and (max-height: 500px)` rung).

**Evidence for "not a regression."** Three runs on this machine, 2026-08-22,
same local deployment, tabulated for `draft-pool-stop` (the three rows this
table actually covers — see the Evidence gap section below for what it does
NOT cover):

| run                          | draft-pool-stop 1440x900x2 | 820x1180x2      | 1180x820x2      |
| ---------------------------- | -------------------------- | --------------- | --------------- |
| base `eda78643`, first walk  | ctrlsOcc 1, small 7 (pass) | ctrlsOcc 7 FAIL | ctrlsOcc 5 FAIL |
| base `eda78643`, second walk | ctrlsOcc 5, small 11 FAIL  | ctrlsOcc 7 FAIL | ctrlsOcc 5 FAIL |
| `fix/issue-2665`             | ctrlsOcc 5, small 11 FAIL  | ctrlsOcc 7 FAIL | ctrlsOcc 5 FAIL |

The fix-tree walk matches the base tree's SECOND walk row for row — that is
the delta-is-zero evidence for "not a regression," and it is solid. What it is
NOT is proof that the numbers are stable in general: the base tree's FIRST
walk passed at `1440x900x2` and its second did not, on the identical commit —
the rows drift between runs even on `main` alone. That drift is the subject of
this finding, not a footnote to it.

## The mechanism is unknown — two hypotheses were checked and ruled out

This doc previously asserted two different causal mechanisms for the drift.
Both were wrong. Recording them here so nobody re-runs the same dead end.

**Hypothesis 1 (wrong): "the walk itself makes a pick."** It does not.
Verified against `scripts/ui-gate/surfaces.ts`:

- `draft-pick`'s walk is `reachDraftRoom(page, ctx)` +
  `assertTwoSnapStops(page)` (:542-551).
- `reachDraftRoom` (:132-166) navigates, clicks
  `a:has-text('Enter the Draft Room')`, waits for the URL, and returns as soon
  as `DRAFT_PICK_TILE` is **visible**. It never clicks a pack tile.
- `[data-editing-action="Pick"]` occurs exactly once in the file, at :605,
  inside an `Unreachable` message instructing a HUMAN to make picks by hand
  before re-running.
- The lone `picked` variable (:288) is `button:has-text('Select')` — the
  lobby DECK picker inside `ensureBoard`, unrelated.

**Hypothesis 2 (wrong): the server-side `autoPickSeatTimeout` scheduler.**
The mutation exists (`convex/limitedEvents.ts:2333`, scheduled by
`scheduleSeatTimers` at :1308-1331 when an event has `timerEnabled`), and it
looked like a wall-clock explanation independent of the lane. It is ruled out
on THIS deployment:

- `bunx convex data limitedEvents`: every live draft (`status="started"`) has
  `timerEnabled=false` — four of them. The only `timerEnabled=true` event is
  `status="finished"`, where `areDraftPicksLegal` gates `autoPickSeatTimeout`
  off (`convex/limitedEvents.ts:2344`).
- `scheduleSeatTimers` (:1320-1327) returns early on `!timerEnabled` —
  `if (!timerEnabled || updates.length === 0) return;` — so no Auto-Pick is
  ever even scheduled here.
- Measured directly: two `draft-pool-stop` walks about three minutes apart
  read an identical seat (pool = 6 tiles, `cards n15`, `ctrls n26`, `occ
2/2`). The seat is not gaining cards by any route on this deployment — not
  the walk, not the clock.

## Leading remaining candidate (unconfirmed)

**Event-selection nondeterminism.** `reachDraftRoom` calls
`openLimitedEvent(page, ctx, i)` for `i` in `0..min(count, 3)` — whichever
events currently sit first under `/limited`'s `View` button list
(`scripts/ui-gate/surfaces.ts:252-266`), and returns as soon as one lands on a
visible pack tile. This deployment carries four `started` drafts created
within about five minutes of each other, plus newer events layered above
them in the list. A walk run on one day and a walk run on another can land on
a genuinely different event/seat and read the difference as drift, when it is
actually two different fixtures being measured under the same row label.

Secondary candidate: per-viewport client state left over from whatever a
human last did on the shared dev deployment. `draft-pick`'s own `knownDebt`
in `scripts/ui-gate/budgets.json` already names a mounted Peek Panel rail
(from a Selected Card) as what moves that surface's `ctrlsOcc` — that state is
set by the last click on a shared browser profile, not by the lane.

**No prescription.** With the mechanism unconfirmed, recommending a fix would
repeat the mistake this doc already made twice — a plausible-sounding remedy
aimed at the wrong cause does not stop the drift, it just looks like it did
until the next run. One direction worth naming as a candidate, not a
conclusion: a dedicated fixture the lane addresses by a stable identifier
(a seeded event/seat) instead of "whichever `View` button sits first," plus
clearing per-viewport client state such as the Selected Card before probing.
Neither is verified against this codebase; both would need their own pass.

## Corrected pool-depth claim

An earlier version of this doc read a walk-to-walk change in `probe.js`'s
`cards.n` (15 → 16) as "the seat's pool went from 15 to 16 cards." That
reads the wrong field: `cards.n` counts `<img>` elements matching
`img[src*="scryfall"],img[src*="card-back"],img[src*="/cards/"],…`
(`scripts/ui-gate/probe.js:252-257,292`) anywhere on the surface, including
the parked pack's own images — it is not a pool-depth count. Measured
directly for this seat: pool depth is **6** cards while `cards.n` reads
**15**. Any pool-depth claim in this doc or its PR should use the measured
pool count, never `cards.n`.

## Evidence gap — what the three-run table does and does not cover

The three-run table above covers only `draft-pool-stop` at the three
over-budget viewports. It says nothing directly about `draft-pick`'s three
over-budget rows (`1440x900x2`, `820x1180x2`, `1180x820x2`) — those were
observed failing in the full lane run, not independently re-run base-vs-fix
in the same tabulated way. The PR's pasted "Full lane, this tree:" block is
an 11-row subset of the lane's roughly 65 rows (13 surfaces × 5 viewports);
its lone `draft-pick` row is `844x390x3`, which is a PASSING row, not one of
the six red ones. Treat the "same six rows" claim as scoped to what is
actually tabulated above, not as a blanket statement about all six.

**Why it may not deserve its own issue.** The drift is real cost — six rows
every UI PR on this deployment has to explain away — but the underlying cause
is not yet known, and two rounds of pinning it on a specific mechanism
(the walk making a pick, then the Auto-Pick timer) were both wrong. Filing an
issue with an unconfirmed cause and no verified fix would just relocate the
same guesswork; the next step is investigation (starting with the
event-selection-nondeterminism candidate above), not a ticket demanding a
remedy nobody has checked works.
