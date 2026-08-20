---
title: The draft pack card opens TWO card-reading surfaces on a right click — its own menu and CardPreview's anchored pin
discoveredBy: 2584
status: draft
confidence: high
---

**What is wrong.** `src/components/limited/limited-draft-pack-card.tsx` binds
the pack card's own menu to `contextmenu` (ADR 0060 / issue #1248: click picks,
right click opens the card's menu). The same element renders `CardImage`, which
mounts `CardPreview`, whose `useRightPressPreview` pins the anchored 330px
preview on a quick right-click — and `CardPreview`'s listeners sit on a
**descendant** of the pack card, so both fire from one gesture. The result is
two body portals at `z-modal` (100) in the document at once, with document order
deciding which one paints on top.

That order is **platform-dependent**: macOS raises `contextmenu` after
`pointerup`, Windows and Linux raise it on mouse-**down**, before it. So the
same right-click shows the menu over the pin on one OS and the pin over the menu
on the other.

**Evidence.** Measured on PR #2641 for the structurally identical deckbuilder
tile (`src/components/deckbuilder/deck-card-tile.tsx`), which briefly bound
Inspect the same way: dispatching `pointerdown`/`pointerup`/`contextmenu` on the
inner `<img>` — where a browser actually hit-tests — put both
`[data-card-preview-anchored]` and the second surface in the DOM; with the
Windows/Linux event order the pin mounted last (`pinIdx=2`, `overlayIdx=1`).
`src/components/cards/card-preview.tsx:44` says the suppression prop only covers
touch: "Only the TOUCH gesture is suppressed: the desktop right-click pin … keep
working."

The repo settles this collision the other way everywhere else:
`src/components/ui/context-menu.tsx` and
`src/components/board/activatable-ability-menu.tsx` move their menus onto a
**synthesized left click** and explicitly block Base UI from opening on a
genuine right-click or long press, "because a genuine right-click / long-press
is reserved" for the preview. The pack card predates that convention and never
adopted it.

**What #2584 did instead.** It stopped taking the gesture: the deckbuilder tile
now binds nothing on `contextmenu`, the desktop card read is `CardPreview`'s pin
(as on `main`), and `★ Featured` moved to the deck-detail row — the home issue
#2584 names. The pack card was left alone because it is a different surface with
its own ADR, and changing its pick gesture is not in this slice's scope.

**Why it may not deserve its own issue.** It is a z-order/discoverability
annoyance, not data loss — both surfaces are dismissible and the pick itself is
the LEFT click, which is unaffected. It may be better folded into whichever
slice next touches the Draft Room's gesture model (the same one that owes the
Pool a selection model, see
`docs/findings/2584-draft-pool-touch-column-pin.md`) than ticketed alone.
