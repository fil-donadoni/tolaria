---
title: A Preset Deck cannot carry a Column Layout, so the builder hides column management in preset mode
discoveredBy: 1626
status: draft
confidence: medium
---

**What is wrong.** Issue #1626 put the Column Layout on `userDecks.layout`.
`presetDecks` has no such column, and the Constructed builder is the SAME
component for both kinds — so in preset mode the add/rename/delete affordances
are deliberately withheld, and — since PR #2318's review round — so is the
column DRAG, which was the one entry point still recording a Pin the save then
stripped. ADR 0075's own rationale §4 names the opposite as a goal ("let an
admin curate a Preset Deck's layout"), so the gap is a real, if small, divergence
from the record.

**Evidence.**

- `convex/schema.ts` — `layout: v.optional(storedDeckColumnLayoutValidator)` is
  on `userDecks` only; the `presetDecks` table beneath it has no `layout`.
- `src/lib/deckBuilderDispatch.ts` — `toPresetPayload` exists purely to strip
  the field before it reaches `decks.createPreset` / `decks.updatePreset`, which
  would reject an argument their validators do not declare.
- `src/components/lobby/deck-builder/deck-builder.tsx` — `onAddColumn` /
  `onRenameColumn` / `onDeleteColumn` are passed as `isPreset ? undefined : …`,
  which is the only `kind`-shaped conditional the slice added.
- `handlePin` in the same file now early-returns on `isPreset` (PR #2318 review
  NB1). Before that it recorded into the working deck, moved the card visibly
  and scheduled a save that silently discarded the Pin — so preset mode is now
  consistently "no column work is offered", not "three of four entry points".

**Also unpruned: `pins`.** A Card Pin whose card has left the deck stays in
`deck.layout.<zone>.pins` forever and is rewritten on every save — intentional
per ADR 0075 §3 ("a Pin is never erased", so restoring the card or the Column
resurrects the placement) and bounded by the deck's own history, but there is no
compaction anywhere and `userDecks.layout` only grows. Same shape as the gap
above: a PRD line about preset/layout lifecycle rather than its own ticket.

**Why it may not deserve its own issue.** Nothing REGRESSED — a preset never had
a persisted layout, and the pre-#1626 Constructed builder did not persist one for
user decks either. The work is mechanical but not free: `presetDecks` schema, the
`decks.ts` create/update arg validators, `buildPresetPatch` / `buildNewPresetRow`,
the `LobbyPreset` **returns** validator (a projection field with no returns entry
breaks the query at runtime), and `toPresetLobbyDeck`. That is six touch points
in a file #1626 deliberately stayed out of, for one admin-only surface. If preset
curation grows other per-deck workspace state it becomes worth doing once, for
all of it, rather than for the layout alone.
