// DSL-derived ability-script valuation — the `zone`-aware self-bounce fix
// (issue #1964). `opValuers.bot.test.ts` pins the Op-level sign (a bare
// `{ ref: "$source" }` selector on a `moveZone → hand` scores as a self-cost);
// this file pins the ABILITY-level gate around it that keeps the fix from
// over-firing: a `zone: "graveyard"` triggered ability's `$source` denotes a
// GRAVEYARD card, not a battlefield permanent, so the identical Op shape
// there is card advantage (regrowth), never a cost. `dslAbilityScriptOpValue`
// (`cardScriptValue.ts`) is the only place both pieces of context — the
// Op tree AND the enclosing ability's `zone` — are visible together, so this
// is the layer that has to prove the gate, not `opValuers.bot.test.ts` alone.

import { describe, it, expect } from "vitest";
import type { CardDefinition, TriggeredAbility } from "../../../cards/types";
import { masterOfDeath } from "../../../cards/sets/mh2";
import { dashTrigger } from "../../../cards/abilities/dash";
import {
    dslAbilityScriptOpValue,
    dslRealizedAbilityScriptValue,
} from "../cardScriptValue";

/** A minimal card carrying exactly ONE triggered ability, so the ability's
 *  own script value is the WHOLE result (no other ability's contribution to
 *  disentangle) — mirrors `triggerGate.bot.test.ts`'s own `defWith` helper. */
function defWith(ability: TriggeredAbility): CardDefinition {
    return {
        id: "test-zone-card",
        name: "Test Zone Card",
        manaCost: { generic: 2 },
        types: ["Creature"],
        triggeredAbilities: [ability],
    } as CardDefinition;
}

const selfBounceToHand: TriggeredAbility["effects"] = [
    { op: "moveZone", target: { ref: "$source" }, to: "hand" },
];

describe("dslAbilityScriptOpValue — zone-aware self-bounce (issue #1964)", () => {
    it("a BATTLEFIELD-zoned ability's $source -> hand is a self-cost", () => {
        const def = defWith({
            id: "t",
            oracleText: "t",
            event: "CREATURE_DIED",
            matches: () => true,
            // No `zone` — defaults to battlefield (the overwhelming common
            // case: every ActivatedAbility and most TriggeredAbility rows).
            effects: selfBounceToHand,
        });
        const v = dslAbilityScriptOpValue(def);
        expect(v?.points).toBeLessThan(0);
        expect(v?.tags).toContain("self-cost");
    });

    it("a GRAVEYARD-zoned ability's $source -> hand is card advantage, NOT a self-cost (Master of Death shape)", () => {
        const def = defWith({
            id: "t",
            oracleText: "t",
            event: "PHASE_BEGIN",
            zone: "graveyard",
            matches: () => true,
            effects: selfBounceToHand,
        });
        const v = dslAbilityScriptOpValue(def);
        expect(v?.points).toBeGreaterThan(0);
        expect(v?.tags).not.toContain("self-cost");
    });

    it("Master of Death's real upkeep-return ability scores its own graveyard->hand move positively", () => {
        const upkeepReturn = masterOfDeath.triggeredAbilities!.find(
            (t) => t.id === "master-of-death-upkeep-return"
        )!;
        expect(upkeepReturn.zone).toBe("graveyard");
        const def = defWith(upkeepReturn);
        const v = dslAbilityScriptOpValue(def);
        // `mayPay` + `if` wrap the move, but the walker's context-free
        // grounding takes the "effect happens" branch — the `moveZone`
        // inside is what must NOT be swept into the self-cost branch.
        expect(v?.points).toBeGreaterThan(0);
        expect(v?.tags).not.toContain("self-cost");
    });
});

describe("dashTrigger — realized ability value through the FULL zone/capture path (issue #1964)", () => {
    it("charges the self-bounce (via the delayedTrigger's own capture) as a cost on a battlefield-zoned dash trigger", () => {
        const def = defWith(dashTrigger("Test Dash Creature"));
        // dashTrigger has no `zone` (an ETB trigger — CR 702.109a functions
        // on the battlefield), so this is the battlefield path: the fix must
        // reach THROUGH the delayedTrigger's `capture: { $self: { ref:
        // "$source" } }` to price the nested `{ ref: "$self" }` move.
        expect(dashTrigger("Test Dash Creature").zone).toBeUndefined();
        const value = dslRealizedAbilityScriptValue(def);
        // grantAbility(haste) [+40] + the now-correctly-signed self-bounce
        // [-55, HAND_RETURN_SELF_COST] nets negative.
        expect(value).toBeLessThan(0);
    });
});
