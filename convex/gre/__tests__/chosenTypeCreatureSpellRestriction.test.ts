// CR 106.6 / 205.3m / 702.73a (issue #9388) — the `chosen-type-creature-spell`
// mana restriction: "Spend this mana only to cast a creature spell of the
// chosen type" (Cavern of Souls). The first restriction keyed on a value the
// SOURCE chose, snapshotted onto the unit (`RestrictedMana.chosenCreatureType`)
// when the mana is added. GRE layer: eligibility, the CR 106.4 bucket key, the
// snapshot helper, and the payment that reports the can't-be-countered rider.

import { describe, it, expect } from "vitest";
import {
    addRestrictedManaToPool,
    payManaCostForSpell,
    restrictedUnitAllowsSpell,
    restrictionAllowsAbility,
    restrictionAllowsSpell,
    restrictionChosenCreatureType,
    reverseRestrictedManaFromPool,
    spellRestrictionSubject,
    spendablePoolForSpell,
} from "../state";
import { makePlayer } from "../../cards/__tests__/setup.helper";
import { expandChangeling } from "../../cards/abilities/changeling";
import type { CardDefinition } from "../../cards/types";

const RESTRICTION = "chosen-type-creature-spell" as const;

const elfSubject = { colors: ["G"], subtypes: ["Elf", "Druid"] };
const goblinSubject = { colors: ["R"], subtypes: ["Goblin"] };

describe("restrictionAllowsSpell — chosen-type-creature-spell (CR 106.6 / 205.3m)", () => {
    it("pays for a creature spell of the chosen type", () => {
        expect(
            restrictionAllowsSpell(
                RESTRICTION,
                ["Creature"],
                [],
                elfSubject,
                "Elf"
            )
        ).toBe(true);
    });

    it("refuses a creature spell of another type", () => {
        expect(
            restrictionAllowsSpell(
                RESTRICTION,
                ["Creature"],
                [],
                goblinSubject,
                "Elf"
            )
        ).toBe(false);
    });

    it("refuses a NONCREATURE spell carrying the chosen type (Kindred)", () => {
        expect(
            restrictionAllowsSpell(
                RESTRICTION,
                ["Kindred", "Instant"],
                [],
                { colors: ["G"], subtypes: ["Elf"] },
                "Elf"
            )
        ).toBe(false);
    });

    it("fails closed with no chosen type or no subject", () => {
        expect(
            restrictionAllowsSpell(RESTRICTION, ["Creature"], [], elfSubject)
        ).toBe(false);
        expect(
            restrictionAllowsSpell(
                RESTRICTION,
                ["Creature"],
                [],
                undefined,
                "Elf"
            )
        ).toBe(false);
    });

    it("a changeling creature spell is every creature type (CR 702.73a)", () => {
        const shapeshifter = expandChangeling({
            id: "test-changeling",
            name: "Test Changeling",
            manaCost: { X: 1 },
            types: ["Creature"],
            subtypes: ["Shapeshifter"],
            staticAbilities: ["changeling"],
            power: 1,
            toughness: 1,
        } as CardDefinition);
        const subject = spellRestrictionSubject(shapeshifter);
        for (const chosen of ["Elf", "Goblin", "Merfolk"]) {
            expect(
                restrictionAllowsSpell(
                    RESTRICTION,
                    ["Creature"],
                    [],
                    subject,
                    chosen
                )
            ).toBe(true);
        }
    });

    it("never pays to activate an ability", () => {
        expect(
            restrictionAllowsAbility(RESTRICTION, ["Creature"], elfSubject)
        ).toBe(false);
    });

    it("the unit-level check reads the unit's snapshotted type", () => {
        const unit = {
            color: "G",
            amount: 1,
            restriction: RESTRICTION,
            chosenCreatureType: "Elf",
        };
        expect(
            restrictedUnitAllowsSpell(
                unit,
                ["Creature"],
                undefined,
                [],
                elfSubject
            )
        ).toBe(true);
        expect(
            restrictedUnitAllowsSpell(
                unit,
                ["Creature"],
                undefined,
                [],
                goblinSubject
            )
        ).toBe(false);
    });
});

describe("restrictionChosenCreatureType — the snapshot (CR 614.12a)", () => {
    it("reads the source's chosen type only for the chosen-type restriction", () => {
        const source = { chosenSubtypes: ["Elf"] };
        expect(restrictionChosenCreatureType(RESTRICTION, source)).toBe("Elf");
        expect(
            restrictionChosenCreatureType("creature-spell", source)
        ).toBeUndefined();
        expect(
            restrictionChosenCreatureType(undefined, source)
        ).toBeUndefined();
        expect(restrictionChosenCreatureType(RESTRICTION, {})).toBeUndefined();
    });
});

describe("chosen-type mana in the pool — the CR 106.4 bucket key", () => {
    it("Elf mana and Goblin mana of one colour never merge; same type does", () => {
        const player = makePlayer("p1");
        addRestrictedManaToPool(
            player,
            "G",
            1,
            RESTRICTION,
            undefined,
            undefined,
            undefined,
            "Elf"
        );
        addRestrictedManaToPool(
            player,
            "G",
            1,
            RESTRICTION,
            undefined,
            undefined,
            undefined,
            "Goblin"
        );
        addRestrictedManaToPool(
            player,
            "G",
            1,
            RESTRICTION,
            undefined,
            undefined,
            undefined,
            "Elf"
        );
        expect(player.restrictedMana).toEqual([
            {
                color: "G",
                amount: 2,
                restriction: RESTRICTION,
                chosenCreatureType: "Elf",
            },
            {
                color: "G",
                amount: 1,
                restriction: RESTRICTION,
                chosenCreatureType: "Goblin",
            },
        ]);
    });

    it("a reversal decrements the bucket of its own chosen type", () => {
        const player = makePlayer("p1");
        addRestrictedManaToPool(
            player,
            "G",
            1,
            RESTRICTION,
            undefined,
            undefined,
            undefined,
            "Elf"
        );
        addRestrictedManaToPool(
            player,
            "G",
            1,
            RESTRICTION,
            undefined,
            undefined,
            undefined,
            "Goblin"
        );
        reverseRestrictedManaFromPool(
            player,
            "G",
            1,
            RESTRICTION,
            undefined,
            undefined,
            "Goblin"
        );
        expect(player.restrictedMana).toEqual([
            {
                color: "G",
                amount: 1,
                restriction: RESTRICTION,
                chosenCreatureType: "Elf",
            },
        ]);
    });
});

describe("payManaCostForSpell — chosen-type mana with the can't-be-countered rider", () => {
    it("an Elf spell spends the Elf unit and reports the rider; a Goblin spell cannot see it", () => {
        const player = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        addRestrictedManaToPool(
            player,
            "G",
            1,
            RESTRICTION,
            undefined,
            { cantBeCountered: true },
            undefined,
            "Elf"
        );

        const goblinPool = spendablePoolForSpell(
            player,
            ["Creature"],
            undefined,
            [],
            goblinSubject
        );
        expect(goblinPool.G ?? 0).toBe(0);

        const elfPool = spendablePoolForSpell(
            player,
            ["Creature"],
            undefined,
            [],
            elfSubject
        );
        expect(elfPool.G).toBe(1);

        const riders = payManaCostForSpell(
            player,
            { G: 1 },
            ["Creature"],
            [],
            undefined,
            undefined,
            [],
            elfSubject
        );
        expect(riders.cantBeCountered).toBe(true);
        expect(player.restrictedMana).toBeUndefined();
    });
});
