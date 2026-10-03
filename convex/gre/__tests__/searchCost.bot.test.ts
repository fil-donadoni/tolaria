import { afterEach, describe, it, expect, vi } from "vitest";
import {
    bladeDeckKnowledge,
    buildBladeState,
    seatPlayerId,
    BLADE_SCENARIOS,
    type BladeScenario,
} from "../ai/blade";
import * as clone from "../clone";
import * as evaluate from "../evaluate";
import * as moves from "../moves";
import * as rng from "../rng";
import * as sba from "../sba";
import { searchWithTrace } from "../search";
import * as registry from "../../cards/registry";
import * as manaAvailability from "../manaAvailability";

/**
 * Load-INDEPENDENT search-cost fixture (issue #4458, PRD #4454), GATED
 * (issue #5001).
 *
 * For a FIXED `iterations` budget and a FIXED seed the ISMCTS is
 * deterministic, hence the number of state clones, move enumerations,
 * evaluations and SBA sweeps it performs is an exact integer. A change that
 * makes an iteration do more work (an extra clone in the hot path) moves these
 * counters; a slower CPU does not. That makes this a correctness-tier test,
 * and it lives in the bot suite so `check:lane` runs it on every `engine`
 * landing: in the never-gated `perf` project it went stale twice unseen
 * (PR #4868 landed red, PR #4883 moved it). A legitimate evaluation change
 * that moves a counter re-records it in the PR that causes it, with the delta
 * in that PR's body. The wall-clock half (ms/iteration under the load it ran
 * at) stays in `search.perf.test.ts`, printed, never asserted.
 *
 * Every counter is a `vi.spyOn` on the callee module's NAMESPACE, never a
 * `vi.mock`: the bot suite runs `isolate: false`, so a module mock is only as
 * good as the import order of the files sharing the worker — measured, a
 * `vi.mock` counted zero beside `search.bot.test.ts` (issue #4460). A spy
 * patches the shared namespace object at run time, which every importer reads
 * through, and `afterEach` restores it. Like a module mock, it sees calls
 * from OTHER modules only; a callee module's calls into itself are not
 * counted.
 *
 * "Move applications" is counted through `checkStateBasedActions` (`sbaSweeps`):
 * `applyMoveInSearch` is a module-internal call the test cannot wrap without a
 * production hook, and every applier that changes the position ends in an SBA
 * sweep (CR 704.3) — EXCEPT a rollout's hand-off pass on a settled world, which
 * only hands priority over and skips the sweep (issue #4460). It is a proxy
 * for applications, named for what it counts. `enumerations` likewise counts
 * `enumerateMoves` calls only: a rollout ply that `onlyPassIsLegal` proves is
 * a forced pass never reaches the enumerator.
 *
 * `evaluations` counts every call the search makes into `evaluate.ts` that
 * scores BOTH players' material — `evaluate`, `materialMargin` and
 * `evaluateWithMargin` alike
 * (issue #4459): the leaf used to pay one of each, and the counter has to see
 * both for the merge into one call to show up as a delta.
 *
 * `ptWalkVisits` (issue #4462) counts the permanents the layer-7 SOURCE walk
 * visits: one `declaresLayer7StaticEffect` precheck per battlefield permanent
 * per walk (`collectLayer7Sources`, `gre/layers.ts`; emblems are walked but
 * not prechecked, so they are not counted). It is the term that was quadratic
 * — every creature's P/T read walked every battlefield, so a pass over n
 * creatures visited n² permanents — and a `Layer7Pass` walks once for the
 * pass instead. What remains is one walk per SBA scan and per evaluation,
 * plus the single reads that belong to no pass. Before that change the three
 * positions read 12710 / 0 / 107879; the medium board has no creature, so
 * nothing is ever walked on it.
 *
 * `censuses` (issue #4461) counts the mana censuses computed — every call
 * from outside `gre/manaAvailability.ts` into `manaCensusFor`, `manaUnitsFor`
 * or `boardCensusFor`, each of which walks a battlefield once (their calls
 * into one another inside the module are one census, and are not seen). An
 * evaluation used to pay one per seat in the material terms and another per
 * castable-interaction read in the combat terms, and every reactive-prior edge
 * paid its own probe. Now one census per seat per evaluation, policy probe and
 * rollout ply, and one castable-instant probe per node visit. Before that
 * change the three positions read 1184 / 755 / 3489.
 *
 * `rngDraws` is the total `rngCounter` advance over every clone the search
 * made: game-PRNG draws only (in-game random effects). The search's own
 * stream (`makeRng(seed)`, determinization shuffles) is a private closure, so
 * 0 on these positions means "no in-game random effect fired", and a search
 * that starts triggering one goes red.
 *
 * `searchDraws` is that private stream's length, counted by wrapping `makeRng`
 * (every stream the search opens: its own and the salted block-lens one). It
 * is the forced-pass fast path's RNG contract (issue #4460): the values below
 * were recorded BEFORE the fast path existed, and a path that drops or adds
 * one draw shifts every later rollout and moves this number first.
 *
 * Re-recorded when the fixture moved here (issue #5001), against the perf
 * fixture's last values: (1) the small and medium positions had already moved
 * on the base unseen — small 95→98 iterations, medium enumerations 624→629,
 * the very failure this move closes; (2) the spies see `gre/ai/dominance.ts`'s
 * clones and SBA sweeps (clones / sweeps over a `vi.mock` run on the same
 * tree: medium +34 / +24, large +144 / +96), which the `vi.mock` never counted — that module was already
 * loaded unmocked through the setup file's catalogue import.
 */

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
        ptWalkVisits: number;
        censuses: number;
        rngDraws: number;
        searchDraws: number;
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
            iterationsCompleted: 98,
            clones: 373,
            enumerations: 2166,
            evaluations: 352,
            sbaSweeps: 2510,
            ptWalkVisits: 7151,
            censuses: 1048,
            rngDraws: 0,
            searchDraws: 6101,
        },
    },
    {
        name: "medium (13 moves)",
        labelPrefix: "depletion land: spends the last charge because it",
        legalMoves: 13,
        expected: {
            iterationsCompleted: 97,
            clones: 388,
            enumerations: 629,
            evaluations: 291,
            sbaSweeps: 1788,
            ptWalkVisits: 0,
            censuses: 734,
            rngDraws: 0,
            searchDraws: 5739,
        },
    },
    {
        name: "large (49 moves)",
        labelPrefix: "redirection shield: shields ITS OWN side and point",
        legalMoves: 49,
        expected: {
            iterationsCompleted: 100,
            clones: 1251,
            enumerations: 489,
            evaluations: 888,
            sbaSweeps: 3178,
            ptWalkVisits: 32910,
            censuses: 2507,
            rngDraws: 0,
            searchDraws: 7040,
        },
    },
];

