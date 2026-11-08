// Casting a split card with FUSE as one fused split spell through the full
// `game.ts` mutation path (CR 702.102).
//
// The GRE test (`convex/gre/__tests__/fuse.test.ts`) covers the twin, the
// option list and the resolution; this drives `announceCast` → two
// `selectTarget` groups → `tapForPayment`, the path a click takes, and then
// resolves what it committed.
//
// Harness: the stub `MutationCtx` driving the REGISTERED mutation's own
// `_handler` (`gameMutationHarness.fixture.ts`), as `splitCardCastPath.test.ts`.

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget, tapForPayment } from "../game";
import { hillGiant } from "../cards/sets/lea/red.cards";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { mountain } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { fusedSplitDefinitionId } from "../cards/fusedSplit";
import { splitCastAltCostId } from "../gre/splitCast";
import { resolveTopOfStack } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    FUSED_SPLIT_PROBE_ID,
    fusedSplitProbe,
} from "../gre/__tests__/fixtures/fusedSplitProbe.fixture";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const FUSED_ALT = splitCastAltCostId(fusedSplitProbe, "fused");
const FUSED_ID = fusedSplitDefinitionId(FUSED_SPLIT_PROBE_ID);

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
type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string }[];
};
type Ctx = Parameters<typeof runMutation>[1];

const runAnnounceCast = (ctx: Ctx, alternativeCostId?: string) =>
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
const runSelectTarget = (ctx: Ctx, targetId: string) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", targetType: "permanent", targetId }
    );
const runTapForPayment = (ctx: Ctx, landIds: string[]) =>
    runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            payments: landIds.map((cardInstanceId) => ({ cardInstanceId })),
        }
    );

/** p1 holds the fuse probe ({R} "1 damage" // {1}{R} "2 damage") with three
 *  Mountains — exactly the fused {1}{R}{R}. p2 has a Hill Giant and a pair of
 *  Grizzly Bears: two distinct targets, one per half. */
function position(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(FUSED_SPLIT_PROBE_ID, {
                        id: "split",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: 3 }, (_, i) =>
                    makeInstance(mountain().id, {
                        id: `mountain${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(hillGiant().id, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
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

describe("announceCast of a FUSED split spell (CR 702.102)", () => {
    it("announces both halves' targets, pays both costs, resolves left then right", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(position())]);

        await runAnnounceCast(harness.ctx, FUSED_ALT);
        // CR 601.2c — the left half's target first…
        expect(harness.state().pendingTarget).toBeDefined();
        await runSelectTarget(harness.ctx, "giant");
        // …then the right half's, as an independent group.
        expect(harness.state().pendingTarget).toBeDefined();
        await runSelectTarget(harness.ctx, "bears");
        // CR 702.102c — "the total cost of a fused split spell includes the
        // mana cost of each half": {R} + {1}{R}, all three Mountains.
        await runTapForPayment(harness.ctx, [
            "mountain0",
            "mountain1",
            "mountain2",
        ]);

        const after = harness.state();
        expect(after.stack).toHaveLength(1);
        const item = after.stack[0];
        // CR 702.102b — ONE spell, the fused twin, its parent retained for
        // the CR 709.4 revert.
        expect((item.card as { id?: string }).id).toBe(FUSED_ID);
        expect(item.splitHalfOf).toBe(FUSED_SPLIT_PROBE_ID);
        expect(item.targets?.map((t) => t.id)).toEqual(["giant", "bears"]);
        expect(after.players[0].hand).toHaveLength(0);
        // SURFACE — the client sees the fused spell through the projection.
        const projected = projectPublicState(after, 1, "p1");
        expect((projected.stack[0].card as { id?: string }).id).toBe(FUSED_ID);
        expect(projected.stack[0].targets?.map((t) => t.id)).toEqual([
            "giant",
            "bears",
        ]);

        // CR 702.102d — the left half's 1 damage to ITS target, then the
        // right half's 2 damage to ITS target (a right half reading slot 0
        // would put all 3 on the Giant).
        resolveTopOfStack(after);
        const theirs = after.players[1].battlefield;
        const giant = theirs.find((c) => c.id === "giant");
        expect(giant?.damageMarked ?? 0).toBe(1);
        const bears = theirs.find((c) => c.id === "bears");
        expect(bears?.damageMarked).toBe(2);
        // CR 709.4 — in the graveyard the card is the split card again.
        const card = after.players[0].graveyard.find((c) => c.id === "split");
        expect((card?.card as { id?: string }).id).toBe(FUSED_SPLIT_PROBE_ID);
    });

    it("a single half is still its own announcement beside the fused one", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(position())]);
        await runAnnounceCast(
            harness.ctx,
            splitCastAltCostId(fusedSplitProbe, "left")
        );
        await runSelectTarget(harness.ctx, "giant");
        await runTapForPayment(harness.ctx, ["mountain0"]);
        const item = harness.state().stack[0];
        expect(item.targets?.map((t) => t.id)).toEqual(["giant"]);
        expect((item.card as { id?: string }).id).toBe(
            `${FUSED_SPLIT_PROBE_ID}#left`
        );
    });
});
