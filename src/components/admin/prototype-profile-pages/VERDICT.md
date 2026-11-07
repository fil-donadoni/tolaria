# Prototype verdict — admin Card Profiles / Pick Ratings pages (2026-11-07)

Question: what should the two Bot Drafter admin pages look like, desktop-first,
design-system-native, with the catalogue "sweep" and the human review pass in mind?

Variants: A Workbench (rail · table · inspector), B Sweep board (one catalogue row,
three lanes), C Focus (one card, queue strip), D = A with a collapsible rail, the
focus in a GameDialog, sortable columns, multi-select filter comboboxes.

## Verdict (owner, Card Profiles)

**D.** Two columns on desktop: a collapsible scope rail (progress, catalogue rows
with `tagged · proposed?` counts, computed colour bar, info tooltip, export) and
the table (every column sortable; filters as MultiCombobox for Status, Archetype,
Provides, Requires — OR within, AND across; no colour pips in the card subtitle).
A row opens the card in a dialog: card image left; right a single block — census
rationale, archetype rows, capability matrix. One compact line per catalogue row:
toggle(s) · id · one-line gloss · `?` tooltip with the registry text split in two
halves (TAG WHEN / NOT, PROVIDES / REQUIRES, with an example card) · related cards
from the scope right-aligned (hover/right-click = CardPreview, click = peek).
No Oracle column, no collapsibles. B's lane board stays as the sweep view idea
for the per-row pass (not re-judged after D).

## Owed by the real implementation

- Skin on the design-system primitives: `Checkbox`, `Table`, `Badge`,
  `SegmentedControl`, `.text-label`; no hex (add mana colour tokens), no inline
  grid styles, no `text-[9px]`.
- Registry rows gain `gloss` / `cluster` / `example` fields (proto-gloss.ts is the
  shape); seed rows gain `rationale`.
- Tool pages may use a wider admin frame (1680px) — decision to record.
- Responsive below 1500px + `check:ui` walk.

## Pick Ratings

Not judged here — its own prototype session follows (variants A/B/C/D exist on
this branch as a starting point).
