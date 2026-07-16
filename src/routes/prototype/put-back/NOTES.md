# PROTOTYPE — Brainstorm "put back 2 on top" picker

**Question:** what should the UI look like when a player must put 2 hand cards on
top of their library in chosen order (Brainstorm `putBack` Op → `choose-hand-card`
count 2, ordered — last picked / index 0 = topmost)?

**Route:** `/prototype/put-back?variant=A|B|C` (dev only). Mocked 9-card hand +
mocked library. All Done buttons are inert stubs; the tray text shows the array
that WOULD be submitted (topmost first).

## Variants

- **A — Extended Portent strip.** Single horizontal row: hand fan · library mock ·
  2 ordered TOP slots. Drag hand card across into a slot. Literal "extend that
  component" reading. Swap button reorders.
- **B — Two-panel vertical.** Hand as arc fan (left); library column (right) with
  2 TOP slots STACKED above the deck — "top = up" spatial metaphor. Drag up into
  slots; drag between slots to reorder.
- **C — Click-select + order tray.** No drag: tap 2 hand cards (numbered badges),
  they flow into an ordered tray over the library; ⇅ swaps. Touch-friendly.

## Verdict — A, corrected to the Portent model

Winner = A, but **NOT** with 2 discrete slots. ONE continuous TOP zone (fan),
exactly the existing `LibraryOrderPicker` top-zone: right = top of library,
higher z-index + slight lateral offset, drag WITHIN the fan to reorder
(insertion / deferred commit). The only novelty vs Portent: the LEFT zone is the
HAND (source pool), and you drag exactly 2 cards out of it into the TOP fan; the
rest stay in hand.

Shape ≈ the picker's existing `distribute` mode, INVERTED:
- distribute: left = BOTTOM pool, right = HAND (keep exactly N)
- putBack:    left = HAND pool,   right = TOP  (keep exactly N = 2), ordered,
              submit right topmost-first as the `choose-hand-card` picks; leftover
              hand cards submit nothing (already in hand).

→ Implement as a new MODE on `LibraryOrderPicker` (sibling to `distribute`),
reusing layout.ts / insertion drag / OrderCard / DeckMock. "hai già tutto."
Delete this prototype folder + router entry once the mode lands.
