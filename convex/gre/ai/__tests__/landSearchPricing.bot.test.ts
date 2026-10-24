// Source- and hand-aware land pricing for a library search (issue #3282).
//
// `libraryTargetWorth` priced every fetched land on the searcher's land COUNT
// alone, so a dual, a utility land and a basic tied and the pick (and the
// generator's top-K admission, which ranks by the same function) was arbitrary.
// The land leg now adds, faded to zero at the curve's saturation:
//   - absolute source quality (colour breadth, non-mana activated ability);
//   - hand-relative need — a land supplying a colour the board cannot produce
//     for a valuable card in the SEARCHER's own hand — dominating quality.
//
// CR 701.23 (search), CR 305.6 (basic land types), CR 402.3 (hidden hand).
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../../state";
import { libraryTargetWorth } from "../candidateValue";
import { sengirVampire } from "../../../cards/sets/lea/black.cards";
import { hallowedFountain } from "../../../cards/sets/dis/colorless.cards";
import { scaldingTarn } from "../../../cards/sets/zen/colorless.cards";
import { mishrasFactory } from "../../../cards/sets/atq/colorless.cards";
import { island, plains, swamp } from "../../../cards/sets/lea/index.cards";

const ME = "p1";
const OPP = "p2";

function lands(ids: string[]): CardInstanceState[] {
    return ids.map((id) => makeInstance(id));
}

function position(opts: {
    board: string[];
    hand?: string[];
    oppHand?: string[];
}): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                battlefield: lands(opts.board),
                hand: lands(opts.hand ?? []),
            }),
            makePlayer(OPP, { hand: lands(opts.oppHand ?? []) }),
        ],
    });
}

const worth = (state: GameState, id: string) =>
    libraryTargetWorth(state, ME, makeInstance(id), undefined);

describe("land search pricing (CR 701.23)", () => {
    const coveredBoard = [plains().id, island().id];

    it("prices a dual land above a basic on an identical board", () => {
        const s = position({ board: coveredBoard });
        expect(worth(s, hallowedFountain().id)).toBeGreaterThan(
            worth(s, plains().id)
        );
    });

    it("prices a land with a non-mana activated ability above a basic", () => {
        const s = position({ board: coveredBoard });
        expect(worth(s, mishrasFactory().id)).toBeGreaterThan(
            worth(s, plains().id)
        );
    });

    it("keeps a land with no mana ability at the plain fetch curve", () => {
        const s = position({ board: coveredBoard });
        expect(worth(s, scaldingTarn().id)).toBe(worth(s, plains().id));
        expect(worth(s, scaldingTarn().id)).toBeGreaterThan(0);
    });

    it("prices the decisive basic above a dual adding only covered colours", () => {
        const s = position({ board: coveredBoard, hand: [sengirVampire().id] });
        expect(worth(s, swamp().id)).toBeGreaterThan(
            worth(s, hallowedFountain().id)
        );
    });

    it("lets the dual win again when the hand's colours are covered", () => {
        const s = position({ board: coveredBoard });
        expect(worth(s, hallowedFountain().id)).toBeGreaterThan(
            worth(s, swamp().id)
        );
    });

    it("prices every land at the flooded floor at saturation", () => {
        const s = position({
            board: [
                plains().id,
                plains().id,
                island().id,
                island().id,
                island().id,
            ],
            hand: [sengirVampire().id],
        });
        const floor = worth(s, plains().id);
        for (const id of [
            swamp().id,
            hallowedFountain().id,
            mishrasFactory().id,
            scaldingTarn().id,
        ])
            expect(worth(s, id)).toBe(floor);
    });

    it("reads no opponent hand", () => {
        const bare = position({ board: coveredBoard });
        const loaded = position({
            board: coveredBoard,
            oppHand: [sengirVampire().id],
        });
        for (const id of [swamp().id, plains().id, hallowedFountain().id])
            expect(worth(loaded, id)).toBe(worth(bare, id));
    });
});
