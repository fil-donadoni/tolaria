// CR 118.1 + CR 608.2h + CR 208.1 — "It deals damage equal to its power to
// target creature" behind a "Sacrifice this creature" cost (Cinder Shade, Flame
// Elemental, Minotaur Illusionist; issue #4317).
//
// "its" is the SOURCE the cost sacrificed, so its power is last known
// information: the compiler lowers it to the `sacrificed` value, which the
// engine reads off the snapshot the activation stamps on the stack item
// (`sacrificeSourceSnapshot`, `gre/sacrificeChoice.ts`). Only a site whose cost
// sacrificed the source can bind it — anywhere else "its power" is a live value
// of an object still in play, which the value grammar cannot read.
//
// Two layers:
//
//  1. GOLDEN — real corpus cards, whole Compiled Definition, `sortKeys` equality.
//  2. REFUSALS — every neighbour the rule must not read: no sacrifice in the
//     cost, a sacrifice of ANOTHER permanent, a trigger site, and the other
//     characteristics.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

const FLAME_ELEMENTAL_TEXT =
    "{R}, {T}, Sacrifice this creature: It deals damage equal to its power to target creature.";
const MINOTAUR_TEXT =
    "{R}, Sacrifice this creature: It deals damage equal to its power to target creature.";

const DAMAGE_BY_POWER = {
    op: "dealDamage",
    amount: { sacrificed: { read: "power" } },
    to: { target: 0 },
} as const;

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function creature(oracleText: string) {
    return oracleCard({
        name: "Test Creature",
        manaCost: "{2}{R}",
        typeLine: "Creature — Elemental",
        oracleText,
        power: "2",
        toughness: "2",
    });
}

describe("sacrificed source's power — golden (CR 608.2h)", () => {
    it("Flame Elemental: {R}, {T}, Sacrifice this creature", () => {
        const card = oracleCard({
            name: "Flame Elemental",
            manaCost: "{2}{R}{R}",
            typeLine: "Creature — Elemental",
            oracleText: FLAME_ELEMENTAL_TEXT,
            power: "3",
            toughness: "2",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Flame Elemental",
                types: ["Creature"],
                subtypes: ["Elemental"],
                manaCost: { X: 2, R: 2 },
                power: 3,
                toughness: 2,
                oracleText: FLAME_ELEMENTAL_TEXT,
                activatedAbilities: [
                    {
                        id: "flame-elemental-ability",
                        oracleText: FLAME_ELEMENTAL_TEXT,
                        cost: { mana: { R: 1 }, tap: true, sacrifice: true },
                        useStack: true,
                        effects: [DAMAGE_BY_POWER],
                        targetRequirement: { type: "Creature", count: 1 },
                    },
                ],
            })
        );
    });

    it("no {T}: the sacrifice alone binds it (Minotaur Illusionist's damage line)", () => {
        const definition = compiled(creature(MINOTAUR_TEXT));
        expect(sortKeys(definition.activatedAbilities?.[0]?.cost)).toEqual(
            sortKeys({ mana: { R: 1 }, sacrifice: true })
        );
        expect(definition.activatedAbilities?.[0]?.effects).toEqual([
            DAMAGE_BY_POWER,
        ]);
    });
});

describe("sacrificed source's power — refusals (fail-closed)", () => {
    it("refuses 'its power' when the cost does not sacrifice the source", () => {
        // The dealer is the source, still in play: its power is a LIVE value.
        const outcome = compileCard(
            creature(
                "{R}, {T}: This creature deals damage equal to its power to target creature."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses when the cost sacrifices ANOTHER permanent", () => {
        const outcome = compileCard(
            creature(
                "{R}, Sacrifice a Goblin: This creature deals damage equal to its power to target creature."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses at a triggered site — nothing was sacrificed as a cost", () => {
        const outcome = compileCard(
            creature(
                "When this creature dies, it deals damage equal to its power to target creature."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses the characteristics no card prints at a damage site", () => {
        for (const word of ["toughness", "mana value"]) {
            const outcome = compileCard(
                creature(
                    `{R}, Sacrifice this creature: It deals damage equal to its ${word} to target creature.`
                )
            );
            expect(outcome.state, word).toBe("unparsed");
        }
    });
});
