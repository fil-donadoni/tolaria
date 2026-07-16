# PROTOTYPE — Brainstorm "put back 2 on top" picker

**Question:** what should the UI look like when a player must put 2 hand cards on
top of their library in chosen order (Brainstorm `putBack` Op → `choose-hand-card`
count 2, ordered — last picked / index 0 = topmost)?

**Route:** `/prototype/put-back` (dev only). Mocked 9-card hand as the left pool.
Done is inert (logs the topmost-first array to the console).

## Final shape (single variant)

Mounts the REAL `LibraryOrderPicker` in `distribute` mode: every card starts in
the LEFT pool, pull exactly 2 into the RIGHT zone. The RIGHT is ONE drop area
with internal drag-reorder (right = top, higher z + slight lateral offset) —
identical to the scry/surveil/Portent top-zone. The only novelty vs those is that
the LEFT pool is the HAND (scry: bottom-of-library, surveil: graveyard).

Cosmetic-only delta vs the shipped feature: distribute mode hardcodes the labels
BOTTOM/HAND; the real `putBack` mode reads HAND / TOP OF LIBRARY. Interaction and
drag-reorder are already exactly right.

(Earlier throwaway variants B/two-panel and C/click-select were dropped once A —
corrected to a single top drop zone — was confirmed as the shape.)

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
