// The decklist as colour evidence (issue #3533, PRD #3526) — the `expert`
// sharpening of the opponent colour-demand estimate, and the gate that keeps
// it out of every other difficulty.
//
// Three things are pinned here, in the order they can break:
//   1. the derivation itself (`deckColorEvidence`);
//   2. the GATE — `determinize` stamps a seat only when the search was handed
//      that seat's decklist AND that seat is not the observer. The client
//      hands over the bot's OWN decklist at every difficulty, so "a decklist
//      exists" alone is not the gate and a test that only checked that would
//      pass while `hard` silently changed;
//   3. the OUTCOME through the real consumer (`observedColorCoverage`), per
//      difficulty, against the byte-identical blind baseline.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { scatheZombies } from "../../cards/sets/lea/black";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { plains, swamp } from "../../cards/sets/lea/colorless";
import { jasmineBoreal } from "../../cards/sets/leg/multicolor";
import {
    deckColorEvidence,
    deckColorsFor,
    type DeckKnowledgeBySeat,
} from "../deckKnowledge";
import { determinize } from "../determinize";
import { DIFFICULTY_KNOWS_OPPONENT, knowsOpponent } from "../difficulty";
import { makeRng } from "../rng";
import { observedOpponentColors } from "../ai/observedColors";
import { observedColorCoverage } from "../ai/colorCoverage";
import { manaCensusFor } from "../manaAvailability";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import type { GameState } from "../state";

/** The observer seat; `p2` is the seat being estimated throughout. */
const OBSERVER = "p1";

/** A twenty-card mono-black decklist — the `expert` search's evidence that
 *  this opponent spends its cards on {B} whatever its board shows. */
const BLACK_DECK = Array<string>(20).fill(scatheZombies.id);

/** The board both halves of the difficulty sweep run on: the estimated seat
 *  holds ONE untapped Plains and nothing else, so the blind reading is "this
 *  player needs {W}, and can produce it" — coverage 1, a denial worth
 *  nothing. The decklist is what turns that into twenty units of uncovered
 *  {B} demand. */
function boardWithLonePlains(): GameState {
    return makeState({
        players: [
            makePlayer(OBSERVER),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(plains.id, { id: "pl-1", controllerId: "p2" }),
                ],
            }),
        ],
    });
}

function coverageOfEstimatedSeat(state: GameState): number {
    const seat = state.players[1];
    return observedColorCoverage(state, seat, manaCensusFor(state, seat).base);
}

/** The two shapes `useVsAiDriver` pre-computes and picks between with
 *  `knowsOpponent` — reproduced here because the gate's whole correctness
 *  claim is about which of them reaches `determinize`. `blind` names the
 *  BOT'S OWN seat at every difficulty; only `informed` adds the human's. */
const BLIND: DeckKnowledgeBySeat = [
    { playerId: OBSERVER, cardIds: [...BLACK_DECK] },
];
const INFORMED: DeckKnowledgeBySeat = [
    ...BLIND,
    { playerId: "p2", cardIds: [...BLACK_DECK] },
];

describe("deckColorEvidence — the decklist lowered into colour mass (issue #3533)", () => {
    it("counts ONE unit per coloured card, per colour that card actually is", () => {
        expect(deckColorEvidence(BLACK_DECK)).toEqual({ B: 20 });
        expect(
            deckColorEvidence([grizzlyBears.id, grizzlyBears.id, swamp.id])
        ).toEqual({ G: 2 });
    });

    it("a land, and an id the registry cannot resolve, are evidence of nothing", () => {
        expect(deckColorEvidence([plains.id, swamp.id])).toEqual({});
        expect(deckColorEvidence(["not-a-card-id"])).toEqual({});
    });

    it("a GOLD card demands each of its colours (CR 202.2) — one unit apiece", () => {
        // Jasmine Boreal is {3}{G}{W}: one green unit AND one white unit from
        // the same physical card, because a deck holding it wants both.
        expect(deckColorEvidence([jasmineBoreal.id])).toEqual({ G: 1, W: 1 });
        expect(deckColorEvidence([jasmineBoreal.id, scatheZombies.id])).toEqual(
            { G: 1, W: 1, B: 1 }
        );
    });
});

