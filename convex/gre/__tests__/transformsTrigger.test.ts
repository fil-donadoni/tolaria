// "When this creature transforms into {self}" (CR 701.27e, issue #8164).
//
//   - The event: `SpellContext.transform` queues one `PERMANENT_TRANSFORMED`
//     for a real flip, and none for an instruction that moved nothing.
//   - The face: the ability is collected from the face now up, in either
//     direction, so "into {self}" fires only on the flip that reached it.
//   - Wire format: the opponent's projection carries the trigger on the stack.
//   - Full path: Concealing Curtains' own ability flips it, Revealing Eye's
//     trigger goes on the stack, and the optional pick gates discard + draw.

import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import { transformsTrigger } from "../../cards/abilities/triggers/transformsTrigger";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { activateAbilityOnState } from "../activation";
import { refreshExpectedInput } from "../expectedInput";
import { resolveTopOfStack, type GameState } from "../state";

const transformAbility = {
    id: "flip",
    oracleText: "{0}: Transform this creature.",
    cost: {},
    useStack: true,
    effects: [{ op: "transform" as const, target: { ref: "$source" } }],
};
const gain = (id: string, amount: number) =>
    transformsTrigger({
        id,
        oracleText: `When this creature transforms into {self}, you gain ${amount} life.`,
        effects: [{ op: "gainLife", player: "controller", amount }],
    });

const TWO_FACED = "test-transforms-two-faced";
registerTokenDefinition({
    id: TWO_FACED,
    name: "Test Curtain",
    rarity: "common",
    manaCost: {},
    types: ["Creature"],
    power: 0,
    toughness: 4,
    activatedAbilities: [transformAbility],
    triggeredAbilities: [gain("front-face", 1)],
    backFace: {
        name: "Test Eye",
        types: ["Creature"],
        power: 3,
        toughness: 4,
        activatedAbilities: [transformAbility],
        triggeredAbilities: [gain("back-face", 7)],
    },
});
const ONE_FACED = "test-transforms-one-faced";
registerTokenDefinition({
    id: ONE_FACED,
    name: "Test Single Face",
    rarity: "common",
    manaCost: {},
    types: ["Creature"],
    power: 1,
    toughness: 1,
    activatedAbilities: [transformAbility],
});

function board(id: string, p2Hand: string[] = []): GameState {
    const state = makeState({
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                battlefield: [makeInstance(id, { id: "flipper" })],
                manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", {
                hand: p2Hand.map((cardId, i) =>
                    makeInstance(cardId, {
                        id: `p2-hand-${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "hand",
                    })
                ),
                library: [
                    makeInstance(getCardByName("Plains").id, {
                        id: "p2-top",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    }),
                ],
            }),
        ],
    });
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    refreshExpectedInput(state);
    return state;
}

/** Announce the transform and resolve it: its trigger, if any, is what is left
 *  on the stack. */
function flip(state: GameState, abilityId = "flip"): void {
    state.priorityPlayerId = "p1";
    state.passCount = 0;
    refreshExpectedInput(state);
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "flipper",
        abilityId,
        keepPriority: true,
    });
    resolveTopOfStack(state);
}

const life = (state: GameState) => state.players[0].life;

describe("PERMANENT_TRANSFORMED — which instructions emit it (CR 701.27e)", () => {
    it("a real flip puts the new face's trigger on the stack, sourced from the permanent", () => {
        const state = board(TWO_FACED);
        flip(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggerSourceId).toBe("flipper");
        expect(state.stack[0].triggerEvent).toEqual({
            type: "PERMANENT_TRANSFORMED",
            permanentId: "flipper",
            controllerId: "p1",
        });
    });

    it("CR 701.27c: a permanent with no other face transforms into nothing and emits nothing", () => {
        const state = board(ONE_FACED);
        flip(state);
        expect(state.stack).toHaveLength(0);
    });

    it("wire format: the opponent's projection carries the trigger", () => {
        const state = board(TWO_FACED);
        flip(state);
        const opp = projectPublicState(state, 1, "p2");
        expect(opp.stack).toHaveLength(1);
        expect(opp.stack[0].triggerSourceId).toBe("flipper");
    });
});

describe("'into {self}' reads the face now up (CR 701.27e)", () => {
    it("front → back fires only the back face's ability", () => {
        const state = board(TWO_FACED);
        const before = life(state);
        flip(state);
        resolveTopOfStack(state);
        expect(life(state)).toBe(before + 7);
        expect(state.stack).toHaveLength(0);
    });

    it("back → front fires only the front face's ability", () => {
        const state = board(TWO_FACED);
        flip(state);
        resolveTopOfStack(state);
        const before = life(state);
        flip(state);
        resolveTopOfStack(state);
        expect(life(state)).toBe(before + 1);
        expect(state.players[0].battlefield[0].transformed).toBeUndefined();
    });
});

describe("Concealing Curtains // Revealing Eye (full path)", () => {
    const CURTAINS = getCardByName("Concealing Curtains").id;
    const BEARS = getCardByName("Grizzly Bears").id;
    const PLAINS = getCardByName("Plains").id;

    /** Flip (the only opponent is the only legal target), resolve up to the pick. */
    function toThePick(hand: string[]): GameState {
        const state = board(CURTAINS, hand);
        flip(state, "concealing-curtains-ability");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        return state;
    }

    it("a chosen card is discarded and its owner draws (CR 701.9b + CR 608.2c)", () => {
        const state = toThePick([BEARS, PLAINS]);
        submitChoice(state, ["p2-hand-0"]);
        const p2 = state.players[1];
        expect(p2.graveyard.map((c) => c.id)).toEqual(["p2-hand-0"]);
        expect(p2.hand.map((c) => c.id).sort()).toEqual([
            "p2-hand-1",
            "p2-top",
        ]);
    });

    it("declining the pick discards nothing and draws nothing (CR 608.2c)", () => {
        const state = toThePick([BEARS, PLAINS]);
        submitChoice(state, []);
        const p2 = state.players[1];
        expect(p2.graveyard).toHaveLength(0);
        expect(p2.hand.map((c) => c.id).sort()).toEqual([
            "p2-hand-0",
            "p2-hand-1",
        ]);
        expect(p2.library).toHaveLength(1);
    });
});
