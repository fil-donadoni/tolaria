# Card Prints are a database table sourced from Scryfall; the engine never reads a print

## Status

accepted (2026-09-19, grilled in session `card-prints.json`). Supersedes
ADR 0014 (set files carry `CardPrint` literals). Amends ADR 0113: Card Prints
are **not** part of the resident corpus — neither bundled server-side nor in
the client's eagerly-loaded catalogue artefact.

## Context

A reprint was a hand-written `CardPrint` literal (`printId`, `definitionId`,
`setCode`, `rarity`) in a set file: 1,409 of them across 55 files, resolved by
an alias (`registerPrintAlias`) so `getDefinition(printId)` returned the
printed card's definition. Three facts made that shape untenable:

- **Coverage.** The literals held only the printings someone typed. Birds of
  Paradise had `leb`/`2ed`/`4ed`, but not Revised although the `3ed` set
  exists. The Oracle compiler is heading for every existing card (~35k), and
  the goal is every printing of each (~80k).
- **Scale.** Measured on 2026-09-19: an eagerly-loaded print row costs
  ~28.5 B brotli against a 500 KB client budget, so 80k rows (~2.3 MB brotli)
  cannot be resident client-side, and splitting by print-id prefix does not
  help: UUIDs are uniform, so one deck touches nearly every shard. Server-side
  the argument is per-request cost, not capacity (corrected 2026-09-20, ADR
  0113 Amendment III: the 32 MiB code ceiling is documented but not enforced):
  module globals do not survive a request, so the 1,409 constants cost ~6.8 ms
  of evaluation on EVERY mutation and query, and 80k would cost
  proportionally more. A table costs nothing until a row is read.
- **A broken flow.** `buildPlayerState` resolved the alias and kept only the
  definition id, so a player's chosen printing never reached the board.

## Decision

1. **Migration, not retirement.** What a Card Print means is unchanged; only
   where it is written and how it is read change.
2. **Scryfall is the only source.** Every printing Scryfall has for a card
   that has a Card Definition, except oversized cards, with `digital` and
   `promo` flags. There is no allowlist by set directory, because set
   directories shrink as the compiler absorbs hand-written cards. The printing
   whose id _is_ the definition id is skipped. Twin ids (`#`) never enter the
   input.
3. **A Convex table is the source of truth**, indexed by print id and by
   definition id. It is filled by an idempotent sync that upserts and never
   deletes: a withdrawn printing keeps its row, so a deck naming it still
   loads. There is no committed lockfile, since nothing builds from the data.
   Only the reviewed rarity override file lives in the repo.
4. **Each print row carries its Token Prints** (Scryfall `all_parts`): the
   same-edition token when one was printed, otherwise the one Scryfall pairs it
   with. This replaces `convex/cards/generated/token-prints.json`.
5. **A deck entry names both ids**: `{definitionId, printId, cardName}` in
   user decks, sideboards and preset decks. Nothing on the client resolves a
   print id to a definition. Any consumer that needs print metadata (format
   validation, Limited rarity) gets a resolver built from the rows at the
   server boundary.
6. **The engine is blind to prints.** It carries `imagePrintId` (from the
   deck entry) and `sourcePrintId` (stamped on a created token) as opaque
   values. No rules module reads them. A guard test fails on any reader
   outside a closed list: deck setup, token creation, copy, serialisation and
   projection. The client alone turns a print into an image. Face-down
   objects expose no print, except to a controller the rules let look at them.
7. **Legality follows the printing only in edition-scoped Formats.** Old
   School and Alpha 40 judge the chosen printing's set and rarity. Premodern
   and Freeform ignore the printing.

## Considered options

- **Rows inside the resident catalogue artefact (ADR 0113).** Rejected: it
  does not fit at 80k rows on either side (see Context).
- **A lazily loaded, sharded asset.** Could serve the client picker, but
  Convex queries and mutations cannot fetch, so the server needs the table
  anyway.
- **A side table `instanceId → printId` outside the engine.** Rejected: only
  the engine knows object identity across copies, token creation and zone
  changes, and a second visibility filter would duplicate
  `projectPublicState`'s redaction.

## Consequences

- `getDefinition(printId)` stops resolving printings. Every call site that
  passed a print id receives the definition id instead.
- Every request sheds the 1,409 constants (~6.8 ms eval, measured) and gains
  no eagerly-loaded byte.
- ADR 0113's resident compiled corpus at 35k cards was its own decision, since
  settled by ADR 0113 Amendment III: it stays resident, packed.
