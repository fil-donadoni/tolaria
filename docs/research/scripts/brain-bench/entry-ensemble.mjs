// The root-parallel bench payload (issue #10135): `entry.mjs`'s
// `__brainBench`, plus `__brainBench.ensemble` — blade entries searched by an
// ensemble of N trees (`ensemble.mjs`), and the hooks the memory reading
// needs. Bundle it with the root seam (`bundleBench(..., { rootHook: true })`);
// `run-ensemble.mjs` and `run-workers.mjs` build it themselves.

import "./entry.mjs";
import { installEnsemble, treeSeed, captureNextRoot } from "./ensemble.mjs";
import { bladeScenariosForTier } from "../../../../convex/gre/ai/blade/registry";
import { runBladeScenario } from "../../../../convex/gre/ai/blade/runner";
import { moveKey } from "../../../../convex/gre/search";

const TIERS = {
    must: bladeScenariosForTier("must"),
    stretch: bladeScenariosForTier("stretch"),
};

/** Every entry of `tier`, as the job list reads it. */
function entries(tier) {
    return TIERS[tier].map((s, index) => ({
        index,
        label: s.label,
        iterations: s.budget.iterations,
        seeds: s.seeds ?? null,
    }));
}

/**
 * Run blade entry `index` of `tier` at ONE seed, each tree of an `n`-tree
 * ensemble at `iterations` (`split`: a root split, `ensemble.mjs`) — the
 * blade's own expectation check, unchanged.
 */
function blade(tier, index, { iterations, n, seed, split = false }) {
    const scenario = TIERS[tier][index];
    installEnsemble(n, { split });
    try {
        const result = runBladeScenario({
            ...scenario,
            seeds: [seed],
            budget: { ...scenario.budget, iterations },
        });
        const row = result.seeds[0];
        return {
            ok: row.ok,
            move: row.move ? moveKey(row.move) : null,
            mechanism: row.mechanism,
        };
    } finally {
        installEnsemble(1);
    }
}

globalThis.__brainBench.ensemble = {
    entries,
    blade,
    install: installEnsemble,
    treeSeed,
    captureNextRoot,
};
