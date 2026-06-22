# Deck builder drag & drop with touch-delay disambiguation

The deck builder's primary card interaction is drag & drop (`@dnd-kit/react`):
drag a search result onto the Maindeck or Sideboard drop zone to add it, drag a
card between zones to move it. Plain click stays as the fast path (result →
quick-add to Maindeck, pile card → remove one copy); the old per-card move button
is gone. The dragged card follows the cursor via a `DragOverlay` (the source
element stays put, so it isn't clipped by the zones' scroll containers), and the
drop animation is disabled — a card snapping back to its origin on drop read as
confusing rather than helpful.

## Touch vs long-press preview — the 250 ms delay

On touch, drag must coexist with two other gestures on the same element: list
scrolling and the long-press card preview (ADR 0009, 400 ms, cancels on >10px
move). They are disambiguated by a **pointer activation delay of 250 ms** on the
touch sensor (mouse uses an 8px distance instead):

- quick swipe → no drag yet → the list scrolls;
- hold ~250 ms then move → drag starts (and, being movement, cancels the pending
  400 ms long-press, so no preview);
- hold still 400 ms → long-press preview opens.

The 250 ms sits deliberately **below** the 400 ms preview threshold so a
deliberate drag always wins over the preview, while a quick swipe still scrolls.
This is why no separate drag handle is needed. Changing either number without
preserving `touch-drag-delay < long-press-threshold` reintroduces the conflict.

## Per-zone card zoom

Each zone (results / Maindeck / Sideboard) has an independent MTGO-style zoom
slider that multiplies the responsive base width (`--card-base`) and persists to
`localStorage`. Independent per zone because a crowded zone wants small cards
while a sparse one can afford large ones. The current density is each slider's
floor; the default sits slightly above it.
