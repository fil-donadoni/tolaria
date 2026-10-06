// The CLIENT half of ADR 0113 §2's asymmetric delivery (issue #3053), on the
// shared Definition Source since issue #4861 (ADR 0113 Amendment IV).
//
// `vite.config.ts` aliases the specifier `./compiledPool` — imported by
// `convex/cards/catalogue.ts` and by nothing else — to this module, in BOTH
// the app graph and the `brain.worker` graph (`resolve.alias` is shared with
// the worker build; `plugins` are not). The effect is that
// `data/catalogue/packed-corpus.json` never enters a client bundle: the main
// thread and the worker each FETCH the packed corpus as one immutable asset
// at the loading gate
// (`src/lib/catalogueArtifact.ts`) and hand it to `registerPackedCorpus`,
// which decodes a block on first request — the same rows, the same decoder
// as the server.
//
// It is deliberately empty rather than absent: `catalogue.ts` reads these at
// module load, so the two builds run the same code path and differ only in
// what it is handed.
import type { PackedCorpus, PackedLookup } from "@convex/cards/packedCorpus";

/** No BUNDLED corpus: it arrives as a fetched asset, after module load. */
export const packedServerCorpus: PackedCorpus | null = null;

/** No bundled lookup; the client's is built by `registerPackedCorpus`. */
export const packedCorpusLookup: PackedLookup | null = null;
