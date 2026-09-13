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
    deckColorsForSearch,
    type DeckKnowledgeBySeat,
} from "../deckKnowledge";
import { determinize } from "../determinize";
import { searchWithTrace } from "../search";
import { findBladeScenario } from "../ai/blade/registry";
import { bladeDeckKnowledge, buildBladeState } from "../ai/blade/runner";
import { seatPlayerId } from "../ai/blade/matcher";
import { DIFFICULTY_KNOWS_OPPONENT, knowsOpponent } from "../difficulty";
import { makeRng } from "../rng";
import { observedOpponentColors } from "../ai/observedColors";
import { observedColorCoverage } from "../ai/colorCoverage";
import { manaCensusFor } from "../manaAvailability";
import { compactState, expandState } from "../serialize";
import { projectFullState, projectPublicState } from "../../gameProjections";
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

describe("deckColorsForSearch — the gate that keeps the decklist at `expert` (issue #3533)", () => {
    it("lowers a NON-OBSERVER seat the search was handed a decklist for", () => {
        expect(deckColorsForSearch(INFORMED, OBSERVER)).toEqual([
            { playerId: "p2", colors: { B: 20 } },
        ]);
    });

    it("lowers NOTHING when the only decklist is the observer's own — the shape every non-expert difficulty sends", () => {
        expect(deckColorsForSearch(BLIND, OBSERVER)).toBeUndefined();
        expect(
            deckColorsFor(deckColorsForSearch(BLIND, OBSERVER), OBSERVER)
        ).toBeUndefined();
    });

    it("lowers nothing at all when no decklist is supplied", () => {
        expect(deckColorsForSearch(undefined, OBSERVER)).toBeUndefined();
    });
});

describe("determinize — a blinded world carries no decklist knowledge (issue #3533)", () => {
    /** A root already stamped, exactly as `searchWithTrace` hands it over. */
    function stampedRoot(): GameState {
        const state = boardWithLonePlains();
        state.deckColorKnowledge = deckColorsForSearch(INFORMED, OBSERVER);
        return state;
    }

    it("carries the root's stamp into the sampled world", () => {
        const next = determinize(stampedRoot(), OBSERVER, makeRng(1), INFORMED);
        expect(next.deckColorKnowledge).toEqual([
            { playerId: "p2", colors: { B: 20 } },
        ]);
    });

    it("CLEARS it under the ladder's `blind` opponent model, whatever reached it", () => {
        const next = determinize(
            stampedRoot(),
            OBSERVER,
            makeRng(1),
            INFORMED,
            "blind"
        );
        expect(next.deckColorKnowledge).toBeUndefined();
    });

    it("invents nothing on an unstamped root", () => {
        const next = determinize(
            boardWithLonePlains(),
            OBSERVER,
            makeRng(1),
            INFORMED
        );
        expect(next.deckColorKnowledge).toBeUndefined();
    });
});

describe("searchWithTrace — the ROOT carries the stamp, so the trace reports the informed reading (issue #3533)", () => {
    const LABEL =
        "informed colour denial: the decklist, not the board, picks which land dies";

    /** The opponent-seat `colorCoverage` the trace prints for each Stone Rain
     *  target, keyed by the target's name. Read off `CandidateTrace.eval`,
     *  which `buildTrace` derives from the ROOT state — the exact surface
     *  that reported the blind number for an informed decision before the
     *  stamp moved to the root. */
    function coverageByTarget(
        knowledge: DeckKnowledgeBySeat | undefined
    ): Record<string, number> {
        const scenario = findBladeScenario(LABEL)!;
        const state = buildBladeState(scenario);
        const botId = seatPlayerId(state, "me");
        const { trace } = searchWithTrace(
            state,
            botId,
            { iterations: 60 },
            0xb1ade,
            knowledge
        );
        const out: Record<string, number> = {};
        for (const c of trace?.candidates ?? []) {
            const m = /Stone Rain → (\w+)/.exec(c.label);
            if (m) out[m[1]] = c.eval.opp.colorCoverage;
        }
        return out;
    }

    it("informed: the two land targets no longer price the same", () => {
        const scenario = findBladeScenario(LABEL)!;
        const built = buildBladeState(scenario);
        const informed = bladeDeckKnowledge(built, scenario);
        const seen = coverageByTarget(informed);
        // The bot's own Mountains are legal targets too; the two that matter
        // are the opponent's materially identical basics.
        expect(seen).toHaveProperty("Plains");
        expect(seen).toHaveProperty("Swamp");
        expect(seen.Swamp).toBeLessThan(seen.Plains);
    });

    it("blind: the same two targets are indistinguishable, which is what the root stamp fixes", () => {
        const seen = coverageByTarget(undefined);
        expect(seen).toHaveProperty("Plains");
        expect(seen).toHaveProperty("Swamp");
        expect(seen.Swamp).toBe(seen.Plains);
    });
});

