// The client's half of ADR 0113 §2: the card catalogue arrives as immutable
// assets and lazy chunks, FETCHED on demand, instead of being imported into
// the bundle (issue #3053).
//
// WHY A FETCH AND NOT AN IMPORT. A Worker gets its own module graph, so an
// imported corpus would be paid twice on every cold load — in the app's chunk
// and in `brain.worker` — and re-downloaded whenever the app code changes.
// The rows are data, and data belongs in an asset the browser caches for a
// year.
//
// WHAT IT FETCHES — ADR 0113 Amendments IV–VI. The compiled corpus as
// per-Set SHARDS (issue #5616, `./catalogue/compiled-shards`), each the
// server's packed format over one first-printing Set, decoded a block at a
// time on first request; the hand-written definitions as one lazy chunk per
// Set (issue #5615). A game installs the shards of its Definition Manifest
// (`src/components/board/definition-manifest-gate.tsx`); a whole-catalogue
// surface every shard, through `hydrateCatalogue` below. The page and the Bot
// worker each run this module in their own graph.
//
// `getDefinition`/`tryGetDefinition` stay SYNCHRONOUS (§ 1): a surface reads
// definitions only once the shards it needs are resident, so no caller ever
// sees "not yet".
import { resolveDeckCardMeta } from "@convex/cards/catalogue";
import { bindDeckCardMetaResolver } from "~/lib/catalogue/deck-card-meta.browser";
import { installAllShards } from "~/lib/catalogue/definitionShards";
import {
    isShardDictionaryLoaded,
    loadShardDictionary,
} from "~/lib/catalogue/compiled-shards";

// `convex/formats.ts` gets a late-bound `resolveDeckCardMeta` in the browser
// build (`vite.config.ts` → `formats-cards-browser-seam`, issue #4854); this
// module is the one that loads with the catalogue, so it binds the real one.
bindDeckCardMetaResolver(resolveDeckCardMeta);

let hydration: Promise<number> | null = null;
let hydrated = false;

/** Whether the game route's gate has what it waits for: the shard
 *  dictionary every compiled shard decodes against. It renders on the FIRST
 *  frame when the Setup flow's prefetch already fetched it. */
export function isGameCatalogueHydrated(): boolean {
    return isShardDictionaryLoaded();
}

/** Whether the WHOLE catalogue is installed in this graph:
 *  `hydrateCatalogue()` has resolved. Lets the gate render its children on
 *  the FIRST frame when a prefetch already did the work (issue #5584),
 *  instead of a loading screen for the tick its own `then` takes. */
export function isCatalogueHydrated(): boolean {
    return hydrated;
}

/**
 * What the game route's gate awaits before the Definition Manifest gate
 * takes over: the shard dictionary — small, and stable across releases, so
 * it is usually a cache hit. No card: a game's shards need its Manifest
 * (`definition-manifest-gate.tsx`). A rejection is not memoised.
 */
export function hydrateGameCatalogue(): Promise<void> {
    return loadShardDictionary().then(() => undefined);
}

/**
 * The WHOLE catalogue resident: every compiled shard fetched and installed,
 * and every hand-written Set chunk (issues #5615, #5616). What a
 * whole-catalogue surface awaits — the deck builder, deck detail, the Draft
 * Lab, admin, the join antechamber. Never a game: the page installs its
 * Definition Manifest's shards, the Brain worker its own Manifest's
 * (`src/lib/ai/brain-residency.ts`, issue #5617).
 *
 * Promise singleton: the loading gate awaits it. A rejection is not memoised
 * — the gate offers a retry, and a retried load must actually re-load (the
 * shards already installed cost nothing again).
 *
 * Resolves with how many compiled cards this call installed — the honest
 * "did the fetch do anything" signal.
 */
export function hydrateCatalogue(): Promise<number> {
    if (hydration === null) {
        hydration = installAllShards()
            .then((installed) => {
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

/** TEST-ONLY. Drops the memoised promise so a test can drive the hydration
 *  again. Production has exactly one hydration per graph and never needs
 *  this. */
export function resetCatalogueHydrationForTests(): void {
    hydration = null;
    hydrated = false;
}
