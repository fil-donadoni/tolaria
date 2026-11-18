// Root-parallel ISMCTS, prototyped in the bench (issue #10135): N independent
// trees searching ONE decision, each from its own seed, merged at the root.
//
// What a Brain Worker would do in parallel this bench does one tree after
// another — the merge reads only the grown trees, never the clock, so an
// iterations-only ensemble chooses the same move however its trees were
// scheduled. `run-workers.mjs` measures the parallel half (how many
// iterations N real Workers complete under a time cap); this module is the
// arithmetic half (what a merge of those trees picks).
//
// It drives the root seam `bundle.mjs` patches into the bundled search
// (`rootHook`): `__benchSearch` runs the trees, `__benchRootHook` captures
// each grown root and hands the LAST tree's selection the merged one.

/** Golden-ratio stride: the seeds of an ensemble's trees. Tree 0 keeps the
 *  decision's own seed, so an ensemble of ONE is today's search, bit for bit. */
const SEED_STRIDE = 0x9e3779b9;

/** The seed tree `k` of an ensemble searches from. */
export function treeSeed(seed, k) {
    return k === 0 ? seed : (seed + Math.imul(k, SEED_STRIDE)) | 0;
}

/**
 * Merge grown roots into one: per root edge (by tree key — the same key in
 * every tree, since every tree enumerates the same root state) the visit,
 * availability, reward and margin sums; the memoized one-ply policy value is
 * the MEAN over the trees that hold one (each tree read it in its own sampled
 * world). An edge's `move` and child node come from the first tree that
 * opened it — root selection reads neither below the root. Iteration order is
 * tree 0's keys first, then each later tree's new keys: fixed by tree index,
 * never by which Worker answered first.
 */
export function mergeRoots(roots) {
    const children = new Map();
    const valueSums = new Map();
    for (const root of roots) {
        for (const [key, edge] of root.children) {
            const merged = children.get(key);
            if (!merged) {
                children.set(key, { ...edge });
                continue;
            }
            merged.visits += edge.visits;
            merged.avail += edge.avail;
            merged.totalReward += edge.totalReward;
            merged.totalMargin += edge.totalMargin;
        }
        for (const [key, value] of root.policyValues ?? []) {
            const sum = valueSums.get(key) ?? { total: 0, count: 0 };
            sum.total += value;
            sum.count += 1;
            valueSums.set(key, sum);
        }
    }
    const merged = { ...roots[0], children };
    if (valueSums.size > 0) {
        merged.policyValues = new Map(
            [...valueSums].map(([key, s]) => [key, s.total / s.count])
        );
    }
    return merged;
}

/** One `SearchStats` for the ensemble: iterations summed, elapsed time the
 *  slowest tree's (the trees run side by side), stopped by the clock if any
 *  tree was. */
export function mergeStats(all) {
    const stoppedBy = all.some((s) => s.stoppedBy === "time")
        ? "time"
        : all.some((s) => s.stoppedBy === "iterations")
          ? "iterations"
          : "settled";
    return {
        iterationsCompleted: all.reduce((n, s) => n + s.iterationsCompleted, 0),
        iterationsRequested: all.reduce((n, s) => n + s.iterationsRequested, 0),
        elapsedMs: Math.max(...all.map((s) => s.elapsedMs)),
        stoppedBy,
    };
}

/**
 * Make every `searchWithTrace` in the bundle an ensemble of `n` trees, each
 * at the budget the caller asked for (so `n` trees of B iterations: n·B in
 * all). `n <= 1` uninstalls it: one tree, today's search.
 *
 * `split`: a ROOT SPLIT instead of n copies — the root candidates, in
 * enumeration order, are dealt into min(n, candidates) groups and tree k
 * keeps only group k modulo that count (the rest join its root deny-set), so
 * each candidate is searched by n / groups trees, each at its whole budget,
 * instead of sharing every tree with all the others.
 */
export function installEnsemble(n, { split = false } = {}) {
    if (n <= 1) {
        delete globalThis.__benchSearch;
        return;
    }
    // Fewer candidates than trees: the candidates are the groups, and the
    // trees share them round-robin (four trees, two candidates: two each).
    const denyFor = (k) => (denied, keys) => {
        const groups = Math.min(n, keys.length);
        if (!split || groups < 2) return;
        keys.forEach((key, j) => {
            if (j % groups !== k % groups) denied.add(key);
        });
    };
    globalThis.__benchSearch = (inner, args) => {
        const [state, playerId, budget, seed, ...rest] = args;
        const roots = [];
        const stats = [];
        globalThis.__benchRootHook = (root, s) => {
            roots.push(root);
            stats.push(s);
            return { root, stats: s };
        };
        try {
            for (let k = 1; k < n; k++) {
                globalThis.__benchRootDeny = denyFor(k);
                inner(state, playerId, budget, treeSeed(seed, k), ...rest);
            }
            globalThis.__benchRootDeny = denyFor(0);
            // Tree 0 last: its selection reads the merge of every tree.
            globalThis.__benchRootHook = (root, s) => ({
                root: mergeRoots([root, ...roots]),
                stats: mergeStats([s, ...stats]),
            });
            return inner(state, playerId, budget, seed, ...rest);
        } finally {
            delete globalThis.__benchRootHook;
            delete globalThis.__benchRootDeny;
        }
    };
}

/** Hold on to the next search's grown root (memory measurement): the
 *  callback receives it, the search proceeds unchanged. */
export function captureNextRoot(onRoot) {
    globalThis.__benchRootHook = (root, stats) => {
        delete globalThis.__benchRootHook;
        onRoot(root, stats);
        return { root, stats };
    };
}
