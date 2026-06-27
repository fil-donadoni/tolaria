// Modern Horizons 3 (MH3) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { psychicFrog } from "../multicolor";
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
