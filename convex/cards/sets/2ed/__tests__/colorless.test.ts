// Set-wide / registry-parity tests for `convex/cards/sets/2ed/`.
//
// 2ED (Unlimited Edition) reprints the full Beta card list and introduces no
// new cards, so the modules are entirely CardPrint entries that resolve
// printId -> definitionId -> a shared LEA/LEB CardDefinition (ADR 0014). The
// module-load guard in index.ts already throws on a dangling printId; these
// assertions make the reprint contract explicit and verify that Unlimited
// shows up as an extra printing alongside LEA/LEB. This set-wide invariant
// lives with the colorless (catch-all) module per ADR 0043.

import { describe, it, expect } from "vitest";
import {
    airElemental2ed,
    ancestralRecall2ed,
    lightningBolt2ed,
    volcanicIsland2ed,
    circleOfProtectionBlack2ed,
} from "..";
import {
    getDefinition,
    getPrintingsForCard,
    getAllSetCodes,
} from "../../../index";
import { setName } from "../../../setMeta";
import { validateDeck } from "../../../../formats";
import type { ValidatableDeck } from "../../../../formats";

const airElemental = getDefinition("69c3b2a3-0daa-4d42-832d-fcdfda6555ea");
const ancestralRecall = getDefinition("70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");
const volcanicIsland = getDefinition("0324641d-af55-4c53-b4dc-c8262e967da5");
const circleOfProtectionBlack = getDefinition(
    "fa47b4cd-8da4-4544-b011-ba92b7009203"
);

describe("2ED registry parity (ADR 0014)", () => {
    it("resolves reprint prints to their shared LEA definition", () => {
        expect(getDefinition(airElemental2ed.printId)).toBe(airElemental);
        expect(getDefinition(ancestralRecall2ed.printId)).toBe(ancestralRecall);
        expect(getDefinition(lightningBolt2ed.printId)).toBe(lightningBolt);
    });

    it("resolves Beta-original reprints to their LEB definition", () => {
        // Volcanic Island and Circle of Protection: Black never existed in
        // Alpha — their CardDefinition lives in leb, and 2ED reprints it.
        expect(getDefinition(volcanicIsland2ed.printId)).toBe(volcanicIsland);
        expect(getDefinition(circleOfProtectionBlack2ed.printId)).toBe(
            circleOfProtectionBlack
        );
    });
});

describe("2ED as an extra printing", () => {
    it("appends Unlimited to the LEA + LEB printing list, original first", () => {
        const printings = getPrintingsForCard(lightningBolt.id);
        expect(printings[0].setCode).toBe("lea");
        expect(printings).toContainEqual({
            printId: lightningBolt2ed.printId,
            setCode: "2ed",
        });
    });

    it("is included in the catalogue's set codes", () => {
        expect(getAllSetCodes()).toContain("2ed");
    });
});

describe("2ED display name (#560)", () => {
    it("maps the 2ed code to its human-readable name", () => {
        expect(setName("2ed")).toBe("Unlimited Edition");
        // case-insensitive, no upper-cased fallback
        expect(setName("2ED")).toBe("Unlimited Edition");
    });
});

describe("2ED Old School legality (#560)", () => {
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

    it("validates a 60-card Old School deck built around an Unlimited reprint", () => {
        // 1 Unlimited Bolt + 59 basics resolves and validates legal end-to-end
        // via the real registry resolver.
        const deck: ValidatableDeck = {
            cards: [
                {
                    cardId: lightningBolt2ed.printId,
                    cardName: "Lightning Bolt",
                },
                ...Array.from({ length: 59 }, () => ({
                    cardId: MOUNTAIN,
                    cardName: "Mountain",
                })),
            ],
        };
        const result = validateDeck(deck, "old-school");
        expect(result.isLegal).toBe(true);
        expect(result.reasons).toEqual([]);
    });
});
