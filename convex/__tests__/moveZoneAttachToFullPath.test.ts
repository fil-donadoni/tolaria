// Full-path integration for `moveZone`'s `attachTo` (CR 303.4f): GRE ->
// game.ts -> wire projection. A resolving script returns a graveyard Aura to
// the battlefield attached to a named host; the controller is never asked to
// choose, even with two legal hosts on the board.
import { describe, expect, it } from "vitest";
import { passPriority } from "../game";
import { projectPublicState } from "../gameProjections";
import { registerTokenDefinition } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import {
    grizzlyBears,
    savannahLions,
    unholyStrength,
} from "../cards/sets/lea/index.cards";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
} from "./gameMutationHarness.fixture";

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";
const SCRIPT_ID = "test-fullpath-move-zone-attach-to";
registerTokenDefinition({
    id: SCRIPT_ID,
    name: SCRIPT_ID,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "battlefield",
            attachTo: { target: 1 },
        },
    ],
});

describe("moveZone attachTo through the real mutation (CR 303.4f)", () => {
    it("returns the Aura attached to the named host with no host prompt, and projects it", async () => {
        const state = makeState({
            activePlayerId: ME,
            priorityPlayerId: ME,
            players: [
                makePlayer(ME, {
                    graveyard: [
                        makeInstance(unholyStrength().id, {
                            id: "aura-1",
                            controllerId: ME,
                            ownerId: ME,
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [
                        makeInstance(grizzlyBears().id, {
                            id: "bears-1",
                            controllerId: ME,
                            ownerId: ME,
                            zone: "battlefield",
                        }),
                    ],
                }),
                makePlayer(OPP, {
                    battlefield: [
                        makeInstance(savannahLions().id, {
                            id: "lions-1",
                            controllerId: OPP,
                            ownerId: OPP,
                            zone: "battlefield",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, SCRIPT_ID, ME, [
            { type: "graveyard-card", id: "aura-1", playerId: ME },
            { type: "permanent", id: "lions-1" },
        ]);

        const stub = makeMutationCtx("u", [gameStateSeed(state)]);
        for (
            let guard = 0;
            guard < 6 && stub.state().stack.length > 0;
            guard++
        ) {
            await runMutation<Record<string, unknown>, unknown>(
                passPriority,
                stub.ctx,
                { gameId: GAME, playerId: stub.state().priorityPlayerId }
            );
        }

        const after = stub.state();
        expect(after.stack).toHaveLength(0);
        expect(after.pendingChoices ?? []).toHaveLength(0);
        const aura = after.players[0].battlefield.find(
            (c) => c.id === "aura-1"
        )!;
        expect(aura.attachedTo).toBe("lions-1");

        const projected = projectPublicState(after, 1, ME);
        expect(
            projected.players[0].battlefield.find((c) => c.id === "aura-1")!
                .attachedTo
        ).toBe("lions-1");
    });
});
