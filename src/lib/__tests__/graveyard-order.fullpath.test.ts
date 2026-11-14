// Full-path integration for the CR 404.3 graveyard arrangement (issue #9554):
// GRE → wire projection → client → game.ts.
//
//  1. GRE: Hermit Druid's activation reveals a creature among other cards; the
//     revealed nonland cards are one batch and the SBA settle raises the
//     owner's `graveyard-order` choice.
//  2. WIRE + CLIENT: the client reads ONLY `projectPublicState`'s output;
//     `graveyardOrderCards` builds the ordering strip from it.
//  3. game.ts: the REGISTERED `submitResolutionChoice` handler (stub
//     `MutationCtx`) receives the order; the creature put on top gives
//     Volrath's Shapeshifter its text (CR 612.6 / 611.3a). "Order randomly"
//     travels the same mutation as `orderRandomly`.

import { describe, it, expect } from "vitest";
import { submitResolutionChoice } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import { resolveTopOfStack } from "@convex/gre/state";
import { activateAbilityOnState } from "@convex/gre/activation";
import { checkStateBasedActions } from "@convex/gre/sba";
import { presentedDefId } from "@convex/gre/copy";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice, Player } from "~/types/game";
import { graveyardOrderCards } from "~/lib/graveyard-order";

const GAME_ID = "game-1" as Id<"games">;
const HERMIT_DRUID = getCardByName("Hermit Druid").id;
const SHAPESHIFTER = getCardByName("Volrath's Shapeshifter").id;
const FOREST = getCardByName("Forest").id;
const WURM = getCardByName("Craw Wurm").id;
const BOLT = getCardByName("Lightning Bolt").id;
const BEARS = getCardByName("Grizzly Bears").id;

type SubmitArgs = {
    gameId: Id<"games">;
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
    orderRandomly?: boolean;
};

function p1Card(cardId: string, id: string, zone: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        ownerId: "p1",
        controllerId: "p1",
        zone: zone as CardInstanceState["zone"],
    });
}

/** Druid activated and resolved: Grizzly Bears, Craw Wurm and Lightning Bolt
 *  revealed above a Forest. The engine order leaves the LAST revealed nonland
 *  card (Bolt, not a creature) on top. */
function druidResolved(): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    p1Card(HERMIT_DRUID, "druid", "battlefield"),
                    p1Card(SHAPESHIFTER, "shifter", "battlefield"),
                ],
                library: [
                    p1Card(BEARS, "bears", "library"),
                    p1Card(WURM, "wurm", "library"),
                    p1Card(BOLT, "bolt", "library"),
                    p1Card(FOREST, "forest", "library"),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "druid",
        abilityId: "hermit-druid-ability",
    });
    resolveTopOfStack(state);
    checkStateBasedActions(state);
    return state;
}

function submit(state: GameState, args: Omit<SubmitArgs, "gameId">) {
    const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
    return {
        stub,
        run: () =>
            runMutation<SubmitArgs, void>(
                submitResolutionChoice as unknown as Handler<SubmitArgs, void>,
                stub.ctx,
                { gameId: GAME_ID, ...args }
            ),
    };
}

describe("graveyard arrangement — GRE → wire → client → game.ts (CR 404.3)", () => {
    it("the owner puts the creature on top and Volrath's Shapeshifter takes its text", async () => {
        const state = druidResolved();
        const view = projectPublicState(state, 1, "p1");
        const choice = view.pendingChoices![0] as PendingChoice;
        expect(choice.kind).toBe("graveyard-order");

        // The strip shows exactly the batch, topmost first (engine order: Bolt
        // last in, on top — no creature on top yet).
        const cards = graveyardOrderCards(choice, view.players as Player[]);
        expect(cards.map((c) => c.instanceId)).toEqual([
            "bolt",
            "wurm",
            "bears",
        ]);
        expect(
            presentedDefId(
                state.players[0].battlefield.find((c) => c.id === "shifter")!
            )
        ).toBe(SHAPESHIFTER);

        const { stub, run } = submit(state, {
            playerId: "p1",
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: ["wurm", "bolt", "bears"],
        });
        await run();
        const after = stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual([
            "bears",
            "bolt",
            "wurm",
        ]);
        const shifter = after.players[0].battlefield.find(
            (c) => c.id === "shifter"
        )!;
        expect(presentedDefId(shifter)).toBe(WURM);
    });

    it('"Order randomly" reaches the mutation and the server draws a legal order', async () => {
        const state = druidResolved();
        const choice = projectPublicState(state, 1, "p1")
            .pendingChoices![0] as PendingChoice;
        const { stub, run } = submit(state, {
            playerId: "p1",
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: [],
            orderRandomly: true,
        });
        await run();
        const after = stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(after.rngCounter).toBeGreaterThan(state.rngCounter);
        expect(after.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "bears",
            "bolt",
            "wurm",
        ]);
    });
});
