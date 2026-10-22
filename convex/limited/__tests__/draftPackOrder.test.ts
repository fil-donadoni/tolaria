// Draft Booster display order (issue #5936): rarest first, name as tie-break.
// CR 206 — rarity is a property of the printing.
import { describe, it, expect } from "vitest";
import { compareDraftPackCards } from "../draftPackOrder";
import type { Rarity } from "../../cards/types";

const card = (cardName: string, rarity?: Rarity) => ({ cardName, rarity });
const order = (cards: ReturnType<typeof card>[]) =>
    [...cards].sort(compareDraftPackCards).map((c) => c.cardName);

describe("compareDraftPackCards", () => {
    it("orders mythic, rare, uncommon, common", () => {
        expect(
            order([
                card("C", "common"),
                card("U", "uncommon"),
                card("M", "mythic"),
                card("R", "rare"),
            ])
        ).toEqual(["M", "R", "U", "C"]);
    });

    it("breaks a rarity tie alphabetically", () => {
        expect(order([card("Zap", "common"), card("Ankh", "common")])).toEqual([
            "Ankh",
            "Zap",
        ]);
    });

    it("sorts an unresolved rarity after commons, by name", () => {
        expect(
            order([card("Zed"), card("Alpha"), card("Mid", "common")])
        ).toEqual(["Mid", "Alpha", "Zed"]);
    });
});
