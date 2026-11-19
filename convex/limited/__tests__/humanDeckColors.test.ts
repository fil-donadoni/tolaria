// Issue #9994 — a deck's colours are its NONLAND cards' colours; a triome in an
// R/G deck must not add B. CR 105.1 (colours are WUBRG) / 305 (lands are
// colourless objects; their mana is not a deck colour).
import { describe, expect, it } from "vitest";
import { humanDeckColors } from "../humanDeckColors";
import { deckColorsOfNonlands } from "../../cards/colors";

const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const ZIATORA = "75fdce80-e338-4a50-bdc6-786511feaeef"; // B/R/G triome

describe("humanDeckColors", () => {
    it("R/G deck with Ziatora's Proving Ground reads R/G, not B/R/G", () => {
        expect(
            humanDeckColors({
                cards: [
                    { cardId: BOLT },
                    { cardId: ZIATORA },
                    { cardId: MOUNTAIN },
                ],
                colors: ["B", "R", "G"],
            })
        ).toEqual(["R"]);
    });

    it("falls back to the saved colours when no card resolves", () => {
        expect(
            humanDeckColors({ cards: [{ cardId: "nope" }], colors: ["W"] })
        ).toEqual(["W"]);
    });
});

describe("deckColorsOfNonlands", () => {
    it("R + G spells with a B/R/G triome → R/G in WUBRG order", () => {
        expect(
            deckColorsOfNonlands([
                { isLand: false, colors: ["G"] },
                { isLand: false, colors: ["R"] },
                { isLand: true, colors: ["B", "R", "G"] },
            ])
        ).toEqual(["R", "G"]);
    });
});
