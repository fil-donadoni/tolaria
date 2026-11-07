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

Question (own session, same day): rail and table being D's, what should the
rating dialog be? `?variant=` on `/admin/pick-ratings` swaps only the dialog, on
the same open card (← → cycle): `ladder-pack`, `ladder`, `pack`, `lines`, `shelf`.
The first session's ratings variants A/B/C stay in the folder, unmounted.

### Verdict (owner)

**Ladder, with the pack test as an accessory** (`ladder-pack`). The owner on the
pack: nice, unsure how useful, "lo vedremo" — so a tab, not a part of the pass.

- Left: image, cost, source badge, the three layers (Override / Seed / Scope median).
- Right: eleven rungs 5.0 → 0.0, each with the comparable cards on it, closest in
  cost first; "Compare with" colour / cost ±1 / type / scope. Click a rung = rate.
- A card on a rung: **right click = CardPreview; left click = opens THAT card in
  the dialog to reposition it**, then `← Back to <card>` returns to the card of
  the pass (a stack, it nests). No peek here.
- Pack test tab (`p`): 15-card pack sorted by rating, the pick slider showing the
  context cap live (`contextCapForPick`), bright = the context can flip it, dimmed
  = the rating decides; click a card = rate half a point above it. "Top of a random
  pack %" stays visible on both tabs. The sample is uniform: exact for the cube,
  an approximation for a set (no rarity slots).
- The dialog walks a list FROZEN at open: under a rating sort a rating change
  re-sorts the table, and the open card must not change.

**No "Mark reviewed" for ratings** (owner): the seed is preserved and every manual
change persists as the Override, so "what a human touched" = filter Source =
Override. Clicking the rung the card already sits on writes an Override equal to
the seed, which is the "seen, it is right" gesture, no schema change.

### Owed by the real implementation (on top of the list above)

- Rail: "Hand-rated" progress (override or seed over total), overrides count,
  distribution, per-colour rows with average rating.
- Filters: Source, Rarity, Type, Archetype. Columns: Card, Cost, Rarity,
  Archetypes, Rating, Source. No inline ±: a row opens the dialog.
- The effective rating is DB → seed → the scope's median (issue #7652), not the
  heuristic; label it "Scope median".
- A write must leave the Override visible as such even when equal to the seed.
