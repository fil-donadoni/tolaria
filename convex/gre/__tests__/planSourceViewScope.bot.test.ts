// Issue #10755 — one enumeration derives a mana source's options once.
//
// `enumerateMoves` prices one cost per activated ability (and per announceable
// X, per cast, per alternative cost), and every pricing reads each untapped
// permanent's mana options. Within one enumeration of one position those
// options cannot change, so they are derived once and shared — and never past
// the call, since the next call may be handed the same state object mutated.
import { beforeEach, describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";

/** How many times the rock's mana gate was asked, and what it answers. */
let gateReads = 0;
let gateOpen = true;

const ROCK_ID = "plan-scope-test-rock";
const ENGINE_ID = "plan-scope-test-engine";
const WIDE_ENGINE_ID = "plan-scope-test-wide-engine";

const gain = (id: string) => ({
    id,
    oracleText: "{1}: You gain 1 life.",
    cost: { mana: { X: 1 } },
    useStack: true,
    effects: [{ op: "gainLife", player: "controller", amount: 1 }],
});

preloadDefinitions([
    {
        id: ROCK_ID,
        name: "Plan Scope Test Rock",
        rarity: "common",
        manaCost: {},
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "plan-scope-test-rock-mana",
                oracleText: "{T}: Add {C}.",
                cost: { tap: true },
                useStack: false,
                manaProduced: { C: 1 },
                canActivate: () => {
                    gateReads++;
                    return gateOpen;
                },
            },
        ],
    } as CardDefinition,
    {
        id: ENGINE_ID,
        name: "Plan Scope Test Engine",
        rarity: "common",
        manaCost: {},
        types: ["Artifact"],
        activatedAbilities: [gain("plan-scope-test-gain-0")],
    } as CardDefinition,
    {
        id: WIDE_ENGINE_ID,
        name: "Plan Scope Test Wide Engine",
        rarity: "common",
        manaCost: {},
        types: ["Artifact"],
        activatedAbilities: [0, 1, 2, 3, 4, 5].map((n) =>
            gain(`plan-scope-test-wide-gain-${n}`)
        ),
    } as CardDefinition,
]);

function board(engineId: string): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(ROCK_ID, {
                        id: "rock",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(engineId, {
                        id: "engine",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

const activations = (state: GameState) =>
    enumerateMoves(state, "p1").filter((m) => m.kind === "activate-ability");

describe("enumerateMoves: a mana source's options within one enumeration (issue #10755)", () => {
    beforeEach(() => {
        gateReads = 0;
        gateOpen = true;
    });

    it("six costed abilities read the source's gate as often as one does", () => {
        expect(activations(board(ENGINE_ID))).toHaveLength(1);
        const readsForOne = gateReads;
        expect(readsForOne).toBeGreaterThan(0);

        gateReads = 0;
        expect(activations(board(WIDE_ENGINE_ID))).toHaveLength(6);
        expect(gateReads).toBe(readsForOne);
    });

    it("the next enumeration of the same state object reads the source again", () => {
        const state = board(WIDE_ENGINE_ID);
        expect(activations(state)).toHaveLength(6);

        // The same object, a different position: the rock's gate has closed,
        // so nothing funds the abilities any more.
        gateOpen = false;
        expect(activations(state)).toHaveLength(0);
    });
});
