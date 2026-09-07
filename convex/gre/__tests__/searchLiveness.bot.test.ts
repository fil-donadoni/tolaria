// Search liveness smoke (issue #2436).
//
// The gate's replacement for the AI-diagnosis harness's 16 ladder episodes.
// Those answered a STRENGTH question — "is the bot still playing well" — at up
// to 20 000 iterations, which is a cadence question, not a merge question
// (owner decision, 2026-08-22): they now live as blade entries (`must` for the
// deterministic ones) and as the leaf assertions in `evaluate.bot.test.ts`.
//
// What the gate still owes is the LIVENESS question the harness answered as a
// side effect: does `searchWithTrace` still run end-to-end and hand back a
// usable `DecisionTrace`? A crash, a null trace, an empty candidate set or a
// `chosen` naming no candidate breaks every consumer of the trace — the Brain,
// the DecisionTrace panel, the blade runner, the ladder — and none of the
// deterministic seam tests assert the trace's SHAPE.
//
// One position, one seed, `iterations: 400` (`DIFFICULTY_BUDGETS.medium`, the
// budget the bot actually plays at). Seconds, not minutes. It asserts nothing
// about WHICH move is chosen — that is what the blade suite is for.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { searchWithTrace } from "../search";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const FOREST = getCardByName("Forest").id;
const GRIZZLY = getCardByName("Grizzly Bears").id; // 2/2, {1}{G}
const HILL_GIANT = getCardByName("Hill Giant").id; // 3/3

const SEED = 0xc0ffee;
const SMOKE_BUDGET = { iterations: 400 } as const;

/** A precombat main with a real branch to search: a land drop, a castable 2/2
 *  and a pass, against an opposing body. Small enough to be cheap, wide enough
 *  that the trace carries a `cast-spell` root edge — the widest part of
 *  `buildTrace` — and not only the two trivial ones. The creature in hand is
 *  GREEN ({1}{G}) because the mana on the board is three Forests: a colourless-
 *  unpayable body would leave the position two moves wide and the smoke would
 *  silently stop exercising a cast at all. */
function smokePosition(): GameState {
    const lands = [0, 1, 2].map((i) =>
        makeInstance(FOREST, {
            id: `sm-forest${i}`,
            controllerId: "p1",
            ownerId: "p1",
            isTapped: false,
        })
    );
    const library = (owner: string) =>
        [0, 1, 2, 3, 4].map((i) =>
            makeInstance(FOREST, {
                id: `sm-${owner}-lib${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(GRIZZLY, {
                        id: "sm-bear",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                    makeInstance(FOREST, {
                        id: "sm-land-drop",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: lands,
                library: library("p1"),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HILL_GIANT, {
                        id: "sm-opp-giant",
                        controllerId: "p2",
                        ownerId: "p2",
                        isSummoningSick: false,
                    }),
                ],
                library: library("p2"),
            }),
        ],
    });
}

describe("search liveness smoke (issue #2436)", () => {
    it("returns a legal move and a usable DecisionTrace at the play budget", () => {
        const state = smokePosition();
        const { move, trace } = searchWithTrace(
            state,
            "p1",
            SMOKE_BUDGET,
            SEED
        );

        // A move at all, and one the enumerator actually offers — the WHOLE
        // move, not just its kind: `kind` alone can hardly fail (every position
        // offers a `pass`) and would pass for a cast of a card that is not in
        // hand.
        expect(move).not.toBeNull();
        const legal = enumerateMoves(state, "p1");
        expect(
            legal.map((m) => JSON.stringify(m)),
            "the chosen move must be one `enumerateMoves` actually offers"
        ).toContain(JSON.stringify(move));

        // A trace whose shape every consumer relies on.
        expect(trace).not.toBeNull();
        expect(trace!.iterationsCompleted).toBeGreaterThan(0);
        // pass, the land drop and the cast: a floor of 2 would be met by the
        // two trivial edges alone and would stop noticing a lost cast edge.
        expect(trace!.candidates.length).toBeGreaterThanOrEqual(3);
        expect(
            trace!.candidates.some((c) => c.move.kind === "cast-spell"),
            "the smoke must exercise a cast root edge, not only pass/play-land"
        ).toBe(true);
        expect(trace!.chosen).not.toBe("");
        expect(
            trace!.candidates.map((c) => c.label),
            "`chosen` must name one of the candidates the trace carries"
        ).toContain(trace!.chosen);
        expect(
            trace!.candidates.reduce((n, c) => n + c.visits, 0)
        ).toBeGreaterThan(0);
    });

    it("is deterministic: the same seed and budget give the same decision", () => {
        const first = searchWithTrace(
            smokePosition(),
            "p1",
            SMOKE_BUDGET,
            SEED
        );
        const second = searchWithTrace(
            smokePosition(),
            "p1",
            SMOKE_BUDGET,
            SEED
        );
        expect(second.trace!.chosen).toBe(first.trace!.chosen);
    });
});
