// Who may submit a gameplay action AS a seat (ADR 0181).
//
// `gameLifecycle.ts`'s `assertCallerOwnsSeat` answers "is this handle MINE".
// Under Turn Control (CR 723) that stops being the question: the controller
// makes every choice and decision of the controlled player (CR 723.5) and
// keeps making their own (CR 723.8), so the question becomes "do I own the
// player who ANSWERS for this seat". One rule covers the three cases — the
// controller may name the controlled seat, the controlled user may not name
// their own, and Solo Mode is untouched (one user owns both).
//
// Read off `gameTicks.turnControls`, the ACTIVE entries `saveGameTick`
// mirrors on every save: the check runs before the state load on every
// gameplay action, and the tick row is ~200 bytes.
//
// NOT for conceding (CR 723.6 — the controller cannot make the controlled
// player concede, and that player still may) nor for Phase Stop preferences
// (CR 723.5b — not a decision the game calls for): both keep the plain
// ownership check.

import { ConvexError } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { getCurrentUserId } from "./auth";
import { seatBelongsToUser } from "./gameLifecycle";
import { actingPlayerFor, type TurnControlView } from "./gre/turnControl";

/** Why `userId` may not act as `playerId`, or `null` when they may. */
export function seatAuthorityRefusal(
    view: TurnControlView,
    playerId: string,
    userId: string
): "not-your-seat" | "controlled-by-another-player" | null {
    if (seatBelongsToUser(actingPlayerFor(view, playerId), userId)) return null;
    return seatBelongsToUser(playerId, userId)
        ? "controlled-by-another-player"
        : "not-your-seat";
}

/** Throws unless `userId` owns the player who answers for `playerId`. */
export function assertSeatAuthority(
    view: TurnControlView,
    playerId: string,
    userId: string
): void {
    const refusal = seatAuthorityRefusal(view, playerId, userId);
    if (refusal === null) return;
    if (refusal === "controlled-by-another-player")
        // `ConvexError`: an ordinary click by a player whose turn is being
        // controlled — its text must survive a production deployment.
        throw new ConvexError(
            "Another player controls you this turn (CR 723.5)."
        );
    throw new Error("You cannot act as another player.");
}

/** The line every gameplay mutation that takes a CLIENT-SUPPLIED seat handle
 *  opens with: the authenticated caller must own the seat's Acting Player. */
export async function assertCallerActsForSeat(
    ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
    gameId: Id<"games">,
    playerId: string
): Promise<void> {
    const userId = await getCurrentUserId(ctx);
    const tick = await ctx.db
        .query("gameTicks")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .first();
    assertSeatAuthority({ turnControls: tick?.turnControls }, playerId, userId);
}
