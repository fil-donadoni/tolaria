// The packed compiled corpus as a BUNDLED module — the SERVER half of
// ADR 0113 §2's asymmetric delivery, and the one module in the tree that
// imports `data/catalogue/packed-corpus.json`.
//
// It is split out from `compiledCatalogue.ts` for exactly one reason: it is
// the seam the CLIENT build replaces. `vite.config.ts` aliases the specifier
// `./compiledPool` to `src/lib/catalogue/compiled-pool.browser.ts` (an empty
// stub), so neither the `card-catalogue` chunk nor the `brain.worker` bundle
// carries a byte of card definition data; the client FETCHES the same packed
// corpus as an asset instead (`src/lib/catalogueArtifact.ts`, issue #4861).
// The alias matches a RELATIVE specifier, so this module must keep exactly
// one importer — pinned by
// `scripts/__tests__/compiled-pool-client-seam.test.ts`.
//
// A Convex mutation cannot fetch (ADR 0113 § "Server and client have opposite
// cost functions"), so the server keeps the import. Since issue #4168 it is
// the ONLY rendering of the compiled rows the server holds: the pretty-printed
// literal pool (`data/oracle-compiled-pool.json`) is retired, and with it the
// per-request cost of evaluating it (+9.6 ms on cloud at 3k rows, growing with
// every row — ADR 0113 Amendment III, PRD issue #4161). Its bound is the
// Convex function bundle, guarded by `bun run check:convex-bundle`.
import {
    createPackedLookup,
    type PackedCorpus,
    type PackedLookup,
} from "./packedCorpus";
import packedCorpus from "../../data/catalogue/packed-corpus.json";

/** The compiled-ready rows, packed (issue #4164): sorted by id, deflated in
 *  fixed-size blocks against one shared dictionary, carried as one string,
 *  with the compiled section of the Definition Index beside them (issue
 *  #4856). Written by `scripts/catalogue-artifact.ts` from the catalogue
 *  merge, whose decode-equality guard (`packedCorpusDrift`,
 *  `scripts/lib/packed-corpus.ts`) is the standing proof that it decodes to
 *  exactly the merge's server rows. `null` only in the client stub. */
export const packedServerCorpus: PackedCorpus | null =
    packedCorpus as unknown as PackedCorpus;

/** The lookup `getDefinition` reads a compiled row from — resident entry,
 *  then the packed row, then token synthesis — one block at a time, on first
 *  request; nothing is preloaded (issue #4856). Built HERE, behind the seam
 *  the client build aliases away; the client builds its own from the corpus
 *  it fetches (`registerPackedCorpus`, issue #4861). */
export const packedCorpusLookup: PackedLookup | null =
    packedServerCorpus !== null ? createPackedLookup(packedServerCorpus) : null;
