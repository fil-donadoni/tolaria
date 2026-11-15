// A split half cast FREE under a board permission, through the full `game.ts`
// mutation path (CR 709.3 + CR 118.9a, ADR 0121).
//
// The GRE test (`convex/gre/__tests__/splitCastPermission.test.ts`) covers the
// option list, the per-half subject and the stamp. This one drives
// `announceCast`, where the two announcements must compose: the permission id
// carries the half (`castPermissionAltCostId.ts`), so the mutation resolves a
// free cost AND puts that half — not the combined card — on the stack.
//
// No shipped permission covers a shipped split half, so the permission is a
// temporary definition: instants with mana value 1 or less, which covers Stand
// ({W}) and not Deliver ({2}{U}). Harness: `splitCardCastPath.test.ts`'s.

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget } from "../game";
import { standDeliver } from "../cards/sets/inv/multicolor.cards";
import { hillGiant } from "../cards/sets/lea/red.cards";
import { plains } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { withTemporaryDefinitionAsync } from "../cards/registry";
import { splitHalfDefinitionId } from "../cards/splitCard";
import type { CardDefinition } from "../cards/types";
import { splitCastAltCostId } from "../gre/splitCast";
import { composeCastPermissionAltCostId } from "../gre/castPermissionAltCostId";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import { getDefinition } from "../cards/index";

const aluren = () => getDefinition("268403bc-733d-446e-a7c1-abc957c42bc2");

const GAME_ID = "game-1" as Id<"games">;
const PERMISSION_ID = "probe-free-cheap-instant";
const LEFT_ALT = splitCastAltCostId(standDeliver(), "left");
const RIGHT_ALT = splitCastAltCostId(standDeliver(), "right");
const FREE_STAND = composeCastPermissionAltCostId(PERMISSION_ID, LEFT_ALT);
const LEFT_ID = splitHalfDefinitionId(standDeliver().id, "left");

/** Aluren's id (the registry's cast-permission membership finds it), its
 *  permission swapped for a noncreature one. */
const permissionSource: CardDefinition = {
    ...aluren(),
    staticEffects: [
        {
            kind: "cast-permission",
            id: PERMISSION_ID,
            grantee: "controller",
            filter: { type: "Instant", manaValueAtMost: 1 },
            withoutPayingManaCost: true,
            oracleText:
                "You may cast instant spells with mana value 1 or less without paying their mana costs.",
        },
    ],
};

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
};

const runAnnounceCast = (
    ctx: Parameters<typeof runMutation>[1],
    alternativeCostId: string | undefined
) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "split",
            ...(alternativeCostId ? { alternativeCostId } : {}),
        }
    );

const runSelectTarget = (
    ctx: Parameters<typeof runMutation>[1],
    targetId: string
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            targetType: "permanent",
            targetId,
        }
    );

/** p1 holds Stand // Deliver beside the permission source and ONE untapped
 *  Plains — enough to pay Stand's {W}, so a free cast that leaves the Plains
 *  untapped proves the permission paid, not the land. */
function position(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(standDeliver().id, {
                        id: "split",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(aluren().id, {
                        id: "source",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(plains().id, {
                        id: "plains0",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(hillGiant().id, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

describe("announceCast of a split half under a free-cast permission (CR 709.3 + 118.9a)", () => {
    it("puts the HALF on the stack and pays nothing for it", () =>
        withTemporaryDefinitionAsync(permissionSource, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(position())]);

            await runAnnounceCast(harness.ctx, FREE_STAND);
            // CR 709.3a — Stand's own "target creature", not the card's.
            expect(harness.state().pendingTarget).toBeDefined();
            await runSelectTarget(harness.ctx, "giant");

            const after = harness.state();
            expect(after.stack).toHaveLength(1);
            // CR 709.3b — only the cast half's characteristics exist.
            expect((after.stack[0].card as { id?: string }).id).toBe(LEFT_ID);
            expect(after.stack[0].splitHalfOf).toBe(standDeliver().id);
            // CR 118.9 — the permission's cost is nothing: the Plains stands.
            expect(
                after.players[0].battlefield.find((c) => c.id === "plains0")
                    ?.isTapped
            ).toBeFalsy();
            expect(after.players[0].hand).toHaveLength(0);
            // SURFACE — the client sees the half, through the real projection.
            const projected = projectPublicState(after, 1, "p1");
            expect((projected.stack[0].card as { id?: string }).id).toBe(
                LEFT_ID
            );
        }));

    it("refuses the free cast of the half the permission does not cover (CR 709.3a)", () =>
        withTemporaryDefinitionAsync(permissionSource, async () => {
            // Deliver is mana value 3: "only the chosen half is evaluated".
            const harness = makeMutationCtx("p1", [gameStateSeed(position())]);
            await expect(
                runAnnounceCast(
                    harness.ctx,
                    composeCastPermissionAltCostId(PERMISSION_ID, RIGHT_ALT)
                )
            ).rejects.toThrow(/Unknown alternative cost/);
            expect(harness.state().stack).toHaveLength(0);
        }));

    it("refuses a permission announcement that names no half (CR 709.3)", () =>
        withTemporaryDefinitionAsync(permissionSource, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(position())]);
            await expect(
                runAnnounceCast(
                    harness.ctx,
                    composeCastPermissionAltCostId(PERMISSION_ID)
                )
            ).rejects.toThrow();
            expect(harness.state().stack).toHaveLength(0);
        }));
});
