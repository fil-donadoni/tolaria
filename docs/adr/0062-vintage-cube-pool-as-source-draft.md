# ADR 0062 — Vintage Cube as a pool-as-source draft (no completeness gate)

**Status:** Accepted
**Date:** 2026-07-17
**Supersedes / amends:** none (extends the Limited draft pipeline of ADR
0054/0055/0056/0059/0060)

## Context

The Limited draft engine (ADR 0054/0055) samples packs from per-set **Booster
Configs** — weighted print sheets plus rarity-slot recipes imported from MTGJSON
(ADR 0056) — and gates a set as Draftable only when every sheet is ≥80%
implemented (the per-sheet floor, ADR 0059), so "draftability doubles as a
set-completion incentive."

A **cube** is a different object entirely. It is not a set: it's a curated card
**pool** (the Vintage Cube is ~540 hand-picked singletons across every era)
shuffled into random 15-card boosters. It has no print sheets, no rarity slots,
and no notion of "completeness" — there is nothing to complete. Forcing the cube
through the set pipeline would mean fabricating fake sheets and, worse, subjecting
a curated list to the ≥80% gate that exists to pressure set completion. The user
wants a Vintage Cube draft to run **now**, from day one, with whatever cube cards
are currently implemented — no minimum, no gate.

## Decision

Add a **pool-as-source** booster path beside the existing per-set sheet path,
recognized by a reserved Pack Source key `"vintage-cube"` (`CUBE_SOURCE_KEY`,
`convex/limited/cube.ts`). It is NOT a `BoosterConfig`: `getBoosterConfig` returns
`null` for it, and every seam that would look one up special-cases the cube
**before** the lookup.

1. **Pool = the implemented subset of the canonical list.** The canonical Vintage
   Cube list is the worklist `data/worklists/vintage-cube.txt` (~540 names),
   checked in as `data/cube/vintage-cube.json`. `buildCubePool()` resolves each
   name through the SAME registry seam the set path uses (`tryGetCardByName` →
   an implemented `CardDefinition`) and keeps only the names that resolve, mapped
   to their canonical Card ID (`def.id`). Unimplemented names are simply absent.
   The pool grows automatically as more cube cards land — no re-import step. The
   currently-implemented pool size is **N = 283** of 540 names.

2. **No completeness gate — the cube is ALWAYS draftable.** `isDraftableSet(
"vintage-cube")` returns `true` unconditionally (it deliberately bypasses the
   ≥80% per-sheet floor), so `createLimitedEvent` accepts it without throwing.
   `listDraftableSets` surfaces the cube as a selectable Pack Source carrying its
   available-card count N (`isCube: true`, `availableCardCount: N`) — NOT an
   Incompleteness "N missing" disable. A cube is curated, not a set to complete;
   applying a completion incentive to it would be a category error.

3. **Strict singleton sampling, table capped to fit the pool.** The pool is
   shuffled once from the raw **event seed** (`makeRng`, deterministic) and each
   round consumes a disjoint contiguous slice of that single shuffle (starting
   cursor `round × seats × 15`). As long as the whole draft
   (`seats × 15 × rounds`) fits within the pool, no index is revisited — every
   card appears **at most once across the entire draft** (a real cube).
   **Revision (one-copy-max is a hard invariant):** rather than dealing a card
   twice when the table can't be filled singleton from the implemented pool,
   the seat count is **capped at creation** — `createLimitedEvent` rejects a
   cube config whose `seats > maxCubeSeats(poolSize, 15, rounds) =
⌊poolSize / (15 × rounds)⌋`, and the create dialog clamps the seat control
   to the same cap. At 283 implemented cards over 3 boosters that cap is
   `⌊283 / 45⌋ = 6` seats; it lifts automatically toward the full 8-seat table
   as the pool grows past 360. The with-replacement top-up in
   `dealCubeRoundPacks` (surfaced by `cubeSampleRegime`) is retained only as
   defense-in-depth for the pathological sub-pack pool a creatable event can no
   longer reach.

4. **Draft-only.** The pool-as-source path is wired into the draft engine
   (`generateRoundPacks`), not the Sealed pool generator. The create-event UI
   makes the cube selectable only for Draft; Sealed keeps its per-set path.

Everything downstream is unchanged: a cube pack card's `scryfallId` is its
canonical Card ID, which `resolveCardMeta` / the Bot Drafter's `getCardEvalMeta`
resolve exactly as for a set card, so the pick loop, bot auto-picks, timers, and
pool projection all work with no cube-specific plumbing.

## Consequences

- A Vintage Cube draft runs today against the 283 implemented cube cards, with
  no gate and no minimum, and improves automatically as cube cards are added.
- The singleton invariant is exact and deterministic (seeded), so a cube draft is
  replayable from the one event seed — same as a set draft.
- The cube is a second Pack Source **kind**, not a fake set. Future pools (a
  different cube, a jumpstart-style pool) can reuse the same `cube.ts` shape:
  a name list + `buildCubePool` + `dealCubeRoundPacks`.
- Trade-off: the full 8-seat table depends on pool growth. Until the
  implemented pool reaches 360, the cube caps at 6 seats (3 boosters) — a
  smaller table, never a repeated card. The one-copy-max invariant wins over
  table size; the cap self-lifts as cube cards land.

## Alternatives considered

- **Fabricate a per-set `BoosterConfig` with one big "cube" sheet.** Rejected:
  the sheet model samples with-replacement (a real booster can hold two copies of
  a common) — the opposite of a cube's singleton guarantee — and would still be
  subject to (or require special-casing out of) the ≥80% gate. A pool is a
  fundamentally different object; modeling it as a set sheet fights the grain.
- **Deal with-replacement at oversized tables (the original decision #3).**
  Superseded: it produced duplicate cards in an 8-seat draft (283 < 360), which
  breaks the defining property of a cube — one copy of each card. Capping the
  seat count to what the pool fills singleton keeps the invariant exact while
  still "working from day one" at any pool size (just a smaller table), so it is
  strictly better than repeating cards.
- **Hard-block the cube entirely until the pool covers a full 8-seat table.**
  Rejected: it violates "no minimum — must work from day one". The seat cap is
  the middle path — a 6-seat cube draft runs today, singleton, and grows to 8
  automatically.
