// "Whenever this creature deals combat damage to a player, that player …"
// (CR 510.1, CR 102.1): the head is the "deals damage to a player" head
// narrowed to combat damage, on the same `DAMAGE_DEALT` trigger, so "that
// player" names the same `$event.damagedPlayer`. Golden fixture: Demon of
// Loathing (`GOLDEN_FIXTURES`, the sacrifice choice by an `$event` player).
//
//  1. GOLDEN — Blazing Specter's discard.
//  2. REFUSAL — "that opponent": either player can be dealt the damage, so
//     the head names no opponent.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";

describe("combat-damage head names the damaged player — golden (CR 510.1)", () => {
    it("Blazing Specter — that player discards a card", () => {
        const outcome = compileCard({
            oracleId: "4c046368-5899-42ef-9972-3a3a6c8fe3fd",
            name: "Blazing Specter",
            manaCost: "{2}{B}{R}",
            typeLine: "Creature — Specter",
            oracleText:
                "Flying, haste\nWhenever this creature deals combat damage to a player, that player discards a card.",
            power: "2",
            toughness: "2",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Blazing Specter",
                types: ["Creature"],
                subtypes: ["Specter"],
                manaCost: { X: 2, B: 1, R: 1 },
                power: 2,
                toughness: 2,
                oracleText:
                    "Flying, haste\nWhenever this creature deals combat damage to a player, that player discards a card.",
                staticAbilities: ["flying", "haste"],
                compiledTriggeredAbilities: [
                    {
                        id: "blazing-specter-trigger",
                        oracleText:
                            "Whenever this creature deals combat damage to a player, that player discards a card.",
                        head: { kind: "combat-damage-to-player" },
                        effects: [
                            {
                                op: "choice",
                                kind: "discard-hand",
                                player: { ref: "$event.damagedPlayer" },
                                zone: "hand",
                                count: 1,
                                prompt: "Discard a card.",
                                bind: "$discard1",
                            },
                            {
                                op: "discard",
                                player: { ref: "$event.damagedPlayer" },
                                cards: { ref: "$discard1" },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("combat-damage head names the damaged player — refused neighbours", () => {
    it('"that opponent" stays unbound: the damaged player may be either', () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Creature",
            manaCost: "{1}{B}",
            typeLine: "Creature — Horror",
            oracleText:
                "Whenever this creature deals combat damage to a player, that opponent discards a card.",
            power: "2",
            toughness: "2",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/that opponent/)
        );
    });
});
