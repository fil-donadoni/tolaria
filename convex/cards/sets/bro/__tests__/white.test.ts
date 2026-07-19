// BRO (The Brothers' War) — white behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { loranOfTheThirdPath } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type CardInstanceState,
    type StackItem,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { ornithopter } from "../../atq";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** Puts Loran's ETB trigger on the stack with an UN-set target slot
 *  (`targets: undefined`), mirroring `buildTriggerItem` for a targeted
 *  trigger — `raiseTriggerTargetSelection` only picks up a trigger whose
 *  `targets` are unset, and reads `triggerSourceId` to resolve source
 *  characteristics. */
function loranEtbTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "trig-loran-etb",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "loran-etb-destroy",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: source.types,
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen target
 *  (or the empty "decline" set) onto the on-stack trigger. */
function chooseLoranTarget(state: GameState, targetId: string | null) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = targetId
        ? [{ type: "permanent", id: targetId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Loran of the Third Path (CR 603.6a ETB, CR 605 tap-draw)", () => {
    it("is a 2/1 Legendary with vigilance, an ETB trigger, and an opponent-targeted draw", () => {
        expect(loranOfTheThirdPath.power).toBe(2);
        expect(loranOfTheThirdPath.toughness).toBe(1);
        expect(loranOfTheThirdPath.supertypes).toContain("Legendary");
        expect(loranOfTheThirdPath.staticAbilities).toContain("vigilance");
        const etb = loranOfTheThirdPath.triggeredAbilities!.find(
            (t) => t.id === "loran-etb-destroy"
        )!;
        expect(etb).toBeDefined();
        // CR 603.3d — the "up to one target artifact or enchantment" is a real
        // announcement-time target requirement, not a resolution-time choice.
        expect(etb.targetRequirement).toEqual({
            type: ["Artifact", "Enchantment"],
            count: { min: 0, max: 1 },
        });
        const draw = loranOfTheThirdPath.activatedAbilities!.find(
            (a) => a.id === "loran-draw"
        )!;
        expect(draw.cost).toMatchObject({ tap: true });
        expect(draw.targetRequirement).toMatchObject({
            type: "player",
            controller: "opponent",
        });
    });

    it("the {T} ability draws a card for both the controller and the targeted opponent", () => {
        const loran = makeInstance(loranOfTheThirdPath.id, {
            id: "loran",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1lib = makeInstance(loranOfTheThirdPath.id, {
            id: "p1top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const p2lib = makeInstance(loranOfTheThirdPath.id, {
            id: "p2top",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [loran], library: [p1lib] }),
                makePlayer("p2", { library: [p2lib] }),
            ],
        });
        resolveActivated(state, loran, "loran-draw", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1top"]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["p2top"]);
    });

    it("the ETB trigger destroys the chosen artifact (CR 603.3d target chosen at stack placement)", () => {
        const loran = makeInstance(loranOfTheThirdPath.id, {
            id: "loran",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const factory = makeInstance(ornithopter.id, {
            id: "factory",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [loran] }),
                makePlayer("p2", { battlefield: [factory] }),
            ],
        });
        loranEtbTriggerOnStack(state, loran);
        chooseLoranTarget(state, "factory");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(
            state.players[1].battlefield.some((c) => c.id === "factory")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "factory")).toBe(
            true
        );
    });

    it("the ETB trigger may decline (up to one) — nothing destroyed", () => {
        const loran = makeInstance(loranOfTheThirdPath.id, {
            id: "loran",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const factory = makeInstance(ornithopter.id, {
            id: "factory",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [loran] }),
                makePlayer("p2", { battlefield: [factory] }),
            ],
        });
        loranEtbTriggerOnStack(state, loran);
        chooseLoranTarget(state, null);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(
            state.players[1].battlefield.some((c) => c.id === "factory")
        ).toBe(true);
    });
});
