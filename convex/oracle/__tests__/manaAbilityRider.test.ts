// Mana ability: the painland rider on a CHOICE production (CR 605.1a, issue
// #3828) — "{T}: Add {A} or {B}. This land deals N damage to you.", the enemy
// painland cycle (Battlefield Forge, Caves of Koilos, Llanowar Wastes, Shivan
// Reef, Yavimaya Coast, APC) and its Ice Age ancestors (Adarkar Wastes,
// Brushland, Karplusan Forest, Sulfurous Springs, Underground River).
//
// Three layers:
//
//  1. GOLDEN fixtures — a real corpus card's two printed mana lines, compiled
//     together, must produce exactly the shipped shape: ONE `manaChoices`
//     ability whose first option is the painless colourless tap and whose
//     coloured options carry `dealsDamageToControllerOnColoredTap` (Adarkar
//     Wastes, `cards/sets/ice/colorless.ts`). One row for a hand-written twin
//     (Adarkar Wastes itself) and one for a corpus-only card with no
//     hand-written definition (Caves of Koilos, APC) — the merge is a
//     property of the two LINES, not of having a twin to compare against.
//  2. GOLD over the hand-written catalogue — every Ice Age painland's own
//     text compiles to its own definition, exactly (Guard C).
//  3. REFUSALS — what the rule must NOT do: a fixed production's identical
//     rider sentence (Ancient Tomb's unconditional `dealsDamageToControllerOnTap`,
//     a different field) stays unparsed; a plain choice with no rider carries
//     no spurious damage field; two mana lines with DIFFERENT costs do not
//     merge into one ability.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import type { CompiledDefinition, OracleCard } from "../types";
import {
    adarkarWastes,
    brushland,
    karplusanForest,
    sulfurousSprings,
    undergroundRiver,
} from "../../cards/sets/ice/colorless";
import { oracleCard } from "./fixtures";

function land(name: string, oracleText: string, oracleId = name): OracleCard {
    return oracleCard({
        oracleId,
        name,
        manaCost: "",
        typeLine: "Land",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function compiledOf(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} did not reach ready: ${outcome.state}`);
    return outcome.definition;
}

describe("golden — the painland line merges into one manaChoices ability", () => {
    it("Adarkar Wastes (Ice Age, hand-written twin)", () => {
        const compiled = compiledOf(
            land(
                "Adarkar Wastes",
                "{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you."
            )
        );
        expect(compiled.activatedAbilities).toEqual([
            {
                id: "adarkar-wastes-mana",
                oracleText:
                    "{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you.",
                cost: { tap: true },
                useStack: false,
                manaChoices: [{ C: 1 }, { W: 1 }, { U: 1 }],
                dealsDamageToControllerOnColoredTap: 1,
            },
        ]);
    });

    it("Caves of Koilos (APC, no hand-written twin — the merge needs no gold to compare against)", () => {
        const compiled = compiledOf(
            land(
                "Caves of Koilos",
                "{T}: Add {C}.\n{T}: Add {W} or {B}. This land deals 1 damage to you.",
                "33de01e9-ce5a-42d4-afcb-343cd54a6d80"
            )
        );
        expect(compiled.activatedAbilities).toEqual([
            {
                id: "caves-of-koilos-mana",
                oracleText:
                    "{T}: Add {C}.\n{T}: Add {W} or {B}. This land deals 1 damage to you.",
                cost: { tap: true },
                useStack: false,
                manaChoices: [{ C: 1 }, { W: 1 }, { B: 1 }],
                dealsDamageToControllerOnColoredTap: 1,
            },
        ]);
    });
});

describe("gold — the Ice Age painland cycle round-trips through its own text", () => {
    it.each([
        adarkarWastes,
        brushland,
        karplusanForest,
        sulfurousSprings,
        undergroundRiver,
    ])("$name", (card) => {
        const verdict = roundTripCard(card).verdict;
        expect(sortKeys(verdict)).toEqual({ ok: true, kind: "equal" });
    });
});

describe("refusals — what the rider rule must not do", () => {
    it("a FIXED production's identical sentence stays unparsed (Ancient Tomb — a different field)", () => {
        const outcome = compileCard(
            land(
                "Ancient Tomb",
                "{T}: Add {C}{C}. This land deals 2 damage to you."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a plain two-way choice with no rider carries no damage field", () => {
        const compiled = compiledOf(land("Tundra", "{T}: Add {W} or {U}."));
        expect(compiled.activatedAbilities).toEqual([
            {
                id: "tundra-mana",
                oracleText: "{T}: Add {W} or {U}.",
                cost: { tap: true },
                useStack: false,
                manaChoices: [{ W: 1 }, { U: 1 }],
            },
        ]);
    });

    it("two mana lines with DIFFERENT costs do not merge", () => {
        const compiled = compiledOf(
            land(
                "Test Karoo",
                "{T}: Add {C}.\n{1}, {T}: Add {W} or {U}. This land deals 1 damage to you."
            )
        );
        expect(compiled.activatedAbilities).toHaveLength(2);
        expect(compiled.activatedAbilities![0]!.manaProduced).toEqual({
            C: 1,
        });
        expect(compiled.activatedAbilities![1]!.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
        ]);
        expect(
            compiled.activatedAbilities![1]!.dealsDamageToControllerOnColoredTap
        ).toBe(1);
    });
});
