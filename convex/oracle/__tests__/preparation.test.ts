// Preparation (CR 722) in the compiler: the `prepare` layout, the
// "enters prepared" entry rider (CR 722.3a) and the flicker the first
// preparation card's prepare spell prints (CR 400.7).
//
//  1. GOLDEN — real corpus cards compiled whole equal the full Compiled
//     Definition: Skycoach Conductor // All Aboard (layout + rider + flicker),
//     Flicker of Fate (the flicker on a normal card, "it" spelling).
//  2. REFUSALS — the neighbours each rule must not read: a return under the
//     caster's control, a counter rider, a return with no exile before it in
//     the same sentence, "enters prepared" on a subject that is not the card.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const SKYCOACH_CONDUCTOR: OracleCard = {
    oracleId: "788d3cfa-7706-4728-9c48-cf7bc963d002",
    name: "Skycoach Conductor // All Aboard",
    manaCost: "{2}{U} // {U}",
    typeLine: "Creature — Bird Pilot // Instant",
    oracleText: "",
    power: "2",
    toughness: "3",
    layout: "prepare",
    faces: [
        {
            name: "Skycoach Conductor",
            manaCost: "{2}{U}",
            typeLine: "Creature — Bird Pilot",
            oracleText:
                "Flash\nFlying, vigilance\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
            power: "2",
            toughness: "3",
        },
        {
            name: "All Aboard",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText:
                "Exile target non-Pilot creature you control, then return that card to the battlefield under its owner's control.",
        },
    ],
};

function instant(oracleText: string): OracleCard {
    return oracleCard({
        name: "Test Instant",
        manaCost: "{W}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("CR 722 — the prepare layout and the enters-prepared rider (golden)", () => {
    it('Skycoach Conductor // All Aboard compiles whole: the card, `entersPrepared`, and the inset spell as `kind: "prepare"`', () => {
        const outcome = compileCard(SKYCOACH_CONDUCTOR);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Skycoach Conductor",
                types: ["Creature"],
                subtypes: ["Bird", "Pilot"],
                manaCost: { X: 2, U: 1 },
                power: 2,
                toughness: 3,
                oracleText:
                    "Flash\nFlying, vigilance\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
                staticAbilities: ["flash", "flying", "vigilance"],
                entersPrepared: true,
                insetSpell: {
                    kind: "prepare",
                    name: "All Aboard",
                    manaCost: { U: 1 },
                    types: ["Instant"],
                    oracleText:
                        "Exile target non-Pilot creature you control, then return that card to the battlefield under its owner's control.",
                    effects: [
                        { op: "exile", target: { target: 0 }, bind: "$that1" },
                        {
                            op: "moveZone",
                            target: { ref: "$that1" },
                            from: "exile",
                            to: "battlefield",
                        },
                    ],
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        excludeSubtypes: ["Pilot"],
                        controller: "you",
                    },
                },
            })
        );
    });

    it('refuses "enters prepared" on a subject that is not this permanent', () => {
        const outcome = compileCard(
            oracleCard({
                oracleText: "Each other creature you control enters prepared.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("CR 400.7 — the flicker (golden)", () => {
    it("Flicker of Fate: the exile binds the object, the return reads the binding from exile", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "d5b9d250-92f5-40d8-b962-4ae4adb466c8",
                name: "Flicker of Fate",
                manaCost: "{1}{W}",
                typeLine: "Instant",
                oracleText:
                    "Exile target creature or enchantment, then return it to the battlefield under its owner's control.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Flicker of Fate",
                types: ["Instant"],
                manaCost: { X: 1, W: 1 },
                oracleText:
                    "Exile target creature or enchantment, then return it to the battlefield under its owner's control.",
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$that1" },
                    {
                        op: "moveZone",
                        target: { ref: "$that1" },
                        from: "exile",
                        to: "battlefield",
                    },
                ],
                targetRequirement: {
                    type: ["Creature", "Enchantment"],
                    count: 1,
                },
            })
        );
    });

    it.each([
        // Cloudshift — under the CASTER's control (CR 110.2a): a different
        // controller, not read by this rule.
        "Exile target creature you control, then return that card to the battlefield under your control.",
        // Daydream — the counter rider.
        "Exile target creature you control, then return that card to the battlefield under its owner's control with a +1/+1 counter on it.",
        // Two sentences: the return is not read across a full stop.
        "Exile target creature you control. Return it to the battlefield under its owner's control.",
    ])("refuses the neighbour %j", (text) => {
        expect(compileCard(instant(text)).state).toBe("unparsed");
    });
});
