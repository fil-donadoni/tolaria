// Trigger-head anaphora — the heads that NAME a referent, and the words that
// read it back (issue #4127, CR 603.2b / 603.4 / 400.7e).
//
// "At the beginning of each player's upkeep" names a player; "When enchanted
// creature dies" names a creature that becomes a card in a graveyard. "that
// player" / "that card" in the body (or the intervening-if) are bound to those
// referents by the LOWERING site, never by the sentence — so a site that names
// no such referent must refuse the line rather than bind a guess.
//
//  1. GOLDENS — each accepted form is a real corpus card. The three whose
//     scripts the canned smoke scenario cannot stage are `GOLDEN_FIXTURES`
//     rows (compared whole by `goldenFixtures.test.ts`); here they must reach
//     `ready`. Elephant Guide is the head alone, compared whole.
//  2. REFUSALS — every neighbour whose antecedent is missing: a head that
//     names no player, a condition behind such a head, a spell site, a head
//     that puts no card anywhere, a destination other than the hand, and a
//     basic-land-type threshold no board can meet.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./fixtures";

function refused(card: ReturnType<typeof oracleCard>): boolean {
    return compileCard(card).state === "unparsed";
}

describe("trigger-head anaphora — goldens (issue #4127)", () => {
    it.each(
        GOLDEN_FIXTURES.filter((f) => f.rule === "trigger head").map(
            (f) => [f.card.name, f] as const
        )
    )("%s reaches ready — its fixture clears its smoke form", (_name, f) => {
        expect(compileCard(f.card).state).toBe("ready");
    });

    it("Elephant Guide: 'When enchanted creature dies' is the aura's host dying (CR 303.4b)", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "c138bd7f-8751-4e96-b54a-d5082e1a491f",
                name: "Elephant Guide",
                manaCost: "{2}{G}",
                typeLine: "Enchantment — Aura",
                oracleText:
                    "Enchant creature\nEnchanted creature gets +3/+3.\nWhen enchanted creature dies, create a 3/3 green Elephant creature token.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Elephant Guide",
                types: ["Enchantment"],
                subtypes: ["Aura"],
                manaCost: {
                    X: 2,
                    G: 1,
                },
                oracleText:
                    "Enchant creature\nEnchanted creature gets +3/+3.\nWhen enchanted creature dies, create a 3/3 green Elephant creature token.",
                compiledTriggeredAbilities: [
                    {
                        id: "elephant-guide-trigger",
                        oracleText:
                            "When enchanted creature dies, create a 3/3 green Elephant creature token.",
                        head: {
                            kind: "died",
                            scope: "host",
                        },
                        effects: [
                            {
                                op: "createToken",
                                token: {
                                    name: "Elephant",
                                    types: ["Creature"],
                                    subtypes: ["Elephant"],
                                    power: 3,
                                    toughness: 3,
                                    colors: ["G"],
                                },
                                controller: "controller",
                            },
                        ],
                    },
                ],
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        appliesTo: "host",
                        power: 3,
                        toughness: 3,
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                },
            })
        );
    });
});

describe("trigger-head anaphora — refusals (fail-closed, ADR 0105)", () => {
    const artifact = (oracleText: string) =>
        oracleCard({
            typeLine: "Artifact",
            manaCost: "{2}",
            oracleText,
            power: undefined,
            toughness: undefined,
        });

    it("refuses 'that player' after a head that names no player", () => {
        expect(
            refused(
                artifact(
                    "At the beginning of each upkeep, this artifact deals 1 damage to that player."
                )
            )
        ).toBe(true);
    });

    it("refuses a basic-land-type condition after a head that names no player", () => {
        expect(
            refused(
                artifact(
                    "At the beginning of your upkeep, if there are four or more basic land types among lands that player controls, you gain 1 life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that player' at a spell site", () => {
        expect(
            refused(
                oracleCard({
                    typeLine: "Sorcery",
                    oracleText: "That player discards a card at random.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });

    it("refuses 'that card' after a head that moves no card", () => {
        expect(
            refused(
                artifact(
                    "At the beginning of your upkeep, return that card to its owner's hand."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that card' returned anywhere but its owner's hand", () => {
        expect(
            refused(
                oracleCard({
                    typeLine: "Enchantment — Aura",
                    oracleText:
                        "Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under your control.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });

    it.each(["one", "six"])(
        "refuses a '%s or more basic land types' threshold (CR 305.6 — five types exist)",
        (word) => {
            expect(
                refused(
                    artifact(
                        `At the beginning of each player's upkeep, if there are ${word} or more basic land types among lands that player controls, this artifact deals 3 damage to that player.`
                    )
                )
            ).toBe(true);
        }
    );
});
