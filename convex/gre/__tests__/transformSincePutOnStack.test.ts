/**
 * CR 701.27f (issue #3537) — "If an activated or triggered ability of a
 * permanent that isn't a delayed triggered ability of that permanent tries to
 * transform it, the permanent does so only if it hasn't transformed or
 * converted since the ability was put onto the stack."
 *
 * The delayed-trigger sentence of the same rule is covered by Aang, at the
 * Crossroads (`cards/sets/tla/__tests__/multicolor.test.ts`, issue #3249).
 */
import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { activateAbilityOnState } from "../activation";
import { buildActivatedAbilityStackItem } from "../activationCommit";
import { refreshExpectedInput } from "../expectedInput";
import { compactState, expandState } from "../serialize";
import { resolveTopOfStack, type GameState } from "../state";
import { collectTriggers, placeTriggersOnStack } from "../triggers";

const SELF_ID = "test-701-27f-self-transformer";
registerTokenDefinition({
    id: SELF_ID,
    name: "Test Self Transformer",
    rarity: "common",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "self-transform",
            oracleText: "{2}: Transform this artifact.",
            cost: { mana: { X: 2 } },
            useStack: true,
            effects: [{ op: "transform", target: { ref: "$source" } }],
        },
    ],
    triggeredAbilities: [
        {
            id: "self-transform-upkeep",
            oracleText:
                "At the beginning of each upkeep, transform this artifact.",
            event: "PHASE_BEGIN",
            matches: (event) =>
                event.type === "PHASE_BEGIN" && event.phase === "UPKEEP",
            effects: [{ op: "transform", target: { ref: "$source" } }],
        },
    ],
    backFace: {
        name: "Test Self Transformer Back",
        types: ["Artifact"],
        staticAbilities: [],
        activatedAbilities: [
            {
                id: "self-transform",
                oracleText: "{2}: Transform this artifact.",
                cost: { mana: { X: 2 } },
                useStack: true,
                effects: [{ op: "transform", target: { ref: "$source" } }],
            },
        ],
    },
});

const OTHER_ID = "test-701-27f-other-transformer";
registerTokenDefinition({
    id: OTHER_ID,
    name: "Test Other Transformer",
    rarity: "common",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "other-transform",
            oracleText: "{1}: Transform target artifact.",
            cost: { mana: { X: 1 } },
            useStack: true,
            effects: [{ op: "transform", target: { target: 0 } }],
        },
    ],
});

function board(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(SELF_ID, { id: "self" }),
                    makeInstance(OTHER_ID, { id: "other" }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 },
            }),
            makePlayer("p2"),
        ],
    });
    refreshExpectedInput(state);
    return state;
}

function self(state: GameState) {
    return state.players[0].battlefield.find((c) => c.id === "self")!;
}

function activateSelfTransform(state: GameState): void {
    // Priority input is not what these tests are about: hand it back to p1
    // before each announcement.
    state.priorityPlayerId = "p1";
    state.passCount = 0;
    refreshExpectedInput(state);
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "self",
        abilityId: "self-transform",
        keepPriority: true,
    });
}

describe("CR 701.27f — a non-delayed ability of a permanent transforms it only if it hasn't transformed since the ability was put onto the stack", () => {
    it("activated twice before resolving: the first resolution transforms it, the second is ignored", () => {
        const state = board();
        activateSelfTransform(state);
        activateSelfTransform(state);
        expect(state.stack).toHaveLength(2);

        resolveTopOfStack(state);
        expect(self(state).transformed).toBe(true);
        resolveTopOfStack(state);
        // Not flipped back to the front face.
        expect(self(state).transformed).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("the stamps survive a save between the two resolutions", () => {
        const state = board();
        activateSelfTransform(state);
        activateSelfTransform(state);
        resolveTopOfStack(state);
        expect(self(state).transformed).toBe(true);

        const reloaded = expandState(compactState(state));
        resolveTopOfStack(reloaded);
        expect(self(reloaded).transformed).toBe(true);
    });

    it("an ability activated AFTER the permanent transformed still transforms it back", () => {
        const state = board();
        activateSelfTransform(state);
        resolveTopOfStack(state);
        expect(self(state).transformed).toBe(true);

        activateSelfTransform(state);
        resolveTopOfStack(state);
        expect(self(state).transformed).toBeFalsy();
    });

    it("triggered twice before resolving: the first resolution transforms it, the second is ignored", () => {
        const state = board();
        const upkeep = {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as const;
        placeTriggersOnStack(state, collectTriggers(state, [upkeep]));
        placeTriggersOnStack(state, collectTriggers(state, [upkeep]));
        const triggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "self-transform-upkeep"
        );
        expect(triggers).toHaveLength(2);
        state.stack = triggers;

        resolveTopOfStack(state);
        expect(self(state).transformed).toBe(true);
        resolveTopOfStack(state);
        expect(self(state).transformed).toBe(true);
    });

    it("an ability of a DIFFERENT permanent that transforms it is unaffected", () => {
        const state = board();
        const other = state.players[0].battlefield.find(
            (c) => c.id === "other"
        )!;
        for (let i = 0; i < 2; i++) {
            state.stack.push(
                buildActivatedAbilityStackItem(other, {
                    castById: "p1",
                    abilityId: "other-transform",
                    targets: [{ type: "permanent", id: "self" }],
                })
            );
        }

        resolveTopOfStack(state);
        expect(self(state).transformed).toBe(true);
        resolveTopOfStack(state);
        // Both resolve: the second flips it back to the front face.
        expect(self(state).transformed).toBeFalsy();
    });
});
