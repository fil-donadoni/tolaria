// CHK (Champions of Kamigawa) — red behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { lavaSpike } from "../red";
import { makeState, pushSpell } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getResolveFn } from "../../../effectRegistry";
import { validateEffectScript } from "../../../../gre/effects/validate";

describe("Lava Spike (3 damage to target player, CR 120.1 — first DSL-only card, ADR 0045)", () => {
    it("is DSL-only: a valid Effect Script, no imperative resolve", () => {
        expect(lavaSpike.resolve).toBeUndefined();
        expect(lavaSpike.resolveSteps).toBeUndefined();
        expect(lavaSpike.effect).toBeUndefined();
        expect(lavaSpike.effects).toEqual([
            { op: "dealDamage", amount: 3, to: { target: 0 } },
        ]);
        expect(validateEffectScript(lavaSpike)).toEqual([]);
        // compiles onto the same dispatch seam every imperative card uses
        expect(typeof getResolveFn(lavaSpike)).toBe("function");
    });

    it("deals 3 damage to the targeted player and goes to the graveyard (CR 608.2k)", () => {
        const state = makeState();
        pushSpell(state, lavaSpike.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            lavaSpike.id
        );
    });

    it("does nothing when its target is gone at resolution (CR 608.2b)", () => {
        const state = makeState();
        pushSpell(state, lavaSpike.id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });

    it("the damage and the graveyard card survive projection (wire format)", () => {
        const state = makeState();
        pushSpell(state, lavaSpike.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(17);
        expect(projected.players[0].graveyard.map((c) => c.card.id)).toContain(
            lavaSpike.id
        );
    });

    it("declares the printed characteristics (Scryfall CHK)", () => {
        expect(lavaSpike.manaCost).toEqual({ R: 1 });
        expect(lavaSpike.types).toEqual(["Sorcery"]);
        expect(lavaSpike.subtypes).toEqual(["Arcane"]);
        expect(lavaSpike.rarity).toBe("common");
        expect(lavaSpike.targetRequirement).toEqual({
            type: ["player", "Planeswalker"],
            count: 1,
        });
    });
});
