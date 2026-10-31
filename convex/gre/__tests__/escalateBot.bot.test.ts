// Escalate (CR 702.120a, issue #2267) — the Bot side. The escalate count is
// not a caster choice, so the Bot's kicker axis never invents one
// (`enumerateKickerVariants` pins it at 0); `moves.ts` writes it per mode
// combination through the SAME `withPerExtraModePayments` `announceCast`
// uses, drops a combination whose discards the hand cannot cover, and the
// search tree charges the discard (`applyKickerHandLegsForSearch`) so an
// escalated mode is never free in the rollout.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { collectiveBrutality } from "../../cards/sets/emn/black.cards";
import { grizzlyBears, plains } from "../../cards/sets/lea/index.cards";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { getPlayer, type GameState } from "../state";

const BOT = "p1";
const SWAMP = "6176936d-72e2-4205-8871-4c5a4f1cb2d8";

function board(spare: number): GameState {
    const mine = (
        id: string,
        cardId: string,
        zone: "hand" | "battlefield" | "library"
    ) => makeInstance(cardId, { id, controllerId: BOT, ownerId: BOT, zone });
    return makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    mine("cb", collectiveBrutality().id, "hand"),
                    ...Array.from({ length: spare }, (_, i) =>
                        mine(`spare${i}`, plains().id, "hand")
                    ),
                ],
                battlefield: [
                    mine("swamp0", SWAMP, "battlefield"),
                    mine("swamp1", SWAMP, "battlefield"),
                ],
                library: Array.from({ length: 5 }, (_, i) =>
                    mine(`lib-${i}`, plains().id, "library")
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

function castMoves(state: GameState): Extract<Move, { kind: "cast-spell" }>[] {
    return enumerateMoves(state, BOT).filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "cb"
    );
}

describe("Escalate — Bot enumeration (CR 702.120a)", () => {
    it("every move's escalate count is its mode count minus one, and every count is reached", () => {
        const moves = castMoves(board(2));
        expect(moves.length).toBeGreaterThan(0);
        const sizes = new Set<number>();
        for (const m of moves) {
            const n = m.chosenModeIds?.length ?? 0;
            sizes.add(n);
            expect(m.kickerPayments?.escalate ?? 0).toBe(n - 1);
        }
        expect([...sizes].sort()).toEqual([1, 2, 3]);
    });

    it("CR 601.2h — a combination whose discards the hand cannot cover is never offered", () => {
        const moves = castMoves(board(1));
        expect(moves.length).toBeGreaterThan(0);
        expect(
            Math.max(...moves.map((m) => m.chosenModeIds?.length ?? 0))
        ).toBe(2);
        expect(
            castMoves(board(0)).every((m) => m.chosenModeIds?.length === 1)
        ).toBe(true);
    });

    it("the search tree charges the escalate discard — an extra mode is never free", () => {
        const state = board(2);
        const move = castMoves(state).find(
            (m) => m.chosenModeIds?.length === 3
        );
        if (!move) throw new Error("no three-mode move enumerated");
        const after = applyMoveForSearch(state, BOT, move);
        const me = getPlayer(after, BOT);
        expect(
            me.graveyard.filter((c) => c.id.startsWith("spare"))
        ).toHaveLength(2);
        expect(me.hand.filter((c) => c.id.startsWith("spare"))).toHaveLength(0);
    });
});
