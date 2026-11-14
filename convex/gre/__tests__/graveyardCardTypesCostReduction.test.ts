// CR 601.2f + CR 205.2a: Emrakul, the Promised End costs {1} less for each
// card type among the cards in its caster's graveyard (the
// `graveyard-card-types` census), through the real cast-cost path and the
// wire projection.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../gameProjections";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
} from "../state";
import { getDefinition, preloadDefinitions } from "../../cards";
import { emrakulThePromisedEnd } from "../../cards/sets/emn/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, CardType } from "../../cards/types";

const EMRAKUL = "8d74a469-c71d-4773-99d3-5456b31df424";

/** A graveyard card whose printed types are `types`, backed by a synthetic
 *  registered definition so the instance carries them like a real card. */
function graveyardCard(id: string, types: CardType[], owner = "p1") {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "common",
            types,
            subtypes: [],
        } as CardDefinition,
    ]);
    return makeInstance(id, {
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
    });
}

preloadDefinitions([emrakulThePromisedEnd()]);

function castCost(state: GameState): Record<string, number> {
    const view = makeInstance(EMRAKUL, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const cost = normalizeManaCost(getDefinition(EMRAKUL).manaCost ?? {});
    applyCostModifiers(cost, getCostModifiers(state, view, "spell"));
    return cost;
}

function stateWithGraveyard(
    p1Graveyard: ReturnType<typeof graveyardCard>[],
    p2Graveyard: ReturnType<typeof graveyardCard>[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { graveyard: p1Graveyard }),
            makePlayer("p2", { graveyard: p2Graveyard }),
        ],
    });
}

describe("graveyard-card-types cost reduction (CR 601.2f, CR 205.2a)", () => {
    it("costs the full {13} with an empty graveyard", () => {
        expect(castCost(stateWithGraveyard([]))).toEqual({ X: 13 });
    });

    it("counts distinct types, not cards", () => {
        const state = stateWithGraveyard([
            graveyardCard("g1", ["Creature"]),
            graveyardCard("g2", ["Creature"]),
            graveyardCard("g3", ["Land"]),
        ]);
        expect(castCost(state)).toEqual({ X: 11 });
    });

    it("counts each type of a multi-type card", () => {
        const state = stateWithGraveyard([
            graveyardCard("g1", ["Artifact", "Creature"]),
        ]);
        expect(castCost(state)).toEqual({ X: 11 });
    });

    it("ignores the opponent's graveyard", () => {
        const state = stateWithGraveyard(
            [],
            [graveyardCard("o1", ["Instant"], "p2")]
        );
        expect(castCost(state)).toEqual({ X: 13 });
    });

    it("survives the wire projection", () => {
        const state = stateWithGraveyard([
            graveyardCard("g1", ["Sorcery"]),
            graveyardCard("g2", ["Instant"]),
        ]);
        const projected = projectPublicState(state, 1, "p1");
        expect(castCost(projected as unknown as GameState)).toEqual({ X: 11 });
    });
});
