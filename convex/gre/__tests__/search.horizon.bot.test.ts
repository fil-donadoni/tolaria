// ADR 0015 — the rollout horizon is measured on the SEARCH ROOT's clock.
//
// Every root candidate is scored at the start of the bot's next turn after the
// root's, a complete round in which both players had symmetric opportunity to
// act. A tree line made of single forced-looking moves (pass, opponent pass,
// …) is expanded deep by PUCT; when the horizon was read from where each
// rollout STARTED, that narrow line's rollouts began past the boundary and
// played on a further round, while a branching line stayed shallow and was
// scored a round earlier. Two seams hold the boundary: `rollout` stops at once
// on a world already past it, and the tree never expands a node past it.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { buildBladeState } from "../ai/blade/runner";
import { seatPlayerId } from "../ai/blade/matcher";
import type { BladeScenario } from "../ai/blade/types";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { DEFAULT_ACTION_PRIORS } from "../ai/searchVariant";
import { cloneGameState } from "../clone";
import { PHASE_ORDER } from "../phases";
import { enumerateMoves } from "../moves";
import { makeRng } from "../rng";
import {
    advanceToDecision,
    applyMoveInSearch,
    iterate,
    keyedMovesFor,
    pastRootHorizon,
    rollout,
    type Node,
} from "../search";
import type { GameState } from "../state";

function board(): GameState {
    const scenario: BladeScenario = {
        label: "rollout-horizon-unit",
        spec: {
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 0,
            libraryCount: 20,
            cards: [
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Llanowar Elves", owner: "me", zone: "hand" },
            ],
        },
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    };
    return buildBladeState(scenario);
}

function clockOf(state: GameState) {
    return { turn: state.turn, step: PHASE_ORDER.indexOf(state.phase) };
}

/** Pass for whoever decides until `done` holds: the narrow line PUCT deepens. */
function passUntil(state: GameState, done: (s: GameState) => boolean): void {
    for (let i = 0; i < 400 && !done(state); i++) {
        const pid = advanceToDecision(state);
        if (!pid) throw new Error("no decision before the line's end");
        applyMoveInSearch(state, pid, { kind: "pass" });
    }
    expect(done(state)).toBe(true);
}

describe("rollout horizon on the root clock (ADR 0015)", () => {
    it("a pass-chain line and a branching line are both scored at the bot's next turn after the root", () => {
        const root = board();
        const botId = seatPlayerId(root, "me");
        const since = clockOf(root);
        const nextBotTurn = root.turn + 2;

        for (const seed of [1, 2, 3]) {
            // Narrow: passes deepened past the boundary, into the bot's next
            // main phase — where a tree line used to start its rollout.
            const narrow = cloneGameState(root);
            passUntil(
                narrow,
                (s) => s.turn === nextBotTurn && s.phase === "PRECOMBAT_MAIN"
            );
            rollout(narrow, botId, makeRng(seed), DEFAULT_EVAL_WEIGHTS, since);

            // Branching: the cast at the root, rolled out from the root's turn.
            const branching = cloneGameState(root);
            const elves = getCardByName("Llanowar Elves").id;
            const cast = enumerateMoves(branching, botId).find(
                (m) =>
                    m.kind === "cast-spell" &&
                    branching.players[0].hand.some(
                        (c) =>
                            c.id === m.cardInstanceId &&
                            (c.card as { id?: string }).id === elves
                    )
            );
            expect(cast).toBeDefined();
            applyMoveInSearch(branching, botId, cast!);
            rollout(
                branching,
                botId,
                makeRng(seed),
                DEFAULT_EVAL_WEIGHTS,
                since
            );

            for (const leaf of [narrow, branching]) {
                expect(leaf.turn).toBe(nextBotTurn);
                expect(leaf.activePlayerId).toBe(botId);
            }
            // Already past the boundary: scored where it stood, no ply played.
            expect(narrow.phase).toBe("PRECOMBAT_MAIN");
        }
    });

    it("the tree never expands a node past the root horizon", () => {
        const root = board();
        const botId = seatPlayerId(root, "me");
        const tree: Node = { children: new Map() };
        const rng = makeRng(7);
        for (let i = 0; i < 300; i++) {
            iterate(
                tree,
                root,
                botId,
                rng,
                DEFAULT_EVAL_WEIGHTS,
                undefined,
                DEFAULT_ACTION_PRIORS
            );
        }

        // Replay every edge by its stable key from the root and record the
        // nodes that stand at or past the boundary.
        let atBoundary = 0;
        let expandedPast = 0;
        const walk = (node: Node, world: GameState): void => {
            const pid = advanceToDecision(world);
            const edges = [
                ...node.children.values(),
                ...[...(node.optionViews?.values() ?? [])].flatMap((v) => [
                    ...v.children.values(),
                ]),
            ];
            if (pastRootHorizon(world, root.turn, botId)) {
                atBoundary += 1;
                if (edges.length > 0) expandedPast += 1;
                return;
            }
            if (!pid) return;
            const keyed = keyedMovesFor(world, pid, botId);
            for (const edge of edges) {
                const k = keyed.find((x) => x.key === edge.key);
                if (!k) continue;
                const next = cloneGameState(world);
                applyMoveInSearch(next, pid, k.move);
                walk(edge.node, next);
            }
        };
        walk(tree, cloneGameState(root));

        // Non-vacuous: the narrow lines did reach the boundary.
        expect(atBoundary).toBeGreaterThan(0);
        expect(expandedPast).toBe(0);
    });
});
