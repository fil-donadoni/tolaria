// ZNR — multicolor card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { omnathLocusOfCreation } from "../multicolor";
import { swamp, grizzlyBears } from "../../lea";
import { registerTokenDefinition } from "../../..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";

// A synthetic Planeswalker so the third-resolution "each planeswalker you
// don't control" sweep has something to hit.
const OPPONENT_PLANESWALKER_ID = "test-znr-opponent-planeswalker";
registerTokenDefinition({
    id: OPPONENT_PLANESWALKER_ID,
    name: OPPONENT_PLANESWALKER_ID,
    rarity: "rare",
    manaCost: { X: 3 },
    types: ["Planeswalker"],
    subtypes: ["Test"],
    toughness: 5,
});

/** Synthesizes the PERMANENT_ENTERED event a land drop emits (CR 603.6a). */
function landEntered(instanceId: string, controllerId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        cardId: swamp.id,
        types: ["Land"] as const,
    };
}

function setup() {
    const omnath = makeInstance(omnathLocusOfCreation.id, {
        id: "omnath",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [omnath] }),
            makePlayer("p2"),
        ],
    });
    return { state, omnath };
}

describe("Omnath, Locus of Creation (CR 603.6a ETB / Landfall CAP #694 / issue #1189)", () => {
    it("shape: 4/4 for {R}{G}{W}{U} with the ETB draw + Landfall triggers declared", () => {
        expect(omnathLocusOfCreation.manaCost).toEqual({
            R: 1,
            G: 1,
            W: 1,
            U: 1,
        });
        expect(omnathLocusOfCreation.power).toBe(4);
        expect(omnathLocusOfCreation.toughness).toBe(4);
        expect(omnathLocusOfCreation.supertypes).toEqual(["Legendary"]);
        expect(omnathLocusOfCreation.subtypes).toEqual(["Elemental"]);
        expect(omnathLocusOfCreation.triggeredAbilities).toHaveLength(2);
    });

    it("ETB: draws a card when Omnath enters (CR 603.6a)", () => {
        const { state } = setup();
        const libCard = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        state.players[0].library = [libCard];
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PERMANENT_ENTERED" as const,
                    instanceId: "omnath",
                    controllerId: "p1",
                    cardId: omnathLocusOfCreation.id,
                    types: ["Creature"] as const,
                },
            ])
        );
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib1");
    });

    it("landfall, first resolution this turn: gains 4 life", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [landEntered("land1", "p1")])
        );
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(24); // 20 + 4
        expect(state.players[0].manaPool).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 0,
        });
    });

    it("landfall, second resolution the same turn: adds {R}{G}{W}{U} instead", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [landEntered("land1", "p1")])
        );
        resolveTopOfStack(state);
        state.stack.push(
            ...collectTriggers(state, [landEntered("land2", "p1")])
        );
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(24); // unchanged since the first
        expect(state.players[0].manaPool).toEqual({
            W: 1,
            U: 1,
            B: 0,
            R: 1,
            G: 1,
            C: 0,
        });
    });

    it("landfall, third resolution the same turn: deals 4 damage to each opponent and each planeswalker they control", () => {
        const { state } = setup();
        const opponentWalker = makeInstance(OPPONENT_PLANESWALKER_ID, {
            id: "opp-pw",
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty: 6 },
        });
        state.players[1].battlefield.push(opponentWalker);
        for (let i = 0; i < 3; i++) {
            state.stack.push(
                ...collectTriggers(state, [landEntered(`land${i}`, "p1")])
            );
            resolveTopOfStack(state);
        }
        expect(state.players[1].life).toBe(16); // 20 - 4
        // CR 120.3 / 704.5i — damage to a planeswalker removes loyalty
        // counters instead of being marked.
        const walker = state.players[1].battlefield.find(
            (c) => c.id === "opp-pw"
        )!;
        expect(walker.counters?.loyalty).toBe(2); // 6 - 4
    });

    it("landfall, fourth-or-later resolution the same turn: no-op (only three modes exist)", () => {
        const { state } = setup();
        for (let i = 0; i < 4; i++) {
            state.stack.push(
                ...collectTriggers(state, [landEntered(`land${i}`, "p1")])
            );
            resolveTopOfStack(state);
        }
        // Life gained on resolution 1 (+4) is the only change; resolutions
        // 2-4 add mana / deal damage to the OPPONENT / no-op — p1's life
        // stays at 24 throughout.
        expect(state.players[0].life).toBe(24);
    });

    it("survives the wire projection (life + mana pool after the escalating branches are server-computed)", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [landEntered("land1", "p1")])
        );
        resolveTopOfStack(state);
        state.stack.push(
            ...collectTriggers(state, [landEntered("land2", "p1")])
        );
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(24);
        expect(projected.players[0].manaPool).toEqual({
            W: 1,
            U: 1,
            B: 0,
            R: 1,
            G: 1,
            C: 0,
        });
    });
});
