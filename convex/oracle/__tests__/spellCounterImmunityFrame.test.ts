// The spell-counter-immunity verb frame (CR 611.2c / 101.2): "Spells you
// control can't be countered this turn." lowers to `grantSpellCounterImmunity`
// on the controller. The golden is Veil of Summer (`trailingGate.test.ts`);
// here the frame alone and the neighbours it refuses.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function instant(oracleText: string) {
    return oracleCard({
        name: "Test Instant",
        manaCost: "{G}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("spell counter immunity frame — form (CR 611.2c)", () => {
    it("reads the sentence beside another frame", () => {
        const outcome = compileCard(
            instant(
                "Spells you control can't be countered this turn. You gain hexproof until end of turn."
            )
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.effects).toEqual([
            { op: "grantSpellCounterImmunity", player: "controller" },
            {
                op: "grantPlayerKeyword",
                player: "controller",
                keyword: "hexproof",
            },
        ]);
    });
});

describe("spell counter immunity frame — refusals", () => {
    const refused = (text: string) =>
        expect(compileCard(instant(text)).state).toBe("unparsed");

    it('refuses "other spells" (the Op covers every spell)', () => {
        refused("Other spells you control can't be countered this turn.");
    });

    it("refuses a spell class (the Op has no filter)", () => {
        refused("Creature spells you control can't be countered this turn.");
    });

    it("refuses a longer duration", () => {
        refused(
            "Spells you control can't be countered this turn and next turn."
        );
    });
});
