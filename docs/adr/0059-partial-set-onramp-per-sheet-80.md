# 0059 — Partial-set Draft onramp: per-sheet ≥80% gate (supersedes ADR 0056's complete-set gate)

## Status

Accepted. **Supersedes ADR 0056** (draftability gated on a fully-implemented set).

## Context

ADR 0056 made a set **Draftable** only when _every_ card in its Booster Sheets
resolves to an implemented `CardDefinition`, explicitly rejecting "sample only
implemented cards" because a distorted print run misrepresents the Limited
environment. Under that gate the only Draftable Set is **LEA** (100% minus the
ADR-0010 exclusions). Finishing another set to 100% is expensive: every set
carries a long tail of complex, unused cards, and that tail is **concentrated
in the rare sheet** (measured: INV rare 63%, LEG rare 52% implemented, against
higher common/uncommon coverage). Waiting for 100% blocks the Limited
experience for months. We want to ship a playable Limited environment _now_,
with an explicit incompleteness disclosure, without shipping visibly broken
packs.

## Decision

- **The Draftable gate becomes per-sheet, not per-set: every Booster Sheet must
  retain ≥80% of its cards as implemented `CardDefinition`s** (after ADR-0010
  exclusions are stripped). A single sheet under the 80% floor makes the whole
  set non-draftable. The threshold is **per-sheet, deliberately not a per-set
  average** — a set can be 82% overall while its rare sheet sits at 52%, and a
  per-set average would green-light that broken rare slot. Per-sheet is what
  keeps every _slot_ of a generated pack faithful.

- **Unimplemented cards below the ceiling are dropped from the sheet, weights
  renormalized** — the exact mechanism ADR 0056 already uses for ADR-0010
  exclusions (`buildBoosterConfig` + the `excludedScryfallIds` set). A missing
  card is treated as absent from the print run, never rendered as a placeholder
  or phantom bomb. So the "no skewed/placeholder booster" principle of ADR 0056
  is _kept_; only the completeness bar is lowered from 100% to per-sheet 80%.

- **Every Draftable Set below 100% surfaces an Incompleteness Notice** at event
  creation — the honest disclosure that the environment is an approximation
  missing some cards. The notice is per-set and disappears the day that set
  reaches 100%.

- **This is a temporary onramp.** The standing goal remains 100% implementation
  of every set; the 80% floor exists only to unblock a Limited experience
  sooner. Draftability still doubles as a set-completion incentive (ADR 0056's
  consequence): each finished card raises a sheet toward 100% and eventually
  retires that set's Incompleteness Notice.

At the time of writing, per-sheet ≥80% admits **LEA, ICE, DRK** (and **ATQ**
once its 78% common sheet clears 80% — ~9 cards). INV (rare 63%) and LEG (rare
52%) remain non-draftable until their rare sheets are finished — exactly the
sets whose long tail this gate refuses to misrepresent.

## Considered options

- **Keep ADR 0056's 100% gate, just finish more sets**: rejected as the primary
  path — the rare-sheet long tail makes "soon" impossible; but retained as the
  end state (this onramp is temporary).
- **Per-set average ≥80%**: rejected — hides a broken rare slot behind healthy
  commons (INV/LEG are the proof).
- **No threshold, re-roll within the sheet on a missing card**: rejected — same
  distortion ADR 0056 rejected, with no honest floor on how skewed a sheet can
  get.

## Consequences

- `computeDraftability` / `listDraftableSets` change from "zero missing" to
  "every sheet ≥80% after dropping the missing", and `createLimitedEvent`
  validates **each distinct set in `packSlots`** against it (multi-set events).
- The unimplemented ids dropped per sheet must be computed against the live
  registry (`tryGetDefinition`), the same seam the gate already reads.
- An Incompleteness Notice is a new user-facing surface at event creation.
