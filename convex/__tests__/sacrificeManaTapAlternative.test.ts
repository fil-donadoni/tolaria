// CR 605.3a (issue #3630) — a player may activate ANY mana ability while they
// hold priority or pay a cost. A land printing both "{T}: Add {G}" and "{T},
// Sacrifice this land: Add {G}{G}" (the FEM and Invasion sacrifice lands) had
// its second ability unreachable by every route: the unified mana-tap option
// list dropped sacrifice options whenever a non-destructive one existed, and
// that list is the only index space `tapUntap` / `tapSourceIntoPayment` resolve
// a `manaChoiceIndex` against. The preference is right for the AUTOMATIC
// planner only — which still never sacrifices the source.

import { describe, it, expect } from "vitest";
import { autoTapForPayment, tapSourceIntoPayment, tapUntap } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { getCardByName } from "../cards";
import { getManaTapOptionsDetailed } from "../gre/constants";
import { getProducibleManaSourceView } from "../gre/rules";
import { buildAutoTapSources } from "../gre/autoTap";
import type { GameState, PendingCast, PlayerState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const HAVENWOOD = "Havenwood Battleground";
// Invasion's two-colour sacrifice shape: "{T}: Add {U}." beside "{T},
// Sacrifice this land: Add {W}{B}."
const ANCIENT_SPRING = "Ancient Spring";

function boardWith(
    cardName: string,
    pendingCast?: PendingCast
): { state: GameState; player: PlayerState } {
    const card = makeInstance(getCardByName(cardName).id, {
        id: "source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [card] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        ...(pendingCast ? { pendingCast } : {}),
    });
    return { state, player: state.players[0] };
}

function battlefieldsOf(state: GameState) {
    return state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapUntap = (
    ctx: Parameters<typeof runMutation>[1],
    manaChoiceIndex?: number
) =>
    runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "source",
            ...(manaChoiceIndex !== undefined ? { manaChoiceIndex } : {}),
        }
    );

type AutoTapArgs = { gameId: Id<"games">; playerId: string };

const runAutoTap = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<AutoTapArgs, void>(
        autoTapForPayment as unknown as Handler<AutoTapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

describe("the mana-tap option lists (CR 605.3a, issue #3630)", () => {
    it("the manual list offers the sacrifice ability BEHIND the plain one", () => {
        const { state, player } = boardWith(HAVENWOOD);
        const options = getManaTapOptionsDetailed(
            player.battlefield[0],
            "p1",
            battlefieldsOf(state)
        );
        expect(options.map((o) => o.mana)).toEqual([{ G: 1 }, { G: 2 }]);
        expect(options.map((o) => o.sacrificesSource === true)).toEqual([
            false,
            true,
        ]);
    });

    it("the automatic planner sees only the plain ability, and taps it index-free", () => {
        const { state, player } = boardWith(HAVENWOOD);
        const view = getProducibleManaSourceView(
            player.battlefield[0],
            "p1",
            battlefieldsOf(state)
        );
        expect(view.detailed.map((o) => o.mana)).toEqual([{ G: 1 }]);
        expect(view.needIndex).toBe(false);
    });
});

describe("tapUntap at priority — the sacrifice alternative (CR 605.3a, issue #3630)", () => {
    it("naming the sacrifice option adds {G}{G} and puts the land into the graveyard", async () => {
        const { state } = boardWith(HAVENWOOD);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, 1);

        const after = stub.state().players[0];
        expect(after.manaPool.G).toBe(2);
        expect(after.battlefield.some((c) => c.id === "source")).toBe(false);
        expect(after.graveyard.some((c) => c.id === "source")).toBe(true);
    });

    it("an index-free tap still taps for {G} and keeps the land", async () => {
        const { state } = boardWith(HAVENWOOD);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx);

        const after = stub.state().players[0];
        expect(after.manaPool.G).toBe(1);
        expect(after.battlefield[0].isTapped).toBe(true);
    });

    it("naming the plain option taps for {G} and can be untapped for a refund", async () => {
        const { state } = boardWith(HAVENWOOD);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, 0);
        expect(stub.state().players[0].manaPool.G).toBe(1);
        expect(stub.state().players[0].battlefield[0].isTapped).toBe(true);

        await runTapUntap(stub.ctx);
        const after = stub.state().players[0];
        expect(after.manaPool.G ?? 0).toBe(0);
        expect(after.battlefield[0].isTapped).toBe(false);
    });

    it("a two-colour sacrifice output arrives whole (Invasion shape)", async () => {
        const { state } = boardWith(ANCIENT_SPRING);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, 1);

        const after = stub.state().players[0];
        expect(after.manaPool.W).toBe(1);
        expect(after.manaPool.B).toBe(1);
        expect(after.manaPool.U ?? 0).toBe(0);
        expect(after.graveyard.some((c) => c.id === "source")).toBe(true);
    });
});

describe("tapSourceIntoPayment — the sacrifice alternative while paying (CR 605.3a, issue #3630)", () => {
    it("naming the sacrifice option pays {G}{G} and sacrifices the land", () => {
        const { state, player } = boardWith(HAVENWOOD);
        tapSourceIntoPayment(state, player, player.battlefield[0], 1, []);
        expect(player.manaPool.G).toBe(2);
        expect(player.battlefield.some((c) => c.id === "source")).toBe(false);
        expect(player.graveyard.some((c) => c.id === "source")).toBe(true);
    });

    it("an index-free payment tap still taps for {G}", () => {
        const { state, player } = boardWith(HAVENWOOD);
        const tappedLandIds: string[] = [];
        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            tappedLandIds
        );
        expect(player.manaPool.G).toBe(1);
        expect(player.battlefield[0].isTapped).toBe(true);
        expect(tappedLandIds).toEqual(["source"]);
    });
});

describe("auto-tap never sacrifices the source (issue #3630)", () => {
    it("the solver's sources carry no sacrifice option for a sacrifice land", () => {
        // Asserted on the SOURCES, not only on the executed plan: a sacrifice
        // option admitted here without an index would be planned as {G}{G} and
        // then tapped for {G}, so the executed board alone cannot tell the
        // planner filter apart from a plan/payment disagreement.
        const { state, player } = boardWith(HAVENWOOD);
        const sources = buildAutoTapSources(
            player.battlefield,
            battlefieldsOf(state)
        );
        expect(sources).toHaveLength(1);
        expect(sources[0].options.map((o) => o.mana)).toEqual([{ G: 1 }]);
        expect(sources[0].options[0].manaChoiceIndex).toBeUndefined();
    });

    it("a {G}{G} cost with only a sacrifice land on board leaves the land on the battlefield", async () => {
        const spell = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const { state } = boardWith(HAVENWOOD, {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { G: 2 },
            tappedLandIds: [],
        });
        state.players[0].hand = [spell];
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        // The planner cannot cover {G}{G} without the sacrifice, so it may
        // reject; what it must never do is sacrifice the land to try.
        await runAutoTap(stub.ctx).catch(() => undefined);

        const after = stub.state().players[0];
        expect(after.graveyard.some((c) => c.id === "source")).toBe(false);
        expect(after.battlefield.some((c) => c.id === "source")).toBe(true);
    });
});
