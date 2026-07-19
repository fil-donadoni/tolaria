// ODY (Odyssey) — white behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { karmicJustice } from "../white";
import { onulet } from "../../atq/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    destroyWithReplacements,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getLegalTargets,
    raiseTriggerTargetSelection,
} from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { PERMANENT_TYPES } from "../../../types";
import { projectPublicState } from "../../../../gameProjections";

// Karmic Justice (CR 603.10 leave-the-battlefield trigger, issue #1054):
// "Whenever a spell or ability an opponent controls destroys a noncreature
//  permanent you control, you may destroy target permanent that opponent
//  controls."
//
// CR 603.3d (issue #1193): "target permanent that opponent controls" is a REAL
// target chosen when the trigger is put on the stack (a `targetRequirement`
// driven by `raiseTriggerTargetSelection` + `finalizeTargetSelection`), not a
// resolution-time choice.
describe("Karmic Justice (destroyed-by-opponent LTB trigger, CR 603.10 / 603.3d, issue #1054 / #1193)", () => {
    it("is a {2}{W} Enchantment whose trigger carries the CR 603.3d target requirement", () => {
        expect(karmicJustice.manaCost).toEqual({ X: 2, W: 1 });
        expect(karmicJustice.types).toEqual(["Enchantment"]);
        expect(karmicJustice.rarity).toBe("rare");
        const ability = karmicJustice.triggeredAbilities!.find(
            (t) => t.id === "karmic-justice-destroy"
        )!;
        expect(ability).toBeDefined();
        expect(ability.resolve).toBeTypeOf("function");
        expect(ability.effects).toBeUndefined();
        expect(ability.targetRequirement).toEqual({
            type: [...PERMANENT_TYPES],
            count: { min: 0, max: 1 },
            controller: "opponent",
        });
    });

    function setup() {
        const kj = makeInstance(karmicJustice.id, {
            id: "kj",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A noncreature permanent p1 controls (Artifact, no Creature type).
        const victim = makeInstance(onulet.id, {
            id: "victim",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"],
        });
        // A permanent p2 controls, destroy-able as Karmic Justice's payoff.
        const p2Permanent = makeInstance(onulet.id, {
            id: "p2perm",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kj, victim] }),
                makePlayer("p2", { battlefield: [p2Permanent] }),
            ],
        });
        return { state };
    }

    /** Drives the CR 603.3d target choice through the real machinery:
     *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
     *  (count 0..1), then `finalizeTargetSelection` writes the chosen target
     *  (or the empty "decline" set) onto the on-stack trigger. */
    function chooseTarget(
        state: ReturnType<typeof setup>["state"],
        targetId: string | null
    ) {
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

    it("fires when an opponent's spell/ability destroys a noncreature permanent you control, and destroying the chosen target resolves", () => {
        const { state } = setup();
        // "A spell or ability an opponent (p2) controls destroys" the victim.
        destroyWithReplacements(state, "victim", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        );
        expect(trig).toBeDefined();
        // CR 603.3d — pick the opponent's permanent as the trigger's target.
        chooseTarget(state, "p2perm");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2perm")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "p2perm")).toBe(
            true
        );
    });

    it("declining the may (empty target set) leaves the opponent's permanent untouched", () => {
        const { state } = setup();
        destroyWithReplacements(state, "victim", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        chooseTarget(state, null);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2perm")
        ).toBe(true);
    });

    it("only the opponent's permanents are legal targets (controller: opponent)", () => {
        const { state } = setup();
        // Give p1 (the chooser) an extra permanent — it must NOT be targetable.
        const p1Extra = makeInstance(onulet.id, {
            id: "p1extra",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"],
        });
        state.players[0].battlefield.push(p1Extra);
        // p1 (Karmic Justice's controller) is the chooser; controller:"opponent"
        // must yield only p2's permanents (CR 603.3d target legality).
        const req = karmicJustice.triggeredAbilities![0].targetRequirement!;
        const legalIds = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(legalIds).toContain("p2perm");
        expect(legalIds).not.toContain("p1extra");
        expect(legalIds).not.toContain("kj");
    });

    it("does NOT fire on the controller's own destroy of their own permanent", () => {
        const { state } = setup();
        destroyWithReplacements(state, "victim", { causerControllerId: "p1" });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        );
        expect(trig).toBeUndefined();
    });

    it("does NOT fire on a destroy with no resolving causer (an SBA sweep)", () => {
        const { state } = setup();
        destroyWithReplacements(state, "victim"); // no causerControllerId
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        );
        expect(trig).toBeUndefined();
    });

    it("does NOT fire on a CREATURE permanent (filter excludes creatures)", () => {
        const { state } = setup();
        const creature = makeInstance(onulet.id, {
            id: "creatureVictim",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(creature);
        destroyWithReplacements(state, "creatureVictim", {
            causerControllerId: "p2",
        });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        );
        expect(trig).toBeUndefined();
    });

    it("does NOT fire on a SACRIFICE, even by an opponent's effect — Karmic Justice needs 'destroys'", () => {
        const { state } = setup();
        removePermanentTo(state, "victim", "graveyard", "sacrifice", "p2");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        );
        expect(trig).toBeUndefined();
    });

    it("resolves as a no-op (empty target, no PendingTarget) when the opponent controls no permanents", () => {
        const { state } = setup();
        state.players[1].battlefield = [];
        destroyWithReplacements(state, "victim", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        )!;
        expect(trig).toBeDefined();
        // CR 603.3d "up to one" with nothing legal: the engine locks an empty
        // target set, no PendingTarget is raised, the trigger is a no-op.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingTarget).toBeUndefined();
    });

    // Wire format (gre-development.md § Frontend wiring analysis) — the
    // PERMANENT_LEFT fields (`cause`, `causerControllerId`) ride on the
    // trigger's `triggerEvent`, which crosses the wire unchanged via
    // `slimCard`'s `{ ...instance }` spread. Confirm they actually survive
    // `projectPublicState` rather than assuming it.
    it("cause + causerControllerId survive projectPublicState on the pushed trigger's triggerEvent", () => {
        const { state } = setup();
        destroyWithReplacements(state, "victim", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        )!;
        expect(trig.triggerEvent).toMatchObject({
            cause: "destroy",
            causerControllerId: "p2",
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedTrig = projected.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        )!;
        expect(
            (
                projectedTrig as unknown as {
                    triggerEvent?: {
                        cause?: string;
                        causerControllerId?: string;
                    };
                }
            ).triggerEvent
        ).toMatchObject({
            cause: "destroy",
            causerControllerId: "p2",
        });
    });
});
