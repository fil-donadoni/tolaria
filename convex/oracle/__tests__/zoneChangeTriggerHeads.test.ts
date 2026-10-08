// Zone-change trigger heads — "when this Aura is put into a graveyard from the
// battlefield", "whenever another card is put into a graveyard from anywhere",
// "whenever a black card is put into an opponent's graveyard from anywhere" and
// Sacred Ground's "whenever a spell or ability an opponent controls causes a
// land to be put into your graveyard from the battlefield" (issue #4546,
// CR 603.6c / 400.7e / 404.1 / 603.2).
//
//  1. GOLDENS — every accepted form is the trigger line of a real corpus card,
//     compiled and compared with `sortKeys` equality. Rancor, Sacred Ground and
//     Planar Void are also `GOLDEN_FIXTURES` rows: the canned smoke scenario
//     cannot stage a graveyard → hand / battlefield / exile `moveZone`, so the
//     fixture is what lets the form reach `ready`.
//  2. REFUSALS — the neighbours the heads must NOT read: a destination the
//     rows do not spell, another colour or owner, a land without its cause,
//     and "that card" put onto the battlefield behind a head that does not pin
//     the card's owner to the controller.
//
// The engine half (does the rebuilt ability FIRE on the right departures?) is
// `gre/__tests__/compiledZoneChangeTriggers.test.ts`.

import { describe, expect, it } from "vitest";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { triggerHeadRule } from "../grammar/shared/triggerHead";
import { oracleCard, parseContext } from "./oracle.fixture";

function abilitiesOf(
    card: ReturnType<typeof oracleCard>
): readonly CompiledTriggeredAbility[] {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.compiledTriggeredAbilities ?? [];
}

const aura = (name: string, oracleText: string) =>
    oracleCard({
        name,
        manaCost: "{G}",
        typeLine: "Enchantment — Aura",
        oracleText: `Enchant creature\n${oracleText}`,
    });

const enchantment = (name: string, oracleText: string, manaCost = "{1}{W}") =>
    oracleCard({ name, manaCost, typeLine: "Enchantment", oracleText });

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

describe("zone-change trigger heads — goldens (issue #4546)", () => {
    it("Rancor: the Aura's own exit to a graveyard returns it (the card it became) to its owner's hand", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    aura(
                        "Rancor",
                        "When this Aura is put into a graveyard from the battlefield, return it to its owner's hand."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "rancor-trigger",
                    oracleText:
                        "When this Aura is put into a graveyard from the battlefield, return it to its owner's hand.",
                    head: { kind: "left-to-graveyard", scope: "self" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ])
        );
    });

    it("Audacity: the self head reads a plain body too", () => {
        const [ability] = abilitiesOf(
            aura(
                "Audacity",
                "When this Aura is put into a graveyard from the battlefield, draw a card."
            )
        );
        expect(ability?.head).toEqual({
            kind: "left-to-graveyard",
            scope: "self",
        });
        expect(ability?.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("Compost: a black card in an OPPONENT's graveyard, from anywhere", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    enchantment(
                        "Compost",
                        "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card.",
                        "{1}{G}"
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "compost-trigger",
                    oracleText:
                        "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card.",
                    head: {
                        kind: "graveyard-entry",
                        graveyard: "opponents",
                        colors: ["B"],
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Draw a card?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                { op: "draw", player: "controller", count: 1 },
                            ],
                        },
                    ],
                },
            ])
        );
    });

    it("Planar Void: 'another card … from anywhere' excludes itself and exiles 'that card'", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    enchantment(
                        "Planar Void",
                        "Whenever another card is put into a graveyard from anywhere, exile that card.",
                        "{B}"
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "planar-void-trigger",
                    oracleText:
                        "Whenever another card is put into a graveyard from anywhere, exile that card.",
                    head: {
                        kind: "graveyard-entry",
                        graveyard: "any",
                        excludeSelf: true,
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$event.card" },
                            to: "exile",
                        },
                    ],
                },
            ])
        );
    });

    it("Sacred Ground: an opponent-caused land exit into YOUR graveyard returns 'that card' to the battlefield", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    enchantment(
                        "Sacred Ground",
                        "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "sacred-ground-trigger",
                    oracleText:
                        "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.",
                    head: {
                        kind: "left-to-graveyard",
                        scope: "any",
                        filter: { types: ["Land"] },
                        ownedBy: "you",
                        causedBy: "opponent",
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$event.card" },
                            to: "battlefield",
                        },
                    ],
                },
            ])
        );
    });
});

