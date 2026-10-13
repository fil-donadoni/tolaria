// Pay-to-untap escape of an untap lock (issue #5568): Thelon's Curse and
// Magnetic Mountain hold blue creatures tapped (CR 502.3) unless their
// controller pays at upkeep to untap them (CR 503.1a). The escape is data on
// the restriction (`untapEscapeCost`) and `ai/restrictionPricing.ts` reads it:
// a creature the controller can buy out, for less than the creature costs, is
// not held; otherwise it is held whole.
//
// Every assertion goes through `evaluateCreature` / `permanentRealisedValue` /
// `cardValue` — the surfaces the search, the removal lens and the hand term
// read.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { restrictionSourceWorth } from "../ai/restrictionPricing";
import { creatureAttackShareRaw, creatureBlockShareRaw } from "../creatureBody";
import {
    cardValue,
    evaluateCreature,
    handLatentLens,
    permanentRealisedValue,
} from "../evaluate";
import { beginLayer7Pass } from "../layers";
import type { CardInstanceState, GameState } from "../state";

const W = DEFAULT_EVAL_WEIGHTS;

const THELON = getCardByName("Thelon's Curse").id; // {U} per creature
const MOUNTAIN = getCardByName("Magnetic Mountain").id; // {4} per creature
const ELEMENTAL = getCardByName("Water Elemental").id; // blue vanilla 5/4, MV 5
const PEARL = getCardByName("Merfolk of the Pearl Trident").id; // blue, MV 1
const ISLAND = getCardByName("Island").id;
const FOREST = getCardByName("Forest").id;

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
    cardId: string,
    count: number,
    isTapped = false
): CardInstanceState[] {
    return Array.from({ length: count }, (_, k) =>
        inst(cardId, "p1", `p1-${cardId}-${k}`, { isTapped })
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

function worth(state: GameState, card: CardInstanceState): number {
    return evaluateCreature(state, card, W.latent, beginLayer7Pass(state), W);
}

function fullDiscount(card: CardInstanceState): number {
    return (
        W.cannotAttackShare *
            creatureAttackShareRaw(card.power ?? 0, card.staticAbilities) +
        W.cannotBlockShare *
            creatureBlockShareRaw(card.toughness ?? 0, card.staticAbilities)
    );
}

describe("pay-to-untap escape priced (issue #5568)", () => {
    it("CR 503.1a: Thelon's Curse with an untapped Island to pay {U} holds nothing; with no blue source it holds the creature whole", () => {
        const elemental = inst(ELEMENTAL, "p1", "elemental", {
            isTapped: true,
        });
        const lock = inst(THELON, "p2", "lock");
        const open = board([elemental], []);
        const paying = board([elemental, ...lands(ISLAND, 1)], [lock]);
        const payingOpen = board([elemental, ...lands(ISLAND, 1)], []);
        const noBlue = board([elemental, ...lands(FOREST, 3)], [lock]);
        const noBlueOpen = board([elemental, ...lands(FOREST, 3)], []);
        expect(worth(paying, elemental)).toBeCloseTo(
            worth(payingOpen, elemental),
            6
        );
        expect(worth(noBlue, elemental)).toBeCloseTo(
            worth(noBlueOpen, elemental) - fullDiscount(elemental),
            6
        );
        expect(worth(paying, elemental)).toBeGreaterThan(
            worth(noBlue, elemental)
        );
        expect(worth(open, elemental)).toBeGreaterThan(
            worth(noBlue, elemental)
        );
    });

    it("the Island may be tapped: the escape is paid from the mana base, which untaps before the upkeep", () => {
        const elemental = inst(ELEMENTAL, "p1", "elemental", {
            isTapped: true,
        });
        const lock = inst(THELON, "p2", "lock");
        const tappedIsland = board(
            [elemental, ...lands(ISLAND, 1, true)],
            [lock]
        );
        const open = board([elemental, ...lands(ISLAND, 1, true)], []);
        expect(worth(tappedIsland, elemental)).toBeCloseTo(
            worth(open, elemental),
            6
        );
    });

    it("an escape dearer than the creature is no escape: a 1-MV blue creature under Thelon's Curse stays held", () => {
        const pearl = inst(PEARL, "p1", "pearl", { isTapped: true });
        const lock = inst(THELON, "p2", "lock");
        const mine = [pearl, ...lands(ISLAND, 3)];
        expect(worth(board(mine, [lock]), pearl)).toBeCloseTo(
            worth(board(mine, []), pearl) - fullDiscount(pearl),
            6
        );
    });

    it("Magnetic Mountain: {4} is payable with four lands of any colour, not with three", () => {
        const elemental = inst(ELEMENTAL, "p1", "elemental", {
            isTapped: true,
        });
        const lock = inst(MOUNTAIN, "p2", "lock");
        const four = [elemental, ...lands(FOREST, 4)];
        const three = [elemental, ...lands(FOREST, 3)];
        expect(worth(board(four, [lock]), elemental)).toBeCloseTo(
            worth(board(four, []), elemental),
            6
        );
        expect(worth(board(three, [lock]), elemental)).toBeCloseTo(
            worth(board(three, []), elemental) - fullDiscount(elemental),
            6
        );
    });

    it("the source's worth follows: a lock its victim can buy out is worth nothing, one it cannot is worth the held share", () => {
        const elemental = inst(ELEMENTAL, "p1", "elemental", {
            isTapped: true,
        });
        const lock = inst(THELON, "p2", "lock");
        const paying = board([elemental, ...lands(ISLAND, 1)], [lock]);
        const noBlue = board([elemental, ...lands(FOREST, 3)], [lock]);
        expect(
            restrictionSourceWorth(paying, lock, W, beginLayer7Pass(paying))
        ).toBe(0);
        expect(
            restrictionSourceWorth(noBlue, lock, W, beginLayer7Pass(noBlue))
        ).toBeCloseTo(fullDiscount(elemental), 6);
    });

    it("hand face equals board face for both locks", () => {
        for (const cardId of [THELON, MOUNTAIN]) {
            for (const mine of [
                [
                    inst(ELEMENTAL, "p1", "elemental", { isTapped: true }),
                    ...lands(ISLAND, 1),
                ],
                [
                    inst(ELEMENTAL, "p1", "elemental", { isTapped: true }),
                    ...lands(FOREST, 2),
                ],
            ]) {
                const theirs = [
                    inst(ELEMENTAL, "p2", "their-elemental", {
                        isTapped: true,
                    }),
                ];
                const held = inst(cardId, "p1", "lock", { zone: "hand" });
                const inPlay = inst(cardId, "p1", "lock");
                const hand = cardValue(
                    board(mine, theirs, [held]),
                    held,
                    handLatentLens(board(mine, theirs, [held]), "p1", held, W)
                );
                const onBoard = board([...mine, inPlay], theirs);
                expect(hand).toBeCloseTo(
                    permanentRealisedValue(onBoard, inPlay, W) -
                        W.permanentWeight,
                    9
                );
            }
        }
    });
});
