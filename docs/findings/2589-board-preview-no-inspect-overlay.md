---
title: Board card preview has no Cast/Activate actions — InspectOverlay never wired to the board
discoveredBy: 2589
status: draft
confidence: medium
---

**What is wrong.** Issue #2589's AC #3 ("in-game preview ≤100dvh with Cast /
Activate; ADR 0025 portrait contract untouched") describes reusing the
`InspectOverlay` primitives shipped in #2583/commit ac2b6e87
(`src/components/editing/inspect-overlay.tsx`,
`src/components/editing/editing-surface-action.ts`) for the board's mobile
card preview, with Cast/Activate buttons inside. That work was NOT done in
this PR — the board still uses the older `CardPreview`
(`src/components/cards/card-preview.tsx`, ADR 0009), which has no `actions`
concept at all.

**Evidence.** `CardPreview`'s mobile long-press overlay
(`card-preview.tsx:393-428`) renders a bare `CardPreviewBody` inside a
`max-h-[90vh] max-w-[90vw]` box — no CTA of any kind. `CardImage` mounts
`CardPreview` on every hand/battlefield/pile card
(`gre-hand-card.tsx:66`, `board-battlefield-card.tsx`, `cards-pile.tsx:707`).
`stack-row.tsx` has no preview trigger at all — a stack item's card art is a
plain `<img>`/`ColorOverlayCardImage`, not wrapped in `CardPreview` or
`InspectOverlay`.

**Why this was left out of #2589.** Two reasons drove the scope cut, both
recorded in that PR's receipt:

1. `CardPreview` is a single shared component mounted on every hand,
   battlefield, pile and stack-adjacent card across the ENTIRE app (also the
   lobby and other non-board surfaces via the same import) — not just the
   board's stack this issue targets. Swapping its mobile overlay for
   `InspectOverlay` is a cross-cutting change with a blast radius far outside
   `#2589`'s target files, and none of `CardPreview`'s call sites are in the
   issue's own "Target files" list.
2. Cast/Activate actions require a per-card, per-zone `EditingSurfaceAction[]`
   — which action(s) apply to a HAND card (Cast) vs a BATTLEFIELD permanent
   (Activate which of N abilities) is design work with no existing plumbing:
   `CardPreview` today knows only `cardId`/`cardName`/`cardInstance`, nothing
   about legal actions. The issue's own investigator-authored map flagged this
   exact gap and said to "decide deliberately" rather than assuming a shape.

**Correction (round-2 review, #2589):** the claim above that the ≤100dvh size
constraint was "already met today" was FALSE. The pre-fixup overlay was
`max-h-[90vh]` inside a `fixed inset-0` wrapper — `vh` is the LARGE viewport
unit, so on a phone with retracting browser chrome `90vh` can EXCEED `100dvh`
(e.g. `lvh` 844 / `dvh` 740 gives `0.9 * 844 = 759.6px > 740px`). ADR 0101 §5
mandates `max-height: 100dvh` always, so the size half of AC #3 was unmet too,
not just the Cast/Activate half — the round-2 fixup landed the one-line
`max-h-[90vh]` → `max-h-[100dvh]` correction (`card-preview.tsx`). ADR 0025's
portrait contract remains untouched (no portrait band file touched by
#2589 or this fixup).

**What remains unshipped:** the Cast/Activate wiring of `InspectOverlay` onto
the board's card preview, per the two reasons below. That gap is real product
work with a recorded design decision needed (see "Why this was left out"), not
a bug this PR introduced — the orchestrator is tracking it as a follow-up
outside this fixup's scope.

**Why it may not deserve its own issue yet.** It might be more naturally the
next slice of PRD #2405 (mirroring how #2583 shipped the primitives before any
board call site used them) rather than a freestanding bug — worth discussing
with the touch-gesture/editing-surface work already in flight rather than
ticketed in isolation.
