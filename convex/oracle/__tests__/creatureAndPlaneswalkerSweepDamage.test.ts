// "<self> deals N damage to each creature and each planeswalker" — CR 120.3 +
// CR 120.3c (issue #8581). The recipient is ONE sweep over every permanent that
// is a creature or a planeswalker, lowered to a single `forEach` whose selector
// carries the type union `["Creature", "Planeswalker"]`; the engine's damage
// sink removes a planeswalker's loyalty uniformly.
//
// Read by `creatureSweepRecipientRule` as one exact phrase: every other verb,
// a narrowed half and the elided "each creature and planeswalker" stay refused.
//
// Goldens: Storm's Wrath (the bare sentence), Star of Extinction (after an
// announced-target sentence). The smoke
// generator clears the sweep, so Storm's Wrath reaches `ready` with no
// GOLDEN_FIXTURES row.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const STORMS_WRATH: OracleCard = {
    oracleId: "eeb6f5eb-0e16-468e-9dfe-6ec8d8172f86",
    name: "Storm's Wrath",
    manaCost: "{2}{R}{R}",
    typeLine: "Sorcery",
    oracleText:
        "Storm's Wrath deals 4 damage to each creature and each planeswalker.",
    layout: "normal",
};

const STAR_OF_EXTINCTION: OracleCard = {
    oracleId: "48220e6c-5752-46e0-9b7f-f0eef274d929",
    name: "Star of Extinction",
    manaCost: "{5}{R}{R}",
    typeLine: "Sorcery",
    oracleText:
        "Destroy target land. Star of Extinction deals 20 damage to each creature and each planeswalker.",
    layout: "normal",
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function probe(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Refusal Probe",
            manaCost: "{2}{R}",
            typeLine: "Sorcery",
            oracleText,
        })
    );
}

function sweep(amount: number) {
    return {
        op: "forEach",
        select: {
            set: "permanents",
            zone: "battlefield",
            filter: { type: ["Creature", "Planeswalker"] },
        },
        effects: [{ op: "dealDamage", amount, to: { ref: "$each" } }],
    };
}

describe("each creature and each planeswalker (CR 120.3 + CR 120.3c) — goldens", () => {
    it("Storm's Wrath: one forEach over creatures and planeswalkers", () => {
        expect(sortKeys(compiled(STORMS_WRATH))).toEqual(
            sortKeys({
                name: "Storm's Wrath",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 2 },
                oracleText:
                    "Storm's Wrath deals 4 damage to each creature and each planeswalker.",
                effects: [sweep(4)],
            })
        );
    });

    it("Star of Extinction: the sweep follows an announced land target", () => {
        expect(sortKeys(compiled(STAR_OF_EXTINCTION))).toEqual(
            sortKeys({
                name: "Star of Extinction",
                types: ["Sorcery"],
                manaCost: { X: 5, R: 2 },
                oracleText:
                    "Destroy target land. Star of Extinction deals 20 damage to each creature and each planeswalker.",
                targetRequirement: { type: "Land", count: 1 },
                effects: [{ op: "destroy", target: { target: 0 } }, sweep(20)],
            })
        );
    });

    it("the smoke generator takes Storm's Wrath all the way to ready", () => {
        expect(compileCard(STORMS_WRATH).state).toBe("ready");
    });
});

describe("each creature and each planeswalker — refusals stay fail-closed", () => {
    it("the elided 'each creature and planeswalker' is not the printed phrase", () => {
        expect(
            probe(
                "Refusal Probe deals 2 damage to each creature and planeswalker."
            ).state
        ).toBe("unparsed");
    });

    it("a narrowed half is a scope question and stays refused", () => {
        expect(
            probe(
                "Refusal Probe deals 2 damage to each creature and each planeswalker you don't control."
            ).state
        ).toBe("unparsed");
    });

    it("the recipient is read for damage only: a destroy sweep still refuses it", () => {
        expect(
            probe("Destroy each creature and each planeswalker.").state
        ).toBe("unparsed");
    });

    it("joined to every player it is a three-set union no fixture covers", () => {
        expect(
            probe(
                "Refusal Probe deals 2 damage to each creature and each planeswalker and each player."
            ).state
        ).toBe("unparsed");
    });
});