describe("determinize — the gate that keeps the decklist at `expert` (issue #3533)", () => {
    it("stamps a NON-OBSERVER seat the search was handed a decklist for", () => {
        const next = determinize(
            boardWithLonePlains(),
            OBSERVER,
            makeRng(1),
            INFORMED
        );
        expect(next.deckColorKnowledge).toEqual([
            { playerId: "p2", colors: { B: 20 } },
        ]);
    });

    it("stamps NOTHING when the only decklist is the observer's own — the shape every non-expert difficulty sends", () => {
        const next = determinize(
            boardWithLonePlains(),
            OBSERVER,
            makeRng(1),
            BLIND
        );
        expect(next.deckColorKnowledge).toBeUndefined();
        expect(
            deckColorsFor(next.deckColorKnowledge, OBSERVER)
        ).toBeUndefined();
    });

    it("stamps nothing at all when no decklist is supplied", () => {
        const next = determinize(boardWithLonePlains(), OBSERVER, makeRng(1));
        expect(next.deckColorKnowledge).toBeUndefined();
    });

    it("the ladder's `blind` opponent model wins over a supplied decklist", () => {
        const next = determinize(
            boardWithLonePlains(),
            OBSERVER,
            makeRng(1),
            INFORMED,
            "blind"
        );
        expect(next.deckColorKnowledge).toBeUndefined();
    });
});

describe("the estimate per difficulty — `expert` differs, the rest are byte-identical (issue #3533)", () => {
    const blindBaseline = coverageOfEstimatedSeat(
        determinize(boardWithLonePlains(), OBSERVER, makeRng(1))
    );

    it("the blind baseline is the pre-change reading: the lone Plains covers the only colour shown", () => {
        expect(blindBaseline).toBe(1);
    });

    it.each(["easy", "medium", "hard"] as const)(
        "%s reads byte-identically to the blind baseline",
        (difficulty) => {
            expect(DIFFICULTY_KNOWS_OPPONENT[difficulty]).toBe(false);
            const knowledge = knowsOpponent(difficulty) ? INFORMED : BLIND;
            const state = determinize(
                boardWithLonePlains(),
                OBSERVER,
                makeRng(1),
                knowledge
            );
            expect(observedOpponentColors(state, "p2")).toEqual({ W: 1 });
            expect(coverageOfEstimatedSeat(state)).toBe(blindBaseline);
        }
    );

    it("expert VISIBLY differs on the same position — twenty units of uncovered {B} demand", () => {
        expect(knowsOpponent("expert")).toBe(true);
        const state = determinize(
            boardWithLonePlains(),
            OBSERVER,
            makeRng(1),
            INFORMED
        );
        expect(observedOpponentColors(state, "p2")).toEqual({ W: 1, B: 20 });
        expect(coverageOfEstimatedSeat(state)).toBeCloseTo(1 / 21, 10);
        expect(coverageOfEstimatedSeat(state)).not.toBe(blindBaseline);
    });

    it.each(["easy", "medium", "hard"] as const)(
        "%s leaves the OBSERVER's own seat blind too — the shape that leaks is the bot's own decklist, estimated from the other side",
        (difficulty) => {
            const knowledge = knowsOpponent(difficulty) ? INFORMED : BLIND;
            const state = determinize(
                boardWithLonePlains(),
                OBSERVER,
                makeRng(1),
                knowledge
            );
            // `materialMargin(state, moverId)` runs `evaluate` from the HUMAN
            // seat's viewpoint too, which makes the bot's own seat the
            // ESTIMATED one. The bot's decklist is supplied at every
            // difficulty, so a gate that asked only "is there a decklist"
            // would sharpen this reading on `hard` and never touch the
            // assertions above.
            expect(observedOpponentColors(state, OBSERVER)).toEqual({});
        }
    );

    it("still no hand read: the estimate is unchanged when the estimated seat's hand changes", () => {
        const withHand = boardWithLonePlains();
        withHand.players[1].hand = [
            makeInstance(grizzlyBears.id, {
                id: "secret",
                controllerId: "p2",
                zone: "hand",
            }),
        ];
        const informedState = determinize(
            withHand,
            OBSERVER,
            makeRng(1),
            INFORMED
        );
        expect(observedOpponentColors(informedState, "p2")).toEqual({
            W: 1,
            B: 20,
        });
    });
});

describe("the wire — the stamp never reaches a viewer (issue #3533)", () => {
    it("projectPublicState strips `deckColorKnowledge` out of its `...state` spread", () => {
        const state = determinize(
            boardWithLonePlains(),
            OBSERVER,
            makeRng(1),
            INFORMED
        );
        expect(state.deckColorKnowledge).toBeDefined();
        const projected = projectPublicState(state, 1, OBSERVER);
        expect(
            (projected as { deckColorKnowledge?: unknown }).deckColorKnowledge
        ).toBeUndefined();
    });
});

describe("serialization — the stamp is TRANSIENT and never reaches the row (issue #3533)", () => {
    it("compactState drops `deckColorKnowledge`", () => {
        const state = determinize(
            boardWithLonePlains(),
            OBSERVER,
            makeRng(1),
            INFORMED
        );
        expect(state.deckColorKnowledge).toBeDefined();
        const compacted = compactState(state);
        expect(compacted.deckColorKnowledge).toBeUndefined();
        expect(expandState(compacted).deckColorKnowledge).toBeUndefined();
    });
});
