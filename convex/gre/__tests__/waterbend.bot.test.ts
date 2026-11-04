// Bot reachability of a waterbend cost (CR 701.67a): the move exists on a board
// short of mana, carries the taps, and the mana plan covers exactly the rest.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import type { GameState } from "../state";
import { applyActivationCostsForSearch } from "../applyMove";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const on = (name: string, id: string) =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });

function board(...perms: ReturnType<typeof on>[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [on("Aang's Iceberg", "iceberg"), ...perms],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function waterbendMove(state: GameState) {
    return enumerateMoves(state, "p1").find(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.abilityId === "aangs-iceberg-waterbend"
    );
}

describe("enumerateAbilityMoves — waterbend (CR 701.67a)", () => {
    it("no mana at all: three bodies pay the whole cost", () => {
        const move = waterbendMove(
            board(
                on("Grizzly Bears", "b1"),
                on("Grizzly Bears", "b2"),
                on("Savannah Lions", "l1")
            )
        )!;
        expect(move.tapPlan).toEqual([]);
        expect(move.costPicks?.tapOtherIds?.sort()).toEqual(["b1", "b2", "l1"]);
    });

    it("takes the fewest taps: a land pays what it can", () => {
        const move = waterbendMove(
            board(
                on("Mountain", "m1"),
                on("Grizzly Bears", "b1"),
                on("Grizzly Bears", "b2"),
                on("Savannah Lions", "l1")
            )
        )!;
        expect(move.tapPlan.map((t) => t.cardInstanceId)).toEqual(["m1"]);
        expect(move.costPicks?.tapOtherIds).toHaveLength(2);
    });

    it("three lands: no creature is tapped", () => {
        const move = waterbendMove(
            board(
                on("Mountain", "m1"),
                on("Mountain", "m2"),
                on("Mountain", "m3"),
                on("Grizzly Bears", "b1")
            )
        )!;
        expect(move.costPicks?.tapOtherIds ?? []).toEqual([]);
        expect(move.tapPlan).toHaveLength(3);
    });

    it("a permanent the plan taps for mana is never also a pick", () => {
        const move = waterbendMove(
            board(on("Sol Ring", "ring"), on("Grizzly Bears", "b1"))
        )!;
        const planned = move.tapPlan.map((t) => t.cardInstanceId);
        expect(planned).toEqual(["ring"]);
        expect(move.costPicks?.tapOtherIds).toEqual(["b1"]);
    });

    it("short even with every body: not a legal move", () => {
        expect(
            waterbendMove(
                board(on("Grizzly Bears", "b1"), on("Mountain", "m1"))
            )
        ).toBeUndefined();
    });

    it("the search pays the taps the move names", () => {
        const state = board(
            on("Grizzly Bears", "b1"),
            on("Grizzly Bears", "b2"),
            on("Savannah Lions", "l1")
        );
        const move = waterbendMove(state)!;
        expect(applyActivationCostsForSearch(state, "p1", move)).toBe(true);
        expect(
            state.players[0].battlefield
                .filter((c) => c.isTapped)
                .map((c) => c.id)
                .sort()
        ).toEqual(["b1", "b2", "l1"]);
    });
});
