// Tap and cycle trigger heads (issue #4547):
// "whenever this land becomes tapped" (tap, CR 701.26a) and
// "when you cycle this card" (cycling, CR 702.29c).
//
//  1. GOLDENS — each accepted form is a real corpus card compiled whole and
//     compared with `sortKeys` equality.
//  2. REFUSALS — the neighbours the heads must NOT read: a tap whose subject is
//     another permanent ("enchanted land is tapped for mana" needs the tapped
//     land's controller from the event), a cycle of ANOTHER card, and the
//     face-up head (no engine event exists for it).
//
// The engine half (does the rebuilt ability FIRE on the right event?) is the
// generated smoke test over the lockfile plus the factories' own tests.

import { describe, expect, it } from "vitest";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

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

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

const cityOfBrass = (oracleText: string) =>
    oracleCard({
        name: "City of Brass",
        manaCost: "",
        typeLine: "Land",
        oracleText,
        power: undefined,
        toughness: undefined,
    });

const CITY_TEXT =
    "Whenever this land becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color.";

describe("tap and cycle trigger heads — goldens (issue #4547)", () => {
    it("City of Brass: 'becomes tapped' is the source's own tap, and 'it' is the source", () => {
        expect(sortKeys(abilitiesOf(cityOfBrass(CITY_TEXT)))).toEqual(
            sortKeys([
                {
                    id: "city-of-brass-trigger",
                    oracleText:
                        "Whenever this land becomes tapped, it deals 1 damage to you.",
                    head: { kind: "tapped", scope: "self" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: "controller" },
                        },
                    ],
                },
            ])
        );
    });

    it("Windcaller Aven: 'when you cycle this card' is the cycled head", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    oracleCard({
                        name: "Windcaller Aven",
                        manaCost: "{4}{U}{U}",
                        typeLine: "Creature — Bird Wizard",
                        oracleText:
                            "Flying\nCycling {U} ({U}, Discard this card: Draw a card.)\nWhen you cycle this card, target creature gains flying until end of turn.",
                        power: "4",
                        toughness: "3",
                    })
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "windcaller-aven-trigger",
                    oracleText:
                        "When you cycle this card, target creature gains flying until end of turn.",
                    head: { kind: "cycled" },
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [
                        {
                            op: "grantAbility",
                            target: { target: 0 },
                            ability: "flying",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ])
        );
    });
});

describe("tap and cycle trigger heads — refusals (issue #4547)", () => {
    it("refuses 'enchanted land is tapped for mana' (Wild Growth): the recipient is the tapped land's controller", () => {
        expect(
            refused(
                oracleCard({
                    name: "Wild Growth",
                    manaCost: "{G}",
                    typeLine: "Enchantment — Aura",
                    oracleText:
                        "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });

    it("refuses a tap head naming a subject that is not the source", () => {
        expect(
            refused(
                cityOfBrass(
                    "Whenever a land becomes tapped, it deals 1 damage to you."
                )
            )
        ).toBe(true);
    });

    it("refuses 'when you cycle another card' and 'cycle or discard'", () => {
        for (const head of [
            "When you cycle another card",
            "Whenever you cycle or discard a card",
        ])
            expect(
                refused(
                    oracleCard({
                        name: "Probe Cycler",
                        manaCost: "{1}{U}",
                        typeLine: "Creature — Bird",
                        oracleText: `Cycling {U}\n${head}, draw a card.`,
                    })
                )
            ).toBe(true);
    });

    it("refuses an intervening-if behind a cycle head: the factory would drop it (CR 603.4)", () => {
        expect(
            refused(
                oracleCard({
                    name: "Probe Cycler",
                    manaCost: "{1}{R}",
                    typeLine: "Creature — Goblin",
                    oracleText:
                        "Cycling {R}\nWhen you cycle this card, if you control a Goblin, draw a card.",
                })
            )
        ).toBe(true);
    });

    it("refuses 'turned face up': the engine has no face-up event", () => {
        expect(
            refused(
                oracleCard({
                    name: "Nantuko Vigilante",
                    manaCost: "{3}{G}",
                    typeLine: "Creature — Insect Druid Mutant",
                    oracleText:
                        "Morph {1}{G}\nWhen this creature is turned face up, destroy target artifact or enchantment.",
                })
            )
        ).toBe(true);
    });
});
