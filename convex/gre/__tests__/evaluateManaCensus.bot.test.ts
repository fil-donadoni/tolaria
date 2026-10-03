import { describe, it, expect } from "vitest";
import {
    bladeDeckKnowledge,
    buildBladeState,
    seatPlayerId,
    BLADE_SCENARIOS,
} from "../ai/blade";
import { cloneGameState } from "../clone";
import {
    evaluateBreakdown,
    evaluateWithMargin,
    materialMargin,
} from "../evaluate";
import { enumerateMoves } from "../moves";
import {
    applyMoveInSearch,
    policyValue,
    reactivePrior,
    searchWithTrace,
} from "../search";
import { describeMove } from "../describeMove";

/**
 * Byte-identity pin for issue #4461 (PRD #4454): the mana census is computed
 * once per evaluation / probe and handed to every consumer, and the
 * castable-instant probe is hoisted out of the per-edge reactive-prior loop.
 * Both are pure caching — no value may move.
 *
 * The snapshot was recorded BEFORE the change, on the three positions of the
 * search cost fixture (`searchCost.bot.test.ts`, issue #4458), and covers every
 * reader the change re-plumbs: the leaf evaluation and its breakdown from both
 * seats, the material margin, the 1-ply policy value of every legal move (the
 * rollout's `selectRolloutMove` scoring, `policyValueOfSettled`'s combat
 * corrections included), the reactive prior of every legal move, and a whole
 * fixed-budget search's root candidates — which reach the rollout epsilon's
 * held-interaction hint and the in-tree prior loops on positions below the
 * root.
 */

const PREFIXES = [
    "adventure: casts Stomp to kill the blocker",
    "depletion land: spends the last charge because it",
    "redirection shield: shields ITS OWN side and point",
    // A position whose own-main `pass` reads `flashPermanent` as TRUE, so a
    // non-zero reactive prior is pinned too (the three above read 0).
    "flash permanent: holds Containment Priest in its own main with no threat",
];

const ITERATIONS = 100;
const SEED = 0xb1ade;

describe("evaluation values and reactive priors are census-cache invariant (issue #4461)", () => {
    for (const prefix of PREFIXES) {
        it(prefix, () => {
            const found = BLADE_SCENARIOS.filter((s) =>
                s.label.startsWith(prefix)
            );
            expect(found).toHaveLength(1);
            const scenario = found[0];
            const state = buildBladeState(scenario);
            const botId = seatPlayerId(state, scenario.bot);
            const oppId = state.players.find((p) => p.id !== botId)!.id;

            const root = {
                bot: evaluateWithMargin(state, botId),
                opp: evaluateWithMargin(state, oppId),
                margin: materialMargin(state, botId),
                breakdownBot: evaluateBreakdown(state, botId),
                breakdownOpp: evaluateBreakdown(state, oppId),
            };

            const moves = enumerateMoves(state, botId).map((move) => {
                const probe = cloneGameState(state);
                applyMoveInSearch(probe, botId, move);
                const after = cloneGameState(probe);
                // One ply down: the next mover's priors, where the combat and
                // hold shapes of `reactivePrior` actually fire.
                const nextId = after.priorityPlayerId;
                const childPriors = nextId
                    ? enumerateMoves(after, nextId).map((m) =>
                          reactivePrior(after, nextId, m, 0)
                      )
                    : [];
                return {
                    move: describeMove(move, state),
                    leaf: evaluateWithMargin(after, botId),
                    policy: policyValue(probe, botId, move, undefined, botId),
                    prior0: reactivePrior(state, botId, move, 0),
                    childPriors,
                };
            });

            const { trace } = searchWithTrace(
                state,
                botId,
                { iterations: ITERATIONS },
                SEED,
                bladeDeckKnowledge(state, scenario)
            );
            const search = {
                chosen: trace?.chosen,
                iterationsCompleted: trace?.iterationsCompleted,
                candidates: trace?.candidates,
            };

            expect({ root, moves, search }).toMatchSnapshot();
        });
    }
});
