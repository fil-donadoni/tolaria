// What Start match needs, warmed while the player sets up (issue #5584).
//
// The Setup flow is a light surface: it renders without the card catalogue.
// The board is not — its catalogue gate holds it until `hydrateCatalogue()`
// has the definitions resident. Starting that same memoised fetch here, at
// idle, means the gate usually finds it done: Start match goes straight to
// the board instead of "Loading cards...". The gate's own lazy chunk and the
// game route's lazy chunks are preloaded the same way.
//
// Best effort, never a step's dependency: every part may fail on its own and
// is ignored here — the gate retries the catalogue, and the router loads the
// route on navigation, exactly as without a prefetch.
//
// Not the Brain worker: it can only be warmed by spawning it, which starts the
// Bot's own catalogue load in a second graph (PRD #5602 owns its delivery).

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

/** Start the catalogue fetch and the game route's preload; settles when both
 *  have, whatever their outcome. */
export async function prefetchStartMatch(
    preloadGameRoute: () => Promise<unknown>
): Promise<void> {
    await Promise.allSettled([
        import("./catalogueArtifact").then((m) => m.hydrateCatalogue()),
        import("~/components/ui/catalogue-gate"),
        preloadGameRoute(),
    ]);
}
