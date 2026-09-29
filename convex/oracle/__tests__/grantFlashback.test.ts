// Granted Flashback — "<target instant or sorcery card in your graveyard>
// gains flashback until end of turn. The flashback cost is equal to its mana
// cost." (CR 702.34a, CR 514.2, issue #4756). Two sentences folded into ONE
// `grantFlashback` Op by `assembleSentences`; the target rides the shared
// descriptor, which now reads a card-type disjunction before "card"
// ("instant or sorcery card", CR 205.2a).
//
// Three layers:
//
//  1. GOLDENS — one per accepted form, each a real corpus row: the triggered
//     slot under an ETB head (Snapcaster Mage) and an attack head with the
//     "that card's mana cost" spelling (Sphinx of Forgotten Lore), the spell
//     slot over "instant or sorcery" (Flashback) and over one type beside a
//     printed Flashback keyword (Recoup), and the activated slot (Dralnu, Lich
//     Lord's own line — the card's other line is an unrelated gap).
//  2. REFUSALS — the neighbours the rule must NOT read: the grant without its
//     cost, the cost without its grant, a non-instant/sorcery card, the mass
//     form (Past in Flames), an explicit cost, another duration.
//  3. DESCRIPTOR — the type disjunction reads only before "card", keeps the
//     noun or-list reading of "artifact or enchantment", and refuses a second
//     type adjective beside it.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const SNAPCASTER_MAGE: OracleCard = {
    oracleId: "2bb2eda7-3b38-4c56-870f-c3218a1056f5",
    name: "Snapcaster Mage",
    manaCost: "{1}{U}",
    typeLine: "Creature — Human Wizard",
    oracleText:
        "Flash\nWhen this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)",
    power: "2",
    toughness: "1",
    layout: "normal",
};

const SPHINX_OF_FORGOTTEN_LORE: OracleCard = {
    oracleId: "ddb7e868-8f1d-4d57-9ee2-ebadb17b398a",
    name: "Sphinx of Forgotten Lore",
    manaCost: "{2}{U}{U}",
    typeLine: "Creature — Sphinx",
    oracleText:
        "Flash (You may cast this spell any time you could cast an instant.)\nFlying\nWhenever this creature attacks, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to that card's mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)",
    power: "3",
    toughness: "3",
    layout: "normal",
};

const FLASHBACK: OracleCard = {
    oracleId: "02070488-9203-4304-9392-a111d20218c5",
    name: "Flashback",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText:
        "Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)",
    layout: "normal",
};

const RECOUP: OracleCard = {
    oracleId: "f80d151c-7489-4189-8c5b-6d2a730d238e",
    name: "Recoup",
    manaCost: "{1}{R}",
    typeLine: "Sorcery",
    oracleText:
        "Target sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (Mana cost includes color.)\nFlashback {3}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
    layout: "normal",
};

/** Dralnu, Lich Lord's activated line — real corpus text; the card's other
 *  line (a damage replacement) is its own Grammar Gap, so the line is
 *  compiled alone on a creature with no other text. */
const DRALNU_ACTIVATED_LINE =
    "{T}: Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.";

const GRAVEYARD_INSTANT_OR_SORCERY = {
    type: ["Instant", "Sorcery"],
    count: 1,
    zone: "graveyard",
    controller: "you",
};

