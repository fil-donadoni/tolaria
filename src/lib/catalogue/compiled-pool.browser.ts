// The CLIENT half of ADR 0113 §2's asymmetric delivery (issue #3053).
//
// `vite.config.ts` aliases the specifier `./compiledPool` — imported by
// `convex/cards/catalogue.ts` and by nothing else — to this module, in BOTH
// the app graph and the `brain.worker` graph (`resolve.alias` is shared with
// the worker build; `plugins` are not). The effect is that
// `data/oracle-compiled-pool.json` never enters a client bundle: the pool
// leaves the `card-catalogue` chunk and `brain.worker`, and the client gets
// the same rows — plus the relocated hand-written ones — by FETCHING the
// merged content-addressed artifact at the loading gate
// (`src/lib/catalogueArtifact.ts`).
//
// It is deliberately empty rather than absent. `catalogue.ts` still calls
// `registerCompiledDefinitions` at module load with whatever this exports, so
// the two builds run the same code path and differ only in what it is handed.
import type { CardDefinition } from "@convex/cards/types";
import type { PackedCorpus, PackedLookup } from "@convex/cards/packedCorpus";

/** Nothing at module load on the client. The rows arrive from the fetched
 *  artifact, before anything that reads the registry renders. */
export const compiledReadyDefinitions: CardDefinition[] = [];

/** No packed corpus either: the client holds the whole corpus from the fetched
 *  artifact, and a lookup fallback would have nothing to add (issue #4165). */
export const packedServerCorpus: PackedCorpus | null = null;

/** The server-only lookup switch, always off in a client graph. */
export const PACKED_CORPUS_LOOKUP: boolean = false;

/** No lookup to fall back to. */
export const packedCorpusLookup: PackedLookup | null = null;