describe("the estimate per difficulty — `expert` differs, the rest are byte-identical (issue #3533)", () => {
    /** The position as the SEARCH hands it to `evaluate`: the root, stamped
     *  with whatever `deckColorsForSearch` allows for this difficulty. */
    function rootFor(difficulty: "easy" | "medium" | "hard" | "expert") {
        const state = boardWithLonePlains();
        const knowledge = knowsOpponent(difficulty) ? INFORMED : BLIND;
        state.deckColorKnowledge = deckColorsForSearch(knowledge, OBSERVER);
        return state;
    }

    const blindBaseline = coverageOfEstimatedSeat(boardWithLonePlains());

    it("the blind baseline is the pre-change reading: the lone Plains covers the only colour shown", () => {
        expect(blindBaseline).toBe(1);
    });

    it.each(["easy", "medium", "hard"] as const)(
        "%s reads byte-identically to the blind baseline",
        (difficulty) => {
            expect(DIFFICULTY_KNOWS_OPPONENT[difficulty]).toBe(false);
            const state = rootFor(difficulty);
            expect(state.deckColorKnowledge).toBeUndefined();
            expect(observedOpponentColors(state, "p2")).toEqual({ W: 1 });
            expect(coverageOfEstimatedSeat(state)).toBe(blindBaseline);
        }
    );

    it("expert VISIBLY differs on the same position — twenty units of uncovered {B} demand", () => {
        expect(knowsOpponent("expert")).toBe(true);
        const state = rootFor("expert");
        expect(observedOpponentColors(state, "p2")).toEqual({ W: 1, B: 20 });
        expect(coverageOfEstimatedSeat(state)).toBeCloseTo(1 / 21, 10);
        expect(coverageOfEstimatedSeat(state)).not.toBe(blindBaseline);
    });

    it.each(["easy", "medium", "hard"] as const)(
        "%s leaves the OBSERVER's own seat blind too — the shape that leaks is the bot's own decklist, estimated from the other side",
        (difficulty) => {
            const state = rootFor(difficulty);
            // `materialMargin(state, moverId)` runs `evaluate` from the HUMAN
            // seat's viewpoint too, which makes the bot's own seat the
            // ESTIMATED one. The bot's decklist is supplied at every
            // difficulty, so a gate that asked only "is there a decklist"
            // would sharpen this reading on `hard` and never touch the
            // assertions above.
            expect(observedOpponentColors(state, OBSERVER)).toEqual({});
        }
    );

    it("still no hand read: two informed boards differing ONLY in the estimated seat's hand read identically", () => {
        // Asserted on the STAMPED boards directly, never through
        // `determinize`: determinization replaces that hand, so a test that
        // planted a card and then determinized would be asserting that the
        // sampler works, not that this module refuses to look. The planted
        // card is BLACK — the very colour the decklist evidences — so reading
        // the hand at the battlefield weight would show up as `B: 23`.
        const empty = boardWithLonePlains();
        const withHand = boardWithLonePlains();
        withHand.players[1].hand = [
            makeInstance(scatheZombies.id, {
                id: "secret",
                controllerId: "p2",
                zone: "hand",
            }),
        ];
        const stamp = deckColorsForSearch(INFORMED, OBSERVER);
        empty.deckColorKnowledge = stamp;
        withHand.deckColorKnowledge = stamp;
        expect(observedOpponentColors(withHand, "p2")).toEqual(
            observedOpponentColors(empty, "p2")
        );
        expect(observedOpponentColors(withHand, "p2")).toEqual({
            W: 1,
            B: 20,
        });
    });
});

describe("the wire — the stamp never reaches a viewer (issue #3533)", () => {
    it("projectPublicState strips `deckColorKnowledge` out of its `...state` spread", () => {
        const state = boardWithLonePlains();
        state.deckColorKnowledge = deckColorsForSearch(INFORMED, OBSERVER);
        expect(state.deckColorKnowledge).toBeDefined();
        const projected = projectPublicState(state, 1, OBSERVER);
        expect(
            (projected as { deckColorKnowledge?: unknown }).deckColorKnowledge
        ).toBeUndefined();
    });

    it("projectFullState strips it too — the debug view reveals every ZONE, not a searcher's knowledge", () => {
        const state = boardWithLonePlains();
        state.deckColorKnowledge = deckColorsForSearch(INFORMED, OBSERVER);
        const projected = projectFullState(state, 1);
        expect(
            (projected as { deckColorKnowledge?: unknown }).deckColorKnowledge
        ).toBeUndefined();
    });
});

describe("serialization — the stamp is TRANSIENT and never reaches the row (issue #3533)", () => {
    it("compactState drops `deckColorKnowledge`", () => {
        const state = boardWithLonePlains();
        state.deckColorKnowledge = deckColorsForSearch(INFORMED, OBSERVER);
        expect(state.deckColorKnowledge).toBeDefined();
        const compacted = compactState(state);
        expect(compacted.deckColorKnowledge).toBeUndefined();
        expect(expandState(compacted).deckColorKnowledge).toBeUndefined();
    });
});
