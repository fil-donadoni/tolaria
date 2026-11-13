// Bot reachability for `handExileCostReduction` (CR 601.2f, issue #8625 —
// March of Otherworldly Light). The enumerator discounts the generic cost by the
// FORCED number of white hand cards (`genericFuelOf` in `gre/payWith.ts`, {2} a
// card), so a cast the Bot's lands alone cannot pay is still a candidate, and
// the search leaf exiles exactly those cards (`applyDelveExileForSearch`).

import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyDelveExileForSearch } from "../applyMove";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";

const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // MV 2
const MARCH = getCardByName("March of Otherworldly Light")!.id;
const LION = getCardByName("Lion Sash")!.id; // white card = fuel

function board(whiteInHand: number) {
    const hand = [
        makeInstance(MARCH, { id: "march", controllerId: "p1", zone: "hand" }),
        ...Array.from({ length: whiteInHand }, (_, i) =>
            makeInstance(LION, {
                id: `w${i}`,
                controllerId: "p1",
                zone: "hand",
            })
        ),
    ];
    const p1 = makePlayer("p1", {
        hand,
        battlefield: [makeInstance(PLAINS, { id: "pl0", controllerId: "p1" })],
    });
    const victim = makeInstance(BEARS, { id: "victim", controllerId: "p2" });
    return makeState({
        players: [p1, makePlayer("p2", { battlefield: [victim] })],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const marchCasts = (state: ReturnType<typeof board>) =>
    enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "march"
    );

describe("March of Otherworldly Light — Bot reachability (CR 601.2f)", () => {
    it("is a candidate only when a white hand card can pay for X=2", () => {
        // One Plains pays {W}; X=2 on the Bears needs {2} more, which only an
        // exiled white card supplies.
        expect(marchCasts(board(1)).some((m) => (m.chosenX ?? 0) >= 2)).toBe(
            true
        );
        expect(marchCasts(board(0)).some((m) => (m.chosenX ?? 0) >= 2)).toBe(
            false
        );
    });

    it("the search leaf exiles the forced white card from hand", () => {
        const state = board(1);
        const player = state.players[0];
        const card = player.hand.find((c) => c.id === "march")!;
        applyDelveExileForSearch(state, player, card, 2);
        expect(player.exile.map((c) => c.id)).toEqual(["w0"]);
        expect(player.hand.map((c) => c.id)).toEqual(["march"]);
    });
});
