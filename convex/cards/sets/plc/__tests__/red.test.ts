// PLC (Planar Chaos) — red behavior tests (ADR 0043 colour split).
//
// Prodigal Pyromancer's home set is Planar Chaos, its earliest paper printing
// (ADR 0041); the M11 reprint it was first implemented against now rides along
// as a `CardPrint` in `m11/red.ts`.

import { describe, it, expect } from "vitest";
import { prodigalPyromancer } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getAbilityEffectFn } from "../../../effectRegistry";
import { validateAbilityEffectScript } from "../../../../gre/effects/validate";

// Prodigal Pyromancer — "{T}: This creature deals 1 damage to any target."
// DSL-only ACTIVATED ability (ADR 0045, issue #803): the effect payload is a
// declarative Effect Script resolved by the interpreter through the SAME code
// path as spell-site scripts (CR 120.1 damage, CR 602.2 activation).
describe("Prodigal Pyromancer ({T}: 1 damage to any target — DSL-only activated ability, ADR 0045)", () => {
    const ability = prodigalPyromancer.activatedAbilities![0];

    it("its activated ability is DSL-only: a valid Effect Script, no imperative resolve", () => {
        expect(ability.resolve).toBeUndefined();
        expect(ability.resolveSteps).toBeUndefined();
        expect(ability.effects).toEqual([
            { op: "dealDamage", amount: 1, to: { target: 0 } },
        ]);
        expect(
            validateAbilityEffectScript(ability, prodigalPyromancer.name)
        ).toEqual([]);
        // compiles onto the shared ability-site dispatch seam
        expect(typeof getAbilityEffectFn(ability)).toBe("function");
    });

    it("deals 1 damage to the targeted player when the ability resolves (CR 120.1)", () => {
        const pinger = makeInstance(prodigalPyromancer.id, {
            id: "pyro1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinger] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: ability.id,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("the 1 damage survives projection (wire format)", () => {
        const pinger = makeInstance(prodigalPyromancer.id, {
            id: "pyro2",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinger] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: ability.id,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(19);
    });
});