function scenarioFor(prefix: string): BladeScenario {
    const found = BLADE_SCENARIOS.filter((s) => s.label.startsWith(prefix));
    expect(found).toHaveLength(1);
    return found[0];
}

/** Count every call to `spy` — the original runs unchanged. */
function callCount(spy: { mock: { calls: unknown[] } }): () => number {
    return () => spy.mock.calls.length;
}

describe("search cost counters (issue #4458, gated by issue #5001)", () => {
    // Every spy restored, even when the search throws: the worker is shared.
    afterEach(() => {
        vi.restoreAllMocks();
    });

    for (const position of POSITIONS) {
        it(`${position.name}: exact per-iteration work at ${ITERATIONS} iterations`, () => {
            const scenario = scenarioFor(position.labelPrefix);
            const state = buildBladeState(scenario);
            const botId = seatPlayerId(state, scenario.bot);
            const deckKnowledge = bladeDeckKnowledge(state, scenario);
            const rootRng = state.rngCounter;
            // The position's identity: its size is the label in `name`.
            expect(moves.enumerateMoves(state, botId)).toHaveLength(
                position.legalMoves
            );

            const clonedStates: Array<{ rngCounter: number }> = [];
            const originalClone = clone.cloneGameState;
            const clones = callCount(
                vi.spyOn(clone, "cloneGameState").mockImplementation((s) => {
                    const c = originalClone(s);
                    clonedStates.push(c);
                    return c;
                })
            );
            let searchDraws = 0;
            const originalMakeRng = rng.makeRng;
            vi.spyOn(rng, "makeRng").mockImplementation((seed) => {
                const stream = originalMakeRng(seed);
                return () => {
                    searchDraws++;
                    return stream();
                };
            });
            const enumerations = callCount(vi.spyOn(moves, "enumerateMoves"));
            const evaluationSpies = [
                vi.spyOn(evaluate, "evaluate"),
                vi.spyOn(evaluate, "materialMargin"),
                vi.spyOn(evaluate, "evaluateWithMargin"),
            ];
            const sbaSweeps = callCount(
                vi.spyOn(sba, "checkStateBasedActions")
            );
            const ptWalkVisits = callCount(
                vi.spyOn(registry, "declaresLayer7StaticEffect")
            );
            const censusSpies = [
                vi.spyOn(manaAvailability, "manaCensusFor"),
                vi.spyOn(manaAvailability, "manaUnitsFor"),
                vi.spyOn(manaAvailability, "boardCensusFor"),
            ];
            const sum = (spies: Array<{ mock: { calls: unknown[] } }>) =>
                spies.reduce((n, spy) => n + spy.mock.calls.length, 0);

            const { trace } = searchWithTrace(
                state,
                botId,
                { iterations: ITERATIONS },
                SEED,
                deckKnowledge
            );

            // Some positions stop early (`settled`: 98/97 of 100). That stop
            // reads visit counts only, so it is deterministic and asserted.
            const completed = trace?.iterationsCompleted ?? 0;
            expect(completed).toBeGreaterThan(0);

            expect({
                iterationsCompleted: completed,
                clones: clones(),
                enumerations: enumerations(),
                evaluations: sum(evaluationSpies),
                sbaSweeps: sbaSweeps(),
                ptWalkVisits: ptWalkVisits(),
                censuses: sum(censusSpies),
                rngDraws: clonedStates.reduce(
                    (n, c) => n + ((c.rngCounter - rootRng) | 0),
                    0
                ),
                searchDraws,
            }).toEqual(position.expected);
        });
    }
});
