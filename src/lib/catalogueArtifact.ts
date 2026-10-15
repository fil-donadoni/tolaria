// The client's half of ADR 0113 §2: the card catalogue arrives as ONE
// immutable asset, FETCHED once, instead of being imported into the bundle
// (issue #3053).
//
// WHY A FETCH AND NOT AN IMPORT. A Worker gets its own module graph, so an
// imported corpus would be paid twice on every cold load — in the app's chunk
// and in `brain.worker` — and re-downloaded whenever the app code changes.
// The rows are data, and data belongs in an asset the browser caches for a
// year.
//
// WHAT IT FETCHES — ADR 0113 Amendment IV, issue #4861. The PACKED corpus,
// the very file the server bundles (`data/catalogue/packed-corpus.json`):
// the compiled section of the Definition Index plus every row, deflated in
// blocks. `registerPackedCorpus` reads the index and decodes a block the
// first time one of its cards is asked for, so a game holds the definitions
// of its own cards and never the whole catalogue — in the page AND in the
// Bot worker, which runs this same module in its own graph. This supersedes
// § 3's whole-corpus hydration (~30 MB of heap at 34,890 rows, per context).
// `getDefinition`/`tryGetDefinition` stay SYNCHRONOUS (§ 1): the packed data
// is resident before any consumer runs, so no caller ever sees "not yet".
//
// WHY A `?url` IMPORT AND NOT A COMMITTED URL CONSTANT. Vite emits the file as
// an asset whose name carries its CONTENT hash and hands back that URL, so
// the asset is immutable by construction and a regenerated corpus re-points
// the URL with nothing to keep in sync. The packed corpus's own `sourceHash`
// is the generation it belongs to; the emitted name is the cache key.
import packedCorpusUrl from "../../data/catalogue/packed-corpus.json?url";
import type { PackedCorpus } from "@convex/cards/packedCorpus";
import {
    registerPackedCorpus,
    resolveDeckCardMeta,
} from "@convex/cards/catalogue";
import { bindDeckCardMetaResolver } from "~/lib/catalogue/deck-card-meta.browser";
import { installAllSets } from "~/lib/catalogue/definitionShards";
import { fetchJsonAsset } from "~/lib/fetchJsonAsset";

// `convex/formats.ts` gets a late-bound `resolveDeckCardMeta` in the browser
// build (`vite.config.ts` → `formats-cards-browser-seam`, issue #4854); this
// module is the one that loads with the catalogue, so it binds the real one.
bindDeckCardMetaResolver(resolveDeckCardMeta);

/** The packed corpus's emitted asset URL. A function so a test can name it
 *  without reaching into the import. */
export function catalogueArtifactUrl(): string {
    return packedCorpusUrl;
}

let corpus: Promise<number> | null = null;
let corpusHydrated = false;
let hydration: Promise<number> | null = null;
let hydrated = false;

/** Whether the packed corpus is installed in this graph:
 *  `hydrateCompiledCorpus()` has resolved. The game route's gate renders on
 *  the FIRST frame when the Setup flow's prefetch already fetched it. */
export function isCompiledCorpusHydrated(): boolean {
    return corpusHydrated;
}

/** Whether the WHOLE catalogue is installed in this graph:
 *  `hydrateCatalogue()` has resolved. Lets the gate render its children on
 *  the FIRST frame when a prefetch already did the work (issue #5584),
 *  instead of a loading screen for the tick its own `then` takes. */
export function isCatalogueHydrated(): boolean {
    return hydrated;
}

/**
 * Fetch the packed corpus and install it, once per document (or per Worker):
 * the COMPILED half of the catalogue, still one whole asset (PRD #5602's next
 * slice shards it). The game route's gate awaits this and the Sets of its
 * Definition Manifest (`src/lib/catalogue/definitionShards.ts`), never the
 * whole catalogue.
 *
 * Promise singleton; a rejection is not memoised, so a retry really
 * re-fetches. Resolves with the number of compiled cards the corpus added —
 * the honest "did the fetch do anything" signal. Nothing is decoded here: a
 * row is inflated when a card of its block is first asked for.
 */
export function hydrateCompiledCorpus(): Promise<number> {
    if (corpus === null) {
        corpus = fetchCatalogue().catch((error: unknown) => {
            corpus = null;
            throw error;
        });
    }
    return corpus;
}

/**
 * The WHOLE catalogue resident: the packed corpus fetched and every
 * hand-written Set chunk installed (issue #5615). What a whole-catalogue
 * surface awaits — the deck builder, deck detail, the Draft Lab, admin, the
 * join antechamber — and the Brain's Worker in its own graph, until its own
 * slice gives it a per-game Manifest.
 *
 * Promise singleton: the loading gate awaits it. A rejection is not memoised
 * — the gate offers a retry, and a retried load must actually re-load.
 *
 * Resolves with the compiled count of {@link hydrateCompiledCorpus}.
 */
export function hydrateCatalogue(): Promise<number> {
    if (hydration === null) {
        hydration = Promise.all([hydrateCompiledCorpus(), installAllSets()])
            .then(([installed]) => {
                hydrated = true;
                return installed;
            })
            .catch((error: unknown) => {
                hydration = null;
                throw error;
            });
    }
    return hydration;
}

async function fetchCatalogue(): Promise<number> {
    const url = catalogueArtifactUrl();
    const packed = await fetchJsonAsset(url, "catalogue artifact");
    if (!isPackedCorpus(packed)) {
        throw new Error(`catalogue artifact ${url} is not a packed corpus`);
    }
    const installed = registerPackedCorpus(packed);
    corpusHydrated = true;
    return installed;
}

/** The fields the decoder and the index read, present and non-empty — a
 *  truncated or foreign body is refused here, with the URL, rather than
 *  throwing out of the first `getDefinition` mid-render. */
function isPackedCorpus(value: unknown): value is PackedCorpus {
    const p = value as Partial<PackedCorpus> | null;
    return (
        typeof p === "object" &&
        p !== null &&
        typeof p.blocks === "string" &&
        typeof p.dictionary === "string" &&
        Array.isArray(p.blockOffsets) &&
        Array.isArray(p.firstIds) &&
        Array.isArray(p.ids) &&
        Array.isArray(p.names) &&
        Array.isArray(p.setCodes) &&
        p.ids.length > 0 &&
        p.ids.length === p.names.length &&
        p.ids.length === p.setCodes.length
    );
}

/** TEST-ONLY. Drops the memoised promise so a test can drive the fetch again.
 *  Production has exactly one hydration per graph and never needs this. */
export function resetCatalogueHydrationForTests(): void {
    corpus = null;
    corpusHydrated = false;
    hydration = null;
    hydrated = false;
}
