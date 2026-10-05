// The compiled-ready pool as a BUNDLED module — the SERVER half of ADR 0113
// §2's asymmetric delivery, and the one module in the tree that imports
// `data/oracle-compiled-pool.json`.
//
// It is split out from `compiledCatalogue.ts` for exactly one reason: it is
// the seam the CLIENT build replaces. `vite.config.ts` aliases the specifier
// `./compiledPool` to `src/lib/catalogue/compiled-pool.browser.ts` (an empty
// array), so neither the `card-catalogue` chunk nor the `brain.worker` bundle
// carries a byte of card definition data; the client fetches the merged,
// content-addressed artifact instead (`src/lib/catalogueArtifact.ts`,
// issue #3053). The alias matches a RELATIVE specifier, so this module must
// keep exactly one importer — pinned by
// `scripts/__tests__/compiled-pool-client-seam.test.ts`.
//
// A Convex mutation cannot fetch (ADR 0113 § "Server and client have opposite
// cost functions"), so the server keeps the import. Its bound is the Convex
// function bundle limit, guarded by `bun run check:convex-bundle` — see
// ADR 0113 § Amendment (issue #3051).
import type { CardDefinition } from "./types";
import {
    createPackedLookup,
    type PackedCorpus,
    type PackedLookup,
} from "./packedCorpus";
import compiledPool from "../../data/oracle-compiled-pool.json";
import packedCorpus from "../../data/catalogue/packed-corpus.json";

/** The compiled-ready pool, exactly as `scripts/catalogue-artifact.ts` wrote
 *  it: full `CardDefinition[]` shape (the join already resolved `id` +
 *  `rarity` from `data/card-index.json`; that script's own header explains why
 *  those two fields — and no others — are added on top of the compiler's
 *  `CompiledDefinition`).
 *
 *  These rows are the client artifact's compiled rows, FILTERED — the same
 *  objects from the same merge, not a second derivation (issue #3055). The
 *  source hash they were generated from is
 *  `CATALOGUE_SOURCE_HASH` in `./compiledCatalogue`, and
 *  `scripts/__tests__/catalogue-artifact.test.ts` compares the two renderings
 *  byte for byte in the gate. */
export const compiledReadyDefinitions: CardDefinition[] =
    compiledPool as unknown as CardDefinition[];

/** The SAME rows, packed (issue #4164): sorted by id, deflated in fixed-size
 *  blocks against one shared dictionary, carried as one string. Imported HERE
 *  and nowhere else for the same reason the literal is — this module is the
 *  one the client build aliases away — and decoded by `./packedCorpus`.
 *
 *  Both renderings ship side by side while the switch below exists: the
 *  equivalence test over the whole pool needs both, and deleting the literal
 *  import above is the LAST slice of PRD #4161's rollout order. */
export const packedServerCorpus: PackedCorpus | null =
    packedCorpus as unknown as PackedCorpus;

/**
 * THE SWITCH (issue #4165): which rendering serves a compiled row on first
 * request. On, `getDefinition` falls back to {@link packedServerCorpus} —
 * resident entry, then the packed row, then token synthesis — one block at a
 * time.
 *
 * Off by default: the row is read from the literal pool above, and no packed
 * block is ever inflated. Nothing is preloaded either way (issue #4856). Turned on per
 * deployment with the `TOLARIA_PACKED_CORPUS_LOOKUP=on` environment variable,
 * read once at module load (a change reaches a request once its module graph
 * is re-evaluated). The `typeof` guard is for the one runtime with no
 * `process` at all; the browser build never evaluates this module (its alias
 * exports `false`).
 *
 * Either way the catalogue-wide populations (the name lookup behind
 * `tryGetCardByName`, the Set codes, `getAllCatalogueCards`) come from the
 * Definition Index this corpus carries (issue #4856), never from the rows —
 * so neither rendering is walked at load.
 */
export const PACKED_CORPUS_LOOKUP: boolean =
    typeof process !== "undefined" &&
    process.env.TOLARIA_PACKED_CORPUS_LOOKUP === "on";

/** The lookup `getDefinition` falls back to when the switch is on, else
 *  `null`. Built HERE, behind the seam the client build aliases away, so
 *  neither the decoder nor `fflate` enters a client chunk. */
export const packedCorpusLookup: PackedLookup | null = PACKED_CORPUS_LOOKUP
    ? createPackedLookup(packedServerCorpus!)
    : null;
