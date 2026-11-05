// Bot visibility and costing for Jump-start (CR 702.133a), the half of
// `jumpStart.test.ts` that touches bot-only modules. Enumeration reaches it
// through the generic graveyard-cast loop (`graveyardCastMechanism`); each of the
// two search sandboxes must charge the discard and stamp the exile, or the Bot
// models a free spell it can recast forever.
import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { getPlayer, type GameState } from "../state";
import { withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    grizzlyBears,
    lightningBolt,
    mountain,
} from "../../cards/sets/lea/index.cards";

const JS_INSTANT: CardDefinition = {
    ...lightningBolt(),
    staticAbilities: ["jump-start"],
    id: "test-js-instant",
};

function board(handCount: number): GameState {
    const owned = { controllerId: "p1", ownerId: "p1" };
    return makeState({
        players: [
            makePlayer("p1", {
                graveyard: [
                    makeInstance(JS_INSTANT.id, {
                        ...owned,
                        id: "gyJs",
                        zone: "graveyard",
                    }),
                ],
                hand: Array.from({ length: handCount }, (_, i) =>
                    makeInstance(grizzlyBears().id, {
                        ...owned,
                        id: `hand${i}`,
                        zone: "hand",
                    })
                ),
                battlefield: [
                    makeInstance(mountain().id, {
                        ...owned,
                        id: "bfLand",
                        zone: "battlefield",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function castAtOpponent(state: GameState) {
    return enumerateMoves(state, "p1").find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === "gyJs" &&
            m.targets.some((t) => t.type === "player" && t.id === "p2")
    );
}

describe("Jump-start: Bot visibility (CR 702.133a)", () => {
    it("enumerates a cast with a card in hand to discard", () => {
        withTemporaryDefinition(JS_INSTANT, () => {
            expect(castAtOpponent(board(1))).toBeDefined();
        });
    });

    it("enumerates nothing with an empty hand", () => {
        withTemporaryDefinition(JS_INSTANT, () => {
            expect(castAtOpponent(board(0))).toBeUndefined();
        });
    });

    it("the greedy sandbox charges one card and exiles the spell after it resolves", () => {
        withTemporaryDefinition(JS_INSTANT, () => {
            const state = board(2);
            const after = applyMoveForSearch(
                state,
                "p1",
                castAtOpponent(state)!
            );
            const p1 = getPlayer(after, "p1");
            expect(p1.hand).toHaveLength(1);
            expect(p1.graveyard.filter((c) => c.id !== "gyJs")).toHaveLength(1);
            expect(p1.exile.map((c) => c.id)).toEqual(["gyJs"]);
            expect(getPlayer(after, "p2").life).toBe(17);
        });
    });

    it("the ISMCTS sandbox charges the same discard and stamps the exile", () => {
        withTemporaryDefinition(JS_INSTANT, () => {
            const state = board(2);
            applyMoveInSearch(state, "p1", castAtOpponent(state)!);
            expect(getPlayer(state, "p1").hand).toHaveLength(1);
            const item = state.stack.find((s) => s.id === "gyJs")!;
            expect(item.castFromZone).toBe("graveyard");
            expect(item.exileAnyTimeLeavesStack).toBe(true);
        });
    });

    it("the line terminates: an exiled spell offers no second cast", () => {
        withTemporaryDefinition(JS_INSTANT, () => {
            const state = board(3);
            const after = applyMoveForSearch(
                state,
                "p1",
                castAtOpponent(state)!
            );
            for (const perm of getPlayer(after, "p1").battlefield) {
                perm.isTapped = false;
            }
            expect(castAtOpponent(after)).toBeUndefined();
        });
    });
});
