# 0075 — One deckbuilder shell for Constructed and Limited; the Column Layout as its state model

## Status

Accepted. **Amends ADR 0060** (which fixed the draft-time Pool as a set of
_fixed Mana-Value columns_ and the Pool Arrangement as a per-card `column`
override).

## Context

Tolaria has two deck-editing surfaces that look alike and share almost nothing:

- **Constructed** (`src/components/lobby/deck-builder/deck-builder.tsx`, 853
  lines): search results on top, Maindeck grouped into _dynamic_ Mana-Value
  piles (`groupDeckIntoPiles` — only values present in the deck), flat
  Sideboard, drag only Maindeck⇄Sideboard, fixed 3/4 · 1/4 split. Filters,
  sorting and edition selection exist — but only over the **search results**,
  never over the deck itself.
- **Limited** (`src/components/deckbuilder/`): a basic-lands bar, Maindeck in
  the _fixed_ column set (Lands + MV 0..7+), per-column drop targets, a
  per-card column override persisted server-side as the **Pool Arrangement**,
  Sideboard grouped by Mana Value, draggable split. No filters, no sorting, no
  edition choice.

Issues #1575/#1581 had just finished unifying the _draft_ Pool and the Limited
build view (one column-grouping engine, one drop resolver). The Constructed
builder stayed outside that unification, and the two surfaces keep acquiring
the same features twice, differently.

Six requirements landed together: same shape for both builders with few
declared variants; per-zone grouping/sorting/filtering of the **deck** (not
just the search results); an edition picker with art preview under the basic
land buttons; deletable and addable columns; grouping/sorting independent
between Maindeck and Sideboard; a Maindeck statistics dialog.

Two of them collide head-on with the shipped model. "Group by colour" and
"delete a column" cannot both be true while columns are a fixed, derived
Mana-Value ladder: a derived column has nowhere to go when deleted, and
reappears on the next render.

## Decision

### 1. One shell, three declared variants

A single `DeckBuilderShell` owns the toolbar, the source panel slot, both zone
surfaces, the split divider, the column engine, drag-and-drop, the stats
dialog, the legality panel and the save bar. `DeckBuilder` (Constructed) and
`PoolDeckBuilderForm` (Limited) become thin wrappers supplying exactly three
things: the **source panel** (search grid vs nothing), the **persistence
sinks** (`userDecks` vs `userDecks` + `setPoolArrangementEntry`), and the
**legality panel**. Everything else is shared by construction, not by
convention.

The basic-lands bar is **not** a Limited variant — it ships in both builders,
with a per-subtype copy counter, `+1` / shift-click `−1` / `+5` steps, and its
edition grid filtered to the deck's Format.

### 2. The Column Layout replaces the fixed column ladder

A **Column Layout** is per **Zone** (Maindeck / Sideboard) and owns:

- a **Grouping** (Mana Value | colour | type | none) that _generates_
  predicate-carrying **Columns**;
- an ordered list of Columns, including user-created **manual** Columns (label
  only, no predicate — cards arrive only by pin) and a mandatory, undeletable
  **Catch-All Column** in last position;
- an **Ordering** (name | Mana Value | colour | rarity) applied _inside_ each
  Column.

Grouping and Ordering are **orthogonal axes**: "columns by colour, ordered by
Mana Value" is one Layout, and is not expressible with a single control.

A Column may be deleted **only while empty**. Every card is claimed by the
first rule that matches it: a `custom` **Card Pin**, else the Pin for the
active Grouping, else a generated Column's predicate, else the Catch-All. The
**Lands** column is generated under _every_ Grouping — under "by colour" a dual
land sits in Lands, not in Multicolour.

The Zone's build-time **filter** (all | creatures | non-creatures, plus WUBRG+C
toggles) hides non-matching cards, shows `Maindeck 23 of 40` plus a clearable
chip, and is **never persisted** — a saved Layout must not be able to hide part
of a deck from its author.

### 3. Card Pins are namespaced and are never erased

Column ids are namespaced (`mv:5`, `color:R`, `custom:…`). A card's Pin is a
map **per namespace** (`{ mv: "mv:5", color: null, custom: null }`). Switching
Grouping regenerates the generated Columns but touches no Pin: a `mv` Pin
simply does not apply while the active Grouping is colour, and applies again on
the way back. Manual Columns live in every Grouping of their Zone, so a
`custom` Pin always applies — and outranks everything else.

### 4. Persistence: layout on the deck, view preferences on the user

| Data                                            | Home                                                 |
| ----------------------------------------------- | ---------------------------------------------------- |
| Column Layout (manual Columns + Card Pins)      | `userDecks.layout` · `limitedEvents.poolArrangement` |
| Grouping, Ordering, zoom, split, basic-land art | `localStorage` (per user, applied to every deck)     |
| Zone filter                                     | nowhere — momentary                                  |

