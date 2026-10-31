// Plot (CR 702.170, issue #3219) — the special action and the plotted
// designation, across every surface they cross:
//   - GRE unit: the special action's window (702.170a / 116.2k) and cost, the
//     plotted record it stamps (702.170c/d), the cast window that record opens
//     (a LATER turn, the owner's main phase, an empty stack — even for an
//     instant), and its independence from the plot ability (702.170d).
//   - Integration: the `plotCard` and `announceCast` mutations, driven through
//     their own handlers — plot on one turn, cast for free on a later one.
//   - Wire format: the hand card's `canPlot`, and the plotted card in exile as
//     both players see it (face up, CR 406.3) through `projectPublicState`.
//   - Serialization: the designation and its riders survive the DB round-trip.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { pillageTheBog } from "../../cards/sets/otj/multicolor.cards";
import { announceCast, plotCard } from "../../game";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { applyPlot, becomePlotted, canPlot, plottableHandCards } from "../plot";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import { getPlayer, type CardInstanceState, type GameState } from "../state";

const PILLAGE = pillageTheBog().id;
const SWAMP = getCardByName("Swamp").id;
const FOREST = getCardByName("Forest").id;
const BOLT = getCardByName("Lightning Bolt").id;

function land(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
}

/** p1, in their precombat main with priority and an empty stack, holds Pillage
 *  the Bog and controls `lands` untapped lands (Swamp, Forest, then Swamps). */
function plotBoard(lands = 3, turn = 3): GameState {
    const ids = [SWAMP, FOREST, SWAMP, SWAMP, SWAMP];
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(PILLAGE, {
                        id: "pillage",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: ids
                    .slice(0, lands)
                    .map((c, i) => land(c, `land${i}`)),
            }),
            makePlayer("p2"),
        ],
    });
    state.turn = turn;
    return state;
}

const p1 = (state: GameState) => getPlayer(state, "p1");
const pillageIn = (state: GameState) =>
    [...p1(state).hand, ...p1(state).exile].find((c) => c.id === "pillage")!;

/** Whether the owner's client is offered the plotted card's cast — through
 *  the REAL reducer (`projectPublicState`), whose exile `legalActions` is what
 *  the Cast button gates on: the permission (`exileCastPermitted`, with its
 *  lower turn bound) and then the cast gate (`getLegalActions`). */
function castOffered(state: GameState, id = "pillage"): boolean {
    const card = projectPublicState(state, 1, "p1").players[0].exile.find(
        (c) => c.id === id
    );
    return card?.legalActions?.includes("cast") ?? false;
}

/** A board where Pillage was plotted on turn 3 and play has moved on to
 *  `turn`, p1 active in their precombat main with priority. */
function plottedOnTurn3(turn: number): GameState {
    const state = plotBoard();
    applyPlot(state, "p1", "pillage");
    state.turn = turn;
    for (const l of p1(state).battlefield) l.isTapped = false;
    return state;
}

