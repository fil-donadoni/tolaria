---
title: The Draft Room's Pool lost its touch path to a Card Pin when the per-tile "move to…" menu was removed
discoveredBy: 2584
status: draft
confidence: high
---

**What is wrong.** Issue #2584 removes the per-card overlay buttons from the ONE
shared tile (`src/components/deckbuilder/deck-card-tile.tsx`) — the Featured
picker and the `"move to…"` popover — at every viewport, which is an explicit
acceptance criterion. On the two BUILD views the menu's capability moved to the
Peek Panel's `Move to…` CTA (`src/components/deckbuilder/deck-zone-peek.tsx`,
mounted by the zone PAIR in `src/components/deckbuilder/deck-zones-surface.tsx`). On the **draft-time
Pool** it did not: nothing on that surface opens a Peek Panel, so there is no
CTA to carry the menu's capability. A long-press DRAG onto a Column still
records a Pin — but through `src/components/limited/limited-draft-table.tsx`'s
own `onDragEnd` -> `handleMoveArrangement`, not through the Pool surface, which
is why `LimitedDraftPool` now passes no `onPin` at all (`DeckZoneSurface` only
offers its Columns through a selection, and this screen supplies no
`onCardSelect`; the prop it used to pass was inert). Re-wiring it is one line
the day this screen gets a selection model.

So during a timed draft, on a phone, a player can no longer place a Pool card
into a specific Column without completing a long-press drag onto a narrow,
snap-scrolling target — the exact gesture issue #1633 added the menu to avoid.

**Why it was not simply wired.** The Draft Room already mounts a Peek Panel for
the Booster pack (`src/components/limited/limited-draft-table.tsx:374-381`),
driven by `seat.selectedPickId`. `PeekPanel` is `position: fixed` — a bottom
sheet in portrait, a right rail everywhere else — so a second panel for a Pool
selection would paint exactly on top of the first, and the two selections are
owned by different components (`LimitedDraftTable` holds the pack's,
`LimitedDraftPool` would hold the Pool's). Making them exclusive needs one
selection model spanning both, which is a Draft Room slice (#2587), not this
one.

**Why it may NOT deserve a ticket.** Three reasons to leave it: (1) the drag
path still works and is the SAME gesture the build view's power users use; (2)
Pool arrangement during a timed draft is a nice-to-have — the build view, where
the affordance is fully replaced, is where decks actually get arranged; and (3)
issue #2587 rebuilds the Draft Room on the same PRD #2405 contract and will
have to give that screen one selection model anyway, at which point this
resolves for free rather than as its own fix. It earns a ticket only if #2587
slips or is descoped away from the pool.
