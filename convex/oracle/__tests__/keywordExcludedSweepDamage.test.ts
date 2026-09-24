// "<self> deals N damage to each creature without <keyword>" — CR 120.3 +
// CR 702 (issue #4310). The recipient is a creature sweep narrowed by ONE
// keyword exclusion, lowered to a single `forEach` whose selector carries
// `filter.excludeAbility` (the exclusion twin of `hasAbility`).
//
// Read by its OWN rule (`keywordExcludedSweepRule`), not by widening the
// general mass subject: every other verb keeps refusing "without <keyword>",
// and "each creature" with no exclusion stays refused (see
// eachCreatureAndPlayerDamage.test.ts).
//
// Goldens: Ashen Firebeast (plain source), Bloodfire Dwarf ("It" dealer
// behind a sacrifice cost), Magma Vein (a non-creature source, "This
// enchantment"). Ashen Firebeast is also a registered `GOLDEN_FIXTURES` row —
// the smoke generator cannot build a `forEach`/`$each` script.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const ASHEN_FIREBEAST: OracleCard = {
    oracleId: "7246e3a0-f8b7-4c1b-ae75-a1eb8990a728",
    name: "Ashen Firebeast",
    manaCost: "{6}{R}{R}",
    typeLine: "Creature — Elemental Beast",
    oracleText:
        "{1}{R}: This creature deals 1 damage to each creature without flying.",
    power: "6",
    toughness: "6",
    layout: "normal",
};

const BLOODFIRE_DWARF: OracleCard = {
    oracleId: "ff42551a-a08e-4d0c-a5b1-d1c1bbff4915",
    name: "Bloodfire Dwarf",
    manaCost: "{R}",
    typeLine: "Creature — Dwarf",
    oracleText:
        "{R}, Sacrifice this creature: It deals 1 damage to each creature without flying.",
    power: "1",
    toughness: "1",
    layout: "normal",
};

const MAGMA_VEIN: OracleCard = {
    oracleId: "9ae2bf71-c443-4814-b7c3-b3b82d595983",
    name: "Magma Vein",
    manaCost: "{2}{R}",
    typeLine: "Enchantment",
    oracleText:
        "{R}, Sacrifice a land: This enchantment deals 1 damage to each creature without flying.",
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
            manaCost: "{1}{R}",
            typeLine: "Creature — Bear",
            oracleText,
            power: "1",
            toughness: "1",
        })
    );
}

const FLYING_SWEEP = {
    op: "forEach",
    select: {
        set: "permanents",
        zone: "battlefield",
        filter: { type: "Creature", excludeAbility: "flying" },
    },
    effects: [{ op: "dealDamage", amount: 1, to: { ref: "$each" } }],
};

describe("each creature without <keyword> (CR 120.3 + CR 702) — goldens", () => {
    it("Ashen Firebeast: one forEach over creatures without flying", () => {
        expect(sortKeys(compiled(ASHEN_FIREBEAST))).toEqual(
            sortKeys({
                name: "Ashen Firebeast",
                types: ["Creature"],
                subtypes: ["Elemental", "Beast"],
                manaCost: { X: 6, R: 2 },
                power: 6,
                toughness: 6,
                oracleText:
                    "{1}{R}: This creature deals 1 damage to each creature without flying.",
                activatedAbilities: [
                    {
                        id: "ashen-firebeast-ability",
                        oracleText:
                            "{1}{R}: This creature deals 1 damage to each creature without flying.",
                        cost: { mana: { X: 1, R: 1 } },
                        useStack: true,
                        effects: [FLYING_SWEEP],
                    },
                ],
            })
        );
    });

    it("Bloodfire Dwarf: 'It' dealer behind a sacrifice cost (CR 120.1)", () => {
        const definition = compiled(BLOODFIRE_DWARF);
        expect(sortKeys(definition.activatedAbilities?.[0]?.effects)).toEqual(
            sortKeys([FLYING_SWEEP])
        );
        expect(definition.activatedAbilities?.[0]?.cost).toEqual({
            mana: { R: 1 },
            sacrifice: true,
        });
    });

    it("Magma Vein: a non-creature source deals the same sweep", () => {
        const definition = compiled(MAGMA_VEIN);
        expect(sortKeys(definition.activatedAbilities?.[0]?.effects)).toEqual(
            sortKeys([FLYING_SWEEP])
        );
    });

    it("the Ashen Firebeast golden fixture takes it all the way to ready", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Ashen Firebeast"
        );
        expect(fixture?.rule).toBe("effect clause");
        expect(compileCard(fixture!.card).state).toBe("ready");
    });
});

describe("each creature without <keyword> — refusals stay fail-closed", () => {
    it("'each creature' with no exclusion is still refused", () => {
        expect(
            probe("{R}: This creature deals 1 damage to each creature.").state
        ).toBe("unparsed");
    });

    it("'with <keyword>' is a different sweep and stays refused", () => {
        expect(
            probe(
                "{R}: This creature deals 1 damage to each creature with flying."
            ).state
        ).toBe("unparsed");
    });

    it("the exclusion is read for damage only: a destroy sweep still refuses it", () => {
        expect(probe("{R}: Destroy each creature without flying.").state).toBe(
            "unparsed"
        );
    });

    it("a second recipient after the sweep is refused, not dropped", () => {
        expect(
            probe(
                "{R}: This creature deals 1 damage to each creature without flying and each player."
            ).state
        ).toBe("unparsed");
    });

    it("an unknown keyword is refused, not dropped", () => {
        expect(
            probe(
                "{R}: This creature deals 1 damage to each creature without wibble."
            ).state
        ).toBe("unparsed");
    });
});
