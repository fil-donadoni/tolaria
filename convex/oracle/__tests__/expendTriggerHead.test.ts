// "Whenever you expend N" — the expend trigger head (CR 700.14).
//
//  1. GOLDEN fixtures — real corpus cards compiled whole: Bark-Knuckle Boxer
//     (N = 4, a self-referring body) and Trailtracker Scout (N = 8, a targeted
//     body: the head passes the trigger's target through).
//  2. REFUSALS — the neighbours no fixture reads: the enters-and-expend line
//     (Hoarder's Overflow, one ability over two events), another player
//     expending, and a numeral no card prints.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function unparsedLines(card: ReturnType<typeof oracleCard>): string[] {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed") return [];
    return outcome.gaps.map((gap) => gap.line);
}

const BOXER_TEXT =
    "Whenever you expend 4, this creature gains indestructible until end of turn. (You expend 4 as you spend your fourth total mana to cast spells during a turn.)";

const SCOUT_TEXT =
    "{T}: Add one mana of any color.\nWhenever you expend 8, return up to one target permanent card from your graveyard to your hand. (You expend 8 as you spend your eighth total mana to cast spells during a turn.)";

describe("Expend — golden fixtures (CR 700.14)", () => {
    it("Bark-Knuckle Boxer: 'Whenever you expend 4' is the expend head, N = 4", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Bark-Knuckle Boxer",
                manaCost: "{1}{G}",
                typeLine: "Creature — Raccoon Berserker",
                oracleText: BOXER_TEXT,
                power: "3",
                toughness: "2",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Bark-Knuckle Boxer",
                types: ["Creature"],
                subtypes: ["Raccoon", "Berserker"],
                manaCost: { X: 1, G: 1 },
                power: 3,
                toughness: 2,
                oracleText: BOXER_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "bark-knuckle-boxer-trigger",
                        oracleText:
                            "Whenever you expend 4, this creature gains indestructible until end of turn.",
                        head: { kind: "expend", scope: "you", amount: 4 },
                        effects: [
                            {
                                op: "grantAbility",
                                target: { ref: "$source" },
                                ability: "indestructible",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Trailtracker Scout: N = 8, the body's target rides the expend head", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Trailtracker Scout",
                manaCost: "{1}{G}",
                typeLine: "Creature — Raccoon Scout",
                oracleText: SCOUT_TEXT,
                power: "1",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Trailtracker Scout",
                types: ["Creature"],
                subtypes: ["Raccoon", "Scout"],
                manaCost: { X: 1, G: 1 },
                power: 1,
                toughness: 3,
                oracleText: SCOUT_TEXT,
                activatedAbilities: [
                    {
                        id: "trailtracker-scout-mana",
                        oracleText: "{T}: Add one mana of any color.",
                        cost: { tap: true },
                        useStack: false,
                        manaChoices: [
                            { W: 1 },
                            { U: 1 },
                            { B: 1 },
                            { R: 1 },
                            { G: 1 },
                        ],
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "trailtracker-scout-trigger",
                        oracleText:
                            "Whenever you expend 8, return up to one target permanent card from your graveyard to your hand.",
                        head: { kind: "expend", scope: "you", amount: 8 },
                        targetRequirement: {
                            type: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            count: { min: 0, max: 1 },
                            zone: "graveyard",
                            controller: "you",
                        },
                        effects: [
                            {
                                op: "moveZone",
                                target: { target: 0 },
                                to: "hand",
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("Expend — refused neighbours (fail-closed, ADR 0105 § 2)", () => {
    it.each([
        // CR 603.2 — one ability over the source's entry AND the expend
        // event: no compiled head spans both (Hoarder's Overflow).
        [
            "Hoarder's Overflow",
            "Enchantment",
            "When this enchantment enters and whenever you expend 4, put a stash counter on it.",
        ],
        // CR 700.14 — only "you" is printed; another player's tally is no head
        // this rule reads.
        [
            "Test Opponent Expend",
            "Enchantment",
            "Whenever an opponent expends 4, you gain 1 life.",
        ],
        // A numeral no card prints: N is at least 1.
        [
            "Test Zero Expend",
            "Enchantment",
            "Whenever you expend 0, you gain 1 life.",
        ],
    ])("%s stays unparsed", (name, typeLine, line) => {
        expect(
            unparsedLines(
                oracleCard({
                    name,
                    manaCost: "{1}{R}",
                    typeLine,
                    oracleText: line,
                })
            )
        ).toContain(line);
    });
});
