// "Exile this card from your graveyard" activation cost (CR 113.6m, 602.1a).
//
// 1. GOLDEN — a real Oracle row compiled whole (Survivor of Korlis): the leg
//    lowers to `cost.exileThis` and the ability to `activateFromGraveyard`.
// 2. REFUSALS — neighbours the rule must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

const KORLIS_TEXT =
    "First strike\n{1}{W}, Exile this card from your graveyard: Scry 2.";

function creature(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{W}",
        typeLine: "Creature — Human Soldier",
        power: "1",
        toughness: "1",
        oracleText,
    });
}

describe("Graveyard-exile cost — golden (CR 113.6m)", () => {
    it("Survivor of Korlis: exileThis on an ability activated from the graveyard", () => {
        const outcome = compileCard(
            creature("Survivor of Korlis", KORLIS_TEXT)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Survivor of Korlis",
            types: ["Creature"],
            subtypes: ["Human", "Soldier"],
            manaCost: { W: 1 },
            power: 1,
            toughness: 1,
            oracleText: KORLIS_TEXT,
            staticAbilities: ["first strike"],
            activatedAbilities: [
                {
                    id: "survivor-of-korlis-ability",
                    oracleText:
                        "{1}{W}, Exile this card from your graveyard: Scry 2.",
                    cost: { mana: { X: 1, W: 1 }, exileThis: true },
                    useStack: true,
                    activateFromGraveyard: true,
                    effects: [
                        {
                            op: "scryReorder",
                            player: "controller",
                            count: 2,
                            destination: "library-bottom",
                        },
                    ],
                },
            ],
        });
    });
});

describe("Graveyard-exile cost — refusals", () => {
    // CR 113.6m — with the card in the graveyard, mana is the one companion
    // leg: a tap, a counter or a sacrifice names a permanent it is not.
    it.each([
        "{T}, Exile this card from your graveyard",
        "{1}, Sacrifice a creature, Exile this card from your graveyard",
        "Pay 2 life, Exile this card from your graveyard",
        "Exile this card from a graveyard",
    ])("refuses %s", (span) => {
        expect(
            activationCostRule.run(
                span,
                parseContext(creature("Survivor of Korlis", ""))
            ).ok
        ).toBe(false);
    });

    it("Jack-o'-Lantern: refuses a mana ability activated from the graveyard", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Jack-o'-Lantern",
                manaCost: "{1}",
                typeLine: "Artifact",
                oracleText:
                    "{1}, {T}, Sacrifice this artifact: Exile up to one target card from a graveyard. Draw a card.\n{1}, Exile this card from your graveyard: Add one mana of any color.",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((gap) => gap.reason)).toContain(
            "a mana ability activated from the graveyard has no stackless payment site (CR 113.6m)"
        );
    });

    it('Soul of Shandalar: refuses "It" — the exiled card is no antecedent', () => {
        const outcome = compileCard(
            creature(
                "Soul of Shandalar",
                "{3}{R}{R}, Exile this card from your graveyard: It deals 3 damage to target player or planeswalker."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
