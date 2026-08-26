# A compiled card's id is a Scryfall first-print id, joined through `card-index.json`, not an oracle-id-derived synthetic id

## Status

accepted

## Context

Issue #2702 (child of PRD #2693, the Oracle compiler) needed to hydrate the
compiler's `ready` rows through the same `getDefinition`/`tryGetDefinition`
seam (ADR 0046) hand-written cards use. The issue's own text framed the id
contract as "a compiled card's id is its oracle id-derived definition id,
stable across regenerations," and separately required "`card-index`
lockfile/backfill continue to work (compiled ids join the index)."

Those two clauses conflict with what the repo already enforces:

- Every hand-written `CardDefinition.id` is a **Scryfall print id**
  (`convex/cards/types.ts`), specifically the card's EARLIEST PAPER printing
  (ADR 0041 — "home set = earliest paper printing").
- `data/card-index.json` is keyed by that id, and
  `scripts/check-card-index.ts` (`check:index`, part of `check:pr`) asserts
  the registry's id set and the lockfile's id set match **both ways**, plus
  `scryfallId === firstPrintId` for every entry. A synthetic oracle-id-shaped
  id would fail this guard outright — it does not resolve at Scryfall, so it
  can never equal any `firstPrintId`.
- The compiler's own `CompiledDefinition` type
  (`convex/oracle/types.ts`) deliberately **omits** `id` and `rarity` — they
  are "printing/catalogue metadata no amount of grammar can derive from rules
  text." A compiled row has never carried a candidate id at all, oracle-id or
  otherwise; a "stable across regenerations" id had to come from somewhere
  outside the compiler.

