// Full-path integration for the Auto-Tap untap-price gate (CR 502.3,
// CR 601.2g, issue #8381): the REGISTERED `autoTapForPayment` handler over
// the stub `MutationCtx`, on the reported board — Forest + Grim Monolith,
// casting Retrofitter Foundry ({1}) with a held {1}{G} Grizzly Bears.
//
//   502.3   Effects can keep one or more of a player's permanents from
//           untapping during that player's untap step.
//
// Tapping the Monolith would keep the Bears castable, but untapping it costs
// {4} later to save a two-mana play: the Forest pays instead.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { autoTapForPayment } from "../game";
import type { Id } from "../_generated/dataModel";
import type { GameState } from "../gre/state";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // {T}: G
const GRIM_MONOLITH = "9ddc9fe1-17c8-4e1d-aeb8-c4214e881280"; // {T}: CCC, {4}: untap
const RETROFITTER_FOUNDRY = "5da578b8-19e6-4068-9336-e7cd33c585f1"; // {1}

const inHand = (def: string, id: string) =>
    makeInstance(def, { id, controllerId: "p1", ownerId: "p1", zone: "hand" });
const onBoard = (def: string, id: string) =>
    makeInstance(def, { id, controllerId: "p1", ownerId: "p1" });

/** p1 casting Retrofitter Foundry from Forest + Grim Monolith, `held` in hand. */
function castingFoundry(held: boolean): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    inHand(RETROFITTER_FOUNDRY, "foundry"),
                    ...(held ? [inHand(grizzlyBears().id, "bears")] : []),
                ],
                battlefield: [
                    onBoard(FOREST, "forest"),
                    onBoard(GRIM_MONOLITH, "grim"),
                ],
            }),
            makePlayer("p2"),
        ],
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "foundry",
            manaCost: { X: 1 },
            tappedLandIds: [],
        },
    });
}

async function autoTap(state: GameState): Promise<string[]> {
    const h = makeMutationCtx("p1", [gameStateSeed(state, 1)]);
    await runMutation<{ gameId: Id<"games">; playerId: string }, unknown>(
        autoTapForPayment as unknown as Handler<never, never>,
        h.ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );
    const after = h.state();
    expect(after.pendingCast).toBeUndefined();
    return after.players[0].battlefield
        .filter((c) => c.isTapped)
        .map((c) => c.id)
        .sort();
}

describe("autoTapForPayment prices a does-not-untap source (CR 502.3, issue #8381)", () => {
    it("taps the Forest, not Grim Monolith, to save a held {1}{G}", async () => {
        expect(await autoTap(castingFoundry(true))).toEqual(["forest"]);
    });

    it("taps the Forest with no other Demand", async () => {
        expect(await autoTap(castingFoundry(false))).toEqual(["forest"]);
    });
});
