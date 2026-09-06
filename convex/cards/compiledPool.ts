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
import compiledPool from "../../data/oracle-compiled-pool.json";

/** The compiled-ready pool, exactly as `scripts/oracle-pool.ts` wrote it:
 *  full `CardDefinition[]` shape (the join already resolved `id` + `rarity`
 *  from `data/card-index.json`; `scripts/oracle-pool.ts`'s own header
 *  explains why those two fields — and no others — are added on top of the
 *  compiler's `CompiledDefinition`). */
export const compiledReadyDefinitions: CardDefinition[] =
    compiledPool as unknown as CardDefinition[];
