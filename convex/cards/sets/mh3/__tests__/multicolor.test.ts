// Modern Horizons 3 (MH3) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { psychicFrog, phlageTitanOfFiresFury } from "../multicolor";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
    } as StackItem);
    resolveTopOfStack(state);
}

function answer(state: GameState, ids: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

const frogOnBattlefield = () =>
    makeInstance(psychicFrog.id, {
        id: "frog",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });

describe("Psychic Frog ({U}{B} 1/2 Frog; CR 510.4 / 122.1 / 611.1b)", () => {
    it("is a {U}{B} 1/2 Frog", () => {
        expect(psychicFrog.manaCost).toEqual({ U: 1, B: 1 });
        expect(psychicFrog.power).toBe(1);
        expect(psychicFrog.toughness).toBe(2);
        expect(psychicFrog.subtypes).toEqual(["Frog"]);
    });

    it("declares the exile-three-from-graveyard cost on the flying ability", () => {
        const ability = psychicFrog.activatedAbilities!.find(
            (a) => a.id === "psychic-frog-exile-flying"
        )!;
        expect(ability.cost.exileFromGraveyard).toEqual({ count: 3 });
    });

    it("discard ability: discards a chosen card and adds a +1/+1 counter", () => {
        const frog = frogOnBattlefield();
        const handCard = makeInstance(psychicFrog.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [frog], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, frog, "psychic-frog-discard-pump");
        answer(state, ["h1"]);

        const p1 = state.players[0];
        expect(p1.hand).toHaveLength(0);
        expect(p1.graveyard.map((c) => c.id)).toContain("h1");
        const live = p1.battlefield.find((c) => c.id === "frog")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("wire format: the +1/+1 counter survives projection", () => {
        const frog = frogOnBattlefield();
        const handCard = makeInstance(psychicFrog.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [frog], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, frog, "psychic-frog-discard-pump");
        answer(state, ["h1"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "frog"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("exile-flying ability grants flying until end of turn", () => {
        const frog = frogOnBattlefield();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [frog] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, frog, "psychic-frog-exile-flying");
        const live = state.players[0].battlefield.find((c) => c.id === "frog")!;
        expect(live.staticAbilities).toContain("flying");
    });
});

// resolvePhlageValue is a resolve() closure (protocol card, ADR 0045): its
// "3 damage to any target" is a choose-damage-target Pending Choice owed to
// the controller (CR 115.4), with an unconditional 3 life gain on top.
describe("Phlage, Titan of Fire's Fury (enters/attacks value: 3 damage any target + gain 3 life, CR 115.4 / 702.138)", () => {
    const enterEvent = (instanceId: string): StackItem["triggerEvent"] =>
        ({
            type: "PERMANENT_ENTERED",
            instanceId,
            controllerId: "p1",
            types: ["Creature"],
        }) as StackItem["triggerEvent"];

    const phlageOnBattlefield = (id: string, controllerId: string) =>
        makeInstance(phlageTitanOfFiresFury.id, {
            id,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
        });

    it("deals 3 damage to the chosen player and the controller gains 3 life", () => {
        const phlage = phlageOnBattlefield("phlage", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [phlage] }),
                makePlayer("p2"),
            ],
        });

        resolveTrigger(
            state,
            phlage,
            "phlage-enters-value",
            enterEvent("phlage")
        );

        // Resolution suspends for the controller's any-target pick; the
        // unconditional life gain must not have fired yet (CR 601.2c pattern).
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-damage-target");
        expect(head.playerId).toBe("p1");
        expect(state.players[0].life).toBe(20);

        answer(state, ["p2"]);

        expect(state.players[1].life).toBe(17); // 3 damage to the opponent
        expect(state.players[0].life).toBe(23); // controller gained 3
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("wire format: 3 damage on the chosen permanent and the life gain survive projection", () => {
        const phlage = phlageOnBattlefield("phlage", "p1");
        const oppBody = phlageOnBattlefield("p2-body", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [phlage] }),
                makePlayer("p2", { battlefield: [oppBody] }),
            ],
        });

        resolveTrigger(
            state,
            phlage,
            "phlage-enters-value",
            enterEvent("phlage")
        );
        answer(state, ["p2-body"]); // controller pings the opponent's creature

        // GRE: 3 damage marked on the target, controller gained 3 life.
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-body")!
                .damageMarked
        ).toBe(3);
        expect(state.players[0].life).toBe(23);

        // The same visible outcome must survive the wire projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimTarget = projected.players[1].battlefield.find(
            (c) => c.id === "p2-body"
        )!;
        expect(slimTarget.damageMarked).toBe(3);
        expect(projected.players[0].life).toBe(23);
    });
});
