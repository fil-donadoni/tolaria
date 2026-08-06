---
title: A Preset Deck cannot carry a Column Layout, so the builder hides column management in preset mode
discoveredBy: 1626
status: draft
confidence: medium
---

**What is wrong.** Issue #1626 put the Column Layout on `userDecks.layout`.
`presetDecks` has no such column, and the Constructed builder is the SAME
component for both kinds — so in preset mode the add/rename/delete affordances
are deliberately withheld and a Card Pin recorded by a drag lives only until the
tab closes. ADR 0075's own rationale §4 names the opposite as a goal ("let an
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
- A pin drag in preset mode still records into the working deck
  (`handlePin` → `updateMaindeckLayout`) and is silently dropped at save.

**Why it may not deserve its own issue.** Nothing REGRESSED — a preset never had
a persisted layout, and the pre-#1626 Constructed builder did not persist one for
user decks either. The work is mechanical but not free: `presetDecks` schema, the
`decks.ts` create/update arg validators, `buildPresetPatch` / `buildNewPresetRow`,
the `LobbyPreset` **returns** validator (a projection field with no returns entry
breaks the query at runtime), and `toPresetLobbyDeck`. That is six touch points
in a file #1626 deliberately stayed out of, for one admin-only surface. If preset
curation grows other per-deck workspace state it becomes worth doing once, for
all of it, rather than for the layout alone.
