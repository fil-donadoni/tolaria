# Cube filter in the deck builder — design

**Date:** 2026-07-15
**Status:** approved (brainstorm)

## Problem

The deck builder can narrow the card pool by color, type, mana value, set, and
text, plus a Format set-membership gate (`allowedSets`). There is no way to
restrict the pool to a **cube** — a curated, arbitrary list of specific cards
(e.g. the MTGO/paper Vintage Cube, 540 cards). A cube is a *card list*, not a
*set list*, so it does not fit the existing `allowedSets` mechanism. The engine
must support **multiple named cube lists**, not just one.

## Decisions (locked in brainstorm)

1. **Cube is a discovery filter, NOT a legality Format.** It only narrows the
   cards shown in the builder. It never touches `validateDeck` /
   `assertDeckLegal` / the game-start gate. A deck built "in" a cube is not
   validated against it. This keeps cube orthogonal to `FormatId` and avoids
   touching the schema format union, `FORMAT_RULES`, and the authoritative gate.
2. **Cube lists live in a DB table**, admin-editable, resolved by card **name**
   at read time — the same pattern as format banlists
   (`convex/banlists.ts` + `ResolveCardByName`).
3. **This slice: seed + filter only.** No admin editing UI. Editing is via a
   `saveCube` mutation (console / script) for now; a panel is a later slice.
4. **Single-select** in the builder — one cube at a time (a cube is a single
   curated list; you build *for* a cube).

## Why store names, not card ids

The Vintage Cube worklist is 540 card **names**, the majority not yet
implemented in the engine. Storing names (not `cardId`s) and resolving at read
time via `tryGetCardByName` means:

- A cube row can list all 540 names up front.
- Membership = `resolve(name) ∩ implemented pool`. Names with no built card are
  silently dropped from the filter (never an error).
- As new cards ship, they auto-appear in the cube filter with no cube edit —
  retroactive via derivation, matching the codebase philosophy (mirrors how
  banlists / Old School lists intersect with the built pool).

## Data model

New table in `convex/schema.ts`:

```ts
cubeLists: defineTable({
  slug: v.string(),        // stable id, e.g. "vintage-cube"
  name: v.string(),        // display, e.g. "Vintage Cube"
  cardNames: v.array(v.string()), // oracle names (source of truth)
  updatedAt: v.number(),
}).index("by_slug", ["slug"]),
```

## Backend — `convex/cubes.ts`

Mirrors `convex/banlists.ts`: a Convex-function file separate from any pure
core, thin query wrappers over pure, directly-unit-testable functions (no
convex-test harness in this project).

- **Pure core** (unit-tested): `resolveCubeMembership(cardNames, resolve)` →
  `string[]` of canonical `cardId`s (resolved ∩ implemented, deduped, unbuilt
  names dropped). `resolve: ResolveCardByName` injected, exactly like the
  banlist cores.
- `api.cubes.list` (query, no args) → `{ slug, name, count }[]` — every cube
  row projected for the dropdown; `count` = resolved membership size (implemented
  ∩ cube). Sorted by `name`.
- `api.cubes.membership` (query, `{ slug }`) → `string[]` of cardIds for the
  selected cube (empty array for an unknown slug — fail-open to "no cards",
  never throw). Frontend wraps it in a `Set`.
- `saveCube` (mutation, `{ slug, name, cardNames }`) → upsert by `slug`, stamps
  `updatedAt`. Admin-only surface for now; no UI this slice.

**Seed:** a script `scripts/seed-vintage-cube.ts` (or a one-off mutation) that
reads `data/worklists/vintage-cube.txt` (names, `#` comments stripped) and calls
`saveCube("vintage-cube", "Vintage Cube", names)`. Idempotent (upsert by slug).

## Frontend

- **`cube-filter.tsx`** (new component, one-per-file rule): single-select
  dropdown driven by `api.cubes.list`. Options: "None" + one per cube row. All
  UI text English.
- **`CardSearchFilters`** (`useCardSearch.ts`) gains `cube?: string` (slug);
  `DEFAULT_FILTERS.cube` unset.
- **`useCardSearch`**: when `filters.cube` is set, `useQuery(api.cubes.membership,
  { slug })` → build a `Set<cardId>` → new gate `cubeSet.has(e.cardId)`.
  Composes (AND) with the existing `matchesFormatSets` gate and every user
  filter. While the membership query is loading, treat as "no matches yet"
  (empty) rather than showing the unfiltered pool.
- **`hasAnyFilter`**: a selected cube counts as an active filter, so the results
  render (the pool is not idle-suppressed on a bare cube selection).
- **URL persistence** (`filterSearch.ts`): add a `cube` key to `encodeFilters` /
  `decodeFilters` (omitted when unset), so a cube selection survives reload and
  is shareable — consistent with the other filters.

**Orthogonality:** cube AND format-set gate AND user filters all compose. A
Vintage-Cube + Freeform selection shows `implemented ∩ vintage-cube`. No special
interaction handling needed.

## Testing

- **Pure core** (`convex/__tests__/cubes.test.ts`): `resolveCubeMembership`
  drops unbuilt names, dedups, resolves built names to canonical ids, empty for
  empty input — with an injected `resolve` fixture (mirrors
  `banlists.test.ts`).
- **Frontend filter** (`useCardSearch` / `filterSearch` tests): a cube gate
  narrows the pool to the membership set; `hasAnyFilter` true on a bare cube
  selection; `encodeFilters`/`decodeFilters` round-trip the `cube` key.
- No GRE / wire-format tests — cube is a pure builder-side discovery filter, it
  never crosses the GRE → game.ts → UI game boundary (no `GameState` field, no
  reducer, no ability). It does not fall under the `.claude/rules/gre-development.md`
  frontend-wiring reducer walk (that governs card/mechanic affordances).

## Out of scope (this slice)

- Admin UI for creating/editing cubes (later slice; `saveCube` mutation exists).
- Cube as a legality Format / game-start gate.
- Multi-cube (union) selection.
- Cube-aware deck validation or singleton (1-of) enforcement.

## Files touched

- `convex/schema.ts` — `cubeLists` table.
- `convex/cubes.ts` — new: pure core + `list` / `membership` queries + `saveCube`.
- `convex/__tests__/cubes.test.ts` — new: pure-core tests.
- `scripts/seed-vintage-cube.ts` — new: seed from the worklist.
- `src/components/lobby/deck-builder/cube-filter.tsx` — new component.
- `src/components/lobby/deck-builder/useCardSearch.ts` — `cube` filter field + gate.
- `src/components/lobby/deck-builder/filterSearch.ts` — `cube` URL key.
- `src/components/lobby/deck-builder/deck-builder.tsx` — mount `<CubeFilter>`.
- existing deck-builder filter tests — extend for the cube gate + URL round-trip.
