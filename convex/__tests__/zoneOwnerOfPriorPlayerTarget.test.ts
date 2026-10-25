// Full-path coverage for the cross-slot zone-owner filter (CR 601.2c, CR 404.1,
// issue #2912): Drafna's Restoration names a PLAYER, then artifact CARDS from
// THAT player's graveyard. GRE offered set -> `selectTarget` accepted set ->
// the client's `matchesGraveyardTarget` reducer all read one registry key.

import { describe, it, expect } from "vitest";
import { selectTarget, zoneOwnedByPriorPlayerTarget } from "../game";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../gre/rules";
import { getDefinition } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { GameState, PendingTarget } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import { matchesGraveyardTarget } from "../../src/lib/graveyard-targets";

const GAME_ID = "game-1" as Id<"games">;
const drafnasRestoration = getDefinition(
    "4be2aa3b-207b-4d21-abfb-6788520c7676"
);
const ARTIFACT_A = "64975352-8d35-4d02-94ac-fa0c6ee12409";
const ARTIFACT_B = "07793a71-1106-4303-b620-e403bd378020";

type Args = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "player" | "graveyard-card";
    targetId: string;
    targetPlayerId?: string;
};

const pick = (
    ctx: Parameters<typeof runMutation>[1],
    rest: Omit<Args, "gameId" | "playerId">
) =>
    runMutation<Args, void>(
        selectTarget as unknown as Handler<Args, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...rest }
    );

function drafnaState(): GameState {
    const spell = makeInstance(drafnasRestoration.id, {
        id: "drafna",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const mine = makeInstance(ARTIFACT_A, {
        id: "mine",
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
    const theirs = makeInstance(ARTIFACT_B, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
        zone: "graveyard",
    });
    const pendingTarget: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "drafna",
        targetType: "player",
        count: 1,
        selected: [],
        remainingRequirements: drafnasRestoration.additionalTargetRequirements,
    };
    return makeState({
        players: [
            makePlayer("p1", { hand: [spell], graveyard: [mine] }),
            makePlayer("p2", { graveyard: [theirs] }),
        ],
        pendingTarget,
    });
}

describe("zoneOwnerOfPriorPlayerTarget — Drafna's Restoration (CR 601.2c, CR 404.1)", () => {
    it("declares the player as its primary target", () => {
        expect(drafnasRestoration.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it("lowers the announced player into the next group and gates accepted picks", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(drafnaState())]);
        await pick(stub.ctx, { targetType: "player", targetId: "p2" });
        const pt = stub.state().pendingTarget!;
        expect(pt.zoneOwnerId).toBe("p2");
        expect(pt.priorSelected).toEqual([{ type: "player", id: "p2" }]);

        // Accepted set: the OTHER player's graveyard is refused.
        await expect(
            pick(stub.ctx, {
                targetType: "graveyard-card",
                targetId: "mine",
                targetPlayerId: "p1",
            })
        ).rejects.toThrow(/announced player's graveyard/);
        await pick(stub.ctx, {
            targetType: "graveyard-card",
            targetId: "theirs",
            targetPlayerId: "p2",
        });
        expect(stub.state().pendingTarget!.selected.map((t) => t.id)).toEqual([
            "theirs",
        ]);
    });

    it("offered set and client matcher read the same key", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(drafnaState())]);
        await pick(stub.ctx, { targetType: "player", targetId: "p2" });
        const state = stub.state();
        const pt = state.pendingTarget!;
        const group = {
            ...drafnasRestoration.additionalTargetRequirements![0],
            zoneOwnerId: pt.zoneOwnerId,
        };
        // Offered: only p2's graveyard.
        const offered = getLegalTargets(
            state,
            group,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(offered).toEqual(["theirs"]);

        // Client reducer: same decision per graveyard.
        const card = (id: string) => ({ id, types: ["Artifact"] }) as never;
        expect(
            matchesGraveyardTarget(card("theirs"), "p2", pt, "p1", "p1")
        ).toBe(true);
        expect(matchesGraveyardTarget(card("mine"), "p1", pt, "p1", "p1")).toBe(
            false
        );
    });

    it("fails closed when no player precedes the group", () => {
        const group = zoneOwnedByPriorPlayerTarget(
            drafnasRestoration.additionalTargetRequirements![0],
            []
        );
        expect(group.zoneOwnerId).toBe("");
        expect(
            getLegalTargets(drafnaState(), group, NO_TARGETING_SOURCE, "p1")
        ).toEqual([]);
    });
});
