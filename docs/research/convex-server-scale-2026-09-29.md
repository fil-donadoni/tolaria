# Convex server scale: the per-call heap is the first wall (2026-09-29)

PRD: issue #4849. Analysis done right after issue #4811 (the multi-dot rename that took the
bundle from 30.01 to 19.84 MiB). The question was what else limits the engine
on its way to the target scale of ~35k cards / ~80k printings, so that the
platform never has to change. The decisions it led to are ADR 0113
Amendment IV; this file holds the measurements, the method and the things
deliberately NOT done, with the numbers that would re-open them.

## Headline

The binding limit is not the size of the pushed bundle. It is the **RAM of
one function call**. Convex documents (docs.convex.dev/production/state/limits,
read 2026-09-29):

- Convex runtime: **64 MiB RAM**; Node.js runtime: 512 MiB
- query/mutation execution time: **1 second** of user code
- code size: 32 MiB (documented, not enforced; ADR 0113 Amendment III)
- document size: 1 MiB

Module globals do not survive a call (ADR 0113 Amendment III measured it on
cloud), so every call to any function of a module re-materialises everything
that module evaluates at load. For `convex/game.ts` that is today **~41 MiB of
the 64**, and the compiled pool, as an object literal, grows it by ~3.2 KB per
row: at 35k rows the module alone needs ~137 MiB.

## Method

All numbers below are V8 heap deltas measured in Node 22 (`node --expose-gc`,
heap used after `gc()` before and after `await import(game.js)`), on a bundle
produced by esbuild with the Convex CLI's own options (the ones copied into
`scripts/lib/convex-bundle-size.ts`: `platform: browser`, `format: esm`,
`minifySyntax`, `minifyIdentifiers`, `keepNames`, no whitespace minify).
Variants were produced WITHOUT touching the tree, by esbuild `onLoad` plugins
that substitute a module's contents in memory:

- the compiled pool: `oracle-compiled-pool.json` replaced by `[]`, by itself,
  or by N synthetic rows (existing rows cycled, `id` and `name` uniquified,
  4-space formatting kept);
- the hand-written sets: every `sets/<code>/index.cards.ts` replaced by
  `export {}`;
- lazy definitions: every line `export const X: CardDefinition = {` rewritten
  to `export const X = () => ({` and its closing `};` to `});` (1,966 of 2,152
  definitions match the one-line anchor);
- the bot test corpus: `gre/ai/blade/registry.ts` replaced by empty exports.

