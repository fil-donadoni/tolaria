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
//   - Serialization: the designation survives the DB round-trip.
//   - Coexistence: the plotted permission beside another exile grant, each with
//     its own cost and timing (issue #7586).
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
import {
    castRawManaCost,
    exileCastPermitted,
    exileGrantPermitted,
} from "../castCost";
import { finalizeCleanup } from "../phases";
import { resolvePlayLandSourceZone } from "../playLand";
import { getLegalActions } from "../rules";
import {
    buildSpellContext,
    getCostModifiers,
    getPlayer,
    type CardInstanceState,
    type GameState,
} from "../state";
import type { SpellContext } from "../../cards/types";

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
        expect(exiled.plottedOnTurn).toBe(3);
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
        expect(cast.stack[0].plottedOnTurn).toBeUndefined();
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
        expect(theirView.plottedOnTurn).toBe(3);

        const ownSame = projectPublicState(sameTurn, 1, "p1").players[0]
            .exile[0];
        expect(ownSame.legalActions ?? []).not.toContain("cast");
        const ownLater = projectPublicState(plottedOnTurn3(5), 1, "p1")
            .players[0].exile[0];
        expect(ownLater.legalActions).toContain("cast");
    });
});

describe("Plot — serialization", () => {
    it("round-trips the designation its permission is derived from", () => {
        const state = plottedOnTurn3(3);
        const back = expandState(compactState(state));
        const exiled = p1(back).exile[0];
        expect(exiled.plottedOnTurn).toBe(3);
        expect(castOffered(back)).toBe(false);
        back.turn = 5;
        expect(castOffered(back)).toBe(true);
    });
});

const MOUNTAIN = getCardByName("Mountain").id;

/** p1, in their precombat main on turn 2 with priority, holds Lightning Bolt in
 *  exile and one untapped Mountain. */
function exiledBoltBoard(): GameState {
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
                battlefield: [land(MOUNTAIN, "mountain")],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(MOUNTAIN, {
                        id: "their-mountain",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
    });
    state.turn = 2;
    return state;
}

const exiledBolt = (state: GameState) => p1(state).exile[0];

/** A real `grantCastFromExile`, as an effect resolving under `grantee` makes it. */
function grant(
    state: GameState,
    grantee: string,
    window?: Parameters<SpellContext["grantCastFromExile"]>[3],
    opts?: Parameters<SpellContext["grantCastFromExile"]>[4]
): void {
    const source = {
        ...makeInstance(BOLT, { id: "source", zone: "stack" }),
        castById: grantee,
    };
    buildSpellContext(state, source).grantCastFromExile(
        "bolt",
        grantee,
        "p1",
        window,
        opts
    );
}

function setMountainTapped(state: GameState, tapped: boolean): void {
    for (const l of p1(state).battlefield) l.isTapped = tapped;
}

