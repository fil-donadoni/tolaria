// Waterbend {N} as an activation cost (CR 701.67a, issue #8182).
//
//  1. GOLDEN — a real Oracle row compiled whole: the bare cost (North Pole
//     Patrol's `{T}` companion proves the source never pays with itself) and
//     the enchantment source (Aang's Iceberg's cost leg).
//  2. REFUSALS — neighbours the rule must NOT read: variable `{X}`, a coloured
//     waterbend cost, a source that could tap itself (the engine's pool
//     excludes the source), waterbend beside another mana atom.

import { describe, expect, it } from "vitest";
import { waterbendCost } from "../../cards/abilities/waterbend";
import { compileCard } from "../compile";
import {
    activationCostRule,
    lowerActivationCost,
} from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

function source(typeLine: string) {
    return oracleCard({
        name: "Source",
        manaCost: "{2}",
        typeLine,
        oracleText: "",
        power: typeLine.startsWith("Creature") ? "2" : undefined,
        toughness: typeLine.startsWith("Creature") ? "2" : undefined,
    });
}

function costFor(span: string, typeLine: string) {
    return activationCostRule.run(span, parseContext(source(typeLine)));
}

describe("Waterbend cost — golden (CR 701.67a)", () => {
    it("lowers to waterbendCost: generic on the mana leg + substitution picker", () => {
        const read = costFor("Waterbend {3}", "Enchantment");
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        const lowered = lowerActivationCost(read.value);
        expect(lowered.ok).toBe(true);
        if (!lowered.ok) return;
        expect(lowered.value).toEqual(waterbendCost(3));
    });

    it("North Pole Patrol: the whole row compiles ready with the waterbend ability", () => {
        const outcome = compileCard(
            oracleCard({
                name: "North Pole Patrol",
                manaCost: "{2}{U}",
                typeLine: "Creature — Human Soldier Ally",
                oracleText:
                    "{T}: Untap another target permanent you control.\nWaterbend {3}, {T}: Tap target creature an opponent controls. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)",
                power: "2",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.activatedAbilities?.[1]?.cost).toEqual({
            ...waterbendCost(3),
            tap: true,
        });
    });

    it("North Pole Patrol: Waterbend {3}, {T} on a creature keeps both legs", () => {
        const read = costFor("Waterbend {3}, {T}", "Creature — Human Warrior");
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        const lowered = lowerActivationCost(read.value);
        expect(lowered.ok).toBe(true);
        if (!lowered.ok) return;
        expect(lowered.value).toEqual({ ...waterbendCost(3), tap: true });
    });
});

describe("Waterbend cost — refusals", () => {
    it("refuses a variable Waterbend {X} (no announced X)", () => {
        expect(costFor("Waterbend {X}", "Enchantment").ok).toBe(false);
    });

    it("refuses a coloured waterbend cost", () => {
        expect(costFor("Waterbend {2}{W}", "Enchantment").ok).toBe(false);
    });

    it("refuses a creature source without {T}: it could tap itself", () => {
        expect(costFor("Waterbend {4}", "Creature — Bird").ok).toBe(false);
    });

    it("refuses waterbend beside another mana atom", () => {
        expect(costFor("Waterbend {3}, {1}", "Enchantment").ok).toBe(false);
    });
});
