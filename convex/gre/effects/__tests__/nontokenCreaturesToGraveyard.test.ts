// CR 700.4 + CR 111.7 — the per-owner "nontoken creatures put into your
// graveyard from the battlefield this turn" tally and the
// `nontokenCreaturesToGraveyardThisTurn` EffectValue that reads it, driven
// through the real battlefield-departure funnel (`removePermanentTo`) and the
// real stack resolution; the wire format through `projectPublicState`.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import type { EffectOp } from "../../../cards/types";
import { projectPublicState } from "../../../gameProjections";
import { advancePhase } from "../../phases";
import { compactState, expandState } from "../../serialize";
import { removePermanentTo, resolveTopOfStack } from "../../state";
import type { GameState } from "../../state";

const CREATURE_ID = "test-nontoken-tally-creature";
registerTokenDefinition({
    id: CREATURE_ID,
    name: "Tally Fodder",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
});

const SCRIPT_ID = "test-nontoken-tally-script";
const COUNT_SCRIPT: EffectOp[] = [
    {
        op: "createToken",
        token: {
            name: "Bear",
            types: ["Creature"],
            subtypes: ["Bear"],
            power: 2,
            toughness: 2,
            colors: ["G"],
        },
        controller: "controller",
        count: { nontokenCreaturesToGraveyardThisTurn: { of: "controller" } },
    },
];
registerTokenDefinition({
    id: SCRIPT_ID,
    name: SCRIPT_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    effects: COUNT_SCRIPT,
});

function fodder(id: string, owner: "p1" | "p2", isToken = false) {
    return makeInstance(CREATURE_ID, {
        id,
        controllerId: owner,
        ownerId: owner,
        ...(isToken ? { isToken: true } : {}),
    });
}

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    fodder("a1", "p1"),
                    fodder("a2", "p1"),
                    fodder("tok", "p1", true),
                ],
            }),
            makePlayer("p2", { battlefield: [fodder("b1", "p2")] }),
        ],
    });
}

const bears = (state: GameState) =>
    state.players[0].battlefield.filter((c) => c.subtypes.includes("Bear"));

describe("nontokenCreaturesToGraveyardThisTurn (CR 700.4, CR 111.7)", () => {
    it("creates one token per nontoken creature put into the controller's graveyard", () => {
        const state = board();
        removePermanentTo(state, "a1", "graveyard");
        removePermanentTo(state, "a2", "graveyard");
        pushSpell(state, SCRIPT_ID, "p1", []);
        resolveTopOfStack(state);
        expect(bears(state)).toHaveLength(2);
    });

    it("does not count a token that died (CR 111.7)", () => {
        const state = board();
        removePermanentTo(state, "a1", "graveyard");
        removePermanentTo(state, "tok", "graveyard");
        pushSpell(state, SCRIPT_ID, "p1", []);
        resolveTopOfStack(state);
        expect(bears(state)).toHaveLength(1);
    });

    it("does not count a creature that went to the opponent's graveyard, nor one that was exiled or bounced", () => {
        const state = board();
        removePermanentTo(state, "b1", "graveyard");
        removePermanentTo(state, "a1", "exile");
        removePermanentTo(state, "a2", "hand");
        pushSpell(state, SCRIPT_ID, "p1", []);
        resolveTopOfStack(state);
        expect(bears(state)).toHaveLength(0);
        expect(state.players[1].nontokenCreaturesToGraveyardThisTurn).toBe(1);
    });

    it("is turn-scoped: the tally resets when the next turn begins", () => {
        const state = board();
        removePermanentTo(state, "a1", "graveyard");
        expect(state.players[0].nontokenCreaturesToGraveyardThisTurn).toBe(1);
        const turn = state.turn;
        for (let i = 0; i < 20 && state.turn === turn; i++) advancePhase(state);
        expect(state.turn).not.toBe(turn);
        expect(
            state.players[0].nontokenCreaturesToGraveyardThisTurn
        ).toBeUndefined();
    });

    it("survives a compact/expand round trip", () => {
        const state = board();
        removePermanentTo(state, "a1", "graveyard");
        const back = expandState(compactState(state));
        expect(back.players[0].nontokenCreaturesToGraveyardThisTurn).toBe(1);
    });

    it("wire format: the projected tally and the resolved tokens survive projectPublicState", () => {
        const state = board();
        removePermanentTo(state, "a1", "graveyard");
        removePermanentTo(state, "a2", "graveyard");
        pushSpell(state, SCRIPT_ID, "p1", []);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].nontokenCreaturesToGraveyardThisTurn).toBe(
            2
        );
        expect(
            projected.players[0].battlefield.filter((c) =>
                c.subtypes?.includes("Bear")
            )
        ).toHaveLength(2);
    });
});
