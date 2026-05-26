# ADR 0007 — Client-buffered pending choice submission

**Status:** Accepted (2026-05-26)

## Context

A **Pending Choice** (CONTEXT.md) is a mid-resolution decision where a
**Player** picks N items from an eligible set: discards, untap picks under
Winter Orb / Smoke, mulligan bottoming (CR 103.5), Library of Leng routing,
Disrupting Scepter, etc. The chooser clicks cards in the relevant zone; the
engine validates each pick against the choice's filter and zone, and commits
the result back to the resolving stack item's `collectedChoices`
(CR 608.2).

The original model accumulated state **server-side and incrementally**:

- `PendingChoice.selected[]` lived on `GameState`.
- Every click fired `selectResolutionChoice({cardInstanceId})`, which
  validated and appended.
- The server auto-committed when `selected.length === max`.
- Re-clicking an already-selected id was rejected with `"Already selected"`.

That model had four motivations:

1. Refresh persistence — the chooser could reload mid-pick and keep
   selections.
2. Opponent progress visibility — the prompt could show "2 / 3 selected"
   to the non-chooser.
3. Per-click validation against zone/filter (in case the eligible set
   changed mid-pick).
4. Server-side auto-commit at `max` without an extra round-trip.

It also had a clear UX gap: **no way to deselect** a previously selected
card. Clicking an already-selected card was rejected by the server, with
no client affordance to remove it. The chooser was locked in until reaching
`max` or refreshing (which discarded everything).

Re-examining the four motivations:

1. Refresh persistence is rare in practice; pending choice windows are
   short.
2. Most pending choices are over hidden zones (hand for Library of Leng,
   Disrupting Scepter, cleanup discard, mulligan-bottom). The opponent
   sees only a counter, not the cards. Counter visibility is not gameplay-
   critical and CR 608.2 does not require it.
3. Validation can run atomically at submit time over the full list.
4. Auto-commit at `max` can fire client-side once the local buffer reaches
   `max`.

None justify the deselect UX cost.

## Decision

**Move pending choice accumulation to the client and submit atomically.**

- Selection state lives in a dedicated React context
  (`PendingChoiceBufferContext`) at board level: `{ buffer: string[],
toggle(id), clear(), submit() }`. Reset when the choice identity
  changes (`stackItemId:step:choiceId:playerId` key).
- Clicking a card toggles its id in the local buffer. Selected cards
  render with a distinct ring; clicking again removes them.
- Submission is a single atomic mutation
  `submitResolutionChoice({gameId, playerId, stackItemId, step, choiceId,
cardInstanceIds})`. The server validates the full list (zone, filter,
  untap-pick constraints, count within `[min, max]`, no duplicates) and
  dispatches to the existing finalize paths (`finalizeUntapPick`,
  `finalizeCleanupDiscard`, `applyMulliganBottomChoice`, mid-resolution
  `collectedChoices` write).
- Submission is always **explicit** via a Done button (no auto-submit at
  `max`). Button labels: `"Skip"` when `min === 0 && buffer.length === 0`;
  `"Done"` otherwise. Disabled when `buffer.length < min`.
- The server rejects submissions whose `{stackItemId, step, choiceId}`
  do not match the current queue head. The client surfaces a toast on
  mismatch.
- All mutation-firing buttons disable while in-flight
  (`feedback-disable-while-pending`) — orthogonal to the identity check,
  closes the double-click window.
- `PendingChoice.selected[]` is removed from the schema. Projections,
  serializer (`PERSISTED_OPTIONAL_KEYS`), and reader sites are updated.

## Consequences

- **Deselect is free.** Clicking a selected card removes it from the
  local buffer. No mutation, no race against `"Already selected"`.
- **Opponent sees no progress.** The waiting view shows
  `"Waiting for X — <prompt>"` with no counter. Aligns with CR 608.2
  privacy of the chooser's mental state and removes the
  premature-information leak for public-zone picks (untap-pick on
  battlefield no longer shows incremental rings to the opponent).
- **No refresh persistence.** If the chooser reloads mid-pick the buffer
  is empty. Acceptable trade-off; pending choice windows are short.
- **Server validates atomically.** `submitResolutionChoice` runs the same
  zone/filter/untap checks the per-click path used to run, but over the
  full list at once. Errors return a single rejection rather than partial
  commits.
- **Identity check + disable-while-pending** close the double-click race
  on choice transitions (chooser submits choice X, server enqueues
  choice Y for the same player, a stale click could otherwise commit an
  empty / wrong list to Y).
- **`selected[]` field removal** is a one-time schema drift; the guard
  test in `serialize.test.ts` enforces it.

## Alternatives

- **Toggle on `selectResolutionChoice`** (idempotent per id). Simplest UX
  but loses the `"Already selected"` guard — a stale subscription click
  becomes an involuntary deselect.
- **Separate `deselectResolutionChoice` mutation**, keep server-side
  incremental state. Preserves the four original motivations but none
  justify their cost; doubles the mutation surface.
- **Local buffer in each component** (no shared context). Forces every
  click site to re-derive shared state; the counter and Done button in
  `PendingChoicePrompt` could not read the buffer without prop drilling.
