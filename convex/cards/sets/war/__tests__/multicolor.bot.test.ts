// war — multicolor BOT-suite tests (issue #3236, Saheeli, Sublime Artificer).
//
// The move ENUMERATOR (`convex/gre/moves`) is a bot-only module, so these
// assertions live in a `.bot.test.ts` file
// (`scripts/__tests__/bot-suite-boundary.test.ts`); the card's own behaviour is
// in the app-suite sibling `multicolor.test.ts`.
//
// Seam under test: `enumerateTargetGroupTuples`. Saheeli's −2 is the first
// ability whose second target group may not re-pick the first group's
// permanent (CR 115.3 "another target"). The engine lowers that directive onto
// `excludeInstanceIds` when the target WALK reaches the group — a path the bot
// never takes, because it enumerates whole tuples up front. Unfiltered, the
// bot would offer (lotus, lotus), the server would reject it at announcement,
// and the bot would stall on its own move.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../../../../gre/moves";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import { getDefinition } from "../../../index";

const saheeli = getDefinition("5a10b543-d5d4-42a8-9ee8-dada59a2ad7e");
const serraAngel = getDefinition("f8ac5006-91bd-4803-93da-f87cf196dd2f");
const blackLotus = getDefinition("b0faa7f2-b547-42c4-a810-839da50dadfe");

const MINUS2 = "saheeli-sublime-artificer-minus2";

function board(extraIds: { defId: string; id: string }[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(saheeli.id, {
                        id: "saheeli1",
                        controllerId: "p1",
                        ownerId: "p1",
                        counters: { loyalty: 5 },
                    }),
                    makeInstance(blackLotus.id, {
                        id: "lotus",
                        controllerId: "p1",
                    }),
                    ...extraIds.map((e) =>
                        makeInstance(e.defId, {
                            id: e.id,
                            controllerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

function minus2Moves(state: GameState) {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "activate-ability" && m.abilityId === MINUS2
    );
}

describe("Saheeli, Sublime Artificer — bot move enumeration (CR 115.3)", () => {
    it("enumerates the −2 with two DISTINCT targets, never the same permanent twice", () => {
        const state = board([{ defId: serraAngel.id, id: "angel" }]);
        const moves = minus2Moves(state);
        expect(moves.length).toBeGreaterThan(0);
        for (const move of moves) {
            const ids =
                move.kind === "activate-ability"
                    ? move.targets.map((t) => t.id)
                    : [];
            expect(ids).toHaveLength(2);
            expect(new Set(ids).size).toBe(2);
        }
        // The one legal pair IS offered — the filter excludes the collision,
        // not the move.
        expect(
            moves.some(
                (m) =>
                    m.kind === "activate-ability" &&
                    m.targets[0]?.id === "lotus" &&
                    m.targets[1]?.id === "angel"
            )
        ).toBe(true);
    });

    it("enumerates NO −2 when the lone artifact would have to fill both groups", () => {
        // Only Saheeli (a planeswalker, not a legal target for either group)
        // and one artifact: group 1 has nothing left once group 0 takes it.
        expect(minus2Moves(board([]))).toEqual([]);
    });
});
