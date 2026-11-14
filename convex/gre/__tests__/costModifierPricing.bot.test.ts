// Cost-modifier pricing (issue #5363): a standing spell cost modifier is
// priced as mana economy, from its controller's seat, by the mana it moves on
// the known spells of each hand. CR 601.2f (cost increases, reductions, and
// effects that directly affect the total cost).
//
// Every assertion goes through `evaluate` / `evaluateBreakdown` /
// `permanentRealisedValue` or the reading those surfaces call.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { costModifierStandingWorth } from "../ai/costModifierPricing";
import { evaluateBreakdown, permanentRealisedValue } from "../evaluate";
import type { CardInstanceState, GameState } from "../state";

const SPHERE = getCardByName("Sphere of Resistance").id; // spells cost {1} more
const TRINISPHERE = getCardByName("Trinisphere").id; // total cost at least 3
const DEFENSE_GRID = getCardByName("Defense Grid").id; // {3} more off-turn
const RUBY_MEDALLION = getCardByName("Ruby Medallion").id; // your red spells {1} less
const BOLT = getCardByName("Lightning Bolt").id; // {R}
const BEARS = getCardByName("Grizzly Bears").id; // {1}{G}
const DRAGON = getCardByName("Shivan Dragon").id; // {4}{R}{R}
const MOUNTAIN = getCardByName("Mountain").id;
const W = DEFAULT_EVAL_WEIGHTS;

function inst(
    cardId: string,
    controllerId: string,
    id: string,
    overrides: Partial<CardInstanceState> = {}
) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        ...overrides,
    });
}

function hand(cardIds: string[], owner: string): CardInstanceState[] {
    return cardIds.map((cardId, i) =>
        inst(cardId, owner, `${owner}-h${i}`, { zone: "hand" })
    );
}

function board(
    p1: CardInstanceState[],
    p2: CardInstanceState[],
    hands: { p1?: string[]; p2?: string[] } = {},
    overrides: Partial<GameState> = {}
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: p1,
                hand: hand(hands.p1 ?? [], "p1"),
            }),
            makePlayer("p2", {
                battlefield: p2,
                hand: hand(hands.p2 ?? [], "p2"),
            }),
        ],
        ...overrides,
    });
}

const worthOf = (state: GameState, perm: CardInstanceState) =>
    costModifierStandingWorth(state, perm, W);

