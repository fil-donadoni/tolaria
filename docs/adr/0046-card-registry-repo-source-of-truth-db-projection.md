# Card registry: repo as source of truth, DB as a rebuildable projection

## Status

accepted

## Context

All 1,180 card definitions are TypeScript compiled into the Convex bundle and
loaded by every game mutation. This is fine today and impossible at 80k
(bundle size, cold starts, Convex function limits). Draft/sealed also need
pool _queries_ ("all red uncommons of set X") that module imports cannot
answer. But the entire high-throughput workflow — per-colour set files
(ADR 0043), PR-diff review, vitest importing card modules, the agentic
worklist (ADR 0041) — is built on files in git, and it is the best-working
part of the system. Two fears drove the decision: losing git's recoverability
if cards live in a DB, and paying Convex read/bandwidth on every mutation if
definitions are fetched per action (bandwidth has already hurt once).

## Decision

**Cards live in the repo forever; the DB, when it arrives, is a derived,
rebuildable projection — never the source of truth.** Same model as
`card-index.json`: regenerated via backfill, never hand-edited, guarded
against drift.

Fixed now, at near-zero cost:

1. **`effects[]` must be pure JSON** — no functions, no non-serializable
   values. A guard test round-trips every Effect Script through
   `JSON.stringify`. Every DSL-only card is thereby already a DB row waiting
   to happen, even while it lives in a `.ts` file.
2. **Single registry interface.** All consumers resolve definitions through
   one `getDefinition(cardId)` seam; no consumer imports set modules
   directly. Today it is an in-code map; later a cache + DB read — consumers
   never know.
3. **The GRE never goes async because of the registry.** Definitions are
   hydrated once at the mutation entry point (from module-level cache or DB)
   into an in-memory map; the engine works synchronously on it. Definitions
   are immutable, so caching needs no invalidation.

Deferred until the trigger — **draft/sealed work starts, or bundle size
hurts, whichever first**:

- The backfill: a sync script projects DSL-only cards into a Convex table
  with a content-hash per card; a drift guard (CI) compares repo hash ↔ DB
  hash. Lose the table → regenerate with one command.
- DB rows are immutable and versioned (new version = new row); a game pins
  its definition versions at creation, so errata never change a running game
  and event-log replays stay deterministic.
- `resolve()` cards (the escape hatch) stay in-code permanently — closures
  cannot serialize. The registry is two-tier by design.

Rejected: DB-now (breaks the working pipeline today to solve a ~10k-card
problem, and forces async into the GRE); separate `.json` card files (splits
every set into two file kinds and trades TS type-checking of `effects[]` for
a schema validator — the purity guard test buys serializability without the
friction).

## Consequences

- Git review, rollback, and history remain exactly as strong after the DB
  arrives as before it: a card change is always a PR diff.
- Never embed definitions in `game_state` — it is rewritten at every stable
  point and would multiply write bandwidth. Definitions travel via the
  registry seam only.
- Steady-state Convex cost of the future DB registry is ~zero: immutable
  definitions + module-level cache mean an active game reads definitions
  from the DB approximately once.
- The migration cost is paid when the benefit exists, and by then it is
  mechanical, not architectural.
