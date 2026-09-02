# The compiled-card store is the WHOLE corpus, resident: bundled server-side, one content-addressed immutable asset client-side — never lazy-by-id

## Status

accepted (settles the "separate grill" PRD #2693 deferred; supersedes that
PRD's "loaded lazily by id" contract line and the interim shape of ADR 0108 /
issue #2702)

## Context

PRD #2693 shipped the Oracle compiler but deliberately deferred where its
output physically lives:

> Loading is per deck (the definitions a game references), never the whole
> lockfile. … JSON rows keyed by definition id, immutable, loaded lazily by
> id. … The physical store for compiled rows (table vs shard asset, hot/cold
> split per the Convex usage model) is decided in a separate grill.

Issue #2702 shipped an explicitly interim shape instead: the whole
`ready` pool imported at module load, into both the Convex server graph and
the client bundle, guarded by a 2 MB size budget on
`data/oracle-compiled-pool.json` and gzip budgets on the two client chunks it
lands in (`scripts/check-bundle-size.ts`). Crossing those budgets was declared
"the intended signal to build that store, not to raise the number."

That signal is close. Measured 2026-09-02 on the committed artifact, after a
`oracle:compile` / `oracle:index` / `oracle:pool` regeneration:

|                                  | at #2702 landing | 2026-09-02      | budget      |
| -------------------------------- | ---------------- | --------------- | ----------- |
| `data/oracle-compiled-pool.json` | 1,094,857 B      | **1,681,196 B** | 2,000,000 B |
| pool rows                        | 1,429            | **1,957**       | —           |
| pool gzip                        | 119,661 B        | **179,245 B**   | —           |

The binding constraint is not the 2 MB pool budget (371 rows of headroom) but
the `card-catalogue` chunk: 533,558 B gzip at landing, plus the +59,584 B gzip
the pool has since grown, against a 620,000 B budget — roughly **290 rows of
headroom**, with six Premodern Tier 1 deck tickets (#2713–#2718) queued, each
of which makes more cards `ready`.

### The PRD's contract is not implementable as written

`getDefinition` / `tryGetDefinition` (ADR 0046) is **synchronous**, at 382
non-test call sites (48 in `convex/gre` alone), and
`.claude/rules/gre-development.md` § Code patterns mandates "Pure functions,
no async". `scripts/check-bundle-size.ts` already recorded why the eager
import stayed: an async/lazy load "would leave a real window where a compiled
card resolves as unknown mid-game, which is a correctness bug, not just a perf
one."

"Loaded lazily by id" and "synchronous seam" cannot both hold. The PRD never
noticed the collision. This ADR resolves it in favour of the synchronous seam,
which is what makes the engine deterministic and testable without async
fixtures.

### Server and client have opposite cost functions

The GRE runs in Convex **mutations**, which are deterministic transactions
with no network. A fetched asset is therefore impossible server-side; the only
options are the module graph or a table read. A table read is the Convex usage
model's known bug class — a game is hundreds of mutations, each needing the
deck's ~40 distinct definitions at ~859 B each, and putting them on
`game_state` would attach a fat cold field to the hottest reactive row in the
app. Bundling costs **zero reads, zero bandwidth, zero billing**: it is code,
not data.

The client can fetch. Its constraint is not total bytes but _bundle_ bytes —
the cold-load critical path. Same payload, different right answer.

### Measured, not assumed

Brotli and heap, measured 2026-09-02. Heap via
`performance.measureUserAgentSpecificMemory()` in real Chrome under
`crossOriginIsolated` (a post-GC measurement, not `performance.memory`), over
a corpus built by replicating the 2,199 real `ready` definitions to 34,890
rows with **uniquified `id` and `name`** so V8 string dedup could not flatter
the result:

| corpus                | rows   | JSON         | heap        | fetch | parse     | map build |
| --------------------- | ------ | ------------ | ----------- | ----- | --------- | --------- |
| real `ready` (today)  | 2,199  | 763,663 B    | **1.6 MB**  | 5 ms  | 3 ms      | 0 ms      |
| synthetic full corpus | 34,890 | 13,880,383 B | **29.5 MB** | 30 ms | **49 ms** | 9 ms      |

Linearity check: 1.6 MB × 34890/2199 = 25.4 MB against 29.5 MB measured (the
synthetic rows carry longer unique names). Consistent.

Wire size, using the Brotli ratio measured on the 2,199 **real and diverse**
definitions (12.7x) rather than on the synthetic (which compresses 55.7x
through repetition): **~1.09 MB Brotli for all 34,890 compiled definitions.**

So the "35k rows" case `oracle-pool-size.test.ts` treats as catastrophic is,
measured: ~1 MB over the wire, ~100 ms to become resident, ~30 MB of heap.

Two reservations are recorded rather than hidden. First, today's `ready` cards
are the _simple_ ones — it is because they are simple that they compile — so
per-row cost will rise as the compiler advances; 30 MB is a measured floor,
and a fully compiled corpus is plausibly 45–60 MB. Second, the ~1.09 MB is an
extrapolation from a real sample, not a measurement of a real 34,890-row
compiled corpus, which does not exist yet.

### Comparison with phase.rs

Verified against the live deployment, not inferred. Their
`https://data.phase-rs.dev/staging/card-data-a3e819dac5d8eb55.json` is
**35,798 entries, 100.3 MB raw, 7,969,870 B Brotli**, served
`cache-control: public, max-age=31536000, immutable` from a content-addressed
filename; the unhashed `/card-data.json` returns 404, exactly as
`client/vite.config.ts` states. It is fetched with a plain `fetch` into WASM
memory by the engine worker and by every AI worker — no IndexedDB, no Cache
API, no storage layer above the browser's HTTP cache.

Two corrections to earlier belief, recorded because both were wrong in this
project's own notes:

1. **phase.rs is AOT, not JIT.** `card-data.json` carries `abilities`,
   `triggers`, `static_abilities` and `replacements` as already-parsed typed
   AST (Lightning Bolt ships
   `{"kind":"Spell","effect":{"type":"DealDamage","amount":{"type":"Fixed","value":3},"target":{"type":"Any"}}}`).
   Their parser runs in the build pipeline, not in the user's client. Their
   `card-data.json` is our Oracle Lockfile. The real difference with them is
   fail-closed versus permissive parsing, not when they parse.
2. Their entries are **2,802 B each against our 347 B** because they bundle
   `legalities`, `printings`, `rarities` and printing metadata that we keep
   separate in `card-index.json` and the Full Catalogue. Our whole-corpus
   payload is ~7x lighter than theirs.

They arrived independently at the delivery shape this ADR adopts.

## Decision

### 1. `getDefinition` stays synchronous; the store is pre-hydrated, never lazy-by-id

PRD #2693's "loaded lazily by id" line is superseded. The store is hydrated
in full at a known `await` point before any synchronous consumer can run. What
that PRD actually wanted was _not shipping 35k rows in the bundle_; a
pre-hydrated asset delivers that without touching the seam.

### 2. Delivery is asymmetric — bundled server-side, fetched client-side

- **Server (Convex):** compiled definitions stay in the module graph. Zero
  reads, zero bandwidth, zero billing. The bound is the Convex function bundle
  limit, **not** the 2 MB artifact budget, which was a client-bundle proxy all
  along. That limit is unverified and must be measured before the corpus grows
  into it.
- **Client:** one **content-addressed, `immutable`** static asset, fetched at
  the loading gate. It leaves the `card-catalogue` and `brain.worker` chunks
  entirely, so both return to their pre-#2702 baselines instead of growing.

The asymmetry's price is drift: the server module and the client asset could
disagree, which is the worst bug class available here (the client is only a
view, but the Brain decides moves). It is paid with a mechanical guard — one
generator, one hash, and a gate check asserting the two are byte-identical —
in the same spirit as `check-card-index.ts` and `check-oracle-lockfile.ts`.

### 3. The client loads the WHOLE corpus, not a per-game slice

At ~1 MB and ~100 ms, a slice buys nothing and costs a second state. A
per-slice design forces every caller to distinguish "definitions present" from
"not yet" — which is precisely the correctness window #2702 refused. One
state, resolved before the app renders, is worth 30 MB.

Consequence: the hot/cold split **dissolves client-side**. The deck builder
needs no rewiring (`src/lib/deckCardShape.ts`'s registry→catalogue chain stays
as it is), and the Card Zoom Overlay's engine view (issue #2704) needs no
lazy per-card channel — the definition is simply there, synchronously.

### 4. The search index stops being a Convex query

`api.cardIndex.list` is measured at **2,051 rows / 1,605,676 B raw /
248,393 B gzip**, shipped over the Convex wire on every cold load, per user —
the largest read in the app, and fully derivable from the repo. It becomes
part of the same static asset.

The reactivity this gives up (`convex/cardIndex.ts`'s "deploy a new card and
it appears in the builder on the next query refresh") is **already half
broken**: a new card touches `convex/cards/sets/**`, which lives in both
graphs, so a deployed card's index row arrives live while its definition
does not — the open client still holds the old bundle. Paying a Convex read
per cold load for half-delivered reactivity is worse than not having it.

Unlike `data/full-catalogue.json.gz` (gitignored, because it derives from an
external Scryfall bulk), this asset derives from the repo, so it is
**committed** — reproducible, diffable, reviewable, and unable to go missing
the way the `catalogue:ensure` class of failure allows.

### 5. Caching is two regimes and one island — never a TTL on Convex data

| Class          | Contents                                                              | Changes when             | Mechanism                            | Expiry                   |
| -------------- | --------------------------------------------------------------------- | ------------------------ | ------------------------------------ | ------------------------ |
| **Static**     | Compiled Pool, hand-written definitions, search index, Full Catalogue | a deploy / regeneration  | content-addressed asset, `immutable` | **never**                |
| **Reactive**   | user decks, cube membership, banned/restricted lists, game state      | a DB write               | Convex subscription                  | **none — never a clock** |
| **TTL island** | third-party responses (Scryfall text search)                          | never, for a given query | in-memory LRU + `sessionStorage`     | hours                    |

A TTL over Convex-backed data is not an optimisation but a correctness
regression: the subscription already pushes the change, so a clock can only
make the client staler than doing nothing. For immutable content-addressed
data a TTL is equally wrong in the other direction — the URL changes when the
content does, so the correct expiry is forever. The only place a number is
chosen is the third row.

### 6. The hybrid is permanent, and that is the design

`resolve()` remains ADR 0045's escape hatch for protocol-like cards, so a
functions-carrying residue never disappears. Measured over the 2,051
hand-written definitions:

|                                                        | count   | share |
| ------------------------------------------------------ | ------- | ----- |
| serializable as data **today**, unchanged              | **885** | 43.1% |
| carry a function somewhere                             | 1,166   | 56.9% |
| — of which top-level `resolve`/`resolveSteps`/`effect` | 80      |       |
| — of which only nested predicates                      | 1,069   |       |

Of the 885, only 95 are vanilla — **790 carry real abilities** and are already
fully declarative. The blocker is therefore not the 80 protocol cards but the
nested predicate surface (`triggeredAbilities[].matches` 560,
`staticEffects[].applies` 215, `triggeredAbilities[].resolve` 219,
`activatedAbilities[].effect` 162), which is exactly what the compiler's
declarative slots replace.

So the client carries two forms — asset (data) and bundle (code) — for as long
as the project exists. The asset's share grows as issue #2703 retires proven
duplicates; it never reaches 100%, and is not meant to.

## Consequences

- **The 2 MB pool budget and the two gzip chunk budgets stop being the
  trigger they were designed to be.** They guard a bundle-time import that
  this ADR removes. They are replaced by a budget on the served asset plus the
  server/client identity guard.
- **The bundle wins are large.** The 1,104 non-test set sources are 5.10 MB of
  TypeScript; the same definitions serialize to 1,416,809 B raw / 255,780 B
  gzip / **168,773 B Brotli** — roughly 40% smaller as data than as code, and
  zero in the bundle once fetched instead of imported. At full migration the
  `card-catalogue` and `brain.worker` chunks shed their card payload
  (533,558 + 682,833 B gzip today), replaced by one ~1 MB Brotli asset fetched
  once and cached for a year. The worker stops duplicating it.
- **Game processing speed is unchanged.** `getDefinition` is a `Map` lookup
  either way and the GRE never re-parses. Whether an interpreted Effect Script
  costs measurably more per resolution than a hand-written closure calling
  primitives directly is unmeasured, and is a question for the migration
  (issue #2703), not for this ADR.
- **Deck-builder search gets faster by losing a round-trip**, not by changing
  format — the filter is already an in-memory `useMemo`
  (`src/components/lobby/deck-builder/useCardSearch.ts`). A second, larger win
  is that mechanics become filterable at all: `power > 3` is not expressible
  today because `CardIndexRow` carries no `power`/`toughness`.
- **A loading gate becomes load-bearing.** `src/components/ui/loading-screen.tsx`
  already exists on the lobby, `/limited`, join and the Pool builder; the
  fetch hides inside it. The Brain's Web Worker awaits the same asset before
  its first response — its channel is already `postMessage` request/response
  (`src/lib/ai/brain-client.ts`), so no caller changes.
- **Heap is the number to watch**, not wire size: ~1.6 MB today, ~30 MB
  measured at 34,890 rows, plausibly 45–60 MB once complex cards compile. If
  that ceiling is ever reached, the fallback is a per-slice store — and
  re-introducing the second state this ADR spent 30 MB to avoid.
- **The served asset must be minified.** `data/oracle-compiled-pool.json` is
  859 B/row as committed against 347 B/row for the raw definitions: roughly
  60% of the committed file is prettier whitespace.
- **ADR 0108 §3's exclusion is unaffected in principle but overtaken in
  practice.** Compiled rows still do not join `getAllCards()`; what changes is
  that the deck builder no longer needs them to, because the search index is
  generated from the same source as the asset rather than from that
  population.

## Open, deliberately not decided here

- The Convex function bundle limit — unverified; the server-side "bundling is
  free" claim is bounded by a number nobody in this repo has measured.
- Whether retiring a hand-written card in favour of its proven-equal compiled
  twin (issue #2703) is safe when ADR 0108 §4 makes the hand-written
  definition permanently authoritative — retirement deletes the very artifact
  that authority refers to. That is the next grill.
