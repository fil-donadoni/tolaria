// Full path for the `activation-restriction` static (CR 602.5 / 605.1a,
// Cursed Totem): one board, read on BOTH sides of the authority boundary. The
// registered mutations (`tapUntap`, `activateManaAbility`) run through their
// real `_handler` against a stub ctx and refuse the activation; the SAME board,
// projected by `projectPublicState` and reduced by `buildTriggerStateView`,
// offers the client no affordance for it. Without the Totem both sides agree
// the other way, so neither half can pass by refusing everything.

import { describe, expect, it } from "vitest";
import { activateManaAbility, tapUntap } from "@convex/game";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { CardInstance, Player } from "~/types/game";
import {
    buildTriggerStateView,
    getManaCostMenuAbility,
    hasManaAbility,
} from "../card-utils";

const GAME_ID = "game-1" as Id<"games">;
const TOTEM_TEXT = "Activated abilities of creatures can't be activated.";

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type ActivateManaArgs = TapUntapArgs & {
    abilityId: string;
    tapOtherIds?: string[];
};

function board(withTotem: boolean): GameState {
    const perm = (name: string, id: string, owner = "p1") =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: owner,
            ownerId: owner,
            isSummoningSick: false,
        });
    const me = makePlayer("p1", {
        battlefield: [
            perm("Llanowar Elves", "elves"),
            perm("Farrelite Priest", "priest"),
            perm("Urza, Lord High Artificer", "urza"),
            perm("Ornithopter", "thopter"),
        ],
    });
    me.manaPool = { ...me.manaPool, G: 1 };
    return makeState({
        players: [
            me,
            makePlayer("p2", {
                battlefield: withTotem
                    ? [perm("Cursed Totem", "totem", "p2")]
                    : [],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function tap(state: GameState, cardInstanceId: string) {
    const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
    const run = runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        stub.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );
    return { stub, run };
}

function activateMana(
    state: GameState,
    cardInstanceId: string,
    abilityId: string,
    tapOtherIds?: string[]
) {
    const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
    const run = runMutation<ActivateManaArgs, void>(
        activateManaAbility as unknown as Handler<ActivateManaArgs, void>,
        stub.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId,
            abilityId,
            ...(tapOtherIds ? { tapOtherIds } : {}),
        }
    );
    return { stub, run };
}

function clientCard(state: GameState, id: string) {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const view = buildTriggerStateView(players, projected.activePlayerId);
    const card = players
        .find((p) => p.id === "p1")!
        .battlefield.find((c) => c.id === id) as CardInstance;
    return { view, card };
}

describe("activation-restriction — mutation and client agree (CR 602.5 / 605.1a)", () => {
    it("tapUntap refuses Llanowar Elves under the Totem, and the client offers no tap", async () => {
        const state = board(true);
        const { view, card } = clientCard(state, "elves");
        expect(hasManaAbility(card, view)).toBe(false);

        const { stub, run } = tap(state, "elves");
        await expect(run).rejects.toThrow(TOTEM_TEXT);
        expect(stub.writes).toHaveLength(0);
    });

    it("…and both allow it with no Totem out", async () => {
        const state = board(false);
        const { view, card } = clientCard(state, "elves");
        expect(hasManaAbility(card, view)).toBe(true);

        const { stub, run } = tap(state, "elves");
        await run;
        expect(stub.state().players[0].manaPool.G).toBe(2);
    });

    it("activateManaAbility refuses a non-tap mana ability (Farrelite Priest), and the client hides its entry", async () => {
        const locked = board(true);
        const lockedView = clientCard(locked, "priest");
        expect(
            getManaCostMenuAbility(lockedView.card, lockedView.view)
        ).toBeNull();
        const refused = activateMana(locked, "priest", "farrelite-priest-mana");
        await expect(refused.run).rejects.toThrow(TOTEM_TEXT);

        const free = board(false);
        const freeView = clientCard(free, "priest");
        expect(
            getManaCostMenuAbility(freeView.card, freeView.view)
        ).not.toBeNull();
        const allowed = activateMana(free, "priest", "farrelite-priest-mana");
        await allowed.run;
        expect(allowed.stub.state().players[0].manaPool.W).toBe(1);
    });

    it("activateManaAbility refuses a tap-another mana ability (Urza, Lord High Artificer)", async () => {
        const refused = activateMana(board(true), "urza", "urza-lha-mana", [
            "thopter",
        ]);
        await expect(refused.run).rejects.toThrow(TOTEM_TEXT);

        const allowed = activateMana(board(false), "urza", "urza-lha-mana", [
            "thopter",
        ]);
        await allowed.run;
        expect(allowed.stub.state().players[0].manaPool.U).toBe(1);
    });
});