A prior finding (`docs/findings/2695-oracle-id-join-alternative.md`,
written for a different ticket, #2695's legality join) noted that
`data/card-index.json` already carries `{ scryfallId, oracleId }` pairs and
could serve as an oracleId → id join table. That pairing is real but was
built for a DIFFERENT population: only the ~2,028 already-hand-written cards.
Checked against the 2026-08-26 lockfile, only 209 of the 1,638 compiled
`ready` rows' oracle ids were already present — the other 1,429 (87%) are
cards nobody has hand-written, so the existing pairing alone does not reach
them.

## Decision

### 1. A compiled card's id is the Scryfall id of its earliest paper printing — the SAME rule ADR 0041 already applies to hand-written cards, not a second scheme

`scripts/oracle-index-backfill.ts` (issue #2702) extends the existing
`data/card-index.json` — the SAME file `scripts/backfill-card-index.ts`
seeds for hand-written cards — with one row per compiled `ready` oracle id
not already indexed, resolved via Scryfall exactly as the hand-written
backfill resolves a reprint: `POST /cards/collection` for a fast path,
`GET /cards/search?order=released&dir=asc` for the slow "which print was
first" path when the representative print is itself a reprint. New rows
carry `source: "compiled"` so the guard (below) can tell them apart from a
hand-written entry, plus `rarity` (a hand-written row never needed it — a
`CardDefinition` already declares its own; a compiled row's `rarity` has
nowhere else to come from, `CompiledDefinition` excludes it by type).

**This is a deliberate divergence from the issue's literal wording.** An
oracle-id-derived id would be stable, but it would not be a Scryfall id, so
every consumer that already treats `CardDefinition.id` as a print id (image
lookup, `CardPrint` aliasing, `check-card-index.ts`'s own invariant) would
need a second code path for "this id is fake." Reusing ADR 0041's rule keeps
`CardDefinition.id` meaning ONE thing catalogue-wide, compiled or not.

### 2. `data/card-index.json` is the join — the same file, not a parallel index

"Compiled ids join the index" (#2702 acceptance criterion) is satisfied
literally: `scripts/oracle-pool.ts` reads `data/oracle-compiled.json`'s
`ready` rows and `data/card-index.json` together and writes
`data/oracle-compiled-pool.json` — a `CardDefinition[]` slice with `id` and
`rarity` filled in from the SAME lockfile a hand-written card's id is
checked against. There is exactly one `oracleId → id` table in the repo,
not two that could drift apart.

`scripts/check-card-index.ts`'s "extra / pollution" check — a card-index row
with no matching hand-written `CardDefinition` — is extended with one
exclusion: a `source: "compiled"` row is expected to have no hand-written
match, by construction, so it is no longer counted as pollution. Every other
invariant (`firstPrintId === scryfallId`, "missing" hand-written entries)
is unchanged and still computed only over the hand-written population.

### 3. Compiled rows join the `getDefinition` registry; they do NOT join `catalogue.ts`'s `allCards` / `getAllCards()`

`convex/cards/compiledCatalogue.ts` calls the SAME `preloadDefinitions` seam
`catalogue.ts` uses for hand-written cards, so `getDefinition` /
`tryGetDefinition` — the seam GRE, projections, Bot, Draft Lab and preview
all read (ADR 0046) — never distinguish compiled from hand-written. Debug
scenario name resolution (`convex/debugScenarios.ts`'s
`tryGetCardByName`) is extended the same way.

What compiled rows do NOT join is `allCards` / `getAllCards()` — the
catalogue-wide population several UNRELATED sweeps already walk (the full
asset catalogue builder, the migration classifier, `check-card-index.ts`'s
own "missing" direction). Folding 1,400+ more rows into that population is a
real, separate decision (which sweeps should see compiled cards, at what
size cost, gated by which of the catalogue-wide card tests) that PRD #2693
explicitly defers to the physical-store grill ("table vs shard asset,
hot/cold split... decided in a separate grill; this PRD fixes only the
contract"). Registering into `getDefinition` without widening
`getAllCards()` delivers everything #2702's acceptance criteria ask for
(lookup by id, lookup by name, wire projection, size-budgeted bundle
inclusion) without that wider, unscoped change.

### 4. A hand-written definition is always authoritative

A compiled row whose resolved id ALREADY belongs to a hand-written
`CardDefinition` is excluded twice: at generation time
(`scripts/oracle-pool.ts` skips any oracle id whose card-index entry has
`source !== "compiled"`) and at hydration time
(`convex/cards/catalogue.ts` filters `compiledReadyDefinitions` against the
live `allCards` id set before calling `preloadDefinitions`, so a hand-written
card added since the pool was last regenerated still wins). "Retiring" a
hand-written card in favour of its proven-equal compiled twin (PRD #2693
"Retirement of proven duplicates") is its own future PR, not a side effect of
this hydration.

## Consequences

- **The graduation test is now a triviality, by design — for the id.** "A
  compiled card that later becomes hand-written keeps its id" (#2702
  acceptance criterion) holds because the id was NEVER a function of
  compiled-vs-hand-written in the first place — it is ADR 0041's rule,
  computed once, from `data/card-index.json`, for every card regardless of
  source. There is nothing "compiled" about the id to lose on graduation.
  The `source: "compiled"` TAG on that same row is a separate fact, and one
  the id's stability says nothing about: `backfill-card-index.ts` matches
  existing rows by `scryfallId` and skips anything already present, so
  without an explicit clearing step a graduated row would keep reading
  `"compiled"` forever even though a real `CardDefinition` now backs it —
  under-counting the PRD #2693 pool metric
  (`oracle-compile.ts`'s `poolOracleIdsFromIndex`) and re-staging an
  already-implemented card into the worklist importer
  (`list-to-cards.mjs`'s `dedupByOracle`/`knownImplementedNames`), both of
  which read the tag as "still compiled-only." `graduateCompiledEntries`
  (`backfill-card-index.ts`, PR #2838 round 3) closes this: it clears
  `source` on any row whose id has joined the hand-written registry, run as
  part of every `backfill-card-index.ts` pass.
- **Data completeness is progressive, exactly like `card-index.json` always
  was.** `backfill-card-index.ts`'s own docstring already describes itself
  as idempotent/incremental ("re-run after adding cards the tool didn't
  index"); `oracle-index-backfill.ts` inherits the same shape. A `ready` row
  whose oracle id is not yet in `data/card-index.json` is excluded from the
  pool, not registered under a placeholder id — fail-closed, matching the
  compiler's own fail-closed contract (PRD #2693).
- **`getAllCards()`-driven sweeps are unaffected by this ticket** — a
  deliberate scoping decision, not an oversight; a future ticket that wants
  compiled cards in, say, the full-catalogue asset or the migration
  classifier's census makes that call explicitly, against its own size and
  correctness budget.
