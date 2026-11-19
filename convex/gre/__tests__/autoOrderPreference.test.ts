// Issue #9988 — "Order my triggers and graveyard automatically". A seat in
// `state.autoOrderSeatIds` has the CR 603.3b trigger-order and CR 404.3
// graveyard-arrangement prompts answered by the engine (its own order, no
// PendingChoice); every other seat, and the default, is prompted as before.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { getPlayer, moveCard, type GameState, type StackItem } from "../state";
import { placeTriggersOnStack } from "../triggers";
import { withGraveyardArrivalBatch } from "../graveyardOrder";
import { compactState, expandState } from "../serialize";
import { loadAutoOrderSeatIds } from "../../autoOrderSeats";

const CARD_A = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
const CARD_B = "55fe6449-1f23-43dc-adee-d144cd505b5c";
const BEARS = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;

function mkTrigger(id: string, cardId: string, abilityId: string): StackItem {
    return {
        id,
        card: { id: cardId },
        controllerId: "p1",
        ownerId: "p1",
        castById: "p1",
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        triggeredAbilityId: abilityId,
        triggerSourceId: `src-${id}`,
    };
}

function triggerState(autoOrderSeatIds?: string[]): GameState {
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    if (autoOrderSeatIds) state.autoOrderSeatIds = autoOrderSeatIds;
    return state;
}

function discardTwo(state: GameState): void {
    const p1 = getPlayer(state, "p1");
    p1.hand = [
        makeInstance(BEARS, {
            id: "d1",
            ownerId: "p1",
            controllerId: "p1",
            zone: "hand",
        }),
        makeInstance(WURM, {
            id: "d2",
            ownerId: "p1",
            controllerId: "p1",
            zone: "hand",
        }),
    ];
    withGraveyardArrivalBatch(state, () => {
        moveCard(p1, "d1", "hand", "graveyard", state);
        moveCard(p1, "d2", "hand", "graveyard", state);
    });
}

describe("auto-order preference: triggers (CR 603.3b)", () => {
    const distinct = [
        mkTrigger("t1", CARD_A, "ability-a"),
        mkTrigger("t2", CARD_B, "ability-b"),
    ];

    it("default: two distinct triggers still raise the order prompt", () => {
        const state = triggerState();
        expect(placeTriggersOnStack(state, distinct)).toBe(false);
        expect(state.pendingChoices?.[0].kind).toBe("trigger-order");
        expect(state.stack).toHaveLength(0);
    });

    it("opted-in controller: pushed in collection order, no prompt", () => {
        const state = triggerState(["p1"]);
        expect(placeTriggersOnStack(state, distinct)).toBe(true);
        expect(state.stack.map((s) => s.id)).toEqual(["t1", "t2"]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingTriggerBatch).toBeUndefined();
    });

    it("another seat's opt-in does not skip this controller's prompt", () => {
        const state = triggerState(["p2"]);
        expect(placeTriggersOnStack(state, distinct)).toBe(false);
        expect(state.pendingChoices?.[0].playerId).toBe("p1");
    });
});

describe("auto-order preference: graveyard (CR 404.3)", () => {
    it("default: a two-card discard of different names queues an arrangement", () => {
        const state = makeState();
        discardTwo(state);
        expect(state.pendingGraveyardArrangements).toEqual([
            { ownerId: "p1", cardIds: ["d1", "d2"] },
        ]);
    });

    it("opted-in owner: nothing queued, the batch keeps its arrival order", () => {
        const state = makeState();
        state.autoOrderSeatIds = ["p1"];
        discardTwo(state);
        expect(state.pendingGraveyardArrangements).toBeUndefined();
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toEqual([
            "d1",
            "d2",
        ]);
    });

    it("another seat's opt-in does not skip this owner's arrangement", () => {
        const state = makeState();
        state.autoOrderSeatIds = ["p2"];
        discardTwo(state);
        expect(state.pendingGraveyardArrangements).toHaveLength(1);
    });
});

describe("auto-order preference: persistence + loader", () => {
    it("is transient: compactState drops it", () => {
        const state = makeState();
        state.autoOrderSeatIds = ["p1"];
        expect(
            expandState(compactState(state)).autoOrderSeatIds
        ).toBeUndefined();
    });

    it("loadAutoOrderSeatIds lists opted-in seats, never the vs-AI Bot seat", async () => {
        const rows: Record<string, { autoOrderPrompts?: boolean }> = {
            u1: { autoOrderPrompts: true },
            u2: {},
        };
        const ctx = {
            db: {
                get: async () => ({ vsAi: true }),
                normalizeId: (_t: string, id: string) => id,
                query: () => ({
                    withIndex: (_n: string, f: (q: unknown) => unknown) => {
                        let uid = "";
                        f({ eq: (_k: string, v: string) => (uid = v) });
                        return { unique: async () => rows[uid] ?? null };
                    },
                }),
            },
        } as unknown as Parameters<typeof loadAutoOrderSeatIds>[0];
        const gameId = "g" as Parameters<typeof loadAutoOrderSeatIds>[1];
        expect(
            await loadAutoOrderSeatIds(ctx, gameId, ["u1-p1", "u1-p2"])
        ).toEqual(["u1-p1"]);
        expect(await loadAutoOrderSeatIds(ctx, gameId, ["u2", "u1"])).toEqual([
            "u1",
        ]);
    });
});
