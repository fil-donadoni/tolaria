// Full-path integration for the Demands of the permanent being CAST (CR 117.3b,
// CR 601.2g, issue #10465): the REGISTERED `autoTapForPayment` handler over the
// stub `MutationCtx`, on the reported board — Mountain + Tropical Island,
// casting Pyrite Spellbomb ({1}), whose "{R}, Sacrifice this artifact" is
// usable the moment it resolves.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
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

const p1Card = (name: string, id: string, zone: "hand" | "battlefield") =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });

/** p1 paying {1} for `spell` from Mountain + Tropical Island. */
function casting(spell: string): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [p1Card(spell, "spell", "hand")],
                battlefield: [
                    p1Card("Mountain", "mountain", "battlefield"),
                    p1Card("Tropical Island", "trop", "battlefield"),
                ],
            }),
            makePlayer("p2"),
        ],
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { X: 1 },
            tappedLandIds: [],
        },
    });
}

async function tappedBy(state: GameState): Promise<string[]> {
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
        .map((c) => c.id);
}

describe("autoTapForPayment keeps the cast permanent's own ability affordable (issue #10465)", () => {
    it("taps the Tropical Island for Pyrite Spellbomb, leaving {R}", async () => {
        expect(await tappedBy(casting("Pyrite Spellbomb"))).toEqual(["trop"]);
    });

    it("taps the Mountain when the cast permanent needs no red", async () => {
        expect(await tappedBy(casting("Skullclamp"))).toEqual(["mountain"]);
    });
});
