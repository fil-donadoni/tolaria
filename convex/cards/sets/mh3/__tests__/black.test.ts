// MH3 black — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { nethergoyf } from "../black";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { CardInstanceState } from "../../../../gre/state";
import type { CardType } from "../../../types";

// A dead card of a chosen card type sitting in a graveyard (the CDA reads the
// instance `.types`).
function deadCard(id: string, owner: string, types: CardType[]): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types,
        subtypes: [],
        staticAbilities: [],
        power: 0,
        toughness: 0,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
        isTapped: false,
    };
}

describe("Nethergoyf (CR 604.3 card-type-counting CDA P/T, CR 702.138 escape)", () => {
    it("power = distinct card types in YOUR graveyard, toughness = that + 1", () => {
        const goyf = makeInstance(nethergoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("c2", "p1", ["Creature"]), // dup type
                        deadCard("l1", "p1", ["Land"]),
                        deadCard("i1", "p1", ["Instant"]),
                    ],
                }),
                // Opponent's graveyard must NOT count ("YOUR graveyard").
                makePlayer("p2", {
                    graveyard: [deadCard("x1", "p2", ["Sorcery"])],
                }),
            ],
        });
        const after = state.players[0].battlefield[0];
        // Creature, Land, Instant = 3 distinct types in p1's graveyard → 3/4.
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("MANDATORY wire format: the card-type count survives projectPublicState", () => {
        const goyf = makeInstance(nethergoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("i1", "p1", ["Instant"]),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].battlefield[0];
        expect(getEffectivePower(state, before)).toBe(2);
        expect(getEffectiveToughness(state, before)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "goyf"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("declares its printed escape cost (CR 702.138a variable exile)", () => {
        expect(nethergoyf.escape).toEqual({
            mana: { X: 2, B: 1 },
            exile: { minCardTypes: 4 },
        });
    });
});
