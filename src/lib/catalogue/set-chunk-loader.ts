// The one dynamic import of a hand-written Set module in a client graph
// (issue #5615, ADR 0113 Amendment V).
//
// A template specifier, on purpose: Vite's dynamic-import-vars expands it into
// one lazily imported chunk per directory under `convex/cards/sets/` — so the
// list of Sets is the directory listing, never a second copy of the server's
// import list (`convex/cards/setModules.ts`), and a new Set is a new chunk
// with no line to add here. `vite.config.ts` names each chunk
// `card-set-<code>` (`codeSplitting.groups`), which is what the asset-graph
// check keys on (`scripts/lib/asset-graph.ts`).
//
// SWAPPED ON THE DEV SERVER (`scripts/lib/vite-card-sets-dev-bundle.ts`,
// issue #5597): there every Set file would be its own revalidated request, so
// the plugin resolves `./set-chunk-loader` — imported by the browser seam and
// nothing else — to a loader over its one pre-bundled Set module instead.
// The specifier and this module's one export are what that swap keys on.
import type { SetModuleExports } from "@convex/cards/setModuleSource";

/** The Set module for `code`, loaded as its own chunk. Rejects on a code
 *  that names no directory. */
export function loadSetModule(code: string): Promise<SetModuleExports> {
    return import(`../../../convex/cards/sets/${code}/index.cards.ts`);
}
