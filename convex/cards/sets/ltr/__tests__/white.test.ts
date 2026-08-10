// LTR — white card behavior tests (ADR 0043 colour split). Each card's
// describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { eaglesOfTheNorth } from "../white";
import { grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { getEffectivePower } from "../../../../gre/layers";

const ETB_EVENT: StackItem["triggerEvent"] = {
    type: "PERMANENT_ENTERED",
    instanceId: "eagles",
    controllerId: "p1",
    types: ["Creature"],
} as StackItem["triggerEvent"];

function setup() {
    const eagles = makeInstance(eaglesOfTheNorth.id, {
        id: "eagles",
        controllerId: "p1",
        ownerId: "p1",
    });
    const ally = makeInstance(grizzlyBears.id, {
        id: "ally",
        controllerId: "p1",
        ownerId: "p1",
    });
    const enemy = makeInstance(grizzlyBears.id, {
        id: "enemy",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [eagles, ally] }),
            makePlayer("p2", { battlefield: [enemy] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, eagles };
}

/** Puts the ETB trigger on the stack exactly as the engine does after
 *  PERMANENT_ENTERED (CR 603.6a) — no target slot, the ability is untargeted. */
function putEtbOnStack(state: GameState, source: CardInstanceState) {
    state.stack.push({
        ...source,
        id: "eagles-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "eagles-of-the-north-etb-pump",
        triggerSourceId: source.id,
        triggerEvent: ETB_EVENT,
    } as StackItem);
}

const find = (state: GameState, playerIdx: number, id: string) =>
    state.players[playerIdx].battlefield.find((c) => c.id === id)!;

describe("Eagles of the North (LTR — ETB team pump, CR 603.6a / 611.2c)", () => {
    it("gives every creature its controller controls +1/+0 and first strike until end of turn", () => {
        const { state, eagles } = setup();
        // Baseline, before the trigger resolves.
        expect(getEffectivePower(state, find(state, 0, "eagles"))).toBe(3);
        expect(getEffectivePower(state, find(state, 0, "ally"))).toBe(2);

        putEtbOnStack(state, eagles);
        resolveTopOfStack(state);

        // CR 611.2c — both of the controller's creatures, including the
        // source itself ("creatures you control", not "other creatures").
        const pumpedEagles = find(state, 0, "eagles");
        const pumpedAlly = find(state, 0, "ally");
        expect(getEffectivePower(state, pumpedEagles)).toBe(4);
        expect(getEffectivePower(state, pumpedAlly)).toBe(3);
        expect(pumpedEagles.staticAbilities).toContain("first strike");
        expect(pumpedAlly.staticAbilities).toContain("first strike");
        // Flying is printed, not granted — it must still be there.
        expect(pumpedEagles.staticAbilities).toContain("flying");
    });

    it("does NOT touch the opponent's creatures", () => {
        const { state, eagles } = setup();
        putEtbOnStack(state, eagles);
        resolveTopOfStack(state);

        const enemy = find(state, 1, "enemy");
        expect(getEffectivePower(state, enemy)).toBe(2);
        expect(enemy.staticAbilities).not.toContain("first strike");
    });

    // Wire format (mandatory — the pump and the granted keyword are both
    // board-visible, and the projection strips `card.card` to `{ id }`).
    it("the pump and the granted first strike survive the projection", () => {
        const { state, eagles } = setup();
        putEtbOnStack(state, eagles);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimAlly = projected.players[0].battlefield.find(
            (c) => c.id === "ally"
        )!;
        expect(getEffectivePower(projected, slimAlly)).toBe(3);
        expect(slimAlly.staticAbilities).toContain("first strike");
    });
});
