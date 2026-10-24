/**
 * CR 601.2c / 107.3 (issue #6526) — the Bot's Move enumerator reads a
 * text-defined target bound the way the server's target walk does: over the
 * picks of the EARLIER groups (Reap's "up to X target cards …, where X is the
 * number of black permanents target opponent controls").
 *
 * Two things must agree with `advanceTargetGroupOrFinalize` (`game.ts`): how
 * many graveyard cards a cast may name, and whether its batched
 * `selectTargets` leaves the selection resting for a `confirmTargets` (fewer
 * than X picks) or already finalized it (X picks, or X = 0). A mismatch is the
 * cast → cancel → re-cast freeze of issue #2870.
 */
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import {
    REAP_SHAPE,
    REAP_SPELL_ID,
    reapBoard,
} from "../../__tests__/announcedQuantityTargetCount.fixture";

type CastMove = Extract<Move, { kind: "cast-spell" }>;

function castMoves(blackCount: number): CastMove[] {
    return withTemporaryDefinition(REAP_SHAPE, () =>
        enumerateMoves(reapBoard(blackCount), "p1").filter(
            (m): m is CastMove =>
                m.kind === "cast-spell" && m.cardInstanceId === REAP_SPELL_ID
        )
    );
}

const cardPicks = (m: CastMove) =>
    m.targets.filter((t) => t.type === "graveyard-card").length;

describe("bot enumeration — target count bounded by an announced quantity (CR 601.2c, issue #6526)", () => {
    it("offers 0..X graveyard cards, X read off the chosen opponent's black permanents", () => {
        const moves = castMoves(2);
        expect(moves.length).toBeGreaterThan(0);
        for (const m of moves)
            expect(m.targets[0]).toEqual({ type: "player", id: "p2" });
        expect([...new Set(moves.map(cardPicks))].sort()).toEqual([0, 1, 2]);
    });

    it("predicts the confirm: below X rests for it, X picks finalize", () => {
        for (const m of castMoves(2)) {
            expect(m.confirmTargets).toBe(cardPicks(m) < 2);
        }
    });

    it("X = 0 enumerates the opponent alone, with no confirm", () => {
        const moves = castMoves(0);
        expect(moves.length).toBeGreaterThan(0);
        for (const m of moves) {
            expect(m.targets).toEqual([{ type: "player", id: "p2" }]);
            expect(m.confirmTargets).toBe(false);
        }
    });
});
