// Per-card tests for `convex/cards/sets/2ed.ts`.
//
// 2ED (Unlimited Edition) reprints the full Beta card list and introduces no
// new cards, so the module is entirely CardPrint entries that resolve
// printId -> definitionId -> a shared LEA/LEB CardDefinition (ADR 0014). The
// module-load guard in index.ts already throws on a dangling printId; these
// assertions make the reprint contract explicit and verify that Unlimited
// shows up as an extra printing alongside LEA/LEB.

import { describe, it, expect } from "vitest";
import {
    airElemental2ed,
    ancestralRecall2ed,
    lightningBolt2ed,
    volcanicIsland2ed,
    circleOfProtectionBlack2ed,
} from "../2ed";
import { airElemental, ancestralRecall, lightningBolt } from "../lea";
import { volcanicIsland, circleOfProtectionBlack } from "../leb";
import { getCardById, getPrintingsForCard, getAllSetCodes } from "../../index";

describe("2ED registry parity (ADR 0014)", () => {
    it("resolves reprint prints to their shared LEA definition", () => {
        expect(getCardById(airElemental2ed.printId)).toBe(airElemental);
        expect(getCardById(ancestralRecall2ed.printId)).toBe(ancestralRecall);
        expect(getCardById(lightningBolt2ed.printId)).toBe(lightningBolt);
    });

    it("resolves Beta-original reprints to their LEB definition", () => {
        // Volcanic Island and Circle of Protection: Black never existed in
        // Alpha — their CardDefinition lives in leb, and 2ED reprints it.
        expect(getCardById(volcanicIsland2ed.printId)).toBe(volcanicIsland);
        expect(getCardById(circleOfProtectionBlack2ed.printId)).toBe(
            circleOfProtectionBlack
        );
    });

    it("carries the 2ed set code on every print", () => {
        expect(airElemental2ed.setCode).toBe("2ed");
        expect(volcanicIsland2ed.setCode).toBe("2ed");
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
