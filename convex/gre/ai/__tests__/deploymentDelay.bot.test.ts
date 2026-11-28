// The hand term's deployment delay (`ai/deploymentDelay.ts`): a card in hand
// is discounted by the turns its owner's mana base needs to cast it, read at
// the effective cost (CR 601.2f), one land drop per turn (CR 305.2) and the
// whole base untapping each turn (CR 502.3).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { evaluateBreakdown } from "../../evaluate";
import type { GameState } from "../../state";
import {
    deploymentShare,
    deploymentWaits,
    DEPLOYMENT_WAIT_HORIZON,
    windowMana,
    type DeploymentBase,
} from "../deploymentDelay";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";

const BLIND: EvalWeights = { ...DEFAULT_EVAL_WEIGHTS, deploymentDelayDecay: 1 };

function base(over: Partial<DeploymentBase> = {}): DeploymentBase {
    return {
        firstWindowMana: 3,
        perTurnMana: 3,
        landsInHand: 0,
        libraryLandShare: 0,
        firstWindowLandDrops: 0,
        firstWindowDraws: 0,
        ...over,
    };
}

describe("deployment schedule (CR 601.2f, CR 305.2, CR 502.3)", () => {
    it("three mana a turn deploys four one-drops in two turns and four three-drops in four", () => {
        expect(deploymentWaits([1, 1, 1, 1], [5, 5, 5, 5], base())).toEqual([
            0, 0, 0, 1,
        ]);
        expect(deploymentWaits([3, 3, 3, 3], [5, 5, 5, 5], base())).toEqual([
            0, 1, 2, 3,
        ]);
    });

    it("places the most valuable card first", () => {
        // A one-drop and a three-drop on three mana: the three-drop is worth
        // more, so it takes this turn and the one-drop waits.
        expect(deploymentWaits([1, 3], [4, 9], base())).toEqual([1, 0]);
        expect(deploymentWaits([1, 3], [9, 4], base())).toEqual([0, 1]);
    });

    it("a land in hand adds one mana from the window it can be played in", () => {
        const twoLands = base({
            firstWindowMana: 2,
            perTurnMana: 2,
            landsInHand: 1,
        });
        expect(windowMana(twoLands, 0)).toBe(2);
        expect(windowMana(twoLands, 1)).toBe(3);
        // One land in hand: the third window has no second land to play.
        expect(windowMana(twoLands, 2)).toBe(3);
        expect(windowMana({ ...twoLands, firstWindowLandDrops: 1 }, 0)).toBe(3);
        // The expected lands among the draws, one draw a turn (CR 504.1).
        expect(
            windowMana(base({ libraryLandShare: 0.5, firstWindowDraws: 1 }), 1)
        ).toBe(4);
    });

    it("charges the queue, never the turns a card needs on its own", () => {
        // A lone seven-drop on three mana, a lone three-drop a land away: each
        // waits for mana, not for another card, and is charged nothing.
        expect(deploymentWaits([7], [5], base())).toEqual([0]);
        expect(
            deploymentWaits(
                [3],
                [5],
                base({ firstWindowMana: 2, perTurnMana: 2, landsInHand: 1 })
            )
        ).toEqual([0]);
        // Two three-drops behind that land drop: the second queues a turn.
        expect(
            deploymentWaits(
                [3, 3],
                [5, 5],
                base({ firstWindowMana: 2, perTurnMana: 2, landsInHand: 2 })
            )
        ).toEqual([0, 1]);
        expect(DEPLOYMENT_WAIT_HORIZON).toBe(4);
        expect(deploymentShare(0, 0.5)).toBe(1);
        expect(deploymentShare(2, 0.5)).toBe(0.25);
    });
});

/** Three untapped lands (Plains, or `lands`), three copies of `held` in hand
 *  (Savannah Lions by default), a land-free library; the opponent holds a
 *  Trinisphere when `taxed`. */
function lionsHand(
    taxed: boolean,
    active: "p1" | "p2" = "p1",
    held = "Savannah Lions",
    lands = ["Plains", "Plains", "Plains"]
): GameState {
    const lions = getCardByName(held)!;
    const trinisphere = getCardByName("Trinisphere")!;
    return makeState({
        activePlayerId: active,
        players: [
            makePlayer("p1", {
                hand: [0, 1, 2].map((i) =>
                    makeInstance(lions.id, {
                        id: `lion-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    })
                ),
                battlefield: lands.map((name, i) =>
                    makeInstance(getCardByName(name)!.id, {
                        id: `plains-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2", {
                battlefield: taxed
                    ? [
                          makeInstance(trinisphere.id, {
                              id: "trinisphere",
                              controllerId: "p2",
                              ownerId: "p2",
                          }),
                      ]
                    : [],
            }),
        ],
    });
}

describe("hand term: deployment delay (CR 601.2f)", () => {
    it("a tax that spreads a hand over three turns lowers its worth; blind, it does not", () => {
        const untaxed = evaluateBreakdown(lionsHand(false), "p1").self.hand;
        const taxed = evaluateBreakdown(lionsHand(true), "p1").self.hand;
        const d = DEFAULT_EVAL_WEIGHTS.deploymentDelayDecay;
        // Untaxed, the three Lions fit this turn's three mana; at three mana
        // each, one a turn: waits 0, 1 and 2.
        expect(taxed).toBeCloseTo((untaxed / 3) * (1 + d + d * d), 6);
        expect(taxed).toBeLessThan(untaxed);
        // The same two boards with the decay at 1 read the hands alike.
        expect(evaluateBreakdown(lionsHand(true), "p1", BLIND).self.hand).toBe(
            evaluateBreakdown(lionsHand(false), "p1", BLIND).self.hand
        );
    });

    it("the mana spent this turn delays the rest of the hand to the next one", () => {
        const state = lionsHand(false);
        state.players[0].battlefield[0].isTapped = true;
        state.players[0].battlefield[1].isTapped = true;
        const untapped = evaluateBreakdown(lionsHand(false), "p1").self.hand;
        const spent = evaluateBreakdown(state, "p1").self.hand;
        const d = DEFAULT_EVAL_WEIGHTS.deploymentDelayDecay;
        // One Plains left this turn: one Lion now, two next turn.
        expect(spent).toBeCloseTo((untapped / 3) * (1 + 2 * d), 6);
        // On the opponent's turn the whole base untaps first (CR 502.3).
        const theirTurn = lionsHand(false, "p2");
        theirTurn.players[0].battlefield[0].isTapped = true;
        expect(evaluateBreakdown(theirTurn, "p1").self.hand).toBeCloseTo(
            untapped,
            6
        );
    });

    it("a land the census reads as no source still counts as one mana", () => {
        // A fetch land not yet cracked: three lands, three one-drops, all
        // castable by the turn after the fetch is cracked.
        const fetched = lionsHand(false, "p2", "Savannah Lions", [
            "Plains",
            "Plains",
            "Wooded Foothills",
        ]);
        expect(evaluateBreakdown(fetched, "p1").self.hand).toBeCloseTo(
            evaluateBreakdown(lionsHand(false, "p2"), "p1").self.hand,
            6
        );
    });

    it("a hand of instants is held by choice and takes no delay (CR 304.1)", () => {
        const untaxed = evaluateBreakdown(
            lionsHand(false, "p1", "Lightning Bolt"),
            "p1"
        ).self.hand;
        const taxed = evaluateBreakdown(
            lionsHand(true, "p1", "Lightning Bolt"),
            "p1"
        ).self.hand;
        expect(taxed).toBeCloseTo(untaxed, 6);
    });
});
