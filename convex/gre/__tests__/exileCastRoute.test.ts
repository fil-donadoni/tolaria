// Exile cast routes (CR 601.3, CR 601.2b): a card's own designation (plotted,
// foretold, warped) derives a permission that stands beside the grant record,
// and the caster announces which of the two the cast is made under.
//   - GRE: `exileCastRoutes`, the price, the grant's riders.
//   - Integration: `announceCast` and `cancelCast`, through their own handlers.
//   - Wire format: `exileCastRouteChoice` through `projectPublicState`.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, getDefinition } from "../../cards";
import { adventureCastAltCostId, adventureCastOptionFor } from "../adventure";
import { announceCast, cancelCast } from "../../game";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { projectPublicState } from "../../gameProjections";
import {
    castAlternativeCostForZone,
    castRawManaCost,
    exileCastOpensOnTurn,
    exileCastPermitted,
    exileCastRoutes,
} from "../castCost";
import { makeForetold } from "../foretell";
import { finalizeCleanup } from "../phases";
import { getLegalActions } from "../rules";
import { specFromState } from "../scenarioBuilder";
import { compactState, expandState } from "../serialize";
import {
    getCostModifiers,
    getPlayer,
    type CardInstanceState,
    type GameState,
} from "../state";

const HYDRA = getCardByName("Rock Hydra").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BORROWER = getCardByName("Brazen Borrower").id;
const OMEN = getCardByName("Behold the Multiverse").id;
const ISLAND = getCardByName("Island").id;

/** p1 in their precombat main on turn 5, priority, empty stack; `cardId` in
 *  their exile, `lands` untapped basics. */
