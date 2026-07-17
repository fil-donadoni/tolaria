# Bot Drafter Pick Ratings live in the DB and are Admin-editable

## Status

accepted

## Context

The Bot Drafter's Pick Heuristic (`convex/limited/botDrafter.ts`, PRD #1107) can
be refined per Draftable Set by an optional Pick Rating file — a hand-curated,
Draftmancer-style 0-5 scale, checked in at `data/pick-ratings/<set>.json` and
read by `convex/limited/pickRatings.ts` (issue #1117). Tuning a rating, or
rating a set that has none yet, requires a code change and a redeploy — there
is no way to adjust the bots' card evaluation from the running app.

Worse, the **Vintage Cube** (ADR 0062) is not a Draftable Set in the registry
sense: it never got a Pick Rating file, so the bots draft it on the raw Pick
Heuristic alone, with no notion that a cube staple is a first-pick bomb and a
filler card is a late pick.

PRD #1107 (story 28, issue #1117) deliberately scoped Pick Ratings as
checked-in repo data files and listed runtime editing / data ingestion as a
non-goal. PRD #1296 supersedes that stance: an Admin should be able to sit in
the app and set per-scope card ratings — for every Draftable Set AND the
cube — and have them take effect on the bots' very next pick.

## Decision

Move Pick Ratings into a dedicated `cardRatings` Convex table, layered OVER
the existing checked-in seed files — mirrors ADR 0033's "Preset Decks → DB,
Admin-editable" move, applied to a second checked-in-data-file feature.

- **New table `cardRatings`**: one row per `(scope, cardId)`. `scope` is a
  lowercased pack-source identity — a Draftable Set code (e.g. `"lea"`) or the
  reserved Vintage Cube key (`convex/limited/cube.ts`'s `CUBE_SOURCE_KEY`,
  `"vintage-cube"`) — the SAME string space `limitedEvents.packSlots` already
  uses, so the read path never needs a cube-specific branch. `cardId` is the
  canonical `CardDefinition.id` (not a printing's `scryfallId`), matching
  `PickRatingFile.ratings`'s key discipline. `rating` is
  `PICK_RATING_MIN..PICK_RATING_MAX` (0-5, fractional allowed). Indexed by
  `scope` (the read path's access pattern: "every rating for this event's
  scopes") and by `(scope, cardId)` (the write path's point-upsert target).
- **Seed layer unchanged** — the checked-in `data/pick-ratings/*.json` files
  and `pickRatings.ts`'s `getPickRating(scope, cardId)` stay exactly as they
  are: the DEFAULT layer. No auto-copy into the database; an un-edited scope
  keeps reading the file.
- **One new pure seam, `resolveEventPickRating`**
  (`convex/limited/cardRatings.ts`): given an event's distinct scopes and an
  injected `GetDbRating` closure, returns the SAME `GetPickRating` shape
  `botDrafter.ts`'s `chooseBotPick` already accepts. Resolution order per
  card: database `(scope, cardId)` for any of the event's scopes → seed JSON
  `getPickRating(scope, cardId)` for any of the event's scopes → `null` (Pick
  Heuristic alone). `botDrafter.ts` is UNCHANGED — only which lookup
  `convex/limitedEvents.ts` builds and injects changes.
- **Bot read path reuses the existing injection point.** The draft-pick call
  sites (`startLimitedEvent`'s draft branch, `submitPick`,
  `autoPickSeatTimeout`) load the event's `cardRatings` rows once per
  invocation (bounded by the `by_scope` index — never a full-table scan),
  build the layered lookup via `resolveEventPickRating`, and inject it into
  `chooseBotPick` — replacing the old registry-agnostic
  `pickRatings.ts#getPickRatingByCardId`.
- **Admin write mutations and the editor UI are a later slice** (PRD #1296
  Slice B/C: `setCardRating`/`clearCardRating`, `assertIsAdmin`-gated, reusing
  a shared `isValidRating` bounds check extracted out of
  `validatePickRatingFile`; a scope-picker + searchable card list surface).
  This slice ships the table, the pure layering seam, and the read-path wiring
  only — with an empty table, every scope drafts byte-identically to today.

## Considered Options

- **Auto-copy every seed file into the database at migration time** —
  rejected: an un-edited scope should keep reading the versioned checked-in
  file (PRD #1107's curated LEA ratings, issue #1117, must not silently
  become "just database rows" a migration could drift or lose); the
  resolution order already makes an un-copied seed work without copying it in.
- **Drop the seed layer entirely, database-only** — rejected: would require a
  one-time data migration for every existing checked-in file (LEA today, more
  sets over time) before shipping, and loses "checked-in ratings are versioned
  with the code" for any set nobody has opened the editor for yet.
- **A single global rating per card (not per-scope)** — rejected: PRD #1296
  story 10 requires a card to rate differently per format/cube (a card can be
  a bomb in one environment and filler in another) — a global number can't
  express that, and would collide across sets that happen to reuse a card.
- **Bake the cube into `pickRatings.ts`'s checked-in-file registry instead of
  the database** — rejected: the cube has no static "set" identity a checked-in
  JSON file can key off in the same way a Draftable Set does today, and PRD
  #1296's whole point is Admin-editable ratings for the cube specifically —
  a checked-in file would just recreate the "redeploy to tune" problem this
  ADR exists to remove.

## Consequences

- `convex/limitedEvents.ts`'s bot-pick call sites gain one extra bounded DB
  read (`loadEventPickRating`) per mutation invocation — negligible: at most
  one row set per distinct event scope, almost always a single scope.
- A card rated in the database for scope `"lea"` has zero effect on a
  different event scoped to `"ice"` — scopes never leak into each other
  (`resolveEventPickRating` only ever queries the event's own distinct
  scopes).
- The Vintage Cube can now be tuned by an Admin from day one, with no
  checked-in seed file required — a database-only scope is a fully supported,
  intentional case (`getPickRatingFile` already returns `null` for a scope
  with no file; the database layer sits in front of that `null`, not behind
  it).
- `botDrafter.ts` and its existing `GetPickRating` injection point are
  untouched — the Pick Heuristic still has no idea whether a rating came from
  a checked-in file or a database row, keeping the scoring module fully
  decoupled from persistence, exactly as ADR 0054/0055 established.
