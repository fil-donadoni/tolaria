// Foretell — the BOT reachability seam (CR 702.143, issue #2096).
//
// Lives apart from `foretell.test.ts` because it imports the enumerator
// (`bot-suite-boundary.test.ts` enforces the split). Four questions:
//   1. Can the Bot SEE the special action? `enumerateMoves` offers one
//      `foretell` Move per foretellable hand card, gated by the same
//      `canForetell` the mutation reads, in any priority of its own turn.
//   2. Does taking it change the position it evaluates? Both search appliers
//      exile the card face down as foretold, tap the {2} and keep priority.
//   3. Can it cast the foretold card back — on a later turn, an instant in the
//      opponent's turn too?
//   4. Does it WANT to? The foretold card stays latent material in
//      `evaluate`'s hand term, and with spare mana the search takes the
//      foretell (the `free-development` tie-break) — but not when the {2} is
//      holding a castable instant open.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import {
    enumerateMoves,
    onlyPassIsLegal,
    SPECIAL_ACTION_MOVE_KINDS,
} from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch, search } from "../search";
import { evaluateBreakdown } from "../evaluate";
import { legalActions } from "../legalActions";
import { applyForetell } from "../foretell";
import type { CardInstanceState, GameState } from "../state";

const BEHOLD = getCardByName("Behold the Multiverse").id;
const COUNTERSPELL = getCardByName("Counterspell").id;
const ISLAND = getCardByName("Island").id;

function own(
    cardId: string,
    id: string,
    zone: CardInstanceState["zone"],
    owner = "p1"
) {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
}

/** p1's `phase` on turn 3: Behold the Multiverse (+ `extra` cards) in hand,
 *  `lands` untapped Islands, libraries to draw from. */
function board(
    opts: { lands?: number; phase?: GameState["phase"]; extra?: string[] } = {}
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    own(BEHOLD, "omen", "hand"),
                    ...(opts.extra ?? []).map((c, i) =>
                        own(c, `extra${i}`, "hand")
                    ),
                ],
                battlefield: Array.from({ length: opts.lands ?? 2 }, (_, i) =>
                    own(ISLAND, `land${i}`, "battlefield")
                ),
                library: Array.from({ length: 8 }, (_, i) =>
                    own(ISLAND, `lib${i}`, "library")
                ),
            }),
            makePlayer("p2", {
                library: Array.from({ length: 8 }, (_, i) =>
                    own(ISLAND, `olib${i}`, "library", "p2")
                ),
            }),
        ],
    });
    state.turn = 3;
    if (opts.phase) state.phase = opts.phase;
    return state;
}

const foretellMove = { kind: "foretell", cardInstanceId: "omen" } as const;
const foretells = (state: GameState) =>
    enumerateMoves(state, "p1").filter((m) => m.kind === "foretell");

describe("foretell — the Bot sees the special action (CR 116.2h)", () => {
    it("enumerates one foretell Move in its main phase, and outside it", () => {
        expect(foretells(board())).toEqual([foretellMove]);
        expect(foretells(board({ phase: "END_STEP" }))).toEqual([foretellMove]);
    });

    it("enumerates none with {2} unaffordable, or in the opponent's turn", () => {
        expect(foretells(board({ lands: 1 }))).toEqual([]);
        const theirs = board();
        theirs.activePlayerId = "p2";
        expect(foretells(theirs)).toEqual([]);
    });

    it("is a special action surfaced in the priority window (ADR 0047)", () => {
        expect(SPECIAL_ACTION_MOVE_KINDS.has("foretell")).toBe(true);
        expect(
            legalActions(board()).some(
                (a) =>
                    a.expect === "priority" &&
                    a.action.kind === "foretell" &&
                    a.playerId === "p1"
            )
        ).toBe(true);
    });

    it("a foretell that is the only alternative to passing is not a forced pass", () => {
        expect(enumerateMoves(board(), "p1")).toEqual([
            { kind: "pass" },
            foretellMove,
        ]);
        expect(onlyPassIsLegal(board(), "p1")).toBe(false);
    });
});

describe("foretell — the search appliers exile the card face down as foretold", () => {
    it("greedy sandbox (applyMoveForSearch)", () => {
        const next = applyMoveForSearch(board(), "p1", foretellMove);
        const exiled = next.players[0].exile.find((c) => c.id === "omen");
        expect(exiled).toMatchObject({ foretold: true, knownTo: ["p1"] });
        expect(next.players[0].hand).toHaveLength(0);
        expect(next.stack).toHaveLength(0);
        expect(next.players[0].battlefield.every((l) => l.isTapped)).toBe(true);
    });

    it("ISMCTS tree (applyMoveInSearch) keeps priority with the actor", () => {
        const state = board();
        state.passCount = 1;
        applyMoveInSearch(state, "p1", foretellMove);
        expect(
            state.players[0].exile.find((c) => c.id === "omen")?.foretold
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
        expect(state.passCount).toBe(0);
        expect(state.priorityPlayerId).toBe("p1");
    });
});

describe("foretell — the foretold card's cast (CR 702.143a)", () => {
    function foretoldOn3(turn: number, theirTurn = false): GameState {
        const state = board();
        applyForetell(state, "p1", "omen");
        state.turn = turn;
        for (const l of state.players[0].battlefield) l.isTapped = false;
        if (theirTurn) state.activePlayerId = "p2";
        return state;
    }
    const exileCasts = (state: GameState) =>
        enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "omen" &&
                m.castFromZone === "exile"
        );

    it("enumerates NO exile cast on the turn the card was foretold", () => {
        expect(exileCasts(foretoldOn3(3))).toEqual([]);
    });

    it("enumerates the {1}{U} exile cast on a later turn — the opponent's included, for an instant", () => {
        expect(exileCasts(foretoldOn3(5)).length).toBeGreaterThan(0);
        expect(exileCasts(foretoldOn3(4, true)).length).toBeGreaterThan(0);
    });
});

describe("foretell — the Bot wants to foretell with spare mana (issue #2096)", () => {
    it("the foretold card stays latent material: the hand term does not drop", () => {
        const before = evaluateBreakdown(board(), "p1").self.hand;
        const after = evaluateBreakdown(
            applyMoveForSearch(board(), "p1", foretellMove),
            "p1"
        ).self.hand;
        expect(after).toBe(before);
    });

    it.each([1, 2, 3])(
        "with nothing else to spend {2} on, the search foretells (seed %i)",
        (seed) => {
            expect(
                search(
                    board({ phase: "POSTCOMBAT_MAIN" }),
                    "p1",
                    {
                        iterations: 200,
                    },
                    seed
                )
            ).toEqual(foretellMove);
        }
    );

    it.each([1, 2, 3])(
        "in its upkeep the tie is left to a later window of the turn (seed %i)",
        (seed) => {
            expect(
                search(
                    board({ phase: "UPKEEP" }),
                    "p1",
                    { iterations: 200 },
                    seed
                )
            ).toEqual({ kind: "pass" });
        }
    );

    it.each([1, 2, 3])(
        "with a castable Counterspell held on that {2}, it does NOT foretell (seed %i)",
        (seed) => {
            expect(
                search(
                    board({ phase: "POSTCOMBAT_MAIN", extra: [COUNTERSPELL] }),
                    "p1",
                    { iterations: 200 },
                    seed
                )
            ).toEqual({ kind: "pass" });
        }
    );
});