function board(cardId: string, landId: string, lands: number): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                exile: [
                    makeInstance(cardId, {
                        id: "subject",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "exile",
                    }),
                ],
                battlefield: Array.from({ length: lands }, (_, i) =>
                    makeInstance(landId, {
                        id: `land${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    state.turn = 5;
    state.phase = "PRECOMBAT_MAIN";
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    return state;
}

const subject = (state: GameState): CardInstanceState =>
    getPlayer(state, "p1").exile.find((c) => c.id === "subject")!;

function plottedHydraWithGrant(lands = 4): GameState {
    const state = board(HYDRA, MOUNTAIN, lands);
    subject(state).plottedOnTurn = 3;
    subject(state).castableFromExileBy = "p1";
    return state;
}

type CastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    chosenX?: number;
    declineManaCostReplacement?: boolean;
    alternativeCostId?: string;
};

const cast = (
    harness: ReturnType<typeof makeMutationCtx>,
    args: Partial<CastArgs> = {}
) =>
    runMutation<CastArgs, void>(
        announceCast as unknown as Handler<CastArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId: "subject",
            ...args,
        }
    );

describe("a plotted {X} spell that also holds a grant (CR 601.3, 601.2b, 107.3b)", () => {
    it("offers both routes in the sorcery window: free first, then the grant", () => {
        const state = plottedHydraWithGrant();
        expect(exileCastRoutes(state, subject(state), "p1")).toEqual([
            "plot",
            "grant",
        ]);
        expect(
            castRawManaCost(state, subject(state), "exile", undefined, true)
        ).toEqual(getDefinition(HYDRA).manaCost);
        expect(castRawManaCost(state, subject(state), "exile")).toEqual({});
    });

    it("declined on the wire, the cast pays X under the grant", async () => {
        const state = plottedHydraWithGrant(0);
        getPlayer(state, "p1").manaPool.R = 4;
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await cast(harness, { chosenX: 2, declineManaCostReplacement: true });
        const after = harness.state();
        expect(after.stack.map((s) => s.id)).toEqual(["subject"]);
        expect(after.stack[0].chosenX).toBe(2);
        expect(after.stack[0].castDeclinedExileRoute).toBeUndefined();
        expect(getPlayer(after, "p1").manaPool.R ?? 0).toBe(0);
    });

    it("undeclined, the only legal choice for X is 0 (CR 107.3b)", async () => {
        const refused = makeMutationCtx("p1", [
            gameStateSeed(plottedHydraWithGrant()),
        ]);
        await expect(cast(refused, { chosenX: 2 })).rejects.toThrow(
            "only legal choice for X is 0"
        );
        const free = makeMutationCtx("p1", [
            gameStateSeed(plottedHydraWithGrant()),
        ]);
        await cast(free);
        const after = free.state();
        expect(after.stack.map((s) => s.id)).toEqual(["subject"]);
        expect(after.stack[0].chosenX ?? 0).toBe(0);
        expect(getPlayer(after, "p1").battlefield.some((l) => l.isTapped)).toBe(
            false
        );
    });

    it("the same lock binds a plotted {X} spell alone, whose cost includes no X", async () => {
        const state = board(HYDRA, MOUNTAIN, 4);
        subject(state).plottedOnTurn = 3;
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(cast(harness, { chosenX: 2 })).rejects.toThrow(
            "only legal choice for X is 0"
        );
    });

    it("refuses a decline where only one route exists", async () => {
        const state = board(HYDRA, MOUNTAIN, 4);
        subject(state).plottedOnTurn = 3;
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            cast(harness, { chosenX: 1, declineManaCostReplacement: true })
        ).rejects.toThrow("No other permission");
    });

    it("the declined route owes the grant's tax; the free one does not", () => {
        const state = plottedHydraWithGrant();
        subject(state).castFromExileCostIncrease = { X: 2 };
        expect(
            getCostModifiers(state, subject(state), "spell", undefined, "p1")
                .increase
        ).toEqual({});
        subject(state).castDeclinedExileRoute = true;
        expect(
            getCostModifiers(state, subject(state), "spell", undefined, "p1")
                .increase
        ).toEqual({ X: 2 });
    });

    it("abandoning the declined cast restores the choice", async () => {
        // The lands are untapped: the cast parks for payment.
        const harness = makeMutationCtx("p1", [
            gameStateSeed(plottedHydraWithGrant(3)),
        ]);
        await cast(harness, { chosenX: 2, declineManaCostReplacement: true });
        expect(harness.state().pendingCast?.cardInstanceId).toBe("subject");
        expect(subject(harness.state()).castDeclinedExileRoute).toBe(true);
        await runMutation<{ gameId: Id<"games">; playerId: string }, void>(
            cancelCast as unknown as Handler<
                { gameId: Id<"games">; playerId: string },
                void
            >,
            harness.ctx,
            { gameId: "game-1" as Id<"games">, playerId: "p1" }
        );
        const after = harness.state();
        expect(subject(after).castDeclinedExileRoute).toBeUndefined();
        expect(exileCastRoutes(after, subject(after), "p1")).toEqual([
            "plot",
            "grant",
        ]);
    });

    it("the wire tells the picker both routes and which locks X", () => {
        const projected = projectPublicState(plottedHydraWithGrant(), 1, "p1")
            .players[0].exile[0];
        expect(projected.exileCastRouteChoice).toEqual({
            price: "free",
            xLocked: true,
            declined: { price: "printed", xLocked: false },
        });
        const opponent = projectPublicState(plottedHydraWithGrant(), 1, "p2")
            .players[0].exile[0];
        expect(opponent.exileCastRouteChoice).toBeUndefined();
    });

    it("outside the sorcery window the grant is the only route", () => {
        const state = plottedHydraWithGrant();
        state.activePlayerId = "p2";
        expect(exileCastRoutes(state, subject(state), "p1")).toEqual(["grant"]);
    });
});

describe("Foretell keeps its permission beside a grant (CR 702.143a/d)", () => {
    function foretoldOmen(): GameState {
        const state = board(OMEN, ISLAND, 4);
        state.turn = 3;
        makeForetold(state, subject(state));
        state.turn = 5;
        return state;
    }

    it("becoming foretold never deletes a grant or any of its riders", () => {
        const state = board(OMEN, ISLAND, 4);
        const card = subject(state);
        card.castableFromExileBy = "p2";
        card.castableFromExileUntilTurn = 9;
        card.castFromExileCostIncrease = { generic: 1 };
        card.castFromExileNotAsAdventure = true;
        const before = structuredClone(card);

        makeForetold(state, card);

        expect(card).toEqual({
            ...before,
            foretold: true,
            foretoldOnTurn: state.turn,
        });
    });

    it("a grant on a foretold card leaves the foretell cast, opening the turn after", () => {
        const state = foretoldOmen();
        subject(state).castableFromExileBy = "p1";
        expect(exileCastRoutes(state, subject(state), "p1")).toEqual([
            "foretell",
            "grant",
        ]);
        expect(castRawManaCost(state, subject(state), "exile")).toEqual(
            getDefinition(OMEN).foretell
        );
        expect(
            castRawManaCost(state, subject(state), "exile", undefined, true)
        ).toEqual(getDefinition(OMEN).manaCost);
        delete subject(state).castableFromExileBy;
        expect(exileCastOpensOnTurn(subject(state), "p1", 3)).toBe(4);
    });

    it("a grant held by the opponent is theirs, at its own price, while the owner keeps foretell", () => {
        const state = foretoldOmen();
        subject(state).castableFromExileBy = "p2";
        expect(exileCastRoutes(state, subject(state), "p1")).toEqual([
            "foretell",
        ]);
        expect(exileCastRoutes(state, subject(state), "p2")).toEqual(["grant"]);
    });

    it("an unaffordable foretell cost leaves the grant's printed cast legal", () => {
        const state = foretoldOmen();
        const card = subject(state);
        card.castableFromExileBy = "p1";
        const owner = getPlayer(state, "p1");
        // A foretell cost dearer than the four Islands; the printed {3}{U} fits.
        card.grantedForetellCost = { X: 9, U: 1 };
        expect(getLegalActions(state, owner, card)).toContain("cast");
    });

    it("an expired grant leaves the foretell permission", () => {
        const state = foretoldOmen();
        subject(state).castableFromExileBy = "p1";
        subject(state).castableFromExileUntilTurn = state.turn;
        finalizeCleanup(state);
        expect(subject(state).castableFromExileBy).toBeUndefined();
        expect(exileCastPermitted(state, subject(state), "p1")).toBe(true);
    });

    it("a foretold card with no foretell cost holds no permission (CR 702.143d)", () => {
        const state = board(HYDRA, MOUNTAIN, 4);
        makeForetold(state, subject(state));
        state.turn += 1;
        expect(subject(state).foretold).toBe(true);
        expect(exileCastPermitted(state, subject(state), "p1")).toBe(false);
    });

    it("the permission survives the DB round-trip", () => {
        const back = expandState(compactState(foretoldOmen()));
        expect(exileCastRoutes(back, subject(back), "p1")).toEqual([
            "foretell",
        ]);
    });
});

describe("Warp keeps its permission beside a grant (CR 702.185a)", () => {
    it("an expired grant on a warped card leaves its recast; the designation stays", () => {
        const state = board(HYDRA, MOUNTAIN, 4);
        subject(state).warpExiledOnTurn = 3;
        subject(state).castableFromExileBy = "p1";
        subject(state).castableFromExileUntilTurn = state.turn;
        finalizeCleanup(state);
        expect(subject(state).castableFromExileBy).toBeUndefined();
        expect(subject(state).warpExiledOnTurn).toBe(3);
        expect(exileCastRoutes(state, subject(state), "p1")).toEqual(["warp"]);
    });

    it("a free grant on a warped card is the default; declining pays the printed cost and X", () => {
        const state = board(HYDRA, MOUNTAIN, 4);
        subject(state).warpExiledOnTurn = 3;
        subject(state).castableFromExileBy = "p1";
        subject(state).castFromExileWithoutPayingManaCost = true;
        expect(exileCastRoutes(state, subject(state), "p1")).toEqual([
            "grant",
            "warp",
        ]);
        expect(castRawManaCost(state, subject(state), "exile")).toEqual({});
        expect(
            castRawManaCost(state, subject(state), "exile", undefined, true)
        ).toEqual(getDefinition(HYDRA).manaCost);
    });

    it("a plain grant adds no choice, and its tax does not bind the warp cast", () => {
        const state = board(HYDRA, MOUNTAIN, 4);
        subject(state).warpExiledOnTurn = 3;
        subject(state).castableFromExileBy = "p1";
        subject(state).castFromExileCostIncrease = { generic: 2 };
        expect(exileCastRoutes(state, subject(state), "p1")).toEqual(["warp"]);
        expect(
            getCostModifiers(state, subject(state), "spell", undefined, "p1")
                .increase
        ).toEqual({});
    });
});

describe("the Adventure rider binds its own grant only (CR 715.3d)", () => {
    function borrowerUnderRider(): GameState {
        const state = board(BORROWER, ISLAND, 4);
        const card = subject(state);
        card.castableFromExileBy = "p1";
        card.castFromExileNotAsAdventure = true;
        card.plottedOnTurn = 3;
        getPlayer(state, "p2").battlefield.push(
            makeInstance(HYDRA, {
                id: "target",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        return state;
    }
    const altId = adventureCastAltCostId(getDefinition(BORROWER));

    it("a plotted card under the rider may be cast as an Adventure, free, on the wire", async () => {
        const state = borrowerUnderRider();
        const option = adventureCastOptionFor(subject(state), {
            state,
            casterId: "p1",
        });
        expect(option?.id).toBe(altId);
        // CR 702.170d / 118.9 — the plotted permission pays no mana.
        expect(
            castAlternativeCostForZone(
                state,
                subject(state),
                "exile",
                altId,
                option
            )?.mana ?? {}
        ).toEqual({});
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await cast(harness, { alternativeCostId: altId });
        expect(harness.state().pendingTarget?.alternativeCostId).toBe(altId);
    });

    it("the client's picker sees the option: the projection drops the rider under the plotted route", () => {
        const projected = projectPublicState(borrowerUnderRider(), 1, "p1")
            .players[0].exile[0];
        expect(projected.castFromExileNotAsAdventure).toBeUndefined();
    });

    it("the rider still binds the grant: before the plot window opens, outside it, and declined", async () => {
        const closed = borrowerUnderRider();
        closed.turn = 3;
        expect(
            adventureCastOptionFor(subject(closed), {
                state: closed,
                casterId: "p1",
            })
        ).toBeUndefined();
        const outside = borrowerUnderRider();
        outside.activePlayerId = "p2";
        expect(
            adventureCastOptionFor(subject(outside), {
                state: outside,
                casterId: "p1",
            })
        ).toBeUndefined();
        const harness = makeMutationCtx("p1", [
            gameStateSeed(borrowerUnderRider()),
        ]);
        await expect(
            cast(harness, {
                alternativeCostId: altId,
                declineManaCostReplacement: true,
            })
        ).rejects.toThrow("can't be cast as an Adventure");
    });

    it("the rider alone still refuses the Adventure", () => {
        const state = borrowerUnderRider();
        delete subject(state).plottedOnTurn;
        expect(
            adventureCastOptionFor(subject(state), { state, casterId: "p1" })
        ).toBeUndefined();
        expect(adventureCastOptionFor(subject(state))).toBeUndefined();
    });
});

describe("the scenario spec stages a designation's permission", () => {
    it.each([
        ["plottedOnTurn", "plotted"],
        ["warpExiledOnTurn", "warpExiled"],
    ] as const)("%s lowers to %s and rebuilds open", (field, specKey) => {
        const state = board(HYDRA, MOUNTAIN, 0);
        subject(state)[field] = 3;
        const { spec } = specFromState(state, { mySeatId: "p1" });
        const exiled = spec.cards.find((c) => c.zone === "exile");
        expect(exiled?.[specKey]).toBe(true);
    });
});
