# Design — Admin editor for Bot Pick Ratings (DB-backed, per-scope)

Status: draft for review · 2026-07-17 · supersedes the "ratings are repo data
files, no runtime editor" stance of PRD #1107 (needs a new ADR).

## Problem

The Bot Drafter refines its picks with an optional **Pick Rating** layer
(0–5, `convex/limited/pickRatings.ts`, issue #1117): a per-set JSON file in the
repo (`data/pick-ratings/lea.json`), keyed by canonical `CardDefinition.id`,
layered over the always-present Pick Heuristic. PRD #1107 deliberately modelled
ratings as **repo data files** and listed runtime ingestion/editing as a
non-goal.

Two gaps:

1. **No runtime editor.** Tuning a bot's card evaluation means hand-editing a
   checked-in JSON file and redeploying. There is no way for an Admin to teach
   the bots from the running app.
2. **Vintage Cube has no ratings at all.** The cube (ADR 0062) is not a set, so
   it never got a `data/pick-ratings/*.json` file; the bots draft it on the
   heuristic alone. "Rate cards for cube and the other formats" is the ask.

## Decision (to be recorded as an ADR)

Evolve the model: **ratings live in a Convex table, editable at runtime by an
Admin; the checked-in JSON files become the seed/default.** This mirrors the
precedent that moved Preset Decks into a DB, Admin-editable store (ADR 0033).

### Data model

New table `cardRatings`:

| field    | type     | notes                                                                                                                 |
| -------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `scope`  | `string` | pack-source identity: a set code (`"lea"`) or the cube key (`"vintage-cube"`). Lowercased, same space as `packSlots`. |
| `cardId` | `string` | canonical `CardDefinition.id` (not a printing's scryfallId).                                                          |
| `rating` | `number` | `PICK_RATING_MIN`..`PICK_RATING_MAX` (0–5, fractional allowed).                                                       |

Index `by_scope` (and `by_scope_card` for point upserts). One row per
`(scope, cardId)`. **Per-format/cube scope was chosen over a single global
rating** — the same card can be a bomb in one environment and filler in
another.

### Resolution order (bot read path)

For an event whose pack sources are `scopes` (its distinct `packSlots`):

```
rating(cardId) =
  DB cardRatings[(scope, cardId)] for scope ∈ scopes   // editor wins
  else seed JSON getPickRating(scope, cardId)          // checked-in default
  else null                                            // → Pick Heuristic only
```

The bot layer is untouched: `chooseBotPick(..., getPickRating?)` already takes
an injected `GetPickRating = (cardId) => number | null`
(`convex/limited/botDrafter.ts`). Today `convex/limitedEvents.ts` injects
`getPickRatingByCardId` (registry-agnostic, checked-in only). The change: the
draft/auto-build mutations **load the DB ratings for the event's scopes once**,
build the layered `(cardId) => number | null` lookup above, and inject THAT.
`botDrafter.ts` never learns where the number came from.

### Editor (Admin-only)

A new Admin surface (mirrors the deck/cube-list editors, `assertIsAdmin`-gated):

- Pick a **scope**: any Draftable Set, or the Vintage Cube.
- List that scope's cards — a set's Booster-Config cards, or the cube pool
  (`buildCubePool`) — each with its current rating (DB row, else the seed JSON
  value shown as placeholder), searchable/filterable.
- Edit a rating inline; save upserts `(scope, cardId)`; clear deletes the row
  (falls back to seed/heuristic). Buttons disable while the mutation is
  in-flight (project rule).

### Seeding

The checked-in `data/pick-ratings/*.json` files stay as the versioned default
(LEA ships curated). They are NOT auto-copied into the DB; the resolution order
reads them as the fallback layer, so an unedited scope behaves exactly as today.
(Optional later: a one-click "seed this scope from the JSON default" action.)

## Slices (tracer-bullet vertical)

1. **ADR** — record the model evolution (DB store + seed layer), supersede the
   #1107 non-goal. Add the index row.
2. **Table + resolution** — `cardRatings` schema + a pure `resolveEventPickRating`
   layering DB over seed JSON; unit-tested at the boundary. Bot behaviour with
   an empty table is byte-identical to today.
3. **Bot read path** — mutations load DB ratings for the event's scopes and
   inject the layered lookup into `chooseBotPick`; integration test proves a DB
   row overrides the seed and the heuristic.
4. **Admin write mutations** — `assertIsAdmin`-gated `setCardRating` /
   `clearCardRating`, arg + return validators, bounds-checked (`validate…`
   reused).
5. **Editor UI** — scope picker + card list + inline rating edit, driven through
   the real projection; frontend wiring walked (no dropped field).
6. **Cube ratings** — first curated pass at `vintage-cube` scope so the cube
   drafts on data, not heuristic alone (data, not code).

## Non-goals (unchanged from #1107)

17Lands-style automated ingestion; per-user rating overrides; rating anything
outside the drafting bot (this is the Bot Drafter's card evaluation, not the
gameplay ISMCTS bot).

## Open questions for review

- Editor home: a tab under an existing Admin area, or its own route? (Lean: same
  place the cube-list / preset-deck editors live.)
- Do we want the "seed scope from JSON" one-click action in the first cut, or
  defer it? (Lean: defer — resolution order already makes seeds work.)
