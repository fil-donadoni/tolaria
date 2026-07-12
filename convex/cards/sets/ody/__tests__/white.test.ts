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
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

// Karmic Justice (CR 603.10 leave-the-battlefield trigger, issue #1054):
// "Whenever a spell or ability an opponent controls destroys a noncreature
//  permanent you control, you may destroy target permanent that opponent
//  controls."
describe("Karmic Justice (destroyed-by-opponent LTB trigger, CR 603.10 / 701.8, issue #1054)", () => {
    it("is a {2}{W} Enchantment with a leftTrigger resolve() ability (not DSL)", () => {
        expect(karmicJustice.manaCost).toEqual({ X: 2, W: 1 });
        expect(karmicJustice.types).toEqual(["Enchantment"]);
        expect(karmicJustice.rarity).toBe("rare");
        const ability = karmicJustice.triggeredAbilities!.find(
            (t) => t.id === "karmic-justice-destroy"
        )!;
        expect(ability).toBeDefined();
        expect(ability.resolve).toBeTypeOf("function");
        expect(ability.effects).toBeUndefined();
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

    it("fires when an opponent's spell/ability destroys a noncreature permanent you control, and destroying the chosen target resolves", () => {
        const { state } = setup();
        // "A spell or ability an opponent (p2) controls destroys" the victim.
        destroyWithReplacements(state, "victim", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        );
        expect(trig).toBeDefined();
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the choose-permanents pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p2perm"],
        });
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2perm")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "p2perm")).toBe(
            true
        );
    });

    it("declining the may (0 picks) leaves the opponent's permanent untouched", () => {
        const { state } = setup();
        destroyWithReplacements(state, "victim", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2perm")
        ).toBe(true);
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

    it("resolves with no choice enqueued when the opponent controls no permanents", () => {
        const { state } = setup();
        state.players[1].battlefield = [];
        destroyWithReplacements(state, "victim", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "karmic-justice-destroy"
        );
        expect(trig).toBeDefined();
        const result = resolveTopOfStack(state);
        expect(result).not.toBeNull(); // resolved immediately, no suspension
        expect(state.pendingChoices).toBeUndefined();
    });

    // Wire format (gre-development.md § Frontend wiring analysis) — the new
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
