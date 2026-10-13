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
import { cardValueById, declaresStandingLock } from "../cardValue";
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
    isTapped = false,
    from = 0
): CardInstanceState[] {
    return Array.from({ length: count }, (_, k) =>
        inst(FOREST, controllerId, `${controllerId}-forest-${from + k}`, {
            isTapped,
        })
    );
}

/** The lock's steady state for one side: `untapped` lands still open (the
 *  one the cap untapped, or the ones held back), the rest tapped. */
function lockedLands(
    controllerId: string,
    untapped: number,
    tapped: number
): CardInstanceState[] {
    return [
        ...lands(controllerId, untapped),
        ...lands(controllerId, tapped, true, untapped),
    ];
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
    it("CR 502.3: under its controller's OWN lock an extra tapped land is never worth less than nothing (the mana axis is counted once)", () => {
        for (const lockId of [ORB, STASIS]) {
            const withLands = (n: number) =>
                evaluate(
                    board(
                        [...lands("p1", n, true), inst(lockId, "p1", "lock")],
                        lands("p2", 3, true)
                    ),
                    "p1"
                );
            expect(withLands(4)).toBeGreaterThan(withLands(3));
        }
    });

    it("under a cap every matched land prices alike: no source's removal depends on its id", () => {
        const orb = inst(ORB, "p1", "orb");
        const four = lands("p2", 4, true);
        const state = board([orb], four);
        const values = four.map((l) => permanentRealisedValue(state, l, W));
        for (const v of values) expect(v).toBeCloseTo(values[0], 9);
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
        // The Orb is on p1's side in both boards, so its own body cancels:
        // what is left is the four renewals more it takes from the long side,
        // counted on the restricted side and credited to the source — well
        // over two untapped sources' worth, never a rounding difference.
        expect(swing(true) - swing(false)).toBeGreaterThan(2 * W.manaWeight);
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

    it("removal lens: an opposing Winter Orb outranks a 2-MV artifact when the Bot has more lands under it, and not when it has fewer", () => {
        const orb = inst(ORB, "p2", "orb");
        const weaponry = inst(WEAPONRY, "p2", "weaponry");
        // The Orb's steady state: the long side has two lands open for the
        // Disenchant and the rest held down; the short side is tapped out.
        const botAhead = board(lockedLands("p1", 2, 5), [
            ...lands("p2", 2, true),
            orb,
            weaponry,
        ]);
        expect(permanentRealisedValue(botAhead, orb, W)).toBeGreaterThan(
            permanentRealisedValue(botAhead, weaponry, W)
        );
        const botBehind = board(lockedLands("p1", 2, 0), [
            ...lockedLands("p2", 2, 5),
            orb,
            weaponry,
        ]);
        expect(permanentRealisedValue(botBehind, orb, W)).toBeLessThan(
            permanentRealisedValue(botBehind, weaponry, W)
        );
    });

    it("a standing lock is a card whose every static the pricing reads whole: Smoke's creature cap, Elephant Grass's tax and Teferi's Moat's chosen colour keep the floor", () => {
        for (const name of ["Winter Orb", "Stasis", "Meekstone", "Moat"]) {
            expect(declaresStandingLock(getCardByName(name)), name).toBe(true);
        }
        for (const name of ["Smoke", "Elephant Grass", "Teferi's Moat"]) {
            expect(declaresStandingLock(getCardByName(name)), name).toBe(false);
        }
    });
});
