/**
 * Force a Game's Match into the Bo3 between-Games Sideboarding gate: the
 * Debug panel's one-click state (`game.debugBo3Sideboard`, admin-gated) and
 * the `check:ui` seam's shortcut to it (`uiSeam.forceSideboarding`, double
 * gate) share THIS body, so the lane walks the state production reaches.
 *
 * The Match is promoted to `bestOf: 3`, the SECOND seat is recorded as Game
 * 1's winner through the same pure transition the game-over path uses
 * (`recordGameResult`, so a solo human's `-p1` seat is the play/draw chooser,
 * CR 103.1), the Match goes to "sideboarding", and the Game's state is ended
 * (`endGame`) so the board opens the Game-Over interstitial.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getLatestGameState, saveGameState } from "../gameStateStore";
import { endGame, type GameState } from "../gre/state";
import { recordGameResult } from "../matches";

export async function forceBo3Sideboarding(
    ctx: MutationCtx,
    gameId: Id<"games">
): Promise<void> {
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Game not found");
    if (!game.matchId) throw new Error("Game has no owning Match");
    const match = await ctx.db.get(game.matchId);
    if (!match) throw new Error("Match not found");

    // The second seat "wins" Game 1 — for a solo Match this is `-p2`, so the
    // human's `-p1` seat becomes the play/draw chooser (loser, CR 103.1).
    const winnerSeat = match.players[1] ?? match.players[0];
    const loserSeat = match.players.find((p) => p.id !== winnerSeat.id);

    const bo3: Doc<"matches"> = { ...match, bestOf: 3 };
    const patch = recordGameResult(bo3, winnerSeat.id);
    const now = Date.now();
    await ctx.db.patch(game.matchId, {
        bestOf: 3,
        ...(patch ?? {}),
        updatedAt: now,
    });

    // Mark the current Game finished and stamp `gameOver` so the board opens
    // the interstitial Game-Over dialog (→ Continue to Sideboarding).
    const existing = await getLatestGameState(ctx, gameId);
    if (existing) {
        const state = structuredClone(existing.state) as GameState;
        endGame(state, {
            winnerId: winnerSeat.id,
            loserId: loserSeat?.id ?? winnerSeat.id,
            reason: "concede",
        });
        await saveGameState(ctx, gameId, existing.seq, state, existing);
    }
    await ctx.db.patch(gameId, {
        status: "finished",
        winner: winnerSeat.id,
        updatedAt: now,
    });
}
