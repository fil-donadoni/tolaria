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
//     Wastes, `cards/sets/ice/colorless.cards.ts`). One row for a hand-written twin
//     (Adarkar Wastes itself) and one for a corpus-only card with no
//     hand-written definition (Caves of Koilos, APC) — the merge is a
//     property of the two LINES, not of having a twin to compare against.
//  2. GOLD over the hand-written catalogue — every Ice Age painland's own
//     text compiles to its own definition, exactly (Guard C).
//  3. REFUSALS — what the rule must NOT do: a fixed production's identical
//     rider sentence (Ancient Tomb's unconditional `dealsDamageToControllerOnTap`,
//     a different field, issue #4542) never writes the coloured-only field; a plain choice with no rider carries
//     no spurious damage field; two mana lines with DIFFERENT costs do not
//     merge into one ability.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import type { CompiledDefinition, OracleCard } from "../types";

import { oracleCard } from "./oracle.fixture";

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

describe("refusals — what the rider rule must not do", () => {
    it("a FIXED production's identical sentence is the unconditional ping, never the coloured-only field (Ancient Tomb)", () => {
        const compiled = compiledOf(
            land(
                "Ancient Tomb",
                "{T}: Add {C}{C}. This land deals 2 damage to you."
            )
        );
        const ability = compiled.activatedAbilities![0]!;
        expect(ability.dealsDamageToControllerOnTap).toBe(2);
        expect(ability.dealsDamageToControllerOnColoredTap).toBeUndefined();
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

// The Talisman cycle (issue #10560) prints the painland rider on its own
// self-referring noun — "This artifact deals N damage to you." — and compiles
// to the shape `makeTalisman` (`cards/abilities/index.ts`) ships.
function artifact(name: string, oracleText: string): OracleCard {
    return oracleCard({
        oracleId: name,
        name,
        manaCost: "{2}",
        typeLine: "Artifact",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("golden — the Talisman line merges like the painland", () => {
    it("Talisman of Unity (MRD, corpus card the modern-tron Target needs)", () => {
        const text =
            "{T}: Add {C}.\n{T}: Add {G} or {W}. This artifact deals 1 damage to you.";
        expect(compiledOf(artifact("Talisman of Unity", text))).toEqual({
            name: "Talisman of Unity",
            types: ["Artifact"],
            manaCost: { X: 2 },
            oracleText: text,
            activatedAbilities: [
                {
                    id: "talisman-of-unity-mana",
                    oracleText: text,
                    cost: { tap: true },
                    useStack: false,
                    manaChoices: [{ C: 1 }, { G: 1 }, { W: 1 }],
                    dealsDamageToControllerOnColoredTap: 1,
                },
            ],
        });
    });
});

describe("refusals — the self-referring noun is the card's own type", () => {
    it('"This artifact" on a land stays unparsed', () => {
        const outcome = compileCard(
            land(
                "Test Wastes",
                "{T}: Add {C}.\n{T}: Add {W} or {U}. This artifact deals 1 damage to you."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('"This land" on a non-land artifact stays unparsed', () => {
        const outcome = compileCard(
            artifact(
                "Test Talisman",
                "{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a FIXED production's artifact ping is not read (no printed card)", () => {
        const outcome = compileCard(
            artifact(
                "Test Tomb",
                "{T}: Add {C}{C}. This artifact deals 2 damage to you."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