describe("zone-change trigger heads — the library head", () => {
    // Narcomoeba and Gaea's Blessing print this head; their BODIES ("you may
    // put it onto the battlefield", "shuffle your graveyard into your
    // library") are other effect-clause rules, so the head is pinned by itself.
    it.each([
        "When this card is put into your graveyard from your library",
        "When {self} is put into your graveyard from your library",
    ])("reads %s as the card's own mill", (span) => {
        const result = triggerHeadRule.run(span, parseContext());
        expect(result.ok && result.value).toEqual({
            kind: "library-to-graveyard",
        });
    });

    it.each([
        "When this card is put into a graveyard from your library",
        "When this card is put into your graveyard from anywhere",
        "When this card is put into your graveyard from your hand",
        "Whenever another card is put into your graveyard from your library",
    ])("refuses %s", (span) => {
        expect(triggerHeadRule.run(span, parseContext()).ok).toBe(false);
    });

    it("lowers to the head descriptor behind a body the grammar reads", () => {
        const [ability] = abilitiesOf(
            oracleCard({
                name: "Narcomoeba",
                manaCost: "{1}{U}",
                typeLine: "Creature — Illusion",
                power: "1",
                toughness: "1",
                oracleText:
                    "When this card is put into your graveyard from your library, draw a card.",
            })
        );
        expect(ability?.head).toEqual({ kind: "library-to-graveyard" });
    });
});

describe("zone-change trigger heads — refusals (fail-closed)", () => {
    it.each([
        // the self head is the battlefield exit only
        "When this Aura is put into a graveyard from anywhere, draw a card.",
        "When this Aura is put into a graveyard from your library, draw a card.",
        // another colour, owner or card word: no row spells them
        "Whenever a white card is put into an opponent's graveyard from anywhere, you may draw a card.",
        "Whenever a black card is put into your graveyard from anywhere, you may draw a card.",
        "Whenever a black card is put into a graveyard from anywhere, you may draw a card.",
        "Whenever a creature card is put into a graveyard from anywhere, exile that card.",
        "Whenever another card is put into a graveyard from the battlefield, exile that card.",
        "Whenever another card is put into your graveyard from anywhere, exile that card.",
        // a land exit without Sacred Ground's cause or owner
        "Whenever a land is put into your graveyard from the battlefield, return that card to the battlefield.",
        "Whenever a spell or ability an opponent controls causes a land to be put into a graveyard from the battlefield, return that card to the battlefield.",
    ])("%s", (line) => {
        expect(refused(enchantment("Probe", line))).toBe(true);
    });

    it("'that card' goes onto the battlefield only behind a head that pins its owner to the controller", () => {
        expect(
            refused(
                enchantment(
                    "Probe",
                    "Whenever another card is put into a graveyard from anywhere, return that card to the battlefield."
                )
            )
        ).toBe(true);
        expect(
            refused(
                enchantment(
                    "Probe",
                    "Whenever a creature dies, return that card to the battlefield."
                )
            )
        ).toBe(true);
    });

    it("'it' behind a non-self graveyard head names no object", () => {
        expect(
            refused(
                enchantment(
                    "Probe",
                    "Whenever another card is put into a graveyard from anywhere, exile it."
                )
            )
        ).toBe(true);
    });
});
