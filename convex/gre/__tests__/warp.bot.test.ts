// Warp — the BOT reachability seam (CR 702.185, issue #1268).
//
// Lives here rather than in `warp.test.ts` because it imports the enumerator
// (`bot-suite-boundary.test.ts` enforces the split), and it is a seam the engine
// suite structurally cannot cover: a keyword the Bot cannot enumerate is silent
// — no test reds, the card simply never shows up in a game against it.
//
// Two questions, one per half of the keyword:
//   1. Can the Bot cast a card FOR its warp cost? The printed-cost loop in
//      `enumerateCastMoves` reads `getInstanceManaCost` — the PRINTED cost — so
//      a card whose printed cost the Bot cannot afford, which is the exact
//      situation Warp exists for, enumerates zero cast moves without the
//      price-only alt-cost branch.
//   2. Can it cast the card back OUT of exile, and only once the window has
//      opened? `enumerateMoves`' exile branch gates on `exileCastPermission`,
//      the same authority the mutation and the projection read — so a closed
//      window must offer nothing and an open one must offer the recast.
import { describe, it, expect } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";
import { WARP_PROBE_ID, warpProbe } from "./fixtures/warpProbe";

const MOUNTAIN = getCardByName("Mountain").id;

function castMovesForProbe(state: GameState) {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "probe"
    );
}

function mountains(count: number) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(MOUNTAIN, { id: `land${i}`, controllerId: "p1" })
    );
}

describe("Warp — the Bot can cast FOR the warp cost (CR 702.185a)", () => {
    it("enumerates the warp cast off one Mountain, where the printed cost is unreachable", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(WARP_PROBE_ID, {
                            id: "probe",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: mountains(1),
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        const casts = castMovesForProbe(state);
        expect(casts.map((m) => m.alternativeCostId)).toEqual([
            warpProbe.warp!.id,
        ]);
        // One Mountain, and the plan taps exactly it.
        expect(casts[0].tapPlan).toHaveLength(1);
    });

    it("offers the warp cast BESIDE the printed one when both are affordable", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(WARP_PROBE_ID, {
                            id: "probe",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: mountains(5),
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        const ids = castMovesForProbe(state).map((m) => m.alternativeCostId);
        // The search must be able to tell the two lines apart: one leaves a
        // permanent, the other lends it for a turn.
        expect(ids).toContain(undefined);
        expect(ids).toContain(warpProbe.warp!.id);
    });
});

describe("Warp — the Bot and the recast window's lower bound (CR 702.185a)", () => {
    /** The probe warped out on turn 3, with the clock at `turn`. */
    function exiledState(turn: number): GameState {
        const exiled = makeInstance(WARP_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        exiled.warpExiled = true;
        exiled.castableFromExileBy = "p1";
        exiled.castableFromExileFromTurn = 4;
        const state = makeState({
            players: [
                makePlayer("p1", {
                    exile: [exiled],
                    battlefield: mountains(5),
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        state.turn = turn;
        return state;
    }

    it("enumerates NO exile cast during the turn the card was warped out", () => {
        expect(castMovesForProbe(exiledState(3))).toHaveLength(0);
    });

    it("enumerates the exile recast from the following turn onward", () => {
        for (const turn of [4, 6]) {
            const casts = castMovesForProbe(exiledState(turn));
            // CR 702.185a — an ORDINARY cast for the printed cost, and ONLY
            // that: the warp cost is a HAND permission ("you may cast this card
            // from your hand"), so the recast must not be offered for it. The
            // assertion is over the WHOLE set rather than `casts[0]`, because a
            // warp move sitting at `casts[1]` is exactly the re-arming loop this
            // clause exists to prevent, and a first-element check would miss it.
            expect(casts.map((m) => m.alternativeCostId)).toEqual([undefined]);
            expect(casts[0].tapPlan).toHaveLength(5);
        }
    });
});
