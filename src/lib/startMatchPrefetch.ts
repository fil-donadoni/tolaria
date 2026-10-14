// What Start match needs, warmed while the player sets up (issue #5584).
//
// The Setup flow is a light surface: it renders without the card catalogue.
// The board is not — its catalogue gate holds it until the packed corpus is
// resident (`hydrateCompiledCorpus()`), and then until the Sets of the game's
// Definition Manifest are (issue #5615). The corpus needs no Manifest, so that
// same memoised fetch starts here, at idle, and the gate usually finds it
// done. The Sets DO need the Manifest, which exists only once the game is
// built, so they load at Start match — a warm-up here would download the
// whole catalogue the per-game delivery exists to avoid. The gate's own lazy
// chunk and the game route's lazy chunks are preloaded the same way.
//
// Best effort, never a step's dependency: every part may fail on its own and
// is ignored here — the gate retries the catalogue, and the router loads the
// route on navigation, exactly as without a prefetch.
//
// Not the Brain worker: it can only be warmed by spawning it, which starts the
// Bot's own catalogue load in a second graph (PRD #5602 owns its delivery).

import { prefetchCatalogueGate } from "./catalogueGateLoader";

/** Run `task` when the browser is idle (`requestIdleCallback`, else after a
 *  short delay). Returns the cancel. */
export function whenIdle(task: () => void): () => void {
    if (typeof window.requestIdleCallback === "function") {
        const handle = window.requestIdleCallback(task, { timeout: 3000 });
        return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(task, 1000);
    return () => window.clearTimeout(handle);
}

/** Start the packed corpus fetch and the game route's preload; settles when
 *  both have, whatever their outcome. */
export async function prefetchStartMatch(
    preloadGameRoute: () => Promise<unknown>
): Promise<void> {
    await Promise.allSettled([
        import("./catalogueArtifact").then((m) => m.hydrateCompiledCorpus()),
        prefetchCatalogueGate(),
        preloadGameRoute(),
    ]);
}
