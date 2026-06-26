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
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
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

describe("Loran of the Third Path (CR 603.6a ETB, CR 605 tap-draw)", () => {
    it("is a 2/1 Legendary with vigilance, an ETB trigger, and an opponent-targeted draw", () => {
        expect(loranOfTheThirdPath.power).toBe(2);
        expect(loranOfTheThirdPath.toughness).toBe(1);
        expect(loranOfTheThirdPath.supertypes).toContain("Legendary");
        expect(loranOfTheThirdPath.staticAbilities).toContain("vigilance");
        expect(
            loranOfTheThirdPath.triggeredAbilities!.some(
                (t) => t.id === "loran-etb-destroy"
            )
        ).toBe(true);
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

    it("the ETB trigger destroys a chosen artifact (CR 603.6a, up to one target)", () => {
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
        // Fire the self ETB trigger (mirrors collectTriggers + buildTriggerItem).
        state.stack.push({
            ...loran,
            id: "trig-loran-etb",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "loran-etb-destroy",
            triggerSourceId: "loran",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "loran",
                controllerId: "p1",
                types: loran.types,
            },
            targets: [],
        });
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the choose-permanents choice
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["factory"],
        });
        expect(
            state.players[1].battlefield.some((c) => c.id === "factory")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "factory")).toBe(
            true
        );
    });
});
