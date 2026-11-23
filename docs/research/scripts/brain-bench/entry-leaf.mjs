// The leaf-parallel bench payload (issue #10450): `entry.mjs`'s
// `__brainBench`, plus `__brainBench.leaf` — blade entries, bench positions
// and field boards searched by ONE tree whose rollouts go through the batch
// driver (`leaf-parallel.mjs`), the hand-off measurement, and the helper's
// side for the browser bench. Bundle it with the leaf seam
// (`bundleBench(..., { leafHook: true })`); `run-leaf.mjs` builds it.

import "./entry.mjs";
import {
    helperRollout,
    installLeaf,
    lastSettleHash,
    localExecutor,
} from "./leaf-parallel.mjs";
import { bladeScenariosForTier } from "../../../../convex/gre/ai/blade/registry";
import { runBladeScenario } from "../../../../convex/gre/ai/blade/runner";
import { moveKey } from "../../../../convex/gre/search";
import {
    beginDominanceDecision,
    endDominanceDecision,
} from "../../../../convex/gre/ai/dominance";

const MUST = bladeScenariosForTier("must");

/** Every `must` entry, as the job list reads it. */
function entries() {
    return MUST.map((s, index) => ({
        index,
        label: s.label,
        iterations: s.budget.iterations,
        seeds: s.seeds ?? null,
    }));
}

/** `cfg` → the installed batch: `null` / `{ K: "base" }` is today's search
 *  (no seam), else `{ K, transport, check }` on the local executor unless an
 *  executor is given. */
function install(cfg) {
    if (!cfg || cfg.K === "base") {
        installLeaf(null);
        return null;
    }
    const executor =
        cfg.executor ?? localExecutor({ check: cfg.check === true });
    installLeaf({
        K: cfg.K,
        L: cfg.L,
        transport: cfg.transport ?? "clone",
        executor,
    });
    return executor;
}

/** Run `must` entry `index` at ONE seed and `iterations` under `cfg` — the
 *  blade's own expectation check, unchanged. */
function blade(index, { iterations, seed, ...cfg }) {
    const scenario = MUST[index];
    install(cfg);
    globalThis.__benchLastTrace = null;
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
            settle: lastSettleHash(),
        };
    } finally {
        installLeaf(null);
    }
}

/** Search bench position `index` (`entry.mjs`'s `run`) under `cfg`. */
function run(index, options, cfg) {
    install(cfg);
    try {
        return {
            ...globalThis.__brainBench.run(index, options),
            settle: lastSettleHash(),
        };
    } finally {
        installLeaf(null);
    }
}

/** Search a field fixture (`entry.mjs`'s `runField`) under `cfg`. */
function runField(fixture, options, cfg) {
    install(cfg);
    try {
        return {
            ...globalThis.__brainBench.runField(fixture, options),
            settle: lastSettleHash(),
        };
    } finally {
        installLeaf(null);
    }
}

/**
 * What crossing the boundary costs, per rollout, in THIS thread: a search of
 * `iterations` at K = 2 whose executor times, for every leaf, a structured
 * clone of the world (what `postMessage` pays, serialise and deserialise,
 * without the thread hop), the helper's determinize-and-replay from the seed
 * and path, and the rollout itself; and, once per search, a structured clone
 * of the root state (what the `replay` transport pays up front). The world's
 * JSON length stands for its size.
 */
function handoff(target, iterations) {
    let ctx = null;
    const jobs = new Map();
    const rows = [];
    let rootCloneMs = null;
    let rootBytes = null;
    const executor = {
        beginSearch(c) {
            ctx = c;
            const t0 = performance.now();
            structuredClone(c.rootState);
            rootCloneMs = performance.now() - t0;
            rootBytes = JSON.stringify(c.rootState).length;
        },
        dispatch(n, job) {
            const t0 = performance.now();
            structuredClone(job.world);
            const cloneMs = performance.now() - t0;
            jobs.set(n, {
                job,
                cloneMs,
                bytes: JSON.stringify(job.world).length,
                pathLength: job.trail.length,
            });
        },
        wait(n) {
            const { job, cloneMs, bytes, pathLength } = jobs.get(n);
            jobs.delete(n);
            const replay = helperRollout(ctx, {
                worldSeed: job.worldSeed,
                trail: job.trail,
                seed: job.seed,
            });
            rows.push({
                cloneMs,
                replayMs: replay.replayMs,
                rolloutMs: replay.rolloutMs,
                bytes,
                pathLength,
            });
            return replay;
        },
        drop(n) {
            jobs.delete(n);
        },
        endSearch() {},
    };
    // `clone`: its payload carries the world AND its seed and path.
    const cfg = { K: 2, transport: "clone", executor };
    const options = { iterations, seed: 0xb1ade };
    const row =
        typeof target === "number"
            ? run(target, options, cfg)
            : runField(target, options, cfg);
    return {
        label: row.label,
        permanents: row.permanents ?? null,
        completed: row.completed,
        rootCloneMs,
        rootBytes,
        leaves: rows,
    };
}

/** The helper Worker's side (`run-leaf-browsers.mjs`): a search's context
 *  opens a dominance scope as `searchWithTrace` does, and every job is one
 *  `helperRollout`. */
const helper = {
    ctx: null,
    begin(ctx) {
        endDominanceDecision();
        beginDominanceDecision();
        helper.ctx = ctx;
    },
    rollout(job) {
        return helperRollout(helper.ctx, job);
    },
};

globalThis.__brainBench.leaf = {
    entries,
    blade,
    run,
    runField,
    handoff,
    helper,
};
