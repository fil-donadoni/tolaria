// The rollout-policy bench payload (issue #10134): `entry.mjs`'s
// `__brainBench`, plus `__brainBench.rollout` — a blade entry or a bench
// position searched under one candidate policy (`rollout-policies.mjs`), with
// the rollout counters. Bundle it with the rollout seam
// (`bundleBench(..., { rolloutHook: true })`); `run-rollout.mjs` builds it.

import "./entry.mjs";
import {
    installPolicy,
    readCounters,
    resetCounters,
} from "./rollout-policies.mjs";
import { bladeScenariosForTier } from "../../../../convex/gre/ai/blade/registry";
import { runBladeScenario } from "../../../../convex/gre/ai/blade/runner";
import { moveKey } from "../../../../convex/gre/search";

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

/** Run `must` entry `index` at ONE seed and `iterations`, under `policy` —
 *  the blade's own expectation check, unchanged. */
function blade(index, { iterations, seed, policy }) {
    const scenario = MUST[index];
    installPolicy(policy);
    resetCounters();
    const result = runBladeScenario({
        ...scenario,
        seeds: [seed],
        budget: { ...scenario.budget, iterations },
    });
    const row = result.seeds[0];
    return {
        ok: row.ok,
        move: row.move ? moveKey(row.move) : null,
        counters: readCounters(),
    };
}

/** Search bench position `index` (`entry.mjs`'s `run`) under `policy`. */
function run(index, options, policy) {
    installPolicy(policy);
    resetCounters();
    const row = globalThis.__brainBench.run(index, options);
    return { ...row, counters: readCounters() };
}

/** Search a field fixture (`entry.mjs`'s `runField`) under `policy`. */
function runField(fixture, options, policy) {
    installPolicy(policy);
    resetCounters();
    const row = globalThis.__brainBench.runField(fixture, options);
    return { ...row, counters: readCounters() };
}

globalThis.__brainBench.rollout = {
    entries,
    blade,
    run,
    runField,
    install: installPolicy,
};
