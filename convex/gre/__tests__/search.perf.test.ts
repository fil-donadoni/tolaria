import { describe, it, expect } from "vitest";
import { loadavg } from "node:os";
import {
    bladeDeckKnowledge,
    buildBladeState,
    seatPlayerId,
    BLADE_SCENARIOS,
} from "../ai/blade";
import { searchWithTrace } from "../search";

/**
 * Search wall clock (issue #4458, PRD #4454) — the machine-DEPENDENT half.
 *
 * Lives in the `perf` vitest project (`bun run test:perf`) and in NO gate:
 * absolute times swung ~3x between load 23 and 111, so `ms/iteration` and the
 * load average it ran under are PRINTED, never asserted (vitest swallows the
 * console output of a passing test: run with `--disableConsoleIntercept` to
 * see them). The deterministic half — exact clone / enumeration / evaluation /
 * SBA-sweep counts for the same positions, seed and budget — is a gated bot
 * test, `searchCost.bot.test.ts` (issue #5001): it sat here once and went
 * stale twice unseen.
 */

const ITERATIONS = 100;
const SEED = 0xb1ade;

// The three positions of `searchCost.bot.test.ts`, by blade label prefix.
const POSITIONS = [
    {
        name: "small (4 moves)",
        labelPrefix: "adventure: casts Stomp to kill the blocker",
    },
    {
        name: "medium (13 moves)",
        labelPrefix: "depletion land: spends the last charge because it",
    },
    {
        name: "large (49 moves)",
        labelPrefix: "redirection shield: shields ITS OWN side and point",
    },
];

describe("search wall clock (issue #4458) — printed, never asserted", () => {
    for (const position of POSITIONS) {
        it(`${position.name}: ms/iteration at ${ITERATIONS} iterations`, () => {
            const found = BLADE_SCENARIOS.filter((s) =>
                s.label.startsWith(position.labelPrefix)
            );
            expect(found).toHaveLength(1);
            const scenario = found[0];
            const state = buildBladeState(scenario);

            const t0 = performance.now();
            const { trace } = searchWithTrace(
                state,
                seatPlayerId(state, scenario.bot),
                { iterations: ITERATIONS },
                SEED,
                bladeDeckKnowledge(state, scenario)
            );
            const elapsedMs = performance.now() - t0;

            const completed = trace?.iterationsCompleted ?? 0;
            expect(completed).toBeGreaterThan(0);
            console.info(
                `[search.perf] ${position.name}: ${(elapsedMs / completed).toFixed(3)} ms/iter ` +
                    `(${completed} iters, ${elapsedMs.toFixed(0)} ms) ` +
                    `load1=${loadavg()[0].toFixed(2)}`
            );
        });
    }
});
