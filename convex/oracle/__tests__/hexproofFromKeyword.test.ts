// "Hexproof from [quality]" keyword line (CR 702.11d/f), the multicolored cast
// head (CR 603.2 + CR 105.2b) and the coloured artifact creature token
// (CR 111.3 + CR 205.2a) — issue #2604.
//
//  1. GOLDENS — one real corpus card per accepted form:
//     - General Ferrous Rokiric (whole card): "Hexproof from monocolored", the
//       "you cast a multicolored spell" head, and a red-and-white Golem
//       ARTIFACT creature token;
//     - Rewards of Diversity (whole card): the "an opponent casts" head;
//     - Knight of Grace / Niv-Mizzet, Guildpact / Raddic, Tal Zealot (their
//       keyword line, compiled alone — each card's other lines are other
//       gaps): a colour quality, the multicolored quality inside a keyword
//       run, and the CR 702.11f "A and from B" shorthand.
//  2. REFUSALS — qualities `parseHexproofQuality` cannot name stay unparsed,
//     and so does a multicolored head nobody prints.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const ROKIRIC_TEXT =
    "Hexproof from monocolored\nWhenever you cast a multicolored spell, create a 4/4 red and white Golem artifact creature token.";

describe("hexproof from [quality] + multicolored cast head — goldens", () => {
    it("golden — General Ferrous Rokiric", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "64c15098-f893-44f2-bf7f-162db8ab80e9",
                name: "General Ferrous Rokiric",
                manaCost: "{1}{R}{W}",
                typeLine: "Legendary Creature — Human Soldier",
                oracleText: ROKIRIC_TEXT,
                power: "3",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "General Ferrous Rokiric",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Human", "Soldier"],
                manaCost: { X: 1, R: 1, W: 1 },
                power: 3,
                toughness: 1,
                oracleText: ROKIRIC_TEXT,
                staticAbilities: ["hexproof from monocolored"],
                compiledTriggeredAbilities: [
                    {
                        id: "general-ferrous-rokiric-trigger",
                        oracleText:
                            "Whenever you cast a multicolored spell, create a 4/4 red and white Golem artifact creature token.",
                        head: {
                            kind: "spell-cast",
                            scope: "you",
                            filter: { colorCountAtLeast: 2 },
                        },
                        effects: [
                            {
                                op: "createToken",
                                controller: "controller",
                                token: {
                                    name: "Golem",
                                    types: ["Artifact", "Creature"],
                                    subtypes: ["Golem"],
                                    power: 4,
                                    toughness: 4,
                                    colors: ["R", "W"],
                                },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("golden — Rewards of Diversity: an opponent casts a multicolored spell", () => {
        const text =
            "Whenever an opponent casts a multicolored spell, you gain 4 life.";
        const outcome = compileCard(
            oracleCard({
                oracleId: "064c5a14-c2f2-4b7a-8e0b-01b9995e8f89",
                name: "Rewards of Diversity",
                manaCost: "{3}{W}",
                typeLine: "Enchantment",
                oracleText: text,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Rewards of Diversity",
                types: ["Enchantment"],
                manaCost: { X: 3, W: 1 },
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "rewards-of-diversity-trigger",
                        oracleText: text,
                        head: {
                            kind: "spell-cast",
                            scope: "opponent",
                            filter: { colorCountAtLeast: 2 },
                        },
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: 4,
                            },
                        ],
                    },
                ],
            })
        );
    });

    const keywordLine = (
        name: string,
        typeLine: string,
        manaCost: string,
        line: string
    ) =>
        compileCard(
            oracleCard({
                name,
                typeLine,
                manaCost,
                oracleText: line,
                power: "2",
                toughness: "2",
            })
        );

    it("golden — Knight of Grace's line: a colour quality, reminder text read", () => {
        const outcome = keywordLine(
            "Knight of Grace",
            "Creature — Human Knight",
            "{1}{W}",
            "Hexproof from black (This creature can't be the target of black spells or abilities your opponents control.)"
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.staticAbilities).toEqual([
            "hexproof from black",
        ]);
    });

    it("golden — Niv-Mizzet, Guildpact's line: multicolored inside a keyword run", () => {
        const outcome = keywordLine(
            "Niv-Mizzet, Guildpact",
            "Legendary Creature — Dragon Avatar",
            "{W}{U}{B}{R}{G}",
            "Flying, hexproof from multicolored"
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.staticAbilities).toEqual([
            "flying",
            "hexproof from multicolored",
        ]);
    });

    it("golden — Raddic, Tal Zealot's line: CR 702.11f, two hexproof abilities", () => {
        const outcome = keywordLine(
            "Raddic, Tal Zealot",
            "Legendary Creature — Human Knight",
            "{2}{W}{B}",
            "Hexproof from white and from black"
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.staticAbilities).toEqual([
            "hexproof from white",
            "hexproof from black",
        ]);
    });
});

describe("hexproof from [quality] + multicolored cast head — refusals (fail-closed)", () => {
    for (const line of [
        // Card-type qualities (Jaheira), CR 702.11g "each" (Breaker of
        // Creation), a card-type quality inside a run (Eradicator Valkyrie):
        // the parser names none of them.
        "Hexproof from artifacts and enchantments",
        "Hexproof from each color",
        "Flying, lifelink, hexproof from planeswalkers",
        // A third "and from" is not the CR 702.11f shape.
        "Hexproof from white and from black and from red",
        // No card prints the "a player casts" multicolored head.
        "Whenever a player casts a multicolored spell, you gain 1 life.",
    ]) {
        it(`refuses "${line}"`, () => {
            const outcome = compileCard(
                oracleCard({
                    name: "Refusal Probe",
                    typeLine: "Creature — Human",
                    manaCost: "{1}{W}",
                    oracleText: line,
                    power: "2",
                    toughness: "2",
                })
            );
            expect(outcome.state).toBe("unparsed");
        });
    }
});