describe("cost-modifier pricing — mana economy (issue #5363)", () => {
    it("CR 601.2f: a tax threshold reads higher against cheap known spells than against spells above it", () => {
        const tri = inst(TRINISPHERE, "p1", "tri");
        const cheap = board([tri], [], { p2: [BOLT, BOLT, BEARS] });
        const dear = board([tri], [], { p2: [DRAGON, DRAGON, BEARS] });
        // Bolt 1 → 3 (+2 each), Bears 2 → 3 (+1), Dragon untouched.
        expect(worthOf(cheap, tri)).toBeCloseTo(5 * W.costTaxWeight, 6);
        expect(worthOf(dear, tri)).toBeCloseTo(1 * W.costTaxWeight, 6);
        // The evaluation the search reads orders the two boards the same way
        // (the hands are equal in size, so only the tax separates them on
        // p1's permanents term).
        expect(evaluateBreakdown(cheap, "p1").self.permanents).toBeGreaterThan(
            evaluateBreakdown(dear, "p1").self.permanents
        );
    });

    it("an empty opponent hand reads zero; lands in hand are never taxed (CR 305.1)", () => {
        const sphere = inst(SPHERE, "p1", "s");
        expect(worthOf(board([sphere], []), sphere)).toBe(0);
        expect(
            worthOf(board([sphere], [], { p2: [MOUNTAIN, MOUNTAIN] }), sphere)
        ).toBe(0);
    });

    it("ADR 0151: a symmetric tax nets the opponent's taxed mana against the controller's own", () => {
        const sphere = inst(SPHERE, "p1", "s");
        const ahead = board([sphere], [], {
            p1: [BOLT],
            p2: [BOLT, BEARS, DRAGON],
        });
        const behind = board([sphere], [], {
            p1: [BOLT, BEARS, DRAGON],
            p2: [BOLT],
        });
        expect(worthOf(ahead, sphere)).toBeCloseTo(2 * W.costTaxWeight, 6);
        expect(worthOf(behind, sphere)).toBeCloseTo(-2 * W.costTaxWeight, 6);
    });

    it("the opponent's tax piece is a loss to its victim's seat", () => {
        const theirs = inst(SPHERE, "p2", "s2");
        const taxed = board([], [theirs], { p1: [BOLT, BEARS] });
        const bare = board([], [inst(MOUNTAIN, "p2", "m2")], {
            p1: [BOLT, BEARS],
        });
        expect(worthOf(taxed, theirs)).toBeCloseTo(2 * W.costTaxWeight, 6);
        expect(evaluateBreakdown(taxed, "p1").opp.permanents).toBeGreaterThan(
            evaluateBreakdown(bare, "p1").opp.permanents
        );
    });

    it("a reduction on the controller's own spells reads positive by the same subtraction", () => {
        const medallion = inst(RUBY_MEDALLION, "p1", "rm");
        // Bolt {R} → {R} (only generic reduces), Dragon {4}{R}{R} → {3}{R}{R}.
        const state = board([medallion], [], { p1: [BOLT, DRAGON] });
        expect(worthOf(state, medallion)).toBeCloseTo(1 * W.costTaxWeight, 6);
    });

    it("the reading is the castability reader's: a turn-gated tax charges only off its caster's turn", () => {
        const grid = inst(DEFENSE_GRID, "p1", "dg");
        const theirTurn = board(
            [grid],
            [],
            { p2: [BOLT] },
            {
                activePlayerId: "p2",
            }
        );
        const myTurn = board(
            [grid],
            [],
            { p2: [BOLT] },
            {
                activePlayerId: "p1",
            }
        );
        expect(worthOf(theirTurn, grid)).toBe(0);
        expect(worthOf(myTurn, grid)).toBeCloseTo(3 * W.costTaxWeight, 6);
    });

    it("counterfactual per source: two Spheres each price the one mana removing it frees", () => {
        const a = inst(SPHERE, "p1", "sa");
        const b = inst(SPHERE, "p1", "sb");
        const state = board([a, b], [], { p2: [BEARS] });
        expect(worthOf(state, a)).toBeCloseTo(W.costTaxWeight, 6);
        expect(worthOf(state, b)).toBeCloseTo(W.costTaxWeight, 6);
    });

    it("the removal lens carries the worth once", () => {
        const sphere = inst(SPHERE, "p1", "s");
        const taxing = board([sphere], [], { p2: [BOLT, BEARS] });
        const idle = board([sphere], []);
        expect(
            permanentRealisedValue(taxing, sphere, W) -
                permanentRealisedValue(idle, sphere, W)
        ).toBeCloseTo(worthOf(taxing, sphere), 6);
    });

    it("hand face and board face agree: the card in hand is worth what it adds once entered", () => {
        const handCard = inst(SPHERE, "p1", "s", { zone: "hand" });
        const opp = { p2: [BOLT, BEARS, DRAGON] };
        const inHand = board([], [], opp);
        inHand.players[0].hand = [handCard];
        const inPlay = board([{ ...handCard, zone: "battlefield" }], [], opp);
        const empty = board([], [], opp);
        const handTerm =
            evaluateBreakdown(inHand, "p1").self.hand -
            evaluateBreakdown(empty, "p1").self.hand;
        const boardTerm =
            evaluateBreakdown(inPlay, "p1").self.permanents -
            evaluateBreakdown(empty, "p1").self.permanents;
        const entered = worthOf(inPlay, inPlay.players[0].battlefield[0]);
        expect(entered).toBeCloseTo(3 * W.costTaxWeight, 6);
        expect(boardTerm - W.permanentWeight).toBeCloseTo(entered, 6);
        expect(handTerm).toBeCloseTo(entered, 6);
    });
});