Constructed Pins are keyed by `cardId` (four Lightning Bolts pin together —
always what is wanted); Limited Pins stay keyed by `poolIndex`, because the
Pool already distinguishes copies.

### 5. Schema evolution by tolerant read, not by migration

`poolArrangement` entries keep `column?: number | "lands"` as a **deprecated,
read-only** field and gain `pins?: { mv?, color?, type?, custom? }`. A pure
`readPins(entry)` normalises `column: 5 → { mv: "mv:5" }` and `"lands" → { mv:
"mv:lands" }`; every write emits only `pins`. No coordinated migration, no
in-flight draft broken; a cleanup migration dropping `column` can follow later.

### 6. The draft surface adopts the same engine, with a reduced bar

The draft-time Pool mounts the same zone surface, so Pins created while
drafting and Pins created while building are literally the same data. Its bar
carries **only** Grouping + Ordering: no filter (hiding cards while a booster
is in front of you is dangerous) and no column add/delete (workbench gestures,
not timed-draft gestures).

### 7. Stats dialog (Maindeck only)

Opened from a toolbar button, never inline. Counting rules:

- **Pips** — coloured symbols in the mana cost; a hybrid `{W/U}` counts **1 to
  W and 1 to U** (it is payable either way; halving would understate both
  requirements); `{X}` and generic ignored; activation costs excluded.
- **Sources** — every card that _could produce_ that colour per CR 106.4,
  lands, rocks and dorks alike, reusing the logic of `getProducibleColors`
  (which must be split into a `CardDefinition`-level twin); a dual counts on
  both colours; rendered as a lands/non-lands stacked bar.
- **Curve** — lands excluded, MV 0..7+, `{X}` at its printed mana value.
- **Types / Subtypes** — two lists, count-descending then alphabetical; a card
  that is both Artifact and Creature counts in both, with the sum-exceeds-total
  caveat shown.

### 8. Narrow screens

Below `md` the columns keep their horizontal scroll (with scroll-snap and
minimum zoom), empty columns are hidden except the Catch-All, and a
`move to…` menu replaces the drag gesture. No second layout is maintained.

## Rationale

1. **A derived-column model cannot satisfy the requirements.** "Delete a
   column" and "group by colour" are only jointly coherent once the column list
   is explicit data and the grouping is a generator over it. Making the list
   explicit is what turns a rendering detail into a state model.
2. **The empty-only delete rule kills the hard case.** No card ever has to be
   relocated by a deletion, so the only remaining question is where a _future_
   card goes — answered uniformly, for every Grouping, by the Catch-All. The
   alternatives (a column that re-materialises; sliding to the nearest column)
   either make "delete" non-durable or define "nearest" only for the numeric
   Grouping.
3. **Namespaced Pins cost nothing and save the draft.** The Pin was already a
   card→column mapping; qualifying its key by Grouping is the same data. Without
   it, one exploratory click on "group by colour" destroys an arrangement built
   over 45 minutes of drafting — the exact thing ADR 0060 introduced to
   preserve. The richer alternative (a fully saved view per grouping) buys
   little more and forces `poolArrangement` to become a map of views.
4. **Layout belongs to the deck, preferences belong to the user.** Manual
   columns and pins are work done _on that deck_, exactly as the Pool
   Arrangement is work done on that seat: they should follow it across devices,
   and let an admin curate a Preset Deck's layout. "I always look at my decks by
   colour" is not a property of any one deck.
5. **A persisted filter is a correctness hazard, not just a UX wrinkle.** A
   saved view that hides cards lets someone save and play a deck they believe
   they have seen in full.
6. **Excluding the draft surface would re-open the seam #1575/#1581 just
   closed.** Two column models over one persisted arrangement is the premise of
   the next divergence.

## Consequences

- `groupDeckIntoPiles` (dynamic Mana-Value piles) and the fixed
  `fixedColumnDescriptors` ladder are both subsumed by the Layout engine; the
  Constructed Sideboard stops being a flat pile.
- A pure, shared `convex/deckLayout.ts` becomes the single authority on column
  identity, claiming order and pin resolution — imported by client and server
  alike (ADR 0074: the frontend may import pure engine modules; it just has no
  authority).
- `getProducibleColors` must be split so its definition-level half is callable
  without a `CardInstanceState`.
- `userDecks` gains an optional `layout`; `PERSISTED_OPTIONAL_KEYS`-style drift
  guards apply on the Convex side.
- Deck import/export, Featured Card, banlist and legality panels are unchanged;
  they become toolbar/panel slots on the shell.
