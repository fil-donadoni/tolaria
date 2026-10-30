// The coin-flip Grammar Rules (CR 705.1–705.2, issue #4537): "Flip a coin. If
// you win/lose the flip, <clause>." → `coinFlip`, and "Flip a coin until you
// lose a flip. Put … for each flip you won." → `coinFlipSeries` + `counters`.
// The until-loss golden is also a `GOLDEN_FIXTURES` row (Crazed Firecat, the
// smoke generator cannot scenario-ize its random flips). Refusals pin
// fail-closed: a flip that drops its outcome, repeats one, or scales a payoff
// the rule does not read stays unparsed.

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

function artifact(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{4}",
        typeLine: "Artifact",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

const CRYPT_TEXT =
    "At the beginning of your upkeep, flip a coin. If you lose the flip, this artifact deals 3 damage to you.";

describe("coin flip — golden fixtures (CR 705.1)", () => {
    it("loss-only outcome: the win branch is a no-op (Mana Crypt)", () => {
        const def = compiled(artifact("Mana Crypt", CRYPT_TEXT));
        expect(def.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            {
                op: "coinFlip",
                win: { consequence: "Nothing happens.", effects: [] },
                loss: {
                    consequence: "This artifact deals 3 damage to you.",
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 3,
                            to: { player: "controller" },
                        },
                    ],
                },
            },
        ]);
    });

    it("win-only outcome: the loss branch is a no-op (Tavern Swindler)", () => {
        const def = compiled(
            oracleCard({
                name: "Tavern Swindler",
                manaCost: "{1}{B}",
                typeLine: "Creature — Human Rogue",
                oracleText:
                    "{T}, Pay 3 life: Flip a coin. If you win the flip, you gain 6 life.",
                power: "2",
                toughness: "2",
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "coinFlip",
                win: {
                    consequence: "You gain 6 life.",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 6 },
                    ],
                },
                loss: { consequence: "Nothing happens.", effects: [] },
            },
        ]);
    });

    it("both outcomes, in printed order (Bottle of Suleiman)", () => {
        const def = compiled(
            artifact(
                "Bottle of Suleiman",
                "{1}, Sacrifice this artifact: Flip a coin. If you win the flip, create a 5/5 colorless Djinn artifact creature token with flying. If you lose the flip, this artifact deals 5 damage to you."
            )
        );
        const op = def.activatedAbilities?.[0]?.effects?.[0];
        expect(op).toMatchObject({
            op: "coinFlip",
            win: { consequence: expect.stringContaining("Djinn") },
            loss: {
                consequence: "This artifact deals 5 damage to you.",
                effects: [
                    {
                        op: "dealDamage",
                        amount: 5,
                        to: { player: "controller" },
                    },
                ],
            },
        });
    });

    it("until you lose a flip: counters scaled by the flips won (Crazed Firecat)", () => {
        const def = compiled(
            oracleCard({
                name: "Crazed Firecat",
                manaCost: "{5}{R}{R}",
                typeLine: "Creature — Elemental Cat",
                oracleText:
                    "When this creature enters, flip a coin until you lose a flip. Put a +1/+1 counter on this creature for each flip you won.",
                power: "4",
                toughness: "4",
            })
        );
        expect(def.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            { op: "coinFlipSeries", untilLoss: true, bindWins: "$wins" },
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { ref: "$source" },
                count: { ref: "$wins" },
            },
        ]);
    });
});

describe("coin flip — refused neighbours (fail-closed)", () => {
    it.each([
        [
            "a flip with no outcome",
            "At the beginning of your upkeep, flip a coin.",
        ],
        [
            "an outcome named twice",
            "At the beginning of your upkeep, flip a coin. If you lose the flip, this artifact deals 3 damage to you. If you lose the flip, you lose 1 life.",
        ],
        [
            "an outcome with no flip",
            "At the beginning of your upkeep, if you lose the flip, this artifact deals 3 damage to you.",
        ],
        [
            "an until-loss series with no payoff (Okaun)",
            "At the beginning of combat on your turn, flip a coin until you lose a flip.",
        ],
        [
            "an until-loss payoff that is not counters",
            "At the beginning of your upkeep, flip a coin until you lose a flip. Draw a card for each flip you won.",
        ],
    ])("%s stays unparsed", (_label, text) => {
        expect(compileCard(artifact("Test Flip", text)).state).toBe("unparsed");
    });
});
