// Full-path integration for the Auto-Tap combat-body stage (CR 508.1a,
// CR 601.2g, issue #9821): the REGISTERED `autoTapForPayment` handler over the
// stub `MutationCtx`, on the reported board — an animated Mishra's Factory, a
// second Factory activating its `{1}:` animate, a Swamp, Duress in hand.
//
//   508.1a  The active player chooses which creatures that they control, if
//           any, will attack. The chosen creatures must be untapped, …
//
// Before declare attackers the animated Factory is a body that can still
// attack: the Swamp pays, stranding Duress. Postcombat it is an ordinary
// source again, and tapping it keeps Duress castable.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { autoTapForPayment } from "../game";
import type { Id } from "../_generated/dataModel";
import type { Phase } from "../gre/types";
import type { GameState } from "../gre/state";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const MISHRAS_FACTORY = "a696c5b6-f216-454d-8029-74e84bbd1428"; // {T}: C, {1}: animate
const SWAMP = "6176936d-72e2-4205-8871-4c5a4f1cb2d8"; // {T}: B
const DURESS = "ca367f49-0f4a-4b7f-8104-851893fbcd8a"; // {B} sorcery

/** A Factory its `{1}:` animate already resolved on: a 2/2 Assembly-Worker
 *  artifact creature until end of turn, not summoning-sick. */
function animatedFactory(id: string) {
    return makeInstance(MISHRAS_FACTORY, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        types: ["Land", "Artifact", "Creature"],
        subtypes: ["Assembly-Worker"],
        power: 2,
        toughness: 2,
        isSummoningSick: false,
        animation: {
            savedPower: undefined,
            savedToughness: undefined,
            setPower: 2,
            setToughness: 2,
            addedCreatureType: true,
            addedTypes: ["Artifact"],
            addedSubtype: "Assembly-Worker",
            duration: { phase: "end-of-turn" },
        },
    });
}

/** p1 paying the second Factory's `{1}:` animate, Duress held, in `phase`. */
function animatingSecondFactory(phase: Phase): GameState {
    return makeState({
        phase,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(DURESS, {
                        id: "duress",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    animatedFactory("worker"),
                    makeInstance(MISHRAS_FACTORY, {
                        id: "factory2",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(SWAMP, {
                        id: "swamp",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        pendingActivation: {
            playerId: "p1",
            cardInstanceId: "factory2",
            abilityId: "mishras-factory-animate",
            manaCost: { X: 1 },
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
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
    expect(after.pendingActivation).toBeUndefined();
    return after.players[0].battlefield
        .filter((c) => c.isTapped)
        .map((c) => c.id)
        .sort();
}

describe("autoTapForPayment spends an attack-ready animated land last (CR 508.1a, issue #9821)", () => {
    it("precombat main: taps the Swamp, the animated Factory stays untapped", async () => {
        expect(await autoTap(animatingSecondFactory("PRECOMBAT_MAIN"))).toEqual(
            ["swamp"]
        );
    });

    it("postcombat main: taps the animated Factory and keeps Duress castable", async () => {
        expect(
            await autoTap(animatingSecondFactory("POSTCOMBAT_MAIN"))
        ).toEqual(["worker"]);
    });
});