const GRANT = [{ op: "grantFlashback", card: { target: 0 } }];

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** A sorcery whose Oracle text is exactly `oracleText`. */
function sorcery(oracleText: string) {
    return oracleCard({
        name: "Flashback Probe",
        manaCost: "{1}{R}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("granted flashback — goldens (CR 702.34a, CR 514.2)", () => {
    it("Snapcaster Mage: the triggered slot under an ETB head", () => {
        const outcome = compileCard(SNAPCASTER_MAGE);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(compiled(SNAPCASTER_MAGE))).toEqual(
            sortKeys({
                name: "Snapcaster Mage",
                types: ["Creature"],
                subtypes: ["Human", "Wizard"],
                manaCost: { X: 1, U: 1 },
                power: 2,
                toughness: 1,
                oracleText: SNAPCASTER_MAGE.oracleText,
                staticAbilities: ["flash"],
                compiledTriggeredAbilities: [
                    {
                        id: "snapcaster-mage-trigger",
                        oracleText:
                            "When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: GRAVEYARD_INSTANT_OR_SORCERY,
                        effects: GRANT,
                    },
                ],
            })
        );
    });

    it('Sphinx of Forgotten Lore: an attack head, "that card\'s mana cost"', () => {
        const outcome = compileCard(SPHINX_OF_FORGOTTEN_LORE);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(compiled(SPHINX_OF_FORGOTTEN_LORE))).toEqual(
            sortKeys({
                name: "Sphinx of Forgotten Lore",
                types: ["Creature"],
                subtypes: ["Sphinx"],
                manaCost: { X: 2, U: 2 },
                power: 3,
                toughness: 3,
                oracleText: SPHINX_OF_FORGOTTEN_LORE.oracleText,
                staticAbilities: ["flash", "flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "sphinx-of-forgotten-lore-trigger",
                        oracleText:
                            "Whenever this creature attacks, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to that card's mana cost.",
                        head: { kind: "attacks" },
                        targetRequirement: GRAVEYARD_INSTANT_OR_SORCERY,
                        effects: GRANT,
                    },
                ],
            })
        );
    });

    it("Flashback: the spell slot over an instant or sorcery card", () => {
        expect(compileCard(FLASHBACK).state).toBe("ready");
        expect(sortKeys(compiled(FLASHBACK))).toEqual(
            sortKeys({
                name: "Flashback",
                types: ["Instant"],
                manaCost: { R: 1 },
                oracleText: FLASHBACK.oracleText,
                effects: GRANT,
                targetRequirement: GRAVEYARD_INSTANT_OR_SORCERY,
            })
        );
    });

    it("Recoup: one card type, beside the card's own printed Flashback", () => {
        expect(compileCard(RECOUP).state).toBe("ready");
        expect(sortKeys(compiled(RECOUP))).toEqual(
            sortKeys({
                name: "Recoup",
                types: ["Sorcery"],
                manaCost: { X: 1, R: 1 },
                oracleText: RECOUP.oracleText,
                effects: GRANT,
                targetRequirement: {
                    type: "Sorcery",
                    count: 1,
                    zone: "graveyard",
                    controller: "you",
                },
                flashback: { X: 3, R: 1 },
            })
        );
    });

    it("Dralnu, Lich Lord's line: the activated slot", () => {
        const card = oracleCard({
            name: "Dralnu Line",
            oracleText: DRALNU_ACTIVATED_LINE,
        });
        const definition = compiled(card);
        expect(sortKeys(definition.activatedAbilities)).toEqual(
            sortKeys([
                {
                    id: "dralnu-line-ability",
                    oracleText: DRALNU_ACTIVATED_LINE,
                    cost: { tap: true },
                    useStack: true,
                    effects: GRANT,
                    targetRequirement: GRAVEYARD_INSTANT_OR_SORCERY,
                },
            ])
        );
    });
});

describe("granted flashback — refusals (fail-closed neighbours)", () => {
    it.each([
        [
            "the grant without its cost sentence",
            "Target instant or sorcery card in your graveyard gains flashback until end of turn.",
        ],
        [
            "the cost sentence without a grant",
            "Draw a card. The flashback cost is equal to its mana cost.",
        ],
        [
            "a sentence between the grant and its cost",
            "Target instant or sorcery card in your graveyard gains flashback until end of turn. Draw a card. The flashback cost is equal to its mana cost.",
        ],
        [
            "a card that is not an instant or sorcery (CR 702.34a)",
            "Target creature card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.",
        ],
        [
            "a card in any graveyard, not yours",
            "Target instant or sorcery card in a graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.",
        ],
        [
            "the mass form (Past in Flames)",
            "Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.",
        ],
        [
            "an explicit flashback cost",
            "Target instant or sorcery card in your graveyard gains flashback {2}{R}{G} until end of turn.",
        ],
        [
            "a duration other than end of turn",
            "Target instant or sorcery card in your graveyard gains flashback until your next turn. The flashback cost is equal to its mana cost.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });
});

describe("granted flashback — the card-type disjunction (CR 205.2a)", () => {
    it("reads a type disjunction before 'card' as one OR adjective", () => {
        expect(
            compiled(
                sorcery(
                    "Return target artifact or enchantment card from your graveyard to your hand."
                )
            ).targetRequirement
        ).toEqual({
            type: ["Artifact", "Enchantment"],
            count: 1,
            zone: "graveyard",
            controller: "you",
        });
    });

    it("keeps the noun or-list reading when no 'card' follows", () => {
        expect(
            compiled(sorcery("Destroy target artifact or enchantment."))
                .targetRequirement
        ).toEqual({ type: ["Artifact", "Enchantment"], count: 1 });
    });

    it.each([
        [
            "a second type adjective beside the disjunction",
            "Return target artifact instant or sorcery card from your graveyard to your hand.",
        ],
        [
            "the same type twice",
            "Return target instant or instant card from your graveyard to your hand.",
        ],
        [
            '"permanent", which names six types',
            "Return target instant or permanent card from your graveyard to your hand.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });
});
