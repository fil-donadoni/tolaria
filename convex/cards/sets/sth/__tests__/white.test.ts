// STH (Stronghold) — white behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { sacredGround } from "../white";
import { plains } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    destroyWithReplacements,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

// Sacred Ground (CR 603.10 leave-the-battlefield trigger, issue #1054):
// "Whenever a spell or ability an opponent controls causes a land to be put
//  into your graveyard from the battlefield, return that card to the
//  battlefield."
describe("Sacred Ground (opponent-caused land-to-graveyard LTB trigger, CR 603.10, issue #1054)", () => {
    it("is a {1}{W} Enchantment with a leftTrigger resolve() ability (not DSL)", () => {
        expect(sacredGround.manaCost).toEqual({ X: 1, W: 1 });
        expect(sacredGround.types).toEqual(["Enchantment"]);
        expect(sacredGround.rarity).toBe("rare");
        const ability = sacredGround.triggeredAbilities!.find(
            (t) => t.id === "sacred-ground-return"
        )!;
        expect(ability).toBeDefined();
        expect(ability.resolve).toBeTypeOf("function");
        expect(ability.effects).toBeUndefined();
    });

    function setup() {
        const sg = makeInstance(sacredGround.id, {
            id: "sg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(plains.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sg, land] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }

    it("returns the land when an opponent's spell/ability destroys it", () => {
        const { state } = setup();
        destroyWithReplacements(state, "land", { causerControllerId: "p2" });
        expect(
            state.players[0].graveyard.some((c) => c.id === "land")
        ).toBe(true);
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sacred-ground-return"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "land")
        ).toBe(true);
        expect(
            state.players[0].graveyard.some((c) => c.id === "land")
        ).toBe(false);
    });

    it("returns the land when an opponent's effect forces its sacrifice (broader than 'destroys')", () => {
        const { state } = setup();
        removePermanentTo(state, "land", "graveyard", "sacrifice", "p2");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sacred-ground-return"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "land")
        ).toBe(true);
    });

    it("does NOT fire when the controller sacrifices their own land (no opponent causer)", () => {
        const { state } = setup();
        removePermanentTo(state, "land", "graveyard", "sacrifice", "p1");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sacred-ground-return"
        );
        expect(trig).toBeUndefined();
    });

    it("does NOT fire with no resolving causer at all (an SBA-driven departure)", () => {
        const { state } = setup();
        removePermanentTo(state, "land", "graveyard");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sacred-ground-return"
        );
        expect(trig).toBeUndefined();
    });

    it("does NOT fire when the land goes to exile instead of the graveyard", () => {
        const { state } = setup();
        removePermanentTo(state, "land", "exile", undefined, "p2");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sacred-ground-return"
        );
        expect(trig).toBeUndefined();
    });

    // Wire format — the causer rides on triggerEvent, projected unchanged.
    it("causerControllerId survives projectPublicState on the pushed trigger", () => {
        const { state } = setup();
        destroyWithReplacements(state, "land", { causerControllerId: "p2" });
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sacred-ground-return"
        )!;
        const projected = projectPublicState(state, 1, "p1");
        const projectedTrig = projected.stack.find(
            (s) => s.triggeredAbilityId === "sacred-ground-return"
        )!;
        expect(trig.triggerEvent).toMatchObject({ causerControllerId: "p2" });
        expect(
            (
                projectedTrig as unknown as {
                    triggerEvent?: { causerControllerId?: string };
                }
            ).triggerEvent
        ).toMatchObject({ causerControllerId: "p2" });
    });
});
