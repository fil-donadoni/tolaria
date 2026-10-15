// Which chunk a module of the card catalogue belongs to (issue #5615, PRD
// #5602): `vite.config.ts` → `codeSplitting.groups`, the one group that names
// the per-Set chunks `card-set-<code>`.
//
// A Set's own modules (`convex/cards/sets/<code>/**`) are the easy half. The
// other half is a helper a Set is the ONLY user of — `convex/cards/abilities/
// amass.ts` is imported by `sets/ltr/black.cards.ts` and nothing else — which
// the bundler's natural chunking would put beside its one importer. The group
// captures ONLY the modules it names (`includeDependenciesRecursively:
// false`, so a helper that twenty Sets share is not swallowed by whichever Set
// is processed first), so such a helper would be left in the Set's ENTRY
// chunk — the barrel's — while the colour module importing it sits in the
// group chunk, which then imports the entry chunk back: a Set in two chunks
// with a static cycle between them (15 of 146 Sets, measured). So a module
// outside the Sets is named after the one Set that reaches it, when exactly
// one does and nothing else does: every importer, followed transitively, is
// that Set's. A module the app or two Sets reach stays unnamed, and the
// bundler's own chunking puts it in a shared chunk every Set imports one way.
import type { ChunkingContext } from "rolldown";

/** A module of one hand-written Set: `convex/cards/sets/<code>/…`, the code
 *  captured. */
export const SET_MODULE_ID = /convex[\\/]cards[\\/]sets[\\/]([a-z0-9]+)[\\/]/;

/** The Set code of a Set module's id, else `undefined`. */
export function setCodeOf(moduleId: string): string | undefined {
    return SET_MODULE_ID.exec(moduleId)?.[1];
}

/** A chunk name for Set `code`. */
export const setChunkName = (code: string): string => `card-set-${code}`;

/** The modules a chunking decision may read: the importer lists the bundler
 *  exposes, static and dynamic. */
export type ImporterGraph = Pick<ChunkingContext, "getModuleInfo">;

/**
 * The ONE Set that owns `moduleId`, or `undefined`: a Set module's own Set;
 * for any other module, the Set every path of static importers leads to —
 * `undefined` as soon as an importer is dynamic, leads to a second Set, to a
 * module nobody imports (an entry), or to one the bundler cannot describe.
 * Memoised per graph; a cycle among importers contributes nothing.
 */
export function owningSet(
    moduleId: string,
    graph: ImporterGraph,
    memo: Map<string, string | undefined> = new Map()
): string | undefined {
    const own = setCodeOf(moduleId);
    if (own !== undefined) return own;
    if (memo.has(moduleId)) return memo.get(moduleId);
    // Pessimistic while in progress: a cycle back to this module reads as
    // "no single owner", never as a vacuous agreement.
    memo.set(moduleId, undefined);
    const info = graph.getModuleInfo(moduleId);
    let owner: string | undefined;
    if (
        info !== null &&
        info.dynamicImporters.length === 0 &&
        info.importers.length > 0
    ) {
        for (const importer of info.importers) {
            const code = owningSet(importer, graph, memo);
            if (code === undefined || (owner !== undefined && code !== owner)) {
                owner = undefined;
                break;
            }
            owner = code;
        }
    }
    memo.set(moduleId, owner);
    return owner;
}

/** The chunk `moduleId` belongs to, for the group's `name` callback: a Set
 *  chunk for a Set's modules and for what only that Set reaches; `undefined`
 *  (ignored by the group) for everything else. One memo per graph. */
export function cardSetChunkName(
    moduleId: string,
    graph: ImporterGraph,
    memos: WeakMap<ImporterGraph, Map<string, string | undefined>> = MEMOS
): string | undefined {
    let memo = memos.get(graph);
    if (memo === undefined) {
        memo = new Map();
        memos.set(graph, memo);
    }
    const code = owningSet(moduleId, graph, memo);
    return code === undefined ? undefined : setChunkName(code);
}

const MEMOS = new WeakMap<ImporterGraph, Map<string, string | undefined>>();
