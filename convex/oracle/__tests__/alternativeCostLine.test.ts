// Alternative costs printed on a spell's own line (CR 118.9, issue #4558):
// "You may [action] rather than pay this spell's mana cost." and
// "[condition], you may cast this spell without paying its mana cost."
//
// Two layers (the gold-over-hand-written layer retired with its cards, ADR 0114:
// `check:oracle` holds each retirement's equivalence proof):
//
//  1. GOLDEN fixtures — one real corpus card per accepted form, compiled whole
//     and compared with the full Compiled Definition: sacrifice N lands
//     (Fireblast), return N lands with "their owner's hand" (Gush), return
//     one land with "its owner's hand" (Daze), and the Legate cycle's
//     two-sided free cast, on an instant (Mogg Salvage) and on a permanent
//     (Saprazzan Legate).
//  2. REFUSALS — the neighbours of the family the rule must not read: other
//     legs (a land card discarded), other conditions (your turn, a
//     commander), and count/noun/pronoun disagreements.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function instant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

describe("Alternative cost line — golden fixtures (CR 118.9)", () => {
    it("sacrifice N: Fireblast", () => {
        const oracleText =
            "You may sacrifice two Mountains rather than pay this spell's mana cost.\nFireblast deals 4 damage to any target.";
        expectDefinition(instant("Fireblast", "{4}{R}{R}", oracleText), {
            name: "Fireblast",
            types: ["Instant"],
            manaCost: { X: 4, R: 2 },
            oracleText,
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
            targetRequirement: { type: "any", count: 1 },
            alternativeCosts: [
                {
                    id: "sacrifice-two-mountains",
                    description: "Sacrifice two Mountains",
                    permanent: {
                        action: "sacrifice",
                        filter: { subtypes: ["Mountain"] },
                        count: 2,
                    },
                },
            ],
        });
    });

    it("return N to their owner's hand: Gush", () => {
        const oracleText =
            "You may return two Islands you control to their owner's hand rather than pay this spell's mana cost.\nDraw two cards.";
        expectDefinition(instant("Gush", "{4}{U}", oracleText), {
            name: "Gush",
            types: ["Instant"],
            manaCost: { X: 4, U: 1 },
            oracleText,
            effects: [{ op: "draw", player: "controller", count: 2 }],
            alternativeCosts: [
                {
                    id: "return-two-islands",
                    description:
                        "Return two Islands you control to their owner's hand",
                    permanent: {
                        action: "return",
                        filter: { subtypes: ["Island"] },
                        count: 2,
                    },
                },
            ],
        });
    });

    it("return one to its owner's hand: Daze", () => {
        const oracleText =
            "You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\nCounter target spell unless its controller pays {1}.";
        expectDefinition(instant("Daze", "{1}{U}", oracleText), {
            name: "Daze",
            types: ["Instant"],
            manaCost: { X: 1, U: 1 },
            oracleText,
            effects: [
                {
                    op: "mayPay",
                    player: { controllerOf: { target: 0 } },
                    cost: { X: 1 },
                    prompt: "Pay {1} to prevent your spell from being countered?",
                    bind: "$may1",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$may1" } },
                    then: [{ op: "counter", target: { target: 0 } }],
                },
            ],
            targetRequirement: { type: "spell", count: 1 },
            alternativeCosts: [
                {
                    id: "return-an-island",
                    description:
                        "Return an Island you control to its owner's hand",
                    permanent: {
                        action: "return",
                        filter: { subtypes: ["Island"] },
                        count: 1,
                    },
                },
            ],
        });
    });

    it("free cast on a two-sided board condition: Mogg Salvage", () => {
        const oracleText =
            "If an opponent controls an Island and you control a Mountain, you may cast this spell without paying its mana cost.\nDestroy target artifact.";
        expectDefinition(instant("Mogg Salvage", "{2}{R}", oracleText), {
            name: "Mogg Salvage",
            types: ["Instant"],
            manaCost: { X: 2, R: 1 },
            oracleText,
            effects: [{ op: "destroy", target: { target: 0 } }],
            targetRequirement: { type: "Artifact", count: 1 },
            alternativeCosts: [
                {
                    id: "cast-without-paying",
                    description: "Cast without paying its mana cost",
                    condition: {
                        kind: "all",
                        of: [
                            {
                                kind: "opponent-control",
                                filter: { subtypes: ["Island"] },
                            },
                            {
                                kind: "control",
                                filter: { subtypes: ["Mountain"] },
                            },
                        ],
                    },
                },
            ],
        });
    });

    it("free cast on a permanent spell: Saprazzan Legate", () => {
        const oracleText =
            "If an opponent controls a Mountain and you control an Island, you may cast this spell without paying its mana cost.\nFlying";
        expectDefinition(
            oracleCard({
                name: "Saprazzan Legate",
                manaCost: "{3}{U}",
                oracleText,
                typeLine: "Creature — Merfolk Soldier",
                power: "1",
                toughness: "3",
            }),
            {
                name: "Saprazzan Legate",
                types: ["Creature"],
                subtypes: ["Merfolk", "Soldier"],
                manaCost: { X: 3, U: 1 },
                power: 1,
                toughness: 3,
                oracleText,
                staticAbilities: ["flying"],
                alternativeCosts: [
                    {
                        id: "cast-without-paying",
                        description: "Cast without paying its mana cost",
                        condition: {
                            kind: "all",
                            of: [
                                {
                                    kind: "opponent-control",
                                    filter: { subtypes: ["Mountain"] },
                                },
                                {
                                    kind: "control",
                                    filter: { subtypes: ["Island"] },
                                },
                            ],
                        },
                    },
                ],
            }
        );
    });
});

describe("Alternative cost refusals (fail-closed)", () => {
    it.each([
        [
            "Flameshot",
            "You may discard a Mountain card rather than pay this spell's mana cost.",
            "a discard leg",
        ],
        [
            "Mine Collapse",
            "If it's your turn, you may sacrifice a Mountain rather than pay this spell's mana cost.",
            "a turn condition",
        ],
        [
            "Fierce Guardianship",
            "If you control a commander, you may cast this spell without paying its mana cost.",
            "a commander condition",
        ],
        [
            "Fireblast",
            "You may sacrifice two Mountain rather than pay this spell's mana cost.",
            "a count that disagrees with its noun",
        ],
        [
            "Daze",
            "You may return an Island you control to their owner's hand rather than pay this spell's mana cost.",
            "a pronoun that disagrees with the count",
        ],
    ])("%s: %s (%s)", (name, line) => {
        const outcome = compileCard(
            instant(name, "{1}{R}", `${line}\nDraw a card.`)
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.fragment)).toContain(line);
    });
});
