// Modal cardinality heads: how many modes a modal spell's head prints
// (CR 700.2, CR 700.2d), lowered onto `CardDefinition.modeSelection`.
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole.
//  2. REFUSALS — the printed neighbours the heads must not read: a head read as
//     "choose one" would ship a spell that does less than it says.

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

const FIERY_CONFLUENCE_TEXT =
    "Choose three. You may choose the same mode more than once.\n• Fiery Confluence deals 1 damage to each creature.\n• Fiery Confluence deals 2 damage to each opponent.\n• Destroy target artifact.";

const FLAME_OF_ANOR_TEXT =
    "Choose one. If you control a Wizard as you cast this spell, you may choose two instead.\n• Target player draws two cards.\n• Destroy target artifact.\n• Flame of Anor deals 5 damage to target creature.";

describe("modal cardinality heads (CR 700.2) — goldens", () => {
    it("Fiery Confluence: three picks with repeats (CR 700.2d)", () => {
        expect(
            sortKeys(
                compiled(
                    spell(
                        "Fiery Confluence",
                        "{2}{R}{R}",
                        "Sorcery",
                        FIERY_CONFLUENCE_TEXT
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Fiery Confluence",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 2 },
                oracleText: FIERY_CONFLUENCE_TEXT,
                modeSelection: { min: 3, max: 3, repeats: true },
                modes: [
                    {
                        id: "fiery-confluence-mode-1",
                        label: "Fiery Confluence deals 1 damage to each creature",
                        oracleText:
                            "Fiery Confluence deals 1 damage to each creature.",
                        effects: [
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    filter: { type: "Creature" },
                                },
                                effects: [
                                    {
                                        op: "dealDamage",
                                        amount: 1,
                                        to: { ref: "$each" },
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        id: "fiery-confluence-mode-2",
                        label: "Fiery Confluence deals 2 damage to each opponent",
                        oracleText:
                            "Fiery Confluence deals 2 damage to each opponent.",
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 2,
                                to: { player: "opponent" },
                            },
                        ],
                    },
                    {
                        id: "fiery-confluence-mode-3",
                        label: "Destroy target artifact",
                        oracleText: "Destroy target artifact.",
                        targetRequirement: { type: "Artifact", count: 1 },
                        effects: [{ op: "destroy", target: { target: 0 } }],
                    },
                ],
            })
        );
    });

    it("Flame of Anor: a controls condition makes the count one to two", () => {
        expect(
            sortKeys(
                compiled(
                    spell(
                        "Flame of Anor",
                        "{1}{U}{R}",
                        "Instant",
                        FLAME_OF_ANOR_TEXT
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Flame of Anor",
                types: ["Instant"],
                manaCost: { X: 1, U: 1, R: 1 },
                oracleText: FLAME_OF_ANOR_TEXT,
                modeSelection: {
                    min: 1,
                    max: 1,
                    when: {
                        condition: { controls: { subtypes: ["Wizard"] } },
                        min: 1,
                        max: 2,
                    },
                },
                modes: [
                    {
                        id: "flame-of-anor-mode-1",
                        label: "Target player draws two cards",
                        oracleText: "Target player draws two cards.",
                        targetRequirement: { type: "player", count: 1 },
                        effects: [
                            {
                                op: "draw",
                                player: { target: 0 },
                                count: 2,
                            },
                        ],
                    },
                    {
                        id: "flame-of-anor-mode-2",
                        label: "Destroy target artifact",
                        oracleText: "Destroy target artifact.",
                        targetRequirement: { type: "Artifact", count: 1 },
                        effects: [{ op: "destroy", target: { target: 0 } }],
                    },
                    {
                        id: "flame-of-anor-mode-3",
                        label: "Flame of Anor deals 5 damage to target creature",
                        oracleText:
                            "Flame of Anor deals 5 damage to target creature.",
                        targetRequirement: { type: "Creature", count: 1 },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 5,
                                to: { target: 0 },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Sizzle: damage to each opponent is the one other player (CR 102.2)", () => {
        expect(
            sortKeys(
                compiled(
                    spell(
                        "Sizzle",
                        "{2}{R}",
                        "Sorcery",
                        "Sizzle deals 3 damage to each opponent."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Sizzle",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 1 },
                oracleText: "Sizzle deals 3 damage to each opponent.",
                effects: [
                    {
                        op: "dealDamage",
                        amount: 3,
                        to: { player: "opponent" },
                    },
                ],
            })
        );
    });
});

describe("modal cardinality heads (CR 700.2) — refused neighbours", () => {
    const BULLETS = "\n• Destroy target artifact.\n• Destroy target land.";

    it.each([
        // The engine has no commander concept to read at announcement.
        "Choose one. If you control a commander as you cast this spell, you may choose both instead.",
        // `ModeCountCondition.controls` reads one filter, not a conjunction.
        "Choose one. If you control an artifact and an enchantment as you cast this spell, you may choose both instead.",
        // A descriptor with no owner clause in `PermanentFilter`.
        "Choose one. If you control a nonland permanent you don't own as you cast this spell, you may choose two instead.",
        // "Any number" admits zero modes; an announcement must name one.
        "Choose one. If this spell was kicked, choose any number instead.",
        // No `ModeCountCondition` reads these facts.
        "Choose one. If you descended this turn, you may choose both instead.",
        "Choose one. If this spell's additional cost was paid, choose both instead.",
        "Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead.",
        // Mandatory count, not the printed "may" this head reads as a range.
        "Choose one. If you control a Wizard as you cast this spell, choose two instead.",
        // No printed card reads the repeat clause on another count.
        "Choose two. You may choose the same mode more than once.",
        "Choose three.",
    ])("refuses %s", (head) => {
        const outcome = compileCard(
            spell("Test Charm", "{1}{R}", "Instant", `${head}${BULLETS}`)
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("keeps each-player damage refused", () => {
        const outcome = compileCard(
            spell(
                "Test Burn",
                "{1}{R}",
                "Sorcery",
                "Test Burn deals 2 damage to each player."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
