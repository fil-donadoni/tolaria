import { describe, expect, it } from "vitest";
import {
    deckCardTitle,
    deckSideCardTitle,
    moveToMaindeckCardTitle,
    moveToSideboardCardTitle,
} from "../deckBuilderVariant";

const card = { cardId: "c1", cardName: "Llanowar Elves" };

// Issue #9993: the tile tooltip names what a click actually does.
describe("deck tile titles follow the click's effect", () => {
    it("Limited Sideboard tile says it adds to the Maindeck", () => {
        expect(moveToMaindeckCardTitle(card)).toContain(
            "Add Llanowar Elves to Maindeck"
        );
        expect(moveToMaindeckCardTitle(card)).not.toMatch(/Remove/);
    });
    it("Limited Maindeck tile says it moves to the Sideboard", () => {
        expect(moveToSideboardCardTitle(card)).toContain(
            "Move Llanowar Elves to Sideboard"
        );
    });
    it("Constructed tiles keep Remove, Sideboard one names its zone", () => {
        expect(deckCardTitle(card)).toMatch(/^Remove Llanowar Elves/);
        expect(deckSideCardTitle(card)).toContain("from the Sideboard");
    });
});
