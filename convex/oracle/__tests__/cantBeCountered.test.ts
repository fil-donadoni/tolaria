// "This spell can't be countered." — a static ability of the SPELL (CR 113.6g,
// issue #4586).
//
//  1. GOLDEN forms — a real corpus card compiled whole, one per site the line
//     is printed at: a creature spell, a sorcery and an instant. One rule in
//     the static clause reads all three, because the ability functions on the
//     stack whatever the card's type line says; an instant compiling at all
//     also proves the spell slot does not read the line too (the router
//     refuses a line two slots consume).
//  2. REFUSALS — the neighbours that name other spells or a later spell: each
//     is a continuous effect this card-level flag cannot express.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function spell(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
        power: undefined,
        toughness: undefined,
    });
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The one line the compiler could not read on a card it refuses. */
function refusedLine(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} parsed, but should not have`);
    if (outcome.gaps.length !== 1)
        throw new Error(
            `${card.name}: expected one gap, got ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.gaps[0]!.line;
}

describe("This spell can't be countered (CR 113.6g)", () => {
    it("flags a creature spell — Carnage Tyrant, whole", () => {
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Carnage Tyrant",
                        manaCost: "{4}{G}{G}",
                        oracleText:
                            "This spell can't be countered.\nTrample, hexproof",
                        typeLine: "Creature — Dinosaur",
                        power: "7",
                        toughness: "6",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Carnage Tyrant",
                types: ["Creature"],
                subtypes: ["Dinosaur"],
                manaCost: { X: 4, G: 2 },
                power: 7,
                toughness: 6,
                oracleText: "This spell can't be countered.\nTrample, hexproof",
                staticAbilities: ["trample", "hexproof"],
                cantBeCountered: true,
            })
        );
    });

    it("flags a sorcery beside its effect — Supreme Verdict, whole", () => {
        expect(
            sortKeys(
                compiled(
                    spell(
                        "Supreme Verdict",
                        "{1}{W}{W}{U}",
                        "Sorcery",
                        "This spell can't be countered.\nDestroy all creatures."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Supreme Verdict",
                types: ["Sorcery"],
                manaCost: { X: 1, W: 2, U: 1 },
                oracleText:
                    "This spell can't be countered.\nDestroy all creatures.",
                cantBeCountered: true,
                effects: [
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            filter: { type: "Creature" },
                        },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
            })
        );
    });

    it("flags an instant, whose own target is unchanged — Last Word, whole", () => {
        expect(
            sortKeys(
                compiled(
                    spell(
                        "Last Word",
                        "{2}{U}{U}",
                        "Instant",
                        "This spell can't be countered.\nCounter target spell."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Last Word",
                types: ["Instant"],
                manaCost: { X: 2, U: 2 },
                oracleText:
                    "This spell can't be countered.\nCounter target spell.",
                cantBeCountered: true,
                effects: [{ op: "counter", target: { target: 0 } }],
                targetRequirement: { type: "spell", count: 1 },
            })
        );
    });

    it("leaves a spell without the line unflagged — Counterspell", () => {
        expect(
            compiled(
                spell(
                    "Counterspell",
                    "{U}{U}",
                    "Instant",
                    "Counter target spell."
                )
            ).cantBeCountered
        ).toBeUndefined();
    });

    it("refuses the class of spells a permanent protects — Leyline of Lifeforce", () => {
        expect(
            refusedLine(
                spell(
                    "Leyline of Lifeforce",
                    "{2}{G}{G}",
                    "Enchantment",
                    "Creature spells can't be countered."
                )
            )
        ).toBe("Creature spells can't be countered.");
    });

    it("refuses the class beside a line it reads — Prowling Serpopard", () => {
        expect(
            refusedLine(
                oracleCard({
                    name: "Prowling Serpopard",
                    manaCost: "{1}{G}{G}",
                    oracleText:
                        "This spell can't be countered.\nCreature spells you control can't be countered.",
                    typeLine: "Creature — Cat Snake",
                })
            )
        ).toBe("Creature spells you control can't be countered.");
    });

    it("refuses a later spell's protection", () => {
        expect(
            refusedLine(
                spell(
                    "Probe",
                    "{U}",
                    "Instant",
                    "The next spell you cast this turn can't be countered."
                )
            )
        ).toBe("The next spell you cast this turn can't be countered.");
    });
});
