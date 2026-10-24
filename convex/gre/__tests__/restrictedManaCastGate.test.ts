// CR 106.6 (issue #1733) — the castability gate counts a mana
// source's output only when that option's own spend restriction permits the
// spell being probed.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getLegalActions } from "../rules";
import type { CardInstanceState, GameState } from "../state";

const UNSUMMON = getCardByName("Unsummon").id;
const SOL_RING = getCardByName("Sol Ring").id;
const ISLAND = getCardByName("Island").id;
const HILL_GIANT = getCardByName("Hill Giant").id;
const UNICORN = getCardByName("Adarkar Unicorn").id;
const HALFLING = getCardByName("Delighted Halfling").id;
const WORKSHOP = getCardByName("Mishra's Workshop").id;

function position(spellId: string, sourceIds: string[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(spellId, {
                        id: "spell",
                        zone: "hand",
                    }),
                ],
                battlefield: sourceIds.map((id, i) =>
                    makeInstance(id, { id: `src${i}` })
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HILL_GIANT, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

const offersCast = (state: GameState): boolean => {
    const spell = state.players[0].hand.find(
        (c) => c.id === "spell"
    ) as CardInstanceState;
    return getLegalActions(state, state.players[0], spell).includes("cast");
};

describe("restricted mana in the castability gate (CR 106.6)", () => {
    it("controls: an Island pays for Unsummon, no source does not", () => {
        expect(offersCast(position(UNSUMMON, [ISLAND]))).toBe(true);
        expect(offersCast(position(UNSUMMON, []))).toBe(false);
    });

    it("cumulative-upkeep mana pays for no spell", () => {
        expect(offersCast(position(UNSUMMON, [UNICORN]))).toBe(false);
    });

    it("Delighted Halfling's restricted any-colour mana does not pay for a non-legendary spell", () => {
        expect(offersCast(position(UNSUMMON, [HALFLING]))).toBe(false);
    });

    it("an artifact-spell restriction counts for an artifact spell only", () => {
        expect(offersCast(position(SOL_RING, [WORKSHOP]))).toBe(true);
        expect(offersCast(position(UNSUMMON, [WORKSHOP]))).toBe(false);
    });

    it("the unrestricted option of a mixed source still counts", () => {
        // Halfling's {T}: Add {C} is free; Sol Ring costs {1}.
        expect(offersCast(position(SOL_RING, [HALFLING]))).toBe(true);
    });
});
