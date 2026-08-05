---
title: Tapped-permanent peek-stack (associatedExiled) visually detaches from the rotated art
discoveredBy: 1994
status: draft
confidence: low
---

**Superseded twice — history for the next reader.** This file originally
described a left-side click-stealing regression in the `widths[]`-reservation
fix (`tappedFootprintWidth`, PR #2279 round 2). That mechanism was reverted
wholesale in round 3, measured to make the reported bug WORSE, not better
(see `.claude/receipts/.../1994-review.json` round 2). Round 3 replaced it
with `pointer-events: none` on a purely presentational `[data-tap-visual]`
layer — which genuinely fixed the reported occlusion, but put `CardTilt3D`'s
own root (`[data-card-tilt-root]`) INSIDE that inert layer, so it (and
`CardImage`/`CardPreview` nested under it) inherited `pointer-events: none`
too. That silently killed hover-tilt, hover-dwell preview, right-click
preview and mobile long-press preview on every tapped permanent, and
un-suppressed the browser's native context menu on right-click of a tapped
permanent (round-3 review, blocking).

**Round 4 (current) fixes that regression.** `CardTilt3D` now WRAPS
`[data-tap-visual]` instead of living inside it — `[data-card-tilt-root]`
sits OUTSIDE the inert layer, so its own pointer listeners (and
`card-preview.tsx`'s, bound onto that same element via
`closest("[data-card-tilt-root]")`) keep firing on a tapped permanent:
hover-tilt, hover-dwell preview, right-click pinned preview and native-menu
suppression are all restored, verified structurally in jsdom
(`board-battlefield-card-tap-inert-layer.test.tsx`: `[data-card-tilt-root]`'s
computed `pointer-events` no longer inherits `none`). Mobile long-press —
the one gesture that still lived as a plain React prop on `CardPreview`'s own
container, which stays INSIDE the rotated layer because the art itself has
to rotate — is now bound imperatively on the same tilt-root ancestor
(`card-preview.tsx`, mirroring the pre-existing right-press pattern),
verified in `card-preview.test.tsx`'s "tap inert layer" describe block. All
four affordances are proven with a proof-of-failure mutation (see
`.claude/receipts/.../1994-fixup.json`).

**What remains, disclosed rather than fixed: a cosmetic-only detachment.**
The `associatedExiled` peek-stack (Banishing Light's held permanent, Ice
Cauldron's noted card) is deliberately rendered OUTSIDE `[data-tap-visual]`
so it stays clickable regardless of tap state (now covered by a test —
round-3's version of this claim had none, see
`board-battlefield-card.test.tsx`'s "peek-stack placement" describe block).
The cost: on a TAPPED host, the peek-stack no longer rotates with the art
underneath it (the art is inside `[data-tap-visual]`, the peek-stack is not),
so it visually detaches from the card's rotated orientation — pinned to the
unrotated box's corner while the art beneath it is sideways. This is purely
cosmetic (no functional loss — the pile stays clickable, which is the whole
point of the exception) and only visible on the narrow intersection of
"permanent holds an exiled card" AND "that permanent is tapped" (Ice
Cauldron, Banishing Light-style effects).

**Why it may not deserve its own issue.** Single-consumer-class cosmetic
detail with no functional cost, on a narrow card intersection, already
documented in the component's own comment
(`board-battlefield-card.tsx`, the `associatedExiled` JSX comment). If a
future reviewer wants the peek-stack to visually track the rotated art
instead, that is a design call (rotate the peek-stack counter to the art so
it reads upright regardless of host orientation — real work, not a
CSS-only fix) rather than a bug fix, and is better filed against whichever
card first makes the mismatch bother a real playtester.
