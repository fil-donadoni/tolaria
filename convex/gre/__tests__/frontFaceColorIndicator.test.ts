// CR 202.2e / 204.2 — "An object with a color indicator is each color denoted
// by that color indicator." A front face's indicator lives on
// `CardDefinition.colorIndicator`; Living End has no mana cost (CR 204.1) and
// is black in every zone, on the stack and on the client.

import { describe, expect, it } from "vitest";
import { cardHasColor, getCardColors } from "../../cards/colors";
import { getEffectiveColors } from "../../cards/effectiveColors";
import { livingEnd } from "../../cards/sets/tsp/black.cards";
import { inevitableBetrayal } from "../../cards/sets/mh2/blue.cards";
import type { CardDefinition, PermanentView } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { syncLayers2to5 } from "../layers2to5";
import type { GameState } from "../state";

const colorsOf = (card: unknown) =>
    [...getEffectiveColors(card as PermanentView)].sort();

function board() {
    const inHand = makeInstance(livingEnd().id, {
        id: "le-hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const inGraveyard = makeInstance(livingEnd().id, {
        id: "le-graveyard",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state: GameState = makeState({
        players: [
            makePlayer("p1", { hand: [inHand], graveyard: [inGraveyard] }),
            makePlayer("p2"),
        ],
    });
    const spell = pushSpell(state, livingEnd().id, "p1");
    return { state, inHand, inGraveyard, spell };
}

describe("front-face colour indicator (CR 202.2e / 204.2)", () => {
    it("a card with no mana cost is each colour its indicator denotes", () => {
        expect(getCardColors(livingEnd())).toEqual(["B"]);
        expect(cardHasColor(inevitableBetrayal(), "U")).toBe(true);
    });

    it("unions with the mana cost's colours, in WUBRG order", () => {
        const def = {
            ...livingEnd(),
            manaCost: { R: 1 },
            colorIndicator: ["G", "W", "R"],
        } satisfies CardDefinition;
        expect(getCardColors(def)).toEqual(["W", "R", "G"]);
    });

    it("a Living End instance is black in hand, graveyard and on the stack", () => {
        const { state, inHand, inGraveyard, spell } = board();
        syncLayers2to5(state);
        expect(colorsOf(inHand)).toEqual(["B"]);
        expect(colorsOf(inGraveyard)).toEqual(["B"]);
        expect(colorsOf(spell)).toEqual(["B"]);
    });

    it("wire format: the client reads it black through projectPublicState", () => {
        const { state } = board();
        syncLayers2to5(state);
        const view = projectPublicState(state, 1, "p1");
        expect(colorsOf(view.players[0].hand[0])).toEqual(["B"]);
        expect(colorsOf(view.players[0].graveyard[0])).toEqual(["B"]);
        expect(colorsOf(view.stack[0])).toEqual(["B"]);
    });
});
