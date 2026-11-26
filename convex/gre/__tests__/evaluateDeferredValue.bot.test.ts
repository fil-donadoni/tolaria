/**
 * A permanent whose value arrives from the next turn on, priced at the leaf
 * (issue #10819). Two readings `evaluate` used to miss:
 *
 *  - a face-down creature its controller can turn face up (CR 702.37e /
 *    701.40b) read as the vanilla 2/2 it is (CR 708.2), with no mana cost
 *    raising the curve, so a morph cast priced the card in hand as thrown
 *    away;
 *  - a planeswalker's loyalty activation still unused on its controller's
 *    main phase (CR 606.3) read as nothing, so the leaf before the
 *    activation sat one activation below the leaf after it.
 *
 * Every assertion goes through the real reducers (`evaluateBreakdown`,
 * `evaluate`, `materialMargin`) on a built state.
 */

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { cardValueById, loyaltyArmValueById } from "../cardValue";
import { evaluate, evaluateBreakdown, materialMargin } from "../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { turnFaceDown } from "../faceDown";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import type { CardInstanceState, GameState } from "../state";

const ANGEL = getCardByName("Exalted Angel").id;
const PLAINS = getCardByName("Plains").id;
const FOREST = getCardByName("Forest").id;
const WALKER = getCardByName("Garruk Wildspeaker").id;

function lands(
    cardId: string,
    n: number,
    controllerId: string
): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(cardId, {
            id: `${controllerId}-land${i}`,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
        })
    );
}

/** `controllerId` controls a face-down Exalted Angel ({2}{W}{W} morph) over
 *  `base` — three lands of `landId`; the other seat controls nothing. */
function faceDownAngel(controllerId: string, landId = PLAINS): GameState {
    const angel = makeInstance(ANGEL, {
        id: "morphed",
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
    turnFaceDown(NO_BOARD_LAYER_VIEW, angel, "morph");
    const other = controllerId === "p1" ? "p2" : "p1";
    const players = [
        makePlayer(controllerId, {
            battlefield: [angel, ...lands(landId, 3, controllerId)],
        }),
        makePlayer(other),
    ];
    return makeState({
        players: controllerId === "p1" ? players : players.reverse(),
    });
}

const LATENT_ANGEL = cardValueById(ANGEL, DEFAULT_EVAL_WEIGHTS.latent, "hand", {
    creature: DEFAULT_EVAL_WEIGHTS.latentCreatureDiscount,
    flash: DEFAULT_EVAL_WEIGHTS.latentFlashCreatureDiscount,
});

describe("a face-down creature with a turn-up cost (CR 702.37e, CR 708.2)", () => {
    it("reads at least the latent worth of the card it is, for its controller", () => {
        const own = evaluateBreakdown(faceDownAngel("p1"), "p1");
        expect(LATENT_ANGEL).toBeGreaterThan(0);
        expect(own.self.creatures).toBeCloseTo(LATENT_ANGEL, 6);
    });

    it("stays the vanilla 2/2 for the seat that may not look at it (CR 708.5)", () => {
        const own = evaluateBreakdown(faceDownAngel("p1"), "p1");
        const observed = evaluateBreakdown(faceDownAngel("p2"), "p1");
        expect(observed.opp.creatures).toBeLessThan(own.self.creatures);
    });

    it("gets no floor when the base cannot supply the turn-up cost's colours", () => {
        const own = evaluateBreakdown(faceDownAngel("p1", FOREST), "p1");
        const observed = evaluateBreakdown(faceDownAngel("p2", FOREST), "p1");
        expect(own.self.creatures).toBeCloseTo(observed.opp.creatures, 6);
    });

    it("keeps the base developing toward the turn-up cost (manaDevelopment)", () => {
        const own = evaluateBreakdown(faceDownAngel("p1"), "p1");
        // Three lands toward a four-mana turn-up: all three earn their keep.
        expect(own.self.manaDevelopment).toBeCloseTo(
            DEFAULT_EVAL_WEIGHTS.manaDevWeight * 3,
            6
        );
        const observed = evaluateBreakdown(faceDownAngel("p2"), "p1");
        expect(observed.opp.manaDevelopment).toBe(0);
    });
});

/** p1 controls a Garruk Wildspeaker at starting loyalty; `active` holds the
 *  turn, in its precombat main phase with priority and an empty stack. */
function walkerBoard(active: string, used: number): GameState {
    const walker = makeInstance(WALKER, {
        id: "walker",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        counters: { loyalty: 3 },
        ...(used > 0 ? { loyaltyActivationsThisTurn: used } : {}),
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [walker] }),
            makePlayer("p2"),
        ],
        activePlayerId: active,
        priorityPlayerId: active,
    });
}

describe("a loyalty activation still unused this turn (CR 606.3)", () => {
    const arm = loyaltyArmValueById(WALKER);

    it("is worth the walker's loyalty arm on its controller's main phase", () => {
        expect(arm).toBeGreaterThan(0);
        const pending = evaluate(walkerBoard("p1", 0), "p1");
        const spent = evaluate(walkerBoard("p1", 1), "p1");
        expect(pending - spent).toBeCloseTo(arm, 6);
    });

    it("stays out of the material margin the tie-break reads", () => {
        expect(materialMargin(walkerBoard("p1", 0), "p1")).toBeCloseTo(
            materialMargin(walkerBoard("p1", 1), "p1"),
            6
        );
    });

    it("is worth nothing outside its controller's turn", () => {
        const offTurn = evaluate(walkerBoard("p2", 0), "p1");
        const spent = evaluate(walkerBoard("p2", 1), "p1");
        expect(offTurn).toBeCloseTo(spent, 6);
    });

    it("counts against the opponent when the walker is theirs", () => {
        // Read from p2's side: p1's pending activation lowers p2's value.
        const pending = evaluate(walkerBoard("p1", 0), "p2");
        const spent = evaluate(walkerBoard("p1", 1), "p2");
        expect(spent - pending).toBeCloseTo(arm, 6);
    });
});
