import { describe, it, expect, vi } from "vitest";
import { loadavg } from "node:os";
import {
    bladeDeckKnowledge,
    buildBladeState,
    seatPlayerId,
    BLADE_SCENARIOS,
    type BladeScenario,
} from "../ai/blade";
import { enumerateMoves } from "../moves";
import { searchWithTrace } from "../search";
import type { GameState } from "../state";

/**
 * Load-INDEPENDENT search-cost fixture (issue #4458, PRD #4454).
 *
 * Lives in the `perf` vitest project (`bun run test:perf`) and in NO gate.
 * The wall-clock half of the story is machine-dependent by nature (absolute
 * times swung ~3x between load 23 and 111), so this file asserts only what does
 * NOT depend on the machine: for a FIXED `iterations` budget and a FIXED seed
 * the ISMCTS is deterministic, hence the number of state clones, move
 * enumerations, evaluations and SBA sweeps it performs is an exact integer. A
 * change that makes an iteration do more work (an extra clone in the hot path)
 * moves these counters; a slower CPU does not. `ms/iteration` and the load
 * average are PRINTED beside them and never asserted (vitest swallows console
 * output of a passing test: run with `--disableConsoleIntercept` to see them).
 *
 * "Move applications" is counted through `checkStateBasedActions` (`sbaSweeps`):
 * `applyMoveInSearch` is a module-internal call the test cannot wrap without a
 * production hook, and every applier that changes the position ends in an SBA
 * sweep (CR 704.3). It is a proxy for applications, named for what it counts.
 *
 * `evaluations` counts every call the search makes into `evaluate.ts` that
 * scores BOTH players' material — `evaluate`, `materialMargin` and
 * `evaluateWithMargin` alike
 * (issue #4459): the leaf used to pay one of each, and the counter has to see
 * both for the merge into one call to show up as a delta.
 *
 * `rngDraws` is the total `rngCounter` advance over every clone the search
 * made: game-PRNG draws only (in-game random effects). The search's own
 * stream (`makeRng(seed)`, determinization shuffles) is a private closure and
 * NOT observable here, so 0 on these positions means "no in-game random effect
 * fired", and a search that starts triggering one goes red.
 */

const counts = vi.hoisted(() => ({
    clones: 0,
    enumerations: 0,
    evaluations: 0,
    sbaSweeps: 0,
    clonedStates: [] as Array<{ rngCounter: number }>,
}));

vi.mock("../clone", async (importOriginal) => {
    const original = await importOriginal<typeof import("../clone")>();
    return {
        ...original,
        cloneGameState: (state: GameState): GameState => {
            counts.clones++;
            const clone = original.cloneGameState(state);
            counts.clonedStates.push(clone);
            return clone;
        },
    };
});

vi.mock("../moves", async (importOriginal) => {
    const original = await importOriginal<typeof import("../moves")>();
    return {
        ...original,
        enumerateMoves: (
            ...args: Parameters<typeof original.enumerateMoves>
        ) => {
            counts.enumerations++;
            return original.enumerateMoves(...args);
        },
    };
});

vi.mock("../evaluate", async (importOriginal) => {
    const original = await importOriginal<typeof import("../evaluate")>();
    return {
        ...original,
        evaluate: (...args: Parameters<typeof original.evaluate>) => {
            counts.evaluations++;
            return original.evaluate(...args);
        },
        materialMargin: (
            ...args: Parameters<typeof original.materialMargin>
        ) => {
            counts.evaluations++;
            return original.materialMargin(...args);
        },
        evaluateWithMargin: (
            ...args: Parameters<typeof original.evaluateWithMargin>
        ) => {
            counts.evaluations++;
            return original.evaluateWithMargin(...args);
        },
    };
});

vi.mock("../sba", async (importOriginal) => {
    const original = await importOriginal<typeof import("../sba")>();
    return {
        ...original,
        checkStateBasedActions: (
            ...args: Parameters<typeof original.checkStateBasedActions>
        ) => {
            counts.sbaSweeps++;
            return original.checkStateBasedActions(...args);
        },
    };
});

