// "As this creature enters, exile any number of creature cards from your
// graveyard." — the as-enters graveyard exile (CR 614.12a, issue #5704).
//
//  1. GOLDEN — Sutured Ghoul compiled whole: the exile leg lowers to the
//     `exileFromGraveyard` as-enters kind and the CDA reads its pile.
//  2. REFUSALS — another card type, a fixed count, another graveyard and a
//     subject that is not the permanent all stay unparsed.
//  3. LOWERING invariants — a second as-enters choice refuses the card.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const CLAUSE =
    "As this creature enters, exile any number of creature cards from your graveyard.";
const CDA =
    "Sutured Ghoul's power is equal to the total power of the exiled cards and its toughness is equal to their total toughness.";
const GHOUL_TEXT = `Trample\n${CLAUSE}\n${CDA}`;

const SUTURED_GHOUL = oracleCard({
    name: "Sutured Ghoul",
    manaCost: "{4}{B}{B}{B}",
    typeLine: "Creature — Zombie",
    power: "*",
    toughness: "*",
    oracleText: GHOUL_TEXT,
});

describe("as-enters graveyard exile — golden fixture (CR 614.12a)", () => {
    it("Sutured Ghoul: trample, the exile leg and the exiled-pile CDA", () => {
        const outcome = compileCard(SUTURED_GHOUL);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Sutured Ghoul",
                types: ["Creature"],
                subtypes: ["Zombie"],
                manaCost: { X: 4, B: 3 },
                power: 0,
                toughness: 0,
                oracleText: GHOUL_TEXT,
                staticAbilities: ["trample"],
                compiledStaticEffects: [
                    {
                        kind: "pt-cda",
                        appliesTo: "self",
                        count: { kind: "exiled-with-source-totals" },
                    },
                ],
                entersWith: {
                    asEnters: [
                        {
                            kind: "exileFromGraveyard",
                            filter: { type: "Creature" },
                        },
                    ],
                },
            })
        );
    });

    it("reads the sentence into one clause", () => {
        const parsed = staticSlot.run(CLAUSE, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "as-enters-exile-from-graveyard",
                filter: { type: "Creature" },
            });
    });
});

describe("as-enters graveyard exile — refusals (fail-closed neighbours)", () => {
    const refused = [
        "As this creature enters, exile any number of land cards from your graveyard",
        "As this creature enters, exile two creature cards from your graveyard",
        "As this creature enters, exile any number of creature cards from an opponent's graveyard",
        "As this creature enters, exile any number of cards from your graveyard",
        "As a creature enters, exile any number of creature cards from your graveyard",
    ];
    for (const line of refused)
        it(`refuses "${line.slice(0, 70)}…"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
});

describe("as-enters graveyard exile — lowering invariants", () => {
    const refusedCard = (oracleText: string) =>
        compileCard(
            oracleCard({
                name: "Ghoul Twin",
                manaCost: "{B}",
                typeLine: "Creature — Zombie",
                power: "1",
                toughness: "1",
                oracleText,
            })
        ).state;

    it("a card declaring the exile twice is refused, not half-read", () => {
        expect(refusedCard(`${CLAUSE}\n${CLAUSE}`)).toBe("unparsed");
    });

    it("a card also choosing a creature type is refused (CR 614.12b)", () => {
        expect(
            refusedCard(
                `${CLAUSE}\nAs this creature enters, choose a creature type.`
            )
        ).toBe("unparsed");
    });
});
