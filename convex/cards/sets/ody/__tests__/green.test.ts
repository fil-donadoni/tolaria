// Odyssey (ODY) — green card behavior tests (ADR 0043 colour split). Each
// describe block cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState } from "../../../../gre/state";
import type { CardType } from "../../../types";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const terravore = getDefinition("c39c412b-2f21-483a-b744-5d55bc007c0d");

// --- Terravore — land-counting CDA P/T (CR 604.3 / 613.4a, layer 7a) --------

describe("Terravore (CR 604.3 land-counting CDA P/T)", () => {
    /** A card sitting in a graveyard with the given types; the CDA reads the
     *  instance `.types`, so the registry id behind it is irrelevant. */
    function gyCard(
        id: string,
        owner: string,
        types: CardType[]
    ): CardInstanceState {
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

    function stateWithGraveyards(
        p1: CardInstanceState[],
        p2: CardInstanceState[]
    ) {
        const goyf = makeInstance(terravore.id, {
            id: "terravore",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [goyf], graveyard: p1 }),
                makePlayer("p2", { graveyard: p2 }),
            ],
        });
    }

    it("power AND toughness both equal the land cards in ALL graveyards", () => {
        const state = stateWithGraveyards(
            [
                gyCard("l1", "p1", ["Land"]),
                gyCard("l2", "p1", ["Land"]),
                // Not a land → ignored, even though it is a permanent card.
                gyCard("c1", "p1", ["Creature"]),
            ],
            // The opposing bin counts too ("all graveyards").
            [gyCard("l3", "p2", ["Land"])]
        );
        const live = state.players[0].battlefield[0];
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("empty graveyards leave it 0/0 (SBA fodder, CR 704.5f)", () => {
        const state = stateWithGraveyards([], []);
        const live = state.players[0].battlefield[0];
        expect(getEffectivePower(state, live)).toBe(0);
        expect(getEffectiveToughness(state, live)).toBe(0);
    });

    it("MANDATORY wire format: the count survives projectPublicState", () => {
        const state = stateWithGraveyards(
            [gyCard("l1", "p1", ["Land"])],
            [gyCard("l2", "p2", ["Land"]), gyCard("l3", "p2", ["Land"])]
        );
        const live = state.players[0].battlefield[0];
        expect(getEffectivePower(state, live)).toBe(3);

        // The projection strips `card` but keeps `.types` on graveyard cards,
        // so the CDA recomputes the identical P/T on the wire.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "terravore"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});
