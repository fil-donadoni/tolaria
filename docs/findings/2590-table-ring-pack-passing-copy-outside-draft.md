---
title: Table Ring dialog's "packs passing left/right" subtitle is drafting-flavor copy, now shown in every antechamber phase
discoveredBy: 2590
status: draft
confidence: medium
---

**What is wrong.** `LimitedTableRing` (`src/components/limited/limited-table-ring.tsx:78`)
always renders `subtitle={`${seatCount} seats · packs passing ${directionLabel}`}`.
That subtitle is accurate mid-draft (its original, only call site: the Draft
Room). Issue #2590 wires the same component into `LimitedTablePanel`
(`src/components/limited/limited-table-panel.tsx`), reachable from the
antechamber at every non-drafting phase too — OPEN (seating), deckbuilding,
ready-to-play, and the play phase's Swiss rounds. In every one of those the
"packs passing" line is either meaningless (no packs exist yet/anymore) or
misleading, since `round={event.currentRound ?? 0}` is passed as a
best-effort default with no real "pack round" behind it outside a draft.

**Evidence.** `limited-table-panel.tsx`'s own comment on the `round` prop
states the tradeoff explicitly: "a wiring choice, not a rewrite of the Ring's
content." `passDirection` (`convex/limited/draftEngine.ts`) and
`packQueueCount` (always `null`/`"· · ·"` outside an active draft, per
`eventProjection.ts`'s privacy stripping) are both drafting-only concepts.

**Why it might not deserve its own issue.** The dialog is opt-in (behind
"View Table"), so the odd copy is not on the default path; and CLAUDE.md's own
map for this issue explicitly authorized "wiring, not a rewrite" — reshaping
the Ring's subtitle per-phase is a legitimate follow-up, not a defect in this
slice's scope. Worth a ticket if a reviewer decides the antechamber's Ring
should carry phase-aware copy (e.g. "N seats · every deck in" once
`showProgress` is true) rather than reusing the Draft Room's text verbatim.
