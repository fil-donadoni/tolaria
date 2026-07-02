// CHK (Champions of Kamigawa) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { hondenOfSeeingWinds } from "../blue";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getAbilityEffectFn } from "../../../effectRegistry";
import { validateAbilityEffectScript } from "../../../../gre/effects/validate";

// Honden of Seeing Winds — "At the beginning of your upkeep, draw a card for
// each Shrine you control." DSL-only TRIGGERED ability (ADR 0045, issue #803):
// the effect is a declarative Effect Script resolved by the interpreter through
// the SAME code path as spell-site scripts. "for each Shrine you control" is a
// frozen battlefield `count` (CR 122) feeding the `draw` Op's count (CR 121.1);
// the Honden itself is a Shrine (CR 205.3) so it counts.
describe("Honden of Seeing Winds (upkeep: draw per Shrine — DSL-only triggered ability, ADR 0045)", () => {
    const ability = hondenOfSeeingWinds.triggeredAbilities![0];

    // Pushes the resolved trigger's stack item as if it had already fired on the
    // controller's upkeep (the firing/APNAP machinery is exercised elsewhere;
    // here we assert the scripted effect resolves through the shared path).
    function pushHondenTrigger(
        state: ReturnType<typeof makeState>,
        controllerId: string,
        sourceId: string
    ) {
        const src = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === sourceId)!;
        state.stack.push({
            ...src,
            zone: "stack",
            castById: controllerId,
            triggeredAbilityId: ability.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: controllerId,
            },
            triggerSourceId: sourceId,
        });
    }

    it("its triggered ability is DSL-only: a valid Effect Script, no imperative resolve", () => {
        expect(ability.resolve).toBeUndefined();
        expect(ability.resolveSteps).toBeUndefined();
        expect(ability.effects).toEqual([
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { subtype: "Shrine" },
                    },
                },
            },
        ]);
        expect(
            validateAbilityEffectScript(ability, hondenOfSeeingWinds.name)
        ).toEqual([]);
        expect(typeof getAbilityEffectFn(ability)).toBe("function");
    });

    it("draws one card per Shrine the controller controls, itself included (CR 122 / 205.3)", () => {
        const honden = makeInstance(hondenOfSeeingWinds.id, {
            id: "honden1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherShrine = makeInstance(hondenOfSeeingWinds.id, {
            id: "honden-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(hondenOfSeeingWinds.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [honden, otherShrine],
                    library,
                }),
                makePlayer("p2"),
            ],
        });
        pushHondenTrigger(state, "p1", "honden1");
        resolveTopOfStack(state);
        // Two Shrines controlled → draw 2.
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(3);
    });

    it("counts only the controller's Shrines, not the opponent's (CR 122)", () => {
        const honden = makeInstance(hondenOfSeeingWinds.id, {
            id: "honden1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppShrine = makeInstance(hondenOfSeeingWinds.id, {
            id: "opp-shrine",
            controllerId: "p2",
            ownerId: "p2",
        });
        const library = Array.from({ length: 3 }, (_, i) =>
            makeInstance(hondenOfSeeingWinds.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [honden], library }),
                makePlayer("p2", { battlefield: [oppShrine] }),
            ],
        });
        pushHondenTrigger(state, "p1", "honden1");
        resolveTopOfStack(state);
        // Only p1's one Shrine counts → draw 1.
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("the drawn cards survive projection: hand count and library count (wire format)", () => {
        const honden = makeInstance(hondenOfSeeingWinds.id, {
            id: "honden1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const library = Array.from({ length: 3 }, (_, i) =>
            makeInstance(hondenOfSeeingWinds.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [honden], library }),
                makePlayer("p2"),
            ],
        });
        pushHondenTrigger(state, "p1", "honden1");
        resolveTopOfStack(state);
        // Own viewer sees own hand as real cards; library reshaped to a count.
        const projected = projectPublicState(state, 0, "p1");
        expect(projected.players[0].hand).toHaveLength(1);
        expect(projected.players[0].library.count).toBe(2);
    });

    it("declares the printed characteristics (Scryfall CHK)", () => {
        expect(hondenOfSeeingWinds.manaCost).toEqual({ X: 4, U: 1 });
        expect(hondenOfSeeingWinds.types).toEqual(["Enchantment"]);
        expect(hondenOfSeeingWinds.supertypes).toEqual(["Legendary"]);
        expect(hondenOfSeeingWinds.subtypes).toEqual(["Shrine"]);
        expect(hondenOfSeeingWinds.rarity).toBe("uncommon");
    });
});
