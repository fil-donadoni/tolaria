# Preset Decks live in the DB and are Admin-editable

## Status

accepted

## Context

Preset decks were hard-coded as constants in `convex/deckPresets.ts` and served verbatim by `api.decks.list`. Adding or fixing a preset required a code change and a redeploy. We want a trusted user to curate the built-in decklists from the existing deck editor instead.

## Decision

Move preset decks into a dedicated `presetDecks` Convex table (separate from `userDecks`, no `userId`). A `User` flagged `isAdmin` may create, edit, and delete presets through the same `DeckBuilder`, gated server-side by `assertIsAdmin(ctx)` — hiding the controls in the UI is cosmetic only. `api.decks.list` now reads the table.

Each preset keeps a stable, human-readable **Slug** (e.g. `mono-red-burn`) derived from its name at creation and **immutable** thereafter — _not_ its Convex id. External references (the lobby's persisted selection, debug scenarios, wire payloads) key off the slug, so a row's identity must survive edits and must not be a random per-row id.

The nine existing presets are migrated by an idempotent **insert-if-absent** seed (`seedPresets`) reading `PRESET_DECKS`. `deckPresets.ts` is retained only as the seed source; it is no longer read by `list`. The seed never overwrites, so re-running it cannot clobber admin edits.

## Considered Options

- **Flag on `userDecks` (`isPreset`, nullable `userId`)** — rejected: mixes ownership semantics, breaks the `by_user` index assumptions, and the random `_id` can't serve as the stable slug.
- **Slug as the Convex id** — rejected: ids are random; saved lobby selections and debug scenarios that hard-code `mono-red-burn` would break.
- **Seed with overwrite / env-var admin list** — rejected: overwrite re-running would erase admin edits; an env-var admin list isn't readable client-side to toggle the editor UI.

## Consequences

- `api.decks.list` becomes an async, reactive DB query (was an in-code array). Existing consumers already use `useQuery`, so no client change beyond the editor surface.
- A new `api.decks.getPreset(slug)` query backs the editor's edit mode.
- Deleting a preset is a hard delete; in-flight games are unaffected because the deck is snapshotted into game state at creation, and the lobby selection lookup is already null-safe for a missing slug.
- `deckPresets.ts` now has a non-obvious role: seed data, not the source of truth read at runtime.
