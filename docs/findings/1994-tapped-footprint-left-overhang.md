---
title: Tapped permanents lose hover-tilt / hover-dwell / right-click / long-press preview while tapped (decoupled hit-target fix)
discoveredBy: 1994
status: draft
confidence: medium
---

**Superseded finding.** This file originally described a left-side click-
stealing regression in the `widths[]`-reservation fix
(`tappedFootprintWidth`, PR #2279 round 2). That mechanism was reverted
wholesale in round 3 — reviewed and measured to make the reported bug WORSE,
not better (an untapped fetchland's clickable area went from 408px² on
`main` to 0px² on that branch; see `.claude/receipts/.../1994-review.json`
round 2 for the full measurement). `tappedFootprintWidth` no longer exists in
`src/lib/board-layout.ts`, so the geometry this file used to describe is
moot. Replaced below with the residual cost of the mechanism that replaced
it.

**What the current fix does.** `board-battlefield-card.tsx`'s `tapTransform`
now rotates a separate, purely presentational `[data-tap-visual]` layer
nested INSIDE the interactive `cardContent` box, which never itself rotates.
While tapped, `[data-tap-visual]` is also given `pointer-events: none`, so
its overhang can never be hit-tested — a click there falls through to
whatever is genuinely painted underneath (typically a neighbour's own
unrotated box) instead of the tapped card stealing it. This fixes the
reported bug at both the row-compression level (no `widths[]` spend at all)
and the paint-order level (both the left AND right overhang are now inert,
not just the right one the reservation approach protected).

**What is (probably) wrong.** `pointer-events: none` disables ALL pointer
interaction on that subtree, not just clicks. Two features that trigger via
native/synthetic pointer listeners bound INSIDE that subtree stop firing for
a TAPPED permanent specifically:

- `CardTilt3D`'s hover-tilt + moving glare (`card-tilt-3d.tsx`) — its
  `onPointerMove`/`onPointerLeave` are on `[data-card-tilt-root]`, which
  lives inside `inner`, i.e. inside `[data-tap-visual]`.
- `CardPreview`'s hover-dwell zoom dock, right-click preview, and mobile
  long-press preview (`card-preview.tsx`) — its `pointerenter`/`pointerleave`
  /`pointerdown`/`contextmenu` listeners are bound (via raw
  `addEventListener`, not React's synthetic system) on that SAME
  `[data-card-tilt-root]` ancestor (`card-preview.tsx`'s own comment explains
  why: `overflow-hidden` inside a `preserve-3d` context flattens the subtree,
  so a real pointer event hit-tests to that ancestor, not to `CardPreview`'s
  own container). The mobile long-press path is the one most relevant to the
  ORIGINAL bug report (iPhone Safari) — a tapped permanent can no longer be
  long-pressed to preview its text while tapped.

Untapped permanents are completely unaffected (no transform, no
`pointer-events` override) — this is scoped exactly to the tapped state.

**Evidence.**

- `src/components/board/board-battlefield-card.tsx` — `[data-tap-visual]`'s
  `pointerEvents: card.isTapped ? "none" : undefined`, wrapping `{inner}`
  which contains `<CardTilt3D><CardImage .../></CardTilt3D>`.
- `src/components/board/card-tilt-3d.tsx:105-110` — `onPointerMove`/
  `onPointerLeave` bound on `[data-card-tilt-root]`, the outermost element of
  `inner`.
- `src/components/cards/card-preview.tsx:173-195,215-266` — both listener
  `useEffect`s explicitly climb to `container.closest("[data-card-tilt-
root]") ?? container` before calling `addEventListener`, so they bind on
  the exact element that is now inside the inert layer while tapped.
- The resulting preview UI itself (`card-preview-dock.tsx`,
  `card-preview-anchored.tsx`) is unaffected once open — both are portalled
  to `document.body`, outside `[data-tap-visual]`'s subtree — only the
  TRIGGER (hover/right-click/long-press starting on the card) is blocked.

**Why it may not deserve its own issue yet.** This is a disclosed,
accepted-in-the-PR trade-off (stated in `tapTransform`'s comment and the PR
body), not a silent regression, and it is strictly smaller in blast radius
than either rejected alternative (a 51%-area global shrink, or an
unclickable neighbour). The primary reported symptom — a tapped permanent
permanently hiding an interactive neighbour — is fixed. Whether losing
hover/long-press preview SPECIFICALLY on tapped permanents (arguably the
state where a player most wants to re-read a card, mid-combat) is worth
restoring is a product call, and restoring it needs a real design: e.g. a
coordinate-gated click/pointer handler on the always-interactive
`cardContent` box (compare pointer coordinates against `cardContent`'s own
unrotated `getBoundingClientRect()` and only honour the ones that ACTIVATE
the card, while still forwarding a raw pointer-move to drive
`CardTilt3D`/`CardPreview`'s effects imperatively) rather than a CSS-only
fix — meaningfully more invasive than this fixup's scope.
