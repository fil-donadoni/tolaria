// CR 602.1b — the Bot reaches `becomeCopy` over a graveyard target: the
// activation is enumerated exactly when the card-type tally holds, one Move per
// legal permanent card in its graveyard. Shifting Woodland is the fixture.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { GameState } from "../state";

const COPY_ABILITY = "shifting-woodland-delirium-copy";
const WOODLAND = getCardByName("Shifting Woodland").id;
/** Three cards, four card types: Memnite is an Artifact Creature. */
const FOUR_TYPES = ["Memnite", "Forest", "Wrath of God"];
const ONE_TYPE = Array.from({ length: 4 }, () => "Grizzly Bears");

function board(names: string[]): GameState {
    const own = (cardId: string, id: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [own(WOODLAND, "woodland")],
                graveyard: names.map((n, i) =>
                    own(getCardByName(n).id, `g${i}`)
                ),
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
}

const copyMoves = (state: GameState) =>
    enumerateMoves(state, "p1").filter(
        (m) => m.kind === "activate-ability" && m.abilityId === COPY_ABILITY
    );

describe("the Bot enumerates a graveyard-source copy activation (CR 602.1b)", () => {
    it("offers it when delirium holds", () => {
        expect(copyMoves(board(FOUR_TYPES)).length).toBeGreaterThan(0);
    });

    it("does not with four cards of a single card type", () => {
        expect(copyMoves(board(ONE_TYPE))).toEqual([]);
    });
});
