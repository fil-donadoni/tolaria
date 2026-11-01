// Sequencing Eval Pairs (issue #7819): a pair between two actions whose
// `other` move is still offered once `right` has settled is a WHEN judgement
// ("play the land, then cast the spell"), routed beside the timing pairs and
// never fitted. Read through the production enumerator and probe, so the
// moves carry the payment plans the engine itself builds.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { Move } from "../../moves";
import type { CardInstanceState, GameState } from "../../state";
import { evalPairsOf, sequencingPairClassifier } from "../verdicts/evalPairs";
import { buildVerdictState, candidateMoves } from "../verdicts/position";
import type { Verdict } from "../verdicts/types";
import { moveKey } from "../../search";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";

const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;
const SWAMP = getCardByName("Swamp").id;
const BEARS = getCardByName("Grizzly Bears").id;
const MONGREL = getCardByName("Wild Mongrel").id;

function card(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
}

/** p1's own precombat main phase over two untapped Forests: mana for ONE of
 *  the two 2-drops, and one land drop for one of the two lands. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    card(ISLAND, "island"),
                    card(SWAMP, "swamp"),
                    card(BEARS, "bears"),
                    card(MONGREL, "mongrel"),
                ],
                battlefield: [
                    card(FOREST, "forest-1"),
                    card(FOREST, "forest-2"),
                ],
            }),
            makePlayer("p2", {}),
        ],
    });
}

function indexOf(moves: readonly Move[], kind: Move["kind"], id?: string) {
    const index = moves.findIndex(
        (m) =>
            m.kind === kind &&
            (id === undefined ||
                ("cardInstanceId" in m && m.cardInstanceId === id))
    );
    expect(index, `${kind} ${id ?? ""}`).toBeGreaterThanOrEqual(0);
    return index;
}

describe("sequencing pairs (issue #7819)", () => {
    const state = board();
    const moves = candidateMoves(state, "p1");
    const isSequencing = sequencingPairClassifier(state, "p1", moves);
    const PASS = indexOf(moves, "pass");
    const ISLAND_DROP = indexOf(moves, "play-land", "island");
    const SWAMP_DROP = indexOf(moves, "play-land", "swamp");
    const BEARS_CAST = indexOf(moves, "cast-spell", "bears");
    const MONGREL_CAST = indexOf(moves, "cast-spell", "mongrel");

    it("a land drop over a spell still castable after it is sequencing, both ways", () => {
        expect(
            isSequencing({ rightIndex: ISLAND_DROP, otherIndex: BEARS_CAST })
        ).toBe(true);
        expect(
            isSequencing({ rightIndex: BEARS_CAST, otherIndex: ISLAND_DROP })
        ).toBe(true);
    });

    it("two moves that exclude each other are a WHAT judgement", () => {
        // One land drop a turn: the Swamp is not offered after the Island.
        expect(
            isSequencing({ rightIndex: ISLAND_DROP, otherIndex: SWAMP_DROP })
        ).toBe(false);
        // Two Forests pay for one 2-drop: the Mongrel is not offered after
        // the Bears resolve.
        expect(
            isSequencing({ rightIndex: BEARS_CAST, otherIndex: MONGREL_CAST })
        ).toBe(false);
    });

    it("pass on either side is never sequencing", () => {
        expect(isSequencing({ rightIndex: PASS, otherIndex: BEARS_CAST })).toBe(
            false
        );
        expect(isSequencing({ rightIndex: BEARS_CAST, otherIndex: PASS })).toBe(
            false
        );
    });
});

describe("evalPairsOf routes a sequencing pair out of the fit (issue #7819)", () => {
    it("files 'play the land, then cast the spell' under timing, never pairs", () => {
        const verdict: Verdict = {
            id: "sequencing",
            spec: {
                cards: [
                    { name: "Forest", owner: "me", zone: "battlefield" },
                    { name: "Forest", owner: "me", zone: "battlefield" },
                    { name: "Island", owner: "me", zone: "hand" },
                    { name: "Grizzly Bears", owner: "me", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                landCount: 0,
                libraryCount: 20,
            },
            seat: "me",
            candidates: [],
            answer: { kind: "right", rightIndexes: [] },
            author: "test",
            createdAt: new Date(0).toISOString(),
            source: "in-play",
        };
        const state = buildVerdictState(verdict);
        const moves = candidateMoves(state, state.players[0].id).filter(
            (m) => m.kind === "play-land" || m.kind === "cast-spell"
        );
        expect(moves.map((m) => m.kind).sort()).toEqual([
            "cast-spell",
            "play-land",
        ]);
        const LAND = moves.findIndex((m) => m.kind === "play-land");
        const judged: Verdict = {
            ...verdict,
            candidates: moves.map((m) => ({
                key: moveKey(m),
                description: m.kind,
            })),
            answer: { kind: "right", rightIndexes: [LAND] },
        };
        const out = evalPairsOf(judged);
        expect(out.error).toBeUndefined();
        expect(out.pairs).toEqual([]);
        expect(out.timing.map((p) => p.other.description)).toEqual([
            "cast-spell",
        ]);
    });
});
