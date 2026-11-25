// "Discard this card" as an activation cost (CR 113.6m, CR 701.9a) — the cost
// atom `discard-self`, heading channel, bloodrush and unnamed hand abilities.
//
//  1. GOLDEN fixtures — real corpus cards compiled whole: the leg lands in
//     `cost.discardThis` and the ability is a hand ability.
//  2. REFUSALS — the neighbours the atom must NOT read. Fail-closed is pinned,
//     not assumed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("Discard this card: … (CR 113.6m)", () => {
    it("Colossal Skyturtle: two channel abilities, each with its own target", () => {
        const regrowth =
            "Channel — {2}{G}, Discard this card: Return target card from your graveyard to your hand.";
        const bounce =
            "Channel — {1}{U}, Discard this card: Return target creature to its owner's hand.";
        const oracleText = `Flying, ward {2}\n${regrowth}\n${bounce}`;
        expect(
            compiled(
                oracleCard({
                    name: "Colossal Skyturtle",
                    manaCost: "{4}{G}{G}{U}",
                    typeLine: "Enchantment Creature — Turtle",
                    power: "6",
                    toughness: "5",
                    oracleText,
                })
            )
        ).toEqual({
            name: "Colossal Skyturtle",
            types: ["Enchantment", "Creature"],
            subtypes: ["Turtle"],
            manaCost: { X: 4, U: 1, G: 2 },
            power: 6,
            toughness: 5,
            oracleText,
            staticAbilities: ["flying", "ward {2}"],
            activatedAbilities: [
                {
                    id: "colossal-skyturtle-ability",
                    oracleText: regrowth,
                    cost: { mana: { X: 2, G: 1 }, discardThis: true },
                    activateFromHand: true,
                    useStack: true,
                    targetRequirement: {
                        type: "card",
                        count: 1,
                        zone: "graveyard",
                        controller: "you",
                    },
                    effects: [
                        { op: "moveZone", target: { target: 0 }, to: "hand" },
                    ],
                },
                {
                    id: "colossal-skyturtle-ability-2",
                    oracleText: bounce,
                    cost: { mana: { X: 1, U: 1 }, discardThis: true },
                    activateFromHand: true,
                    useStack: true,
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [
                        { op: "moveZone", target: { target: 0 }, to: "hand" },
                    ],
                },
            ],
        });
    });

    it("Rubblebelt Maaka: a bloodrush ability", () => {
        const oracleText =
            "Bloodrush — {R}, Discard this card: Target attacking creature gets +3/+3 until end of turn.";
        expect(
            compiled(
                oracleCard({
                    name: "Rubblebelt Maaka",
                    manaCost: "{3}{R}",
                    typeLine: "Creature — Cat",
                    power: "3",
                    toughness: "3",
                    oracleText,
                })
            )
        ).toEqual({
            name: "Rubblebelt Maaka",
            types: ["Creature"],
            subtypes: ["Cat"],
            manaCost: { X: 3, R: 1 },
            power: 3,
            toughness: 3,
            oracleText,
            activatedAbilities: [
                {
                    id: "rubblebelt-maaka-ability",
                    oracleText,
                    cost: { mana: { R: 1 }, discardThis: true },
                    activateFromHand: true,
                    useStack: true,
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        combatRoleFilter: ["attacking"],
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: 3,
                            toughness: 3,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        });
    });

    it("Sureshot Sower: no ability word heads the cost", () => {
        const oracleText =
            "Reach\n{3}{G}, Discard this card: Destroy target creature with flying.";
        expect(
            compiled(
                oracleCard({
                    name: "Sureshot Sower",
                    manaCost: "{3}{G}",
                    typeLine: "Creature — Elf Archer",
                    power: "3",
                    toughness: "5",
                    oracleText,
                })
            )
        ).toMatchObject({
            staticAbilities: ["reach"],
            activatedAbilities: [
                {
                    oracleText:
                        "{3}{G}, Discard this card: Destroy target creature with flying.",
                    cost: { mana: { X: 3, G: 1 }, discardThis: true },
                    activateFromHand: true,
                    useStack: true,
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        requireAbility: "flying",
                    },
                    effects: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        });
    });

    it("Twinshot Sniper: the opening 'It' is the discarded card (CR 608.2h)", () => {
        const channel =
            "Channel — {1}{R}, Discard this card: It deals 2 damage to any target.";
        expect(
            compiled(
                oracleCard({
                    name: "Twinshot Sniper",
                    manaCost: "{3}{R}",
                    typeLine: "Artifact Creature — Goblin Archer",
                    power: "2",
                    toughness: "3",
                    oracleText: `Reach\n${channel}`,
                })
            )
        ).toMatchObject({
            activatedAbilities: [
                {
                    cost: { mana: { X: 1, R: 1 }, discardThis: true },
                    activateFromHand: true,
                    targetRequirement: { type: "any", count: 1 },
                    effects: [
                        { op: "dealDamage", amount: 2, to: { target: 0 } },
                    ],
                },
            ],
        });
    });

    it.each([
        ["a companion leg beyond mana", "{T}, Discard this card: Draw a card."],
        ["a life leg", "Pay 2 life, Discard this card: Draw a card."],
        ["a name in the card's place", "{2}, Discard Test Card: Draw a card."],
        [
            "an announced X (CR 107.3a)",
            "{X}{R}, Discard this card: It deals X damage to each creature without flying.",
        ],
        ["a mana ability", "Discard this card: Add {G}."],
        ["a drawing mana line", "Discard this card: Add {G}. Draw a card."],
    ])("refuses %s", (_label, oracleText) => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Card",
                manaCost: "{1}{G}",
                typeLine: "Creature — Elf",
                power: "1",
                toughness: "1",
                oracleText,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it.each([
        ["the grant itself compiles", "{2}, Sacrifice this creature", true],
        ["its host cannot be discarded", "{2}, Discard this card", false],
    ])("an ability granted to a permanent: %s", (_label, cost, reads) => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Aura",
                manaCost: "{1}{G}",
                typeLine: "Enchantment — Aura",
                oracleText: `Enchant creature\nEnchanted creature has "${cost}: Draw a card."`,
            })
        );
        expect(outcome.state !== "unparsed").toBe(reads);
    });

    it("refuses the cost on an instant or sorcery", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Elemental Masterpiece",
                manaCost: "{5}{U/R}{U/R}",
                typeLine: "Sorcery",
                oracleText: "{2}, Discard this card: Draw a card.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
