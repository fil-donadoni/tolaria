// The pre-"fight" template ("This creature deals damage equal to its power to
// target creature. That creature deals damage equal to its power to this
// creature" — Karplusan Yeti, Tahngarth, Tracker) when its source leaves the
// battlefield before the ability resolves.
//
// CR 608.2h / 113.7a — "If an ability states that an object does something,
// it's the object as it exists—or as it most recently existed—that does it":
// the departed source still deals its damage from last known information; the
// return half has no recipient and is skipped. This is NOT CR 701.14b (a
// keyword-action fight, where neither creature deals damage).
import { describe, it, expect } from "vitest";
import { removePermanentTo, resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";
import { checkStateBasedActions } from "../sba";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards/index";

function foe(power: number, toughness: number): CardInstanceState {
    return {
        id: "foe",
        card: { id: "fake-foe" },
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        power,
        toughness,
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
        isTapped: false,
    };
}

function setup(foePower = 2, foeToughness = 2) {
    const yeti = makeInstance(getCardByName("Karplusan Yeti").id, {
        id: "yeti",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [yeti] }),
            makePlayer("p2", { battlefield: [foe(foePower, foeToughness)] }),
        ],
    });
    // Activation: the ability is on the stack, the source still in play.
    state.stack.push({
        ...yeti,
        zone: "stack",
        castById: "p1",
        abilityId: "karplusan-yeti-fight",
        targets: [{ type: "permanent", id: "foe" }],
    });
    return state;
}

const onBattlefield = (state: GameState, id: string) =>
    state.players.some((p) => p.battlefield.some((c) => c.id === id));

describe("source-damage exchange when the source leaves (CR 608.2h)", () => {
    it("baseline: both on the battlefield, both halves dealt", () => {
        const state = setup(3, 3);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(onBattlefield(state, "foe")).toBe(false);
        expect(onBattlefield(state, "yeti")).toBe(false);
    });

    it("a bounced source still deals its half from LKI; no return damage", () => {
        const state = setup();
        removePermanentTo(state, "yeti", "hand");
        expect(state.stack[0].sourceLkiPower).toBe(3);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        // The 2/2 took 3 from the departed Yeti and died.
        expect(onBattlefield(state, "foe")).toBe(false);
        expect(onBattlefield(state, "yeti")).toBe(false);
    });

    it("a blinked source (same id, NEW object) deals LKI damage and is not hit back", () => {
        const state = setup();
        const departed = state.players[0].battlefield[0];
        removePermanentTo(state, "yeti", "exile");
        // CR 400.7 — the same instance id returns as a new object.
        state.players[0].exile = state.players[0].exile.filter(
            (c) => c.id !== "yeti"
        );
        state.players[0].battlefield.push({
            ...departed,
            zone: "battlefield",
            damage: 0,
        });
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(onBattlefield(state, "foe")).toBe(false);
        const returned = state.players[0].battlefield.find(
            (c) => c.id === "yeti"
        )!;
        expect(returned.damage ?? 0).toBe(0);
    });

    it("the LKI power stays out of the client projection", () => {
        const state = setup();
        removePermanentTo(state, "yeti", "hand");
        const projected = projectPublicState(state, 1, "p2");
        expect(
            (projected.stack[0] as { sourceLkiPower?: unknown }).sourceLkiPower
        ).toBeUndefined();
    });
});
