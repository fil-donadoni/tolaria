// LTR — white card behavior tests (ADR 0043 colour split). Each card's
// describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { eaglesOfTheNorth, reprieve } from "../white";
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

// Reprieve — "Return target spell to its owner's hand. Draw a card." (Issue
// #2605.) Exercises the `moveSpellFromStack` Op through a real card's
// resolution: the ORDER of the two Ops is what makes the drawn card provably
// not the returned one, and CR 608.2b governs the whole spell when its only
// target is gone.
describe("Reprieve — return target spell to its owner's hand (CR 400.7 / 608.2b)", () => {
    function setupReprieve(): {
        state: GameState;
        victim: StackItem;
        reprieveItem: StackItem;
    } {
        const topOfLibrary = makeInstance(grizzlyBears.id, {
            id: "p1-top-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [topOfLibrary] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // p2's creature spell on the stack, with Reprieve on top of it.
        const victim: StackItem = {
            ...makeInstance(grizzlyBears.id, {
                id: "victim",
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
            targets: [],
        };
        const reprieveItem: StackItem = {
            ...makeInstance(reprieve.id, {
                id: "reprieve",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            targets: [{ type: "spell", id: "victim" }],
        };
        state.stack.push(victim, reprieveItem);
        return { state, victim, reprieveItem };
    }

    it("returns the spell to its owner's hand and draws a card that is NOT the returned spell", () => {
        const { state } = setupReprieve();
        resolveTopOfStack(state);

        // The targeted spell went home to its owner (p2), un-cast.
        expect(state.stack.some((s) => s.id === "victim")).toBe(false);
        expect(state.players[1].hand.map((c) => c.id)).toContain("victim");
        // The cantrip resolved AFTER the return: p1 drew their own top card,
        // and the returned spell is in the OPPONENT's hand, not p1's.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-top-card"]);
        expect(state.players[0].library).toHaveLength(0);
    });

    // Wire format: the returned card is board-visible state on the client —
    // the projection must show it in its owner's hand, carrying the ADR 0026
    // eye icon (it was a public object on the stack, so p1 still knows it).
    it("the returned spell survives the projection into its owner's hand", () => {
        const { state } = setupReprieve();
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].hand.find(
            (c) => c?.id === "victim"
        ) as CardInstanceState | undefined;
        expect(slim).toBeDefined();
        expect((slim as { seenByOpponent?: boolean }).seenByOpponent).toBe(
            true
        );
    });

    // CR 608.2b — Reprieve has ONE target. With it gone, EVERY instance of the
    // word "target" is illegal, so the spell does not resolve at all: it is
    // removed from the stack and its controller draws NOTHING. (The issue's
    // acceptance list expected a draw here; the CR text quoted above is the
    // authority, and this test records the CR-correct behaviour.)
    it("does not resolve — and does not draw — when its only target has left the stack", () => {
        const { state, victim } = setupReprieve();
        state.stack = state.stack.filter((s) => s.id !== victim.id);
        resolveTopOfStack(state);

        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(1);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "reprieve"
        );
    });
});
