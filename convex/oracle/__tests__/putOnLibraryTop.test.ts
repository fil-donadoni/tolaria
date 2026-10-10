// "Put target creature you control on top of its owner's library" — an
// activated-ability zone change (CR 401.4 + CR 400.3), lowered to `moveZone`
// with `position: 1` (issue #5406). The golden for the accepted form is the
// Civic Guildmage row in `grammar/fixtures.ts` (`goldenFixtures.test.ts`);
// this file pins the fail-closed neighbours and the other two graduates.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import type { OracleCard } from "../types";

function creature(name: string, oracleText: string): OracleCard {
    return {
        oracleId: `00000000-0000-4000-8000-${name.length.toString().padStart(12, "0")}`,
        name,
        manaCost: "{W}",
        typeLine: "Creature — Human Wizard",
        oracleText,
        power: "1",
        toughness: "1",
        layout: "normal",
    };
}

const PUT_ON_TOP =
    "{U}, {T}: Put target creature you control on top of its owner's library.";

function moveEffects(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") throw new Error("unparsed");
    return outcome.definition.activatedAbilities?.[0]?.effects;
}

describe("put on top of its owner's library (CR 401.4, issue #5406)", () => {
    it("Sunscape Apprentice's second line lowers to moveZone position 1", () => {
        expect(
            moveEffects(creature("Sunscape Apprentice", PUT_ON_TOP))
        ).toEqual([
            {
                op: "moveZone",
                target: { target: 0 },
                to: "library",
                position: 1,
            },
        ]);
    });

    it.each([
        [
            "the bottom, not the top",
            "{U}, {T}: Put target creature you control on the bottom of its owner's library.",
        ],
        [
            "a sweep, not one announced object",
            "{U}, {T}: Put all creatures you control on top of their owners' libraries.",
        ],
        [
            "an unannounced object",
            "{U}, {T}: Put a creature you control on top of its owner's library.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(creature("Refusal Probe", text)).state).toBe(
            "unparsed"
        );
    });
});
