// Plot — the BOT reachability seam (CR 702.170, issue #3219).
//
// Lives apart from `plot.test.ts` because it imports the enumerator
// (`bot-suite-boundary.test.ts` enforces the split). Three questions:
//   1. Can the Bot SEE the special action? `enumerateMoves` offers one `plot`
//      Move per plottable hand card, gated by the same `canPlot` the mutation
//      reads, and `legalActions` classifies it in the priority window.
//   2. Does taking it change the position it evaluates? Both search appliers
//      exile the card as plotted, pay the cost and keep priority.
//   3. Can it cast the plotted card back, only on a later turn, and does a
//      real search over both positions return a move rather than freezing?
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { pillageTheBog } from "../../cards/sets/otj/multicolor.cards";
import {
    enumerateMoves,
    onlyPassIsLegal,
    SPECIAL_ACTION_MOVE_KINDS,
} from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch, search } from "../search";
import { legalActions } from "../legalActions";
import { applyPlot } from "../plot";
import type { CardInstanceState, GameState } from "../state";

const PILLAGE = pillageTheBog().id;
const SWAMP = getCardByName("Swamp").id;
const FOREST = getCardByName("Forest").id;

function own(cardId: string, id: string, zone: CardInstanceState["zone"]) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
}

/** p1's precombat main on `turn`: Pillage the Bog in hand, `lands` untapped
 *  lands, a library to dig into. */
function board(lands = 3, turn = 3): GameState {
    const ids = [SWAMP, FOREST, SWAMP, FOREST];
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [own(PILLAGE, "pillage", "hand")],
                battlefield: ids
                    .slice(0, lands)
                    .map((c, i) => own(c, `land${i}`, "battlefield")),
                library: Array.from({ length: 8 }, (_, i) =>
                    own(FOREST, `lib${i}`, "library")
                ),
            }),
            makePlayer("p2", {
                library: Array.from({ length: 8 }, (_, i) =>
                    makeInstance(SWAMP, {
                        id: `olib${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    })
                ),
            }),
        ],
    });
    state.turn = turn;
    return state;
}

const plotMove = { kind: "plot", cardInstanceId: "pillage" } as const;

describe("plot — the Bot sees the special action (CR 116.2k)", () => {
    it("enumerates one plot Move for the plottable hand card", () => {
        expect(
            enumerateMoves(board(), "p1").filter((m) => m.kind === "plot")
        ).toEqual([plotMove]);
    });

    it("enumerates none when the plot cost is unaffordable", () => {
        expect(
            enumerateMoves(board(2), "p1").filter((m) => m.kind === "plot")
        ).toEqual([]);
    });

    it("is a special action surfaced in the priority window (ADR 0047)", () => {
        expect(SPECIAL_ACTION_MOVE_KINDS.has("plot")).toBe(true);
        expect(
            legalActions(board()).some(
                (a) =>
                    a.expect === "priority" &&
                    a.action.kind === "plot" &&
                    a.playerId === "p1"
            )
        ).toBe(true);
    });
});

describe("plot — the rollout's forced-pass probe sees the plot (issue #4460)", () => {
    it("a plot that is the only alternative to passing is not a forced pass", () => {
        // Djinn of Fool's Fall: {4}{U} to cast, Plot {3}{U} — four Islands
        // pay the plot and not the cast.
        const ISLAND = getCardByName("Island").id;
        const state = board(0);
        const p1 = state.players[0];
        p1.hand = [
            own(getCardByName("Djinn of Fool's Fall").id, "djinn", "hand"),
        ];
        p1.battlefield = [0, 1, 2, 3].map((i) =>
            own(ISLAND, `island${i}`, "battlefield")
        );
        expect(enumerateMoves(state, "p1")).toEqual([
            { kind: "pass" },
            { kind: "plot", cardInstanceId: "djinn" },
        ]);
        expect(onlyPassIsLegal(state, "p1")).toBe(false);
    });
});

describe("plot — the search appliers exile the card as plotted", () => {
    it("greedy sandbox (applyMoveForSearch)", () => {
        const next = applyMoveForSearch(board(), "p1", plotMove);
        const exiled = next.players[0].exile.find((c) => c.id === "pillage");
        expect(exiled?.plotted).toBe(true);
        expect(next.players[0].hand).toHaveLength(0);
        expect(next.stack).toHaveLength(0);
        expect(next.players[0].battlefield.every((l) => l.isTapped)).toBe(true);
    });

    it("ISMCTS tree (applyMoveInSearch) keeps priority with the actor", () => {
        const state = board();
        state.passCount = 1;
        applyMoveInSearch(state, "p1", plotMove);
        expect(
            state.players[0].exile.find((c) => c.id === "pillage")?.plotted
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
        expect(state.passCount).toBe(0);
        expect(state.priorityPlayerId).toBe("p1");
    });
});

describe("plot — the plotted card's cast, and a search over both positions (CR 702.170d)", () => {
    function plottedOn3(turn: number): GameState {
        const state = board(3, 3);
        applyPlot(state, "p1", "pillage");
        state.turn = turn;
        for (const l of state.players[0].battlefield) l.isTapped = false;
        return state;
    }
    const exileCasts = (state: GameState) =>
        enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "pillage"
        );

    it("enumerates NO exile cast on the turn the card was plotted", () => {
        expect(exileCasts(plottedOn3(3))).toEqual([]);
    });

    it("enumerates the free exile cast on a later turn", () => {
        const casts = exileCasts(plottedOn3(5));
        expect(casts.length).toBeGreaterThan(0);
        expect(
            casts.every(
                (m) => m.kind === "cast-spell" && m.castFromZone === "exile"
            )
        ).toBe(true);
    });

    it("a real search returns a move with the plot on offer, and with the plotted card castable", () => {
        expect(search(board(), "p1", { iterations: 60 }, 7)).not.toBeNull();
        expect(
            search(plottedOn3(5), "p1", { iterations: 60 }, 7)
        ).not.toBeNull();
    });
});
