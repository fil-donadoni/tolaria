// Casting one half of a SPLIT card through the full `game.ts` mutation path
// (CR 709.3, ADR 0121).
//
// The GRE test (`convex/gre/__tests__/splitCast.test.ts`) covers the option
// list, the pre-commit subject and the stack item; `splitCard.test.ts` covers
// the derivation and the twins. Neither drives `announceCast`, which is where
// the two headline behaviours live: the object that reaches the stack is the
// HALF and not the {2}{W}{U} card CR 709.4b says sits in every other zone, and
// a printed-cost announcement is REFUSED because CR 709.3 has the choice
// happen before the card is put onto the stack.
//
// Same harness discipline as `alurenCastPath.test.ts` / `bolassCitadelCastPath.test.ts`:
// no convex-test harness exists in this project, so the established seam for
// `game.ts` integration coverage is a stub `MutationCtx` driving the
// REGISTERED mutation's own `_handler` (`gameMutationHarness.ts`).

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget, tapForPayment } from "../game";
import { standDeliver } from "../cards/sets/inv/multicolor";
import { hillGiant } from "../cards/sets/lea/red";
import { plains, island } from "../cards/sets/lea/colorless";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { splitHalfDefinitionId } from "../cards/splitCard";
import { splitCastAltCostId } from "../gre/splitCast";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const LEFT_ALT = splitCastAltCostId(standDeliver, "left");
const RIGHT_ALT = splitCastAltCostId(standDeliver, "right");
const LEFT_ID = splitHalfDefinitionId(standDeliver.id, "left");

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};

const runAnnounceCast = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<AnnounceCastArgs, "gameId" | "playerId">
) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

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

/** The caster pays the announced HALF's mana cost, one land at a time — the
 *  same `tapForPayment` the board's click drives. `tryAutoCommitPendingCast`
 *  then commits, which is the DEFERRED commit site `castAsSplitHalf` rides
 *  `PendingCast.castAsSplitHalf` to (CR 709.3b). */
const runTapForPayment = (
    ctx: Parameters<typeof runMutation>[1],
    landIds: string[]
) =>
    runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            payments: landIds.map((cardInstanceId) => ({ cardInstanceId })),
        }
    );

const runSelectTarget = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<SelectTargetArgs, "gameId" | "playerId">
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

/** p1 holds Stand // Deliver with one Plains and three Islands — enough for
 *  EITHER half, so a cast that taps one Plains proves the left half's own
 *  {W} was the price and not the combined {2}{W}{U}. p2 has a Hill Giant, a
 *  legal target for both halves. */
function position(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(standDeliver.id, {
                        id: "split",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(plains.id, {
                        id: "plains0",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...Array.from({ length: 3 }, (_, i) =>
                        makeInstance(island.id, {
                            id: `island${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(hillGiant.id, {
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

describe("announceCast of one split half (CR 709.3, ADR 0121)", () => {
    it("puts the HALF on the stack, for the half's own price", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(position())]);

        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "split",
            alternativeCostId: LEFT_ALT,
        });
        // CR 709.3a — the announced subject is the twin, so the target
        // requirement being satisfied here is STAND's ("target creature"),
        // never the combined card's (it has none of its own).
        expect(harness.state().pendingTarget).toBeDefined();
        await runSelectTarget(harness.ctx, {
            targetType: "permanent",
            targetId: "giant",
        });
        await runTapForPayment(harness.ctx, ["plains0"]);

        const after = harness.state();
        expect(after.stack).toHaveLength(1);
        const item = after.stack[0];
        // CR 709.3b — "while on the stack, only the characteristics of the
        // half being cast exist."
        expect((item.card as { id?: string }).id).toBe(LEFT_ID);
        expect(item.splitHalfOf).toBe(standDeliver.id);
        // CR 709.4b — the card costs {2}{W}{U} in the hand it just left, and
        // that is NOT what was paid: one Plains, and the Islands untouched.
        const p1 = after.players[0];
        expect(
            p1.battlefield.filter((c) => c.isTapped).map((c) => c.id)
        ).toEqual(["plains0"]);
        expect(p1.hand).toHaveLength(0);
        // SURFACE — the client sees the half, through the real projection.
        const projected = projectPublicState(after, 1, "p1");
        expect((projected.stack[0].card as { id?: string }).id).toBe(LEFT_ID);
    });

    it("refuses a PRINTED-cost announcement (CR 709.3)", async () => {
        // "A player chooses which half of a split card they are casting
        // BEFORE putting it onto the stack" — so there is no announcement
        // that puts the combined object there, and the 709.4b summed cost is
        // a characteristic in a zone rather than a price anyone pays.
        const harness = makeMutationCtx("p1", [gameStateSeed(position())]);
        await expect(
            runAnnounceCast(harness.ctx, { cardInstanceId: "split" })
        ).rejects.toThrow(/one half at a time/);
        expect(harness.state().stack).toHaveLength(0);
        expect(harness.state().players[0].hand).toHaveLength(1);
    });

    it("the OTHER half is a different announcement, at its own price", async () => {
        // The discriminating pair: a seam that resolved both ids to one half
        // would pass the first test on its own.
        const harness = makeMutationCtx("p1", [gameStateSeed(position())]);
        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "split",
            alternativeCostId: RIGHT_ALT,
        });
        await runSelectTarget(harness.ctx, {
            targetType: "permanent",
            targetId: "giant",
        });
        await runTapForPayment(harness.ctx, ["island0", "island1", "island2"]);
        const after = harness.state();
        expect((after.stack[0].card as { id?: string }).id).toBe(
            splitHalfDefinitionId(standDeliver.id, "right")
        );
        // {2}{U} — the three Islands, and the Plains left standing.
        expect(
            after.players[0].battlefield
                .filter((c) => c.isTapped)
                .map((c) => c.id)
                .sort()
        ).toEqual(["island0", "island1", "island2"]);
    });
});