describe("Plot — the plotted permission coexists with another exile grant (CR 702.170d, CR 601.3)", () => {
    describe("scenario A: a card holding a grant becomes plotted", () => {
        it("keeps the grant whole, every rider included", () => {
            const state = exiledBoltBoard();
            grant(state, "p1", undefined, { costIncrease: { generic: 2 } });
            const before = structuredClone(exiledBolt(state));

            becomePlotted(state, exiledBolt(state));

            expect(exiledBolt(state)).toEqual({
                ...before,
                plottedOnTurn: 2,
            });
        });

        it("the grant still licenses the cast, at its own price, on the turn the plot window is closed", () => {
            const state = exiledBoltBoard();
            grant(state, "p1");
            becomePlotted(state, exiledBolt(state));

            expect(castOffered(state, "bolt")).toBe(true);
            expect(castRawManaCost(state, exiledBolt(state), "exile")).toEqual(
                getCardByName("Lightning Bolt").manaCost
            );
            setMountainTapped(state, true);
            expect(castOffered(state, "bolt")).toBe(false);
        });
    });

    describe("scenario B: a plotted card receives a grant", () => {
        it("keeps its permission once the grant has expired", () => {
            const state = exiledBoltBoard();
            becomePlotted(state, exiledBolt(state));
            state.turn = 3;
            grant(state, "p1", "this-turn");

            finalizeCleanup(state);

            state.turn = 4;
            state.phase = "PRECOMBAT_MAIN";
            state.activePlayerId = "p1";
            state.priorityPlayerId = "p1";
            expect(exiledBolt(state).castableFromExileBy).toBeUndefined();
            setMountainTapped(state, true);
            expect(castOffered(state, "bolt")).toBe(true);
        });

        it("is free in the plot window: the grant's tax and price do not apply to that cast", () => {
            const state = exiledBoltBoard();
            becomePlotted(state, exiledBolt(state));
            grant(state, "p1", undefined, { costIncrease: { generic: 2 } });
            state.turn = 3;
            setMountainTapped(state, true);

            expect(castRawManaCost(state, exiledBolt(state), "exile")).toEqual(
                {}
            );
            expect(
                getCostModifiers(
                    state,
                    exiledBolt(state),
                    "spell",
                    undefined,
                    "p1"
                ).increase
            ).toEqual({});
            expect(castOffered(state, "bolt")).toBe(true);
        });

        it("outside the plot window the grant's own cost and timing carry the cast", () => {
            const state = exiledBoltBoard();
            becomePlotted(state, exiledBolt(state));
            grant(state, "p1");
            state.turn = 3;
            // An instant, with priority on the opponent's turn: the grant's
            // timing allows it, CR 702.170d's does not.
            state.activePlayerId = "p2";

            expect(castRawManaCost(state, exiledBolt(state), "exile")).toEqual(
                getCardByName("Lightning Bolt").manaCost
            );
            expect(castOffered(state, "bolt")).toBe(true);
            setMountainTapped(state, true);
            expect(castOffered(state, "bolt")).toBe(false);
        });

        it("the grant's board condition never closes the plotted permission", () => {
            const state = exiledBoltBoard();
            becomePlotted(state, exiledBolt(state));
            grant(state, "p1");
            // "If it's not your turn": false on the owner's own.
            exiledBolt(state).castableFromExileCondition = {
                kind: "not-your-turn",
            };
            state.turn = 3;

            expect(exileCastPermitted(state, exiledBolt(state), "p1")).toBe(
                true
            );
            expect(exileGrantPermitted(state, exiledBolt(state), "p1")).toBe(
                false
            );
        });
    });

    it("a cross-player grant is the grantee's, at its own price, while the owner's plot stays free", () => {
        const state = exiledBoltBoard();
        becomePlotted(state, exiledBolt(state));
        grant(state, "p2");
        state.turn = 3;
        const price = () => castRawManaCost(state, exiledBolt(state), "exile");
        expect(price()).toEqual({});

        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        expect(price()).toEqual(getCardByName("Lightning Bolt").manaCost);
        for (const l of getPlayer(state, "p2").battlefield) l.isTapped = false;
        const seen = projectPublicState(state, 1, "p2").players[0].exile[0];
        expect(seen.legalActions).toContain("cast");
    });

    it("a cross-player grant's tax is owed by its grantee, announcer named or not", () => {
        const state = exiledBoltBoard();
        becomePlotted(state, exiledBolt(state));
        grant(state, "p2", undefined, { costIncrease: { generic: 2 } });
        state.turn = 3;
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        // Normalized: generic mana is keyed `X` once folded.
        const tax = { X: 2 };

        expect(
            getCostModifiers(state, exiledBolt(state), "spell", undefined, "p2")
                .increase
        ).toEqual(tax);
        expect(
            getCostModifiers(state, exiledBolt(state), "spell").increase
        ).toEqual(tax);
    });

    it("the owner's Cast button is offered through a grant held by the other player", () => {
        const state = exiledBoltBoard();
        becomePlotted(state, exiledBolt(state));
        grant(state, "p2");
        state.turn = 3;
        setMountainTapped(state, true);
        expect(castOffered(state, "bolt")).toBe(true);
    });

    it("the permission is to CAST: a plotted land is not played under a grant that is closed (CR 116.2a)", () => {
        const state = exiledBoltBoard();
        const forest = makeInstance(FOREST, {
            id: "exiled-forest",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        p1(state).exile.push(forest);
        becomePlotted(state, forest);
        forest.castableFromExileBy = "p1";
        forest.castableFromExileIncludesLand = true;
        forest.castableFromExileFromTurn = 9;
        state.turn = 3;

        expect(
            resolvePlayLandSourceZone(state, p1(state), forest.id)
        ).toBeNull();
        expect(getLegalActions(state, p1(state), forest, false)).not.toContain(
            "play"
        );
        state.turn = 9;
        expect(resolvePlayLandSourceZone(state, p1(state), forest.id)).toBe(
            "exile"
        );
    });

    it("full path: plot, a later grant, then `announceCast` on a later turn for free", async () => {
        const seeded = plottedOnTurn3(5);
        const pillage = p1(seeded).exile[0];
        pillage.castableFromExileBy = "p1";
        pillage.castFromExileCostIncrease = { generic: 2 };
        setMountainTapped(seeded, true);
        const harness = makeMutationCtx("p1", [gameStateSeed(seeded)]);
        await run(harness, announceCast, "pillage");
        const cast = harness.state();
        expect(cast.stack.map((s) => s.id)).toEqual(["pillage"]);
        expect(p1(cast).exile).toHaveLength(0);
    });
});