const ITERATIONS = 100;
const SEED = 0xb1ade;

type Position = {
    name: string;
    /** Label prefix of the blade entry — unique, resolved below. */
    labelPrefix: string;
    legalMoves: number;
    expected: {
        iterationsCompleted: number;
        clones: number;
        enumerations: number;
        evaluations: number;
        sbaSweeps: number;
        rngDraws: number;
    };
};

// Three blade positions by legal-move count: a small board, a medium one and
// the 49-move board (the widest root in the `must` tier).
const POSITIONS: Position[] = [
    {
        name: "small (4 moves)",
        labelPrefix: "adventure: casts Stomp to kill the blocker",
        legalMoves: 4,
        expected: {
            iterationsCompleted: 95,
            clones: 374,
            enumerations: 3055,
            evaluations: 353,
            sbaSweeps: 3333,
            rngDraws: 0,
        },
    },
    {
        name: "medium (13 moves)",
        labelPrefix: "depletion land: spends the last charge because it",
        legalMoves: 13,
        expected: {
            iterationsCompleted: 97,
            clones: 354,
            enumerations: 2260,
            evaluations: 291,
            sbaSweeps: 2516,
            rngDraws: 0,
        },
    },
    {
        name: "large (49 moves)",
        labelPrefix: "redirection shield: shields ITS OWN side and point",
        legalMoves: 49,
        expected: {
            iterationsCompleted: 100,
            clones: 1107,
            enumerations: 3532,
            evaluations: 888,
            sbaSweeps: 4538,
            rngDraws: 0,
        },
    },
];

function scenarioFor(prefix: string): BladeScenario {
    const found = BLADE_SCENARIOS.filter((s) => s.label.startsWith(prefix));
    expect(found).toHaveLength(1);
    return found[0];
}

describe("search cost counters (issue #4458)", () => {
    for (const position of POSITIONS) {
        it(`${position.name}: exact per-iteration work at ${ITERATIONS} iterations`, () => {
            const scenario = scenarioFor(position.labelPrefix);
            const state = buildBladeState(scenario);
            const botId = seatPlayerId(state, scenario.bot);
            const deckKnowledge = bladeDeckKnowledge(state, scenario);
            const rootRng = state.rngCounter;
            // The position's identity: its size is the label in `name`.
            expect(enumerateMoves(state, botId)).toHaveLength(
                position.legalMoves
            );

            counts.clones = 0;
            counts.enumerations = 0;
            counts.evaluations = 0;
            counts.sbaSweeps = 0;
            counts.clonedStates.length = 0;

            const t0 = performance.now();
            const { trace } = searchWithTrace(
                state,
                botId,
                { iterations: ITERATIONS },
                SEED,
                deckKnowledge
            );
            const elapsedMs = performance.now() - t0;

            // Some positions stop early (`settled`: 95/97 of 100). That stop
            // reads visit counts only, so it is deterministic; the count is
            // asserted and the per-iteration figure divides by it.
            const completed = trace?.iterationsCompleted ?? 0;
            expect(completed).toBeGreaterThan(0);

            const rngDraws = counts.clonedStates.reduce(
                (sum, c) => sum + ((c.rngCounter - rootRng) | 0),
                0
            );
            const actual = {
                iterationsCompleted: completed,
                clones: counts.clones,
                enumerations: counts.enumerations,
                evaluations: counts.evaluations,
                sbaSweeps: counts.sbaSweeps,
                rngDraws,
            };

            // Printed, never asserted: wall clock and the load it ran under.
            console.info(
                `[search.perf] ${position.name}: ${(elapsedMs / completed).toFixed(3)} ms/iter ` +
                    `(${completed} iters, ${elapsedMs.toFixed(0)} ms) ` +
                    `load1=${loadavg()[0].toFixed(2)} counters=${JSON.stringify(actual)}`
            );

            expect(actual).toEqual(position.expected);
        });
    }
});
