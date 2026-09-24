// Bot reachability for Kicker {X} (CR 107.3a / 702.33a, issue #2141).
//
// `.claude/rules/gre-development.md` § Bot reachability. A "Kicker {X}" puts
// the spell's one announced X on a card whose PRINTED cost has none
// (Verdeloth the Ancient), and the enumerator used to key its X axis off the
// printed cost alone — so the kicked cast was offered with no `chosenX`, which
// `announceCast` refuses ("Must choose X"): the bot-freeze shape. The axis is
// now per announce-variant (`kickerXValues`, `moves.ts`), and each sandbox
// must CHARGE the X it announces.
//
// The valuation seam needs nothing new: the kicked value is `createToken`,
// already censused in `OP_VALUERS` / `OP_BENEFICENCE`.

import { describe, it, expect } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { verdelothTheAncient } from "../../cards/sets/inv/green";

const FOREST = getCardByName("Forest").id;
const VERDELOTH = "verdeloth";

/** p1 holds Verdeloth ({4}{G}{G}) with `lands` untapped Forests. */
function board(lands: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(verdelothTheAncient.id, {
                        id: VERDELOTH,
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                battlefield: Array.from({ length: lands }, (_, i) =>
                    makeInstance(FOREST, {
                        id: `forest${i}`,
                        zone: "battlefield",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function verdelothCasts(state: GameState): Move[] {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === VERDELOTH
    );
}

const kicked = (m: Move) =>
    m.kind === "cast-spell" && (m.kickerPayments?.kicker ?? 0) > 0;
const xOf = (m: Move) => (m.kind === "cast-spell" ? m.chosenX : undefined);

function tapped(state: GameState): number {
    return getPlayer(state, "p1").battlefield.filter((c) => c.isTapped).length;
}

describe("Kicker {X} — Bot reachability (CR 107.3a / 702.33a, issue #2141)", () => {
    it("ENUMERATES a kicked cast for every affordable X, each announcing it", () => {
        const casts = verdelothCasts(board(9));
        // Nine Forests: {4}{G}{G} leaves three for X.
        expect(casts.filter(kicked).map(xOf).sort()).toEqual([0, 1, 2, 3]);
        // CR 601.2b — the unkicked cast owes no X, and announces none.
        expect(casts.filter((m) => !kicked(m)).map(xOf)).toEqual([undefined]);
    });

    it("offers only X = 0 when the printed cost uses every land", () => {
        const casts = verdelothCasts(board(6));
        expect(casts.filter(kicked).map(xOf)).toEqual([0]);
    });

    it("the GREEDY sandbox (applyMoveForSearch) charges {4}{G}{G} + X and sees X Saprolings", () => {
        const state = board(9);
        const move = verdelothCasts(state).find(
            (m) => kicked(m) && xOf(m) === 3
        )!;
        const after = applyMoveForSearch(state, "p1", move);
        expect(tapped(after)).toBe(9);
        // The sandbox drains the cast AND its ETB (CR 107.3m — the trigger's
        // X is the spell's), so the evaluator scores the three tokens the
        // kick bought, not a bare 4/7.
        expect(
            getPlayer(after, "p1").battlefield.filter((c) =>
                c.subtypes.includes("Saproling")
            )
        ).toHaveLength(3);
    });

    it("the ISMCTS sandbox (applyMoveInSearch) charges {4}{G}{G} + X", () => {
        const state = board(9);
        const move = verdelothCasts(state).find(
            (m) => kicked(m) && xOf(m) === 2
        )!;
        const world = structuredClone(state);
        applyMoveInSearch(world, "p1", move);
        expect(tapped(world)).toBe(8);
        expect(world.stack[0]?.chosenX).toBe(2);
    });
});
