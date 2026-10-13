// Symmetric locks read by Differential Reading per leaf (issue #5163, ADR
// 0151). An untap restriction over mana sources (Winter Orb's cap, Stasis's
// hard skip, CR 502.3) is priced on each side by the mana axis of
// `ai/restrictionPricing.ts` and netted into the lock's standing worth; the
// hand face reads the same netting on the board the card would leave behind
// (`standingLockWorth`, `ai/latentBoard.ts`), so the two faces are one number
// and a lock that hurts its controller reads negative on both.
//
// Every assertion goes through `evaluate` / `permanentRealisedValue` /
// `cardValue` — the surfaces the search, the removal lens and the hand term
// read — and asserts a direction or an equality, never a fitted constant.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { cardValueById } from "../cardValue";
import {
    cardValue,
    evaluate,
    handLatentLens,
    permanentRealisedValue,
} from "../evaluate";
import type { CardInstanceState, GameState } from "../state";

const W = DEFAULT_EVAL_WEIGHTS;

const ORB = getCardByName("Winter Orb").id;
const STASIS = getCardByName("Stasis").id;
const MEEKSTONE = getCardByName("Meekstone").id;
const WEAPONRY = getCardByName("Tawnos's Weaponry").id; // 2-MV artifact read at its floor
const FOREST = getCardByName("Forest").id;
const BEARS = getCardByName("Grizzly Bears").id;
const GIANT = getCardByName("Hill Giant").id;

function inst(
    cardId: string,
    controllerId: string,
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        ...overrides,
    });
}

function lands(
    controllerId: string,
    count: number,
    isTapped = false
): CardInstanceState[] {
    return Array.from({ length: count }, (_, k) =>
        inst(FOREST, controllerId, `${controllerId}-forest-${k}`, { isTapped })
    );
}

function board(
    p1: CardInstanceState[],
    p2: CardInstanceState[],
    p1Hand: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: p1, hand: p1Hand }),
            makePlayer("p2", { battlefield: p2 }),
        ],
    });
}

/** The hand face: `card` in p1's hand, valued against `state` through the
 *  lens the hand term builds. */
function handFace(state: GameState, card: CardInstanceState): number {
    return cardValue(state, card, handLatentLens(state, "p1", card, W));
}

/** The board face: what the permanent's removal moves, presence excluded —
 *  the one-number convention of issue #5145. */
function boardFace(state: GameState, perm: CardInstanceState): number {
    return permanentRealisedValue(state, perm, W) - W.permanentWeight;
}

/** `card` in p1's hand on the board `p1` / `p2`, and the same board with it
 *  resolved onto p1's battlefield. */
function bothFaces(
    cardId: string,
    p1: CardInstanceState[],
    p2: CardInstanceState[]
): { hand: number; board: number } {
    const held = inst(cardId, "p1", "lock", { zone: "hand" });
    const inPlay = inst(cardId, "p1", "lock");
    return {
        hand: handFace(board(p1, p2, [held]), held),
        board: boardFace(board([...p1, inPlay], p2), inPlay),
    };
}

describe("symmetric locks — Differential Reading per leaf (issue #5163)", () => {
    it("CR 502.3: Winter Orb with the Bot at 2 lands vs 6 scores higher for the Bot than at 6 vs 2, same cards otherwise", () => {
        // The lock's steady state: every land tapped, the Orb untapping one
        // per side. The six-land side holds five dead lands, the two-land
        // side one.
        const orb = () => inst(ORB, "p1", "orb");
        const short = board(
            [...lands("p1", 2, true), orb()],
            lands("p2", 6, true)
        );
        const long = board(
            [...lands("p1", 6, true), orb()],
            lands("p2", 2, true)
        );
        expect(evaluate(short, "p1")).toBeGreaterThan(evaluate(long, "p1"));
    });

    it("an untapped land under the Orb keeps the one activation it holds: the lock still moves the margin toward the short side, by less", () => {
        const swing = (withOrb: boolean) => {
            const orb = withOrb ? [inst(ORB, "p1", "orb")] : [];
            return (
                evaluate(
                    board([...lands("p1", 2), ...orb], lands("p2", 6)),
                    "p1"
                ) -
                evaluate(
                    board([...lands("p1", 6), ...orb], lands("p2", 2)),
                    "p1"
                )
            );
        };
        expect(swing(true)).toBeGreaterThan(swing(false));
    });

    it("a TAPPED Winter Orb locks nothing (its condition), and reads no standing worth", () => {
        const tappedOrb = inst(ORB, "p1", "orb", { isTapped: true });
        const state = board([...lands("p1", 2), tappedOrb], lands("p2", 6));
        expect(boardFace(state, tappedOrb)).toBe(
            boardFace(board([tappedOrb], []), tappedOrb)
        );
    });

    it("hand face equals board face for Stasis on the same board, and reads lower on the side with more to lose", () => {
        const behind = bothFaces(STASIS, lands("p1", 2), [
            ...lands("p2", 5),
            inst(BEARS, "p2", "bears", { isTapped: true }),
        ]);
        expect(behind.hand).toBeCloseTo(behind.board, 9);
        const ahead = bothFaces(STASIS, lands("p1", 5), lands("p2", 2));
        expect(ahead.hand).toBeCloseTo(ahead.board, 9);
        expect(ahead.hand).toBeLessThan(behind.hand);
    });

    it("hand face equals board face for Meekstone and Winter Orb; a lock that hurts its controller reads negative on both faces", () => {
        const meek = bothFaces(
            MEEKSTONE,
            [inst(BEARS, "p1", "bears")],
            [inst(GIANT, "p2", "giant", { isTapped: true })]
        );
        expect(meek.hand).toBeCloseTo(meek.board, 9);
        const orb = bothFaces(ORB, lands("p1", 6, true), lands("p2", 2, true));
        expect(orb.hand).toBeCloseTo(orb.board, 9);
        expect(orb.hand).toBeLessThan(0);
    });

    it("context-free (a draft pick) the lock is unmeasured: Winter Orb keeps its Latent Floor", () => {
        const onEmptyBoard = bothFaces(ORB, [], []);
        expect(onEmptyBoard.hand).toBe(0);
        expect(cardValueById(ORB)).toBeGreaterThan(0);
    });

    it("removal lens: an opposing Winter Orb outranks a 2-MV artifact when the Bot has more lands, and not when it has fewer", () => {
        const orb = inst(ORB, "p2", "orb");
        const weaponry = inst(WEAPONRY, "p2", "weaponry");
        const botAhead = board(lands("p1", 5), [
            ...lands("p2", 2),
            orb,
            weaponry,
        ]);
        expect(permanentRealisedValue(botAhead, orb, W)).toBeGreaterThan(
            permanentRealisedValue(botAhead, weaponry, W)
        );
        const botBehind = board(lands("p1", 2), [
            ...lands("p2", 5),
            orb,
            weaponry,
        ]);
        expect(permanentRealisedValue(botBehind, orb, W)).toBeLessThan(
            permanentRealisedValue(botBehind, weaponry, W)
        );
    });
});