**Caveat: Node is a proxy for the Convex isolate.** The cloud probe (issue
#4852, § Cloud calibration) measured the isolate at ~0.6x the Node heap delta
(0.65 at most): the Node figures below overstate a call's heap.

Timings were also taken, but the machine load average was 15–31 during the
session, so eval times are noise and are not used for any conclusion.

## Measurements

### Heap of one call to `game.ts`, decomposed

| variant                                                | heap     |
| ------------------------------------------------------ | -------- |
| engine only (no hand-written sets, empty pool)         | 11.6 MiB |
| + hand-written sets (2,091 cards, ~6.9 KB each)        | 25.7 MiB |
| + compiled pool, 4,335 rows (~3.2 KB each) = today     | 39.5 MiB |
| same, emitted as the real deploy (452 entries, chunks) | 41.1 MiB |
| today minus the `gre/ai/blade` registry                | 38.0 MiB |
| pool at 35,000 synthetic rows                          | 137 MiB  |

With ~10 MiB left for game state and the work of the mutation, the literal
pool reaches the wall at **~9,000 rows**, about twice today's count.

### Hand-written definitions, isolated (all 152 sets, one synthetic entry)

| variant                                               | heap     |
| ----------------------------------------------------- | -------- |
| as today (every definition built at load)             | 17.3 MiB |
| definitions as thunks (built on first call)           | 10.1 MiB |
| definitions AND the 1,409 `CardPrint` records thunked | 11.2 MiB |

Thunking saves 7.2 MiB. Thunking the `CardPrint` records makes it WORSE: a
function costs more than a small object. The records are cheap in heap; the
reason to delete them is structural (below), not their weight.

The thunk experiment also exposed the coupling that blocks lazy definitions:
the catalogue builds eager indexes over every definition at load
(`nameRegistry`, `allCards`, print aliases via `wirePrintAliases` →
`tryGetDefinition`, `printedBackFaceTriggers`, token synthesis). The build
failed exactly there. Removing the print alias (issue #4121) and moving the
indexes into a generated light index are prerequisites of lazy definitions.

### Which function modules pay for the catalogue

Of the function modules, 15 reach the compiled pool and the hand-written sets
(6.5–9.8 MiB of code each), including `game.ts` with 123 functions. Among
them are queries that need no card definition at all:

- `getGameTick`, the wake-up subscription (reads one ~0.3 KB row);
- `myActiveGame`, subscribed in the lobby by every signed-in user;
- `getJoinInfo`, `getGame`, `getSeatDeck`;
- `debugListBladeScenarios` and the blade load, which put the 527 KB bot test
  corpus (`gre/ai/blade/registry.ts`, 471 KB bundled, 1.5 MiB heap) into
  every game call.

`getPublicState` does need the engine (it computes legal actions), but only
for the ~120 cards of the game.

### Bundle composition (isolate graph, after issue #4811)

| part                        | MiB   |
| --------------------------- | ----- |
| JS emitted                  | 11.76 |
| of which: compiled pool     | 3.41  |
| of which: hand-written sets | 2.64  |
| of which: chunk import glue | 1.26  |
| source maps                 | 7.28  |

Source maps are 38% of the bundle, but the CLI hardcodes
`generateSourceMaps: true` (`convex/dist/esm/cli/lib/config.js`, convex
1.39.1): not a lever.

### Client (production `vite build`, 2026-09-29)

| asset                              | raw     | gzip    | when                          |
| ---------------------------------- | ------- | ------- | ----------------------------- |
| `index-*.js` (app + engine)        | 3.39 MB | 1.06 MB | every page, login included    |
| `card-catalogue-*.js` (hand sets)  | 1.85 MB | 475 KB  | `modulepreload` on every page |
| `catalogue-*.json` (compiled pool) | 2.75 MB | 516 KB  | fetched at startup            |
| `brain.worker-*.js`                | 2.60 MB | 688 KB  | games against the Bot         |
| `full-catalogue-*.json.gz`         | 1.14 MB | (gz)    | deck builder                  |

The worker has its own module graph, so it carries a second copy of the
hand-written sets and hydrates a second copy of the compiled catalogue. ADR
0113 § 3 measured ~30 MB of heap for the whole corpus at 34,890 rows: ~60 MB
in a game against the Bot, on a phone.

### Cloud calibration: the literal pool on a real isolate (issue #4852, 2026-10-06)

Measured on a throwaway Convex cloud dev deployment with
`bun scripts/convex-heap-probe.ts` (on demand, never a gate). A mutation whose
module imports the compiled pool as a JSON object literal (the shape the
server carried until issue #4168) at 4k, 9k, 12k and 35k synthetic rows,
beside an empty control mutation, both pushed in the same run.

**How the isolate's heap is read.** A Convex call exposes no heap counter,
only its failure. So both mutations first allocate `pad` chunks (arrays of
1,024 or 16,384 numbers), and a doubling-then-bisecting search finds the
largest padding a call survives — its room. The control's room minus the pool
module's room is the pool's cost, in chunks. A chunk's isolate size is
measured, not assumed: the control's room in double chunks (8 B per element
under every V8 layout) and in integer chunks came out equal, so the isolate
does NOT compress pointers (same layout as Node; a chunk is 8 B per element in
both). Node heap: the same module, bundled with the Convex CLI's esbuild
options, as a delta over the control (§ Method).

| rows   | `pool.json` | cloud result | OOM error text | latency delta, median / p90 | room left (chunks) | isolate heap | Node heap | isolate / Node |
| ------ | ----------- | ------------ | -------------- | --------------------------- | ------------------ | ------------ | --------- | -------------- |
| 4,000  | 4.4 MiB     | ok           | —              | +11.0 / +28.1 ms            | 9,904 / 10,559     | 5.1 MiB      | 9.2 MiB   | 0.56           |
| 9,000  | 9.9 MiB     | ok           | —              | +36.7 / +42.2 ms            | 9,077 / 10,559     | 11.6 MiB     | 20.0 MiB  | 0.58           |
| 12,000 | 13.3 MiB    | ok           | —              | +50.5 / +60.6 ms            | 8,512 / 10,559     | 16.0 MiB     | 26.5 MiB  | 0.61           |
| 35,000 | 38.8 MiB    | ok           | —              | +203.1 / +216.4 ms          | 4,596 / 10,559     | 46.7 MiB     | 75.8 MiB  | 0.62           |

Chunks of 1,024 elements (8 KiB, V8 regular space, beside the pool's own
objects); 20 interleaved rounds per size, 3 discarded. The replication with
16,384-element chunks (128 KiB, large-object space) gave the same picture:
ratios 0.65 / 0.65 / 0.65 / 0.63, control room 85.4 MiB, latency medians
+8.1 / +34.5 / +48.2 / +206.8 ms. A padded call past the room fails with
`JavaScript execution ran out of memory (maximum memory usage: 64 MB)`.

What it says:

- **No size fails on memory, 35k included.** The smallest failing row count
  is none of those pushed. The projected wall "near 9,000 rows" (§ Heap of one
  call) was the WHOLE `game.ts` module (engine + hand-written sets + pool)
  measured in Node, without the ratio. The pool alone takes 46.7 MiB of
  isolate at 35k.
- **The Node→isolate ratio is ~0.6** (0.56–0.65 over eight measurements; it
  rises with size, so it is not a fixed overhead): a Node heap delta
  overstates the isolate's by ~1.6x. The health heap check is to apply **0.65**,
  the highest measured, so it errs on the side of a failure. The ratio was
  measured on a JSON literal. The engine's code (closures, compiled
  functions) was not measured separately, which is one more reason to take
  the high end.
- **The room is ~83 MiB, not 64.** An empty module's call holds ~83 MiB of V8
  objects before the "64 MB" error. Whatever the runtime counts as its 64 MB,
  it is not the V8 heap that Node's `heapUsed` measures. A Node-measured budget
  is therefore conservative twice over (ratio, then room).
- **The first wall of the literal pool is TIME, not heap.** At 35k rows the
  padless call ran 830–840 ms of the 1 s user-code limit (Convex logs the
  warning) and added ~205 ms of latency per call; the delta grows ~6 ms per
  1,000 rows. Extrapolated, the time limit falls near ~42k rows of literal pool
  alone, and the heap room near ~60k. Amendment III's packed corpus answers
  both.
- Latency at today's size (4k): +8 to +11 ms per call, within Amendment III's
  100 ms budget; 35k is over it twice.

The throwaway project was created for this run only. The owner confirms its
deletion in the PR thread of issue #4852.

## Checked and fine

- The Bot searches in the client worker; no server function runs a search, so
  the 1 s limit is not at risk.
- Finished games are swept (`crons.sweepFinishedGames`); full-table
  `.collect()` reads exist only in backfills and admin queries on bounded
  tables.
- `gameStates` averages 7.1 KB (prod, 2026-08-17) against the 1 MiB document
  limit.

## Considered and NOT done: non-function entry points in the engine

380 of the 452 isolate entry points are pure engine modules (`gre/ai` 72,
`cards/abilities` 64, `oracle/grammar` 27, …), single-dot files under
`convex/` that the CLI treats as function modules, the same cause as issue
#4811. Building from the function modules only:

| build                      | bundle    | files | heap per `game` call |
| -------------------------- | --------- | ----- | -------------------- |
| all 452 entries (as today) | 19.04 MiB | 803   | 41.1 MiB             |
| function modules only      | 16.77 MiB | 132   | 41.6 MiB             |

No benefit per call; 2.3 MiB of bundle and ~380 user modules, neither near a
limit, for a move of the whole engine out of `convex/` (or a second rename of
~380 files) that touches every open PR. Not queued. **Re-open when any of
these holds:**

| trigger                                                  | today                  |
| -------------------------------------------------------- | ---------------------- |
| Convex enforces the 32 MiB code size AND bundle > 28 MiB | 19.8 MiB, not enforced |
| user modules > 2,000 (`MAX_USER_MODULES` = 4,096)        | 452                    |
| chunk fragmentation > 5 MiB of heap per call             | +1.6 MiB               |

The cheaper of the two moves, if it is ever needed: the engine to a top-level
`engine/` directory with an `@engine/*` alias, by a codemod like issue #4811's.

## Reproducing

The session's scripts were throwaway, but each is a few lines on top of
`discoverEntryPoints` (exported by issue #4811) and esbuild:

1. Build `convex/game.ts` (or all isolate entries, with `splitting: true`) to a
   directory with the options above, `sourcemap: false`, plus
   `{"type":"module"}` in a `package.json` there.
2. In a fresh `node --expose-gc`, `gc()`, read `heapUsed`, `await import()` the
   entry, `gc()`, read again. Take the minimum of three runs.
3. For a variant, add an esbuild plugin with `onLoad({ filter })` returning
   substitute `contents`; never edit the tree.
4. Bundle attribution: `metafile.outputs[*].inputs[*].bytesInOutput`; glue is
   an output's `bytes` minus the sum of its inputs.

The health guard the PRD adds is this procedure made permanent. The cloud
calibration is `bun scripts/convex-heap-probe.ts --deployment dev:<name>`
(header for flags; `--node-only` runs the Node half with no deployment) on a
throwaway project created and deleted as `docs/guides/catalogue-cloud-latency.md`
§ 1 and § 3 describe.