describe("Plot — the special action's window (CR 702.170a, CR 116.2k)", () => {
    it("is offered in your main phase with an empty stack, priority and the cost affordable", () => {
        const state = plotBoard();
        expect(canPlot(state, p1(state), pillageIn(state))).toBe(true);
        expect(plottableHandCards(state, p1(state)).map((c) => c.id)).toEqual([
            "pillage",
        ]);
    });

    it("is refused while the stack is not empty", () => {
        const state = plotBoard();
        state.stack.push({
            ...makeInstance(BOLT, { id: "bolt", zone: "stack" }),
            castById: "p2",
        });
        expect(canPlot(state, p1(state), pillageIn(state))).toBe(false);
    });

    it("is refused outside a main phase and on the opponent's turn", () => {
        const combat = plotBoard();
        combat.phase = "BEGINNING_OF_COMBAT";
        expect(canPlot(combat, p1(combat), pillageIn(combat))).toBe(false);

        const theirs = plotBoard();
        theirs.activePlayerId = "p2";
        expect(canPlot(theirs, p1(theirs), pillageIn(theirs))).toBe(false);
    });

    it("is refused when the plot cost {1}{B}{G} cannot be paid", () => {
        // Two lands pay the {B}{G} mana cost, not the three-mana plot cost.
        const state = plotBoard(2);
        expect(canPlot(state, p1(state), pillageIn(state))).toBe(false);
        expect(() => applyPlot(state, "p1", "pillage")).toThrow();
    });

    it("is never offered for a card without plot", () => {
        const state = plotBoard();
        const bolt = makeInstance(BOLT, {
            id: "bolt",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        p1(state).hand.push(bolt);
        expect(canPlot(state, p1(state), bolt)).toBe(false);
    });
});

describe("Plot — taking the action (CR 702.170a/b)", () => {
    it("pays the plot cost, exiles the card face up as plotted, and keeps priority", () => {
        const state = plotBoard();
        state.passCount = 1;
        applyPlot(state, "p1", "pillage");

        expect(p1(state).hand).toHaveLength(0);
        const exiled = p1(state).exile.find((c) => c.id === "pillage")!;
        expect(exiled.zone).toBe("exile");
        expect(exiled.plotted).toBe(true);
        // CR 406.3 — a plotted card is exiled face up.
        expect(exiled.faceDown).toBeUndefined();
        // {1}{B}{G} — all three lands tapped, nothing left floating.
        expect(p1(state).battlefield.every((l) => l.isTapped)).toBe(true);
        expect(Object.values(p1(state).manaPool).every((n) => !n)).toBe(true);
        // CR 702.170b — the plot action uses no stack: passes reset and
        // priority stays with the player who took the action (CR 116).
        expect(state.stack).toHaveLength(0);
        expect(state.passCount).toBe(0);
        expect(state.priorityPlayerId).toBe("p1");
    });
});

describe("Plot — the plotted card's cast window (CR 702.170d)", () => {
    it("is CLOSED during the turn the card became plotted", () => {
        expect(castOffered(plottedOnTurn3(3))).toBe(false);
    });

    it("is OPEN on a later turn of the owner, in their main phase with an empty stack", () => {
        expect(castOffered(plottedOnTurn3(5))).toBe(true);
    });

    it("is CLOSED outside the owner's main phase, and while the stack is not empty", () => {
        const theirs = plottedOnTurn3(4);
        theirs.activePlayerId = "p2";
        expect(castOffered(theirs)).toBe(false);

        const upkeep = plottedOnTurn3(5);
        upkeep.phase = "UPKEEP";
        expect(castOffered(upkeep)).toBe(false);

        const busy = plottedOnTurn3(5);
        busy.stack.push({
            ...makeInstance(BOLT, { id: "bolt", zone: "stack" }),
            castById: "p2",
        });
        expect(castOffered(busy)).toBe(false);
    });

    it("costs nothing: castable on a later turn with every land tapped", () => {
        const state = plottedOnTurn3(5);
        for (const l of p1(state).battlefield) l.isTapped = true;
        expect(castOffered(state)).toBe(true);
    });

    it("a plotted INSTANT without the plot ability is still sorcery-timed (CR 702.170c/d)", () => {
        // "Some spells and abilities cause a card in exile to become plotted",
        // and "may be cast this way even if it doesn't have the plot ability".
        const state = makeState({
            players: [
                makePlayer("p1", {
                    exile: [
                        makeInstance(BOLT, {
                            id: "bolt",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "exile",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        state.turn = 2;
        const bolt = p1(state).exile[0];
        becomePlotted(state, bolt);
        state.turn = 3;
        const offered = () => castOffered(state, "bolt");
        expect(offered()).toBe(true);
        // An instant with priority on the opponent's turn: not this way.
        state.activePlayerId = "p2";
        expect(offered()).toBe(false);
    });
});

type CardArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const run = (
    harness: ReturnType<typeof makeMutationCtx>,
    handler: unknown,
    cardInstanceId: string
) =>
    runMutation<CardArgs, void>(
        handler as Handler<CardArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId,
        }
    );

describe("Plot — full path through the mutations (CR 702.170a/d)", () => {
    it("plots on one turn, refuses the cast that turn, and casts it for free on a later one", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(plotBoard())]);
        await run(harness, plotCard, "pillage");

        const plotted = harness.state();
        expect(p1(plotted).exile.map((c) => c.id)).toEqual(["pillage"]);
        expect(p1(plotted).battlefield.every((l) => l.isTapped)).toBe(true);

        // Same turn: the plotted card is not castable (702.170d "after").
        await expect(run(harness, announceCast, "pillage")).rejects.toThrow();

        // Two turns on, every land still tapped: the free cast commits.
        const later = harness.state();
        later.turn = 5;
        const next = makeMutationCtx("p1", [gameStateSeed(later, 2)]);
        await run(next, announceCast, "pillage");
        const cast = next.state();
        expect(cast.pendingCast).toBeUndefined();
        expect(cast.stack.map((s) => s.id)).toEqual(["pillage"]);
        expect(p1(cast).exile).toHaveLength(0);
        // The designation does not ride the spell (CR 400.7).
        expect(cast.stack[0].plotted).toBeUndefined();
        expect(cast.stack[0].castableFromExileSorceryTiming).toBeUndefined();
    });
});

describe("Plot — wire format (CR 406.3)", () => {
    it("the hand card carries canPlot for its owner only while plotting is legal", () => {
        const state = plotBoard();
        const hand = projectPublicState(state, 1, "p1").players[0].hand;
        expect(hand[0]).toMatchObject({ id: "pillage", canPlot: true });

        const short = plotBoard(2);
        const shortHand = projectPublicState(short, 1, "p1").players[0].hand;
        expect(shortHand[0]?.canPlot).toBeUndefined();
    });

    it("the plotted card is public in exile and castable through the projection on a later turn", () => {
        const sameTurn = plottedOnTurn3(3);
        const theirView = projectPublicState(sameTurn, 1, "p2").players[0]
            .exile[0];
        // Face up: the opponent sees the real card and the designation.
        expect(theirView.card.id).toBe(PILLAGE);
        expect(theirView.plotted).toBe(true);

        const ownSame = projectPublicState(sameTurn, 1, "p1").players[0]
            .exile[0];
        expect(ownSame.legalActions ?? []).not.toContain("cast");
        const ownLater = projectPublicState(plottedOnTurn3(5), 1, "p1")
            .players[0].exile[0];
        expect(ownLater.legalActions).toContain("cast");
    });
});

describe("Plot — serialization", () => {
    it("round-trips the designation and every rider of its permission", () => {
        const state = plottedOnTurn3(3);
        const back = expandState(compactState(state));
        const exiled = p1(back).exile[0];
        expect(exiled).toMatchObject({
            plotted: true,
            castableFromExileBy: "p1",
            castableFromExileFromTurn: 4,
            castFromExileWithoutPayingManaCost: true,
            castableFromExileSorceryTiming: true,
        });
    });
});
