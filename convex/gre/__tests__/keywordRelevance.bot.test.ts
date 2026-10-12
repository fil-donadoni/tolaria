// Board-aware keyword relevance (issue #5356). Two keywords price at zero:
// a landwalk with no such land across the table (CR 702.14c),
// and protection from a colour the opponents have provably not shown
// (CR 702.16a). Every case the board cannot prove inert keeps its
// `creatureBody.ts` table bonus.
//
// Every assertion goes through `evaluateCreature` — the surface the leaf, the
// removal lens and the combat deltas read — against the same body without
// the keyword, so the expected number is the table's own (`keywordBonusFor`).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { keywordBonusFor } from "../creatureBody";
import { evaluateCreature } from "../evaluate";
import { beginLayer7Pass } from "../layers";
import type { CardInstanceState, GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 vanilla
const SWAMP = getCardByName("Swamp").id;
const MOUNTAIN = getCardByName("Mountain").id;
const FOREST = getCardByName("Forest").id;

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

/** A Grizzly Bears of `p1` carrying `keyword`, its twin without it, and the
 *  opponent `p2`'s battlefield. */
function bears(
    keyword: string,
    opp: CardInstanceState[],
    carrierOverrides: Partial<CardInstanceState> = {}
) {
    const carrier = inst(BEARS, "p1", "carrier", {
        staticAbilities: [keyword],
        ...carrierOverrides,
    });
    const plain = inst(BEARS, "p1", "plain");
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [carrier, plain] }),
            makePlayer("p2", { battlefield: opp }),
        ],
    });
    const worth = (card: CardInstanceState, s: GameState = state) =>
        evaluateCreature(s, card, W.latent, beginLayer7Pass(s), W);
    return {
        /** What the keyword adds to the carrier's worth on this board. */
        bonus: worth(carrier) - worth(plain),
        table: keywordBonusFor(keyword, 2),
    };
}

describe("keyword relevance — landwalk (CR 702.14c, issue #5356)", () => {
    it("swampwalk is worth nothing while the defender controls no Swamp", () => {
        const { bonus, table } = bears("swampwalk", [
            inst(FOREST, "p2", "forest"),
        ]);
        expect(table).toBeGreaterThan(0);
        expect(bonus).toBe(0);
    });

    it("swampwalk keeps its table bonus once the defender controls a Swamp", () => {
        const { bonus, table } = bears("swampwalk", [
            inst(SWAMP, "p2", "swamp"),
        ]);
        expect(bonus).toBe(table);
    });
});

describe("keyword relevance — protection from a colour (CR 702.16a, issue #5356)", () => {
    it("protection from red is worth nothing against an opponent who has shown only black", () => {
        const { bonus, table } = bears("protection from red", [
            inst(SWAMP, "p2", "swamp"),
        ]);
        expect(table).toBeGreaterThan(0);
        expect(bonus).toBe(0);
    });

    it("a TAPPED Mountain is still red: protection from red keeps its bonus", () => {
        const { bonus, table } = bears("protection from red", [
            inst(SWAMP, "p2", "swamp"),
            inst(MOUNTAIN, "p2", "mountain", { isTapped: true }),
        ]);
        expect(bonus).toBe(table);
    });

    it("an opponent who has shown no colour at all proves nothing absent: the bonus stands", () => {
        const { bonus, table } = bears("protection from red", []);
        expect(bonus).toBe(table);
    });

    it("a non-colour quality is never ruled out by the board", () => {
        const { bonus, table } = bears("protection from creatures", [
            inst(SWAMP, "p2", "swamp"),
        ]);
        expect(table).toBeGreaterThan(0);
        expect(bonus).toBe(table);
    });
});

describe("keyword relevance — a text-changed keyword is read as rewritten (CR 612)", () => {
    it("Sleight of Mind's protection from red → blue is live against a blue opponent", () => {
        const { bonus, table } = bears(
            "protection from red",
            [inst(getCardByName("Island").id, "p2", "island")],
            {
                textChangeHolds: [
                    {
                        change: { kind: "color-word", from: "red", to: "blue" },
                        seq: 1,
                    },
                ],
            }
        );
        expect(bonus).toBe(table);
    });

    it("Magical Hack's forestwalk → islandwalk is live against an Island", () => {
        const { bonus, table } = bears(
            "forestwalk",
            [inst(getCardByName("Island").id, "p2", "island")],
            {
                textChangeHolds: [
                    {
                        change: {
                            kind: "land-type",
                            from: "Forest",
                            to: "Island",
                        },
                        seq: 1,
                    },
                ],
            }
        );
        expect(bonus).toBe(table);
    });
});
