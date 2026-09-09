// Overload's two `gre/moves.ts` seams (CR 702.96, issue #3215) — split from
// `overload.test.ts` because importing the enumerator puts a file in the bot
// suite (`scripts/__tests__/bot-suite-boundary.test.ts` enforces the `.bot.test`
// suffix for exactly that import).
//
//   - CR 601.2f–h — cost increases apply to the OVERLOAD cost, not the printed
//     one (702.96a routes an overload cast through the ordinary
//     alternative-cost rules);
//   - bot reachability — `enumerateMoves` offers the printed cast AND the
//     overload cast from one hand card, the overload one announcing nothing.

import { describe, it, expect } from "vitest";
import type { GameState } from "../state";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";

const DAMN = getCardByName("Damn");
const BEAR = getCardByName("Grizzly Bears").id;
const PLAINS = getCardByName("Plains").id;
// Thalia taxes noncreature spells by {1} — the CR 601.2f-h probe.
const THALIA_ID = getCardByName("Thalia, Guardian of Thraben").id;

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

function creature(cardId: string, id: string, controllerId: string) {
    return makeInstance(cardId, { id, controllerId, ownerId: controllerId });
}

describe("Overload — cost increases apply to the OVERLOAD cost (CR 601.2f–h / 702.96a)", () => {
    /** p1 holds Damn and controls `plains` Plains; p2 optionally taxes. */
    function castingBoard(plains: number, tax: boolean): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard(DAMN.id, "damn")],
                    battlefield: Array.from({ length: plains }, (_, i) =>
                        makeInstance(PLAINS, {
                            id: `p${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                }),
                makePlayer("p2", {
                    battlefield: tax
                        ? [creature(THALIA_ID, "tax", "p2")]
                        : [creature(BEAR, "body", "p2")],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        return state;
    }

    const overloadMoves = (state: GameState) =>
        enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "damn" &&
                m.alternativeCostId === "overload"
        );

    it("four Plains cast the {2}{W}{W} overload — five are needed once a 'costs {1} more' effect applies", () => {
        expect(overloadMoves(castingBoard(4, false))).toHaveLength(1);
        // Same four Plains, now taxed: the overload cost went up, so the mana
        // plan no longer covers it. If the modifiers were being folded into the
        // PRINTED cost instead, this would still enumerate.
        expect(overloadMoves(castingBoard(4, true))).toHaveLength(0);
        expect(overloadMoves(castingBoard(5, true))).toHaveLength(1);
    });
});

describe("Overload — the Bot sees BOTH cast modes (bot reachability, gre/moves.ts)", () => {
    it("enumerateMoves offers the printed cast AND the overload cast from one hand card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard(DAMN.id, "damn")],
                    // Two Swamps for {B}{B}, four Plains for {2}{W}{W}.
                    battlefield: [
                        ...Array.from({ length: 2 }, (_, i) =>
                            makeInstance(getCardByName("Swamp").id, {
                                id: `s${i}`,
                                controllerId: "p1",
                                ownerId: "p1",
                            })
                        ),
                        ...Array.from({ length: 4 }, (_, i) =>
                            makeInstance(PLAINS, {
                                id: `w${i}`,
                                controllerId: "p1",
                                ownerId: "p1",
                            })
                        ),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [creature(BEAR, "theirs", "p2")],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        const casts = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "damn"
        );
        const overload = casts.filter(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === "overload"
        );
        const printed = casts.filter(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === undefined
        );
        expect(overload).toHaveLength(1);
        expect(printed.length).toBeGreaterThan(0);
        // CR 702.96b — the overload variant announces nothing to target.
        expect(overload[0]).toMatchObject({
            targets: [],
            confirmTargets: false,
        });
        // …while the printed variant does announce one.
        expect(
            printed.some(
                (m) => m.kind === "cast-spell" && m.targets.length === 1
            )
        ).toBe(true);
    });
});
