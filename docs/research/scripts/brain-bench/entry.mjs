// The Brain lab bench's payload (issue #9527): the REAL search over the blade
// `must` positions, bundled by `build.mjs` into one script that every engine
// runs unchanged — Node (V8), Bun (JavaScriptCore), and Chromium, Firefox and
// WebKit through Playwright. It exposes `globalThis.__brainBench`.
//
// A run takes a budget and a CLOCK. The search reads time only through
// `SearchBudget.now`, so a clock that runs `scale` times faster makes the
// search behave exactly as it would on a device `scale` times slower: it stops
// by `time` where that device would. With the `cpu` clock (process CPU time,
// Node and Bun only) the result does not depend on how loaded the machine is;
// the `wall` clock is the only one a browser has.

import { bladeScenariosForTier } from "../../../../convex/gre/ai/blade/registry";
import {
    buildBladeState,
    bladeDeckKnowledge,
    DEFAULT_BLADE_SEED,
} from "../../../../convex/gre/ai/blade/runner";
import { seatPlayerId } from "../../../../convex/gre/ai/blade/matcher";
import { searchWithTrace } from "../../../../convex/gre/search";
import { DIFFICULTY_BUDGETS } from "../../../../convex/gre/difficulty";

const POSITIONS = bladeScenariosForTier("must").slice(0, 60);

const hasCpuClock =
    typeof process !== "undefined" && typeof process.cpuUsage === "function";

/** This process's CPU time (user + system), in milliseconds. */
function cpuMs() {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1000;
}

function wallMs() {
    return performance.now();
}

/**
 * Search position `index` once.
 *
 * @param {number} index
 * @param {{ iterations?: number, timeMs?: number, clock?: "wall" | "cpu",
 *           scale?: number, seed?: number }} options
 */
function run(index, options = {}) {
    const scenario = POSITIONS[index];
    const state = buildBladeState(scenario);
    const botId = seatPlayerId(state, scenario.bot);
    const clock = options.clock === "cpu" && hasCpuClock ? cpuMs : wallMs;
    const scale = options.scale ?? 1;
    const budget = {
        ...(options.iterations === undefined
            ? {}
            : { iterations: options.iterations }),
        ...(options.timeMs === undefined ? {} : { timeMs: options.timeMs }),
        now: () => clock() * scale,
    };
    const wall0 = wallMs();
    const cpu0 = hasCpuClock ? cpuMs() : null;
    const { trace } = searchWithTrace(
        state,
        botId,
        budget,
        options.seed ?? DEFAULT_BLADE_SEED,
        bladeDeckKnowledge(state, scenario)
    );
    const wall = wallMs() - wall0;
    const cpu = cpu0 === null ? null : cpuMs() - cpu0;
    return {
        index,
        label: scenario.label,
        candidates: trace ? trace.candidateCount : null,
        requested: trace ? trace.iterationsRequested : null,
        completed: trace ? trace.iterationsCompleted : null,
        stoppedBy: trace ? trace.stoppedBy : null,
        // The search's own elapsed time, in DEVICE milliseconds (scaled).
        deviceMs: trace ? trace.elapsedMs : null,
        wallMs: wall,
        cpuMs: cpu,
    };
}

globalThis.__brainBench = {
    count: POSITIONS.length,
    labels: POSITIONS.map((s) => s.label),
    budgets: DIFFICULTY_BUDGETS,
    hasCpuClock,
    run,
};
