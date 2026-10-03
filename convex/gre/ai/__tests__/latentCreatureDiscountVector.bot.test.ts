// The creature-in-hand discounts are part of the evaluation VECTOR (issue
// #5012, follow-up of issue #4882): every path that prices a creature not in
// play reads the discounts of the vector the search runs at, never the
// committed ones; and a held creature a board permission lets its holder cast
// "as though it had flash" takes the flash discount (CR 601.3b / 702.8a).
import { describe, expect, it } from "vitest";
import { aluren } from "../../../cards/sets/tmp/green.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { cardValueById } from "../../cardValue";
import { evaluateBreakdown } from "../../evaluate";
import { latentGraveyardValue } from "../graveyardReach";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";

/** The production vector with the two creature discounts moved. `latent` stays
 *  the SAME object, which is the case the graveyard memo must not conflate. */
const HALVED: EvalWeights = {
    ...DEFAULT_EVAL_WEIGHTS,
    latentCreatureDiscount: DEFAULT_EVAL_WEIGHTS.latentCreatureDiscount / 2,
    latentFlashCreatureDiscount:
        DEFAULT_EVAL_WEIGHTS.latentFlashCreatureDiscount / 2,
};

const DISCOUNTS = (w: EvalWeights) => ({
    creature: w.latentCreatureDiscount,
    flash: w.latentFlashCreatureDiscount,
});

function heldBears(withAluren: boolean) {
    const bears = makeInstance(grizzlyBears.id, {
        id: "bears",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [bears],
                battlefield: withAluren
                    ? [
                          makeInstance(aluren.id, {
                              id: "aluren",
                              controllerId: "p1",
                              ownerId: "p1",
                          }),
                      ]
                    : [],
            }),
            makePlayer("p2", {}),
        ],
    });
}

describe("the creature discounts follow the vector (issue #5012)", () => {
    it("cardValueById prices at the discounts it is handed", () => {
        const committed = cardValueById(grizzlyBears.id);
        const halved = cardValueById(
            grizzlyBears.id,
            HALVED.latent,
            "hand",
            DISCOUNTS(HALVED)
        );
        expect(halved).toBeCloseTo(committed / 2, 5);
    });

    it("the graveyard reading agrees with the hand reading under a non-default vector, and the memo keys on the discounts", () => {
        const inGraveyard = makeInstance(grizzlyBears.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // Committed discounts FIRST, same `latent` object: a memo keyed by the
        // `latent` identity alone would serve this number to HALVED below.
        const base = latentGraveyardValue(
            inGraveyard,
            DEFAULT_EVAL_WEIGHTS.latent,
            DISCOUNTS(DEFAULT_EVAL_WEIGHTS)
        );
        const halved = latentGraveyardValue(
            inGraveyard,
            DEFAULT_EVAL_WEIGHTS.latent,
            DISCOUNTS(HALVED)
        );
        expect(halved).toBeCloseTo(base / 2, 5);
        const state = heldBears(false);
        const hand = evaluateBreakdown(state, "p1", HALVED).self.hand;
        expect(halved).toBeCloseTo(hand, 5);
    });

    it("a held creature under a cast-as-though-flash permission takes the flash discount", () => {
        const plain = evaluateBreakdown(
            heldBears(false),
            "p1",
            DEFAULT_EVAL_WEIGHTS
        ).self.hand;
        const permitted = evaluateBreakdown(
            heldBears(true),
            "p1",
            DEFAULT_EVAL_WEIGHTS
        ).self.hand;
        const ratio =
            DEFAULT_EVAL_WEIGHTS.latentFlashCreatureDiscount /
            DEFAULT_EVAL_WEIGHTS.latentCreatureDiscount;
        expect(permitted).toBeCloseTo(plain * ratio, 5);
    });
});
