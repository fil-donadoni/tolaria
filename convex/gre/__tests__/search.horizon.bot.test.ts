// ADR 0015 — the rollout horizon measured on the SEARCH ROOT's clock, behind
// the `horizon-b` search variant (issue #10816, PRD issue #10815).
//
// Production reads the horizon from where each rollout STARTS: a narrow tree
// line (a chain of passes PUCT deepened into the Bot's next turn) begins its
// rollout past the boundary and plays a further round, while a branching
// line stays shallow and is scored a round earlier. Under `horizon-b` every
// line is scored at ONE game-clock point — the precombat main phase of the
// first turn after the root's on which the Bot is active — and the tree
// never expands a node past it. Both assertions read the knob through
// `resolveRolloutHorizon(LADDER_VARIANTS["horizon-b"])`, so a knob that is
// ignored reds them.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { buildBladeState } from "../ai/blade/build";
import { seatPlayerId } from "../ai/blade/matcher";
import type { BladeScenario } from "../ai/blade/types";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import {
    DEFAULT_ACTION_PRIORS,
    LADDER_VARIANTS,
    resolveRolloutHorizon,
} from "../ai/searchVariant";
import { cloneGameState } from "../clone";
import { enumerateMoves } from "../moves";
import { PHASE_ORDER } from "../phases";
import { makeRng } from "../rng";
import {
    advanceToDecision,
    applyMoveInSearch,
    iterate,
    keyedMovesFor,
    pastRootHorizon,
    rollout,
    rootHorizonTracker,
    type Node,
    type RootHorizonTracker,
} from "../search";
import type { GameState } from "../state";

const KNOB = resolveRolloutHorizon(LADDER_VARIANTS["horizon-b"]);

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

describe("rollout horizon on the root clock, horizon-b (ADR 0015)", () => {
    it("a pass-chain line and a branching line are both scored at the Bot's next precombat main phase", () => {
        const root = board();
        const botId = seatPlayerId(root, "me");
        const since = clockOf(root);
        const nextBotTurn = root.turn + 2;
        expect(root.activePlayerId).toBe(botId);

        for (const seed of [1, 2, 3]) {
            // Narrow: passes the tree deepened into the Bot's next turn, each
            // state shown to the iteration's tracker as the tree would.
            const narrow = cloneGameState(root);
            const narrowHorizon = rootHorizonTracker(KNOB, root.turn);
            for (let i = 0; i < 400 && narrow.turn < nextBotTurn; i++) {
                if (narrowHorizon) {
                    pastRootHorizon(narrowHorizon, narrow, botId);
                }
                const pid = advanceToDecision(narrow);
                if (!pid) throw new Error("no decision before the line's end");
                applyMoveInSearch(narrow, pid, { kind: "pass" });
            }
            expect(narrow.turn).toBe(nextBotTurn);
            rollout(
                narrow,
                botId,
                makeRng(seed),
                DEFAULT_EVAL_WEIGHTS,
                since,
                undefined,
                narrowHorizon
            );

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
                since,
                undefined,
                rootHorizonTracker(KNOB, root.turn)
            );

            for (const leaf of [narrow, branching]) {
                expect(leaf.gameOver).toBeFalsy();
                expect(leaf.turn).toBe(nextBotTurn);
                expect(leaf.activePlayerId).toBe(botId);
                expect(leaf.phase).toBe("PRECOMBAT_MAIN");
            }
        }
    });

    it("the tree holds no node expanded past the boundary", () => {
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
                DEFAULT_ACTION_PRIORS,
                undefined,
                null,
                false,
                undefined,
                undefined,
                KNOB
            );
        }

        // Replay every edge by its stable key from the root, each path with
        // its own tracker (the instrument, independent of the knob), and
        // count the nodes standing at the boundary and those expanded there.
        let atBoundary = 0;
        let expandedPast = 0;
        const walk = (
            node: Node,
            world: GameState,
            seen: RootHorizonTracker
        ): void => {
            const edges = [
                ...node.children.values(),
                ...[...(node.optionViews?.values() ?? [])].flatMap((v) => [
                    ...v.children.values(),
                ]),
            ];
            const before = pastRootHorizon(seen, world, botId);
            const pid = before ? null : advanceToDecision(world);
            if (before || pastRootHorizon(seen, world, botId)) {
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
                walk(edge.node, next, { ...seen });
            }
        };
        walk(
            tree,
            cloneGameState(root),
            rootHorizonTracker("next-bot-main", root.turn)!
        );

        // Non-vacuous: the narrow lines did reach the boundary.
        expect(atBoundary).toBeGreaterThan(0);
        expect(expandedPast).toBe(0);
    });
});
