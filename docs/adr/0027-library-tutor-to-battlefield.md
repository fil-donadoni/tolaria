# ADR 0027 — Library tutor → battlefield: a destination primitive, not a search primitive

**Status:** Accepted (2026-06-19)

## Context

Issue #294 (ATQ cluster H, Transmute Artifact) was framed as "introduce a
library tutor/search primitive — no library-search capability exists today."
That framing predates the engine's current state: a **search-library**
capability already exists and is exercised by Demonic Tutor
(`convex/cards/sets/lea.ts`). It is composed from primitives that are already
general:

- **`requestChoice({ kind: "search-library", zone: "library", … })`** — the
  search itself (CR 701.23). It already accepts a `filter` and a
  `candidateIds` allow-list, suspends the resolution (CR 608.2), reveals the
  searched library to the chooser via `computeChoiceExposure`
  (`convex/gameProjections.ts`), and validates the pick server-side
  (`convex/gre/pendingChoiceSubmit.ts`).
- **`moveCardById(playerId, id, "library", "hand" | "graveyard")`** — routes
  the pick to a `MovableZone`.
- **`shuffleLibrary(playerId)`** — CR 701.24.

Transmute Artifact is the first card that must put a searched library card
**onto the battlefield** rather than into hand/graveyard. Two facts shaped the
decision:

1. **`MovableZone` deliberately excludes `"battlefield"`** (`convex/cards/types.ts`):
   putting a card onto the battlefield is a zone change that must run ETB /
   grant application (CR 603.6, 611.2), not a flat array splice. `moveCardById`
   is the wrong tool by design.
2. **`returnToBattlefield` only accepts `"graveyard" | "exile"`** — both are
   public, ordered piles. A library is hidden and unordered, so the searcher
   selects the instance via `requestChoice` and routes the id separately. The
   semantics ("return") also don't fit a card that was never on the
   battlefield.

The library-zone branch of the submit validator (`pendingChoiceSubmit.ts`) does
**not** apply a `PermanentFilter` to hidden library cards — it only enforces a
`candidateIds` allow-list. So a _filtered_ search ("an artifact card") must
carry its eligibility as a precomputed `candidateIds` list, which in turn
requires reading library-card characteristics at resolution.

## Decision

Add **one** dedicated SpellContext primitive for the missing half — the
destination move — and **reuse** the existing search machinery for everything
else.

- **`putFromLibraryOntoBattlefield(playerId, cardInstanceId): boolean`**
  (`convex/gre/state.ts`). Splices the instance out of the player's library and
  puts it onto their battlefield through the shared
  `putReanimatedOnBattlefield` path — the same ETB notification, lord-grant
  application, and summoning-sickness handling reanimation already uses (both
  are zone changes onto the battlefield). Returns `false` on silent fizzle
  (CR 608.2b) if the id isn't in the library at resolution.
- **`getLibraryCards(playerId): Array<{ id, types, manaValue }>`**
  (`convex/gre/state.ts`). Mirrors the existing `getHandCards`; lets a card
  precompute the `candidateIds` allow-list of a filtered search (Transmute
  Artifact: artifact cards), since the submit validator gates library picks on
  `candidateIds`, not on a `PermanentFilter`.

The frontend gates clickability on `candidateIds` for filtered searches
(`src/components/board/player-library.tsx`): a click on an ineligible card is a
no-op, matching the server's rejection.

### Why a dedicated primitive and not a generalized `returnToBattlefield`

Reuse-first (the project's primitive-reuse rule) would argue for widening
`returnToBattlefield`'s `fromZone` to include `"library"`. We rejected that:
the name and contract of `returnToBattlefield` are reanimation ("return a card
**from your graveyard/exile**"), both public piles; folding a hidden,
unordered library source under the same method blurs two distinct operations
and invites callers to pass `"library"` where a public-pile fizzle contract is
assumed. A separate, named entry point keeps each operation's contract crisp
while still sharing the one place that matters — the battlefield-entry path
(`putReanimatedOnBattlefield`).

## Consequences

- The "tutor primitive" of #294 is really **search (reused) + destination
  (new)**. Any future "search your library for a [type] and put it onto the
  battlefield" card composes `getLibraryCards` → `requestChoice` →
  `putFromLibraryOntoBattlefield` → `shuffleLibrary` with no new surface.
- Multi-suspend resolution rule: a `resolveSteps` step re-runs from its top on
  every resume, so any board mutation reached **before** a later suspend fires
  twice. Transmute Artifact therefore defers **all** mutations (the sacrifice
  included) to after its last suspending choice, reading the sacrificed
  artifact's mana value (read-only) from the still-present permanent in that
  final pass.
- No new `GameState` field; nothing to add to `PERSISTED_OPTIONAL_KEYS`.
