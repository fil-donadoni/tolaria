// Umbra armor (CR 702.89a) through the REGISTERED `game.ts` mutations: Lightning
// Bolt on an enchanted creature resolves and marks lethal damage, the SBA's
// destroy is replaced, and the client sees it through `projectPublicState` — the
// creature on the battlefield with no damage, the Aura in its owner's graveyard.
import { beforeAll, describe, expect, it } from "vitest";
import { announceCast, passPriority, selectTargets } from "../game";
import { projectPublicState } from "../gameProjections";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness.fixture";

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";

const AURA: CardDefinition = {
    id: "test-umbra-armor-full-path",
    name: "Test Umbra",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    staticAbilities: ["umbra armor"],
    targetRequirement: { type: "Creature", count: 1 },
};

beforeAll(() => preloadDefinitions([AURA]));

const card = (
    name: string,
    id: string,
    owner: string,
    zone: "hand" | "battlefield" | "library"
) =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });

function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                battlefield: [
                    card("Grizzly Bears", "bears", ME, "battlefield"),
                    makeInstance(AURA.id, {
                        id: "umbra",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "battlefield",
                        attachedTo: "bears",
                        staticAbilities: ["umbra armor"],
                    }),
                ],
                library: [card("Forest", "my-lib-0", ME, "library")],
            }),
            makePlayer(OPP, {
                hand: [card("Lightning Bolt", "bolt", OPP, "hand")],
                library: [card("Mountain", "opp-lib-0", OPP, "library")],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
        ],
        activePlayerId: OPP,
        priorityPlayerId: OPP,
    });
}

async function call(
    harness: MutationStub,
    fn: unknown,
    args: Record<string, unknown>
): Promise<void> {
    await runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, {
        gameId: GAME,
        ...args,
    });
}

describe("umbra armor through the game mutations (CR 702.89a)", () => {
    it("Lightning Bolt's lethal damage destroys the Aura instead, and the client sees the creature healed", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);

        await call(harness, announceCast, {
            playerId: OPP,
            cardInstanceId: "bolt",
        });
        await call(harness, selectTargets, {
            playerId: OPP,
            targets: [{ targetType: "permanent", targetId: "bears" }],
        });
        for (let guard = 0; guard < 8; guard++) {
            const live = harness.state();
            if (live.stack.length === 0) break;
            await call(harness, passPriority, {
                playerId: live.priorityPlayerId,
            });
        }

        const view = projectPublicState(harness.state(), 1, ME);
        const mine = view.players.find((p) => p.id === ME)!;
        expect(mine.battlefield.map((c) => c.id)).toEqual(["bears"]);
        expect(mine.battlefield[0].damageMarked).toBeUndefined();
        expect(mine.graveyard.map((c) => c.id)).toEqual(["umbra"]);
    });
});
