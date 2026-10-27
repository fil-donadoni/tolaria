// "If you haven't added mana with this ability this turn" — the intervening-if
// of a once-per-turn mana trigger (CR 603.4, CR 603.2h), read as the ability's
// per-turn quota (CR 603.2h), not as a board predicate.
//
//  1. GOLDEN — Carpet of Flowers' head and condition, in front of a body that
//     compiles today.
//  2. REFUSALS — neighbours the rule must not read: a different subject, a
//     different quantifier, and a head that has no per-turn cap factory.

import { describe, expect, it } from "vitest";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

// Carpet of Flowers' trigger line with its effect clause swapped for one the
// grammar reads today: the printed "add X mana of any one color, where X is the
// number of Islands target opponent controls" is a separate effect-clause gap,
// so the condition is pinned in front of a body that compiles.
const CARPET =
    "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, add {G}.";

function enchantment(oracleText: string) {
    return oracleCard({
        name: "Quota Garden",
        manaCost: "{G}",
        typeLine: "Enchantment",
        oracleText,
    });
}

function abilitiesOf(oracleText: string): readonly CompiledTriggeredAbility[] {
    const outcome = compileCard(enchantment(oracleText));
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition.compiledTriggeredAbilities ?? [];
}

const refused = (oracleText: string) =>
    compileCard(enchantment(oracleText)).state === "unparsed";

describe("mana-added quota condition (CR 603.4, CR 603.2h)", () => {
    it("Carpet of Flowers head + condition: the condition is the ability's once-per-turn cap", () => {
        const [ability] = abilitiesOf(CARPET);
        expect(ability!.maxTriggersPerTurn).toBe(1);
        expect(ability!.condition).toBeUndefined();
        expect(sortKeys(ability!.head)).toEqual(
            sortKeys({
                kind: "phase",
                phase: "PRECOMBAT_MAIN",
                phases: ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"],
                scope: "your",
            })
        );
    });

    it("the built ability carries the cap the engine counts (CR 603.2h)", () => {
        const [ability] = abilitiesOf(CARPET);
        expect(resolveCompiledTrigger(ability!).maxTriggersPerTurn).toBe(1);
    });

    it("refuses another subject (a player other than you)", () => {
        expect(
            refused(CARPET.replace("if you haven't", "if an opponent hasn't"))
        ).toBe(true);
    });

    it("refuses 'with a spell' in place of 'with this ability'", () => {
        expect(
            refused(CARPET.replace("with this ability", "with a spell"))
        ).toBe(true);
    });

    it("refuses on an ability that functions from the graveyard", () => {
        expect(
            refused(
                "At the beginning of your upkeep, if you haven't added mana with this ability this turn, return this card from your graveyard to your hand."
            )
        ).toBe(true);
    });

    it("refuses behind a head with no per-turn cap factory", () => {
        expect(
            refused(
                "Whenever you cast a spell, if you haven't added mana with this ability this turn, add {G}."
            )
        ).toBe(true);
    });
});
