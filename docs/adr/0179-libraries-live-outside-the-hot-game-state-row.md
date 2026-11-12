# Libraries live outside the hot `gameStates` row

## Status

accepted (2026-11-12, issue #9318, owner ruling). Amends the data model
recorded in CLAUDE.md § Data model and `docs/PROJECT.md` § 4: a position is no
longer one row. Builds on the compact form of issue #1780 (`convex/gre/serialize.ts`).

## Context

Convex bills a read by the whole document, and every write re-runs every
query subscribed to the written row. The `gameStates` row is written whole at
every stable point and re-read whole by every `getPublicState` subscriber.
Production, 2026-11-01 to 2026-11-11: Database I/O 1.55 GB against a 1 GB
monthly quota, `getPublicState` 573 MB and `passPriority` 446 MB of it.

Measured on 30 rows of the local deployment (2026-11-12, average 3.9 KB
compact): the seats' libraries are about 34% of the row and the cardId string
table about 18%, most of it library card ids. A library changes on a draw or a
shuffle; the public projection shows its size and, rarely, a card some viewer
knows.

## Decision

- **A position is two documents.** The hot `gameStates` row holds the compact
  state without the libraries (`libraryCounts` in their place). One
  `gameLibraries` row per game holds every seat's library with its own cardId
  table (`splitCompactState`, `CompactLibraries`).
- **The companion is written only when a library changed.** Its payload is a
  pure function of the libraries, so `saveGameState` compares the serialised
  payload with the row the loader handed it and skips the write on equality.
- **Mutations read both** (`getLatestGameState`): engine semantics are
  unchanged, and `saveGameState` stays the sole writer of both rows.
- **The public view reads the hot row alone when the writer proved it can.**
  At every save `publicViewNeedsLibrary` projects the stored position for each
  seat twice, with the libraries and with identity-less placeholders
  (`OPAQUE_LIBRARIES`), and stores whether any pair differs on the hot row.
  `getPublicState` skips the companion only on a stored `false`, and only for
  a seat's own normal view, which is exactly what the proof covered.
- **The proof is a comparison, not a census.** The projection reads library
  contents in many places (search and peek piles, a revealed or known top
  card, a play-from-top affordance, a characteristic a library card
  contributes). A list of them would fail open the day one is added; the
  comparison cannot.
- **Placeholders cannot leak and cannot be saved.** An opaque state carries no
  card identity, and `saveGameState` refuses one.
- **A hot half expanded without its libraries throws**, unless the caller
  asked for placeholders by name. A reader that forgot the companion fails
  loudly.
- **No migration.** A single-row document still loads; the next save of that
  game writes it split.

## Rejected

- **Moving the cardId table wholesale.** Every zone indexes into it, so the
  hot row could not be expanded without the companion.
- **A hand-kept "projection needs the library" predicate.** Fails open, and a
  wrong `false` shows a player a board that disagrees with the server.
- **Always reading both rows in the public view.** Same bytes as one row; only
  the write side would gain.

## Consequences

- A save costs two expansions and four projections more (about 0.1 to 2 ms per
  projection on the measured rows). Database I/O is the billed resource;
  mutation compute is not.
- A reader of `gameStates` outside `convex/gameStateStore.ts` must load
  through it. Deleting a game deletes its `gameLibraries` row.
- While a viewer knows a library card, or a search or peek is open, the public
  view reads both rows, as before the split.
