import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { getCurrentUser } from "./auth";
import { asDbRounds, callerOwnsSeat, gameBelongsToUser } from "./gameLifecycle";
import { applySideboard, matchBelongsToUser } from "./matches";
import {
    deleteGameDecks,
    deleteMatchDecks,
    loadMatchSeatDecks,
    saveMatchSeatDeck,
} from "./deckStore";
import { unbindPairingMatch } from "./limited/pairingMatch";

// Leaving a table and sideboarding between Games (issue #4855): both move rows
// and apply the pure `applySideboard` / `unbindPairingMatch` transitions, and
// neither reads a Card Definition, so this module imports neither the
// catalogue nor the GRE.

/** #155: abandon a *waiting* game the user created but no opponent joined,
 *  freeing them to start another. A game in progress must be conceded
 *  instead (`concede`) — leaving it outright would strand the opponent. */
export const leaveGame = mutation({
    args: { gameId: v.id("games") },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) return; // already gone — nothing to free
        if (!gameBelongsToUser(game, user._id))
            throw new Error("You are not part of this game");
        // "pregame" (G1 coin-toss gate) has no gameStates row and no moves
        // played, so it abandons like a waiting room; "playing" must be
        // conceded instead.
        //
        // The refusal names the Game's ACTUAL status (issue #3336): a
        // `finished` Game whose Match is still active — a Bo3 between Games —
        // is not "in progress", and telling the user it is sent them looking
        // for a Concede button the lobby was hiding precisely because the Game
        // was not `playing`. `~/lib/activeGameExit` is the client-side twin of
        // this refusal, so the banner offers the verb this mutation accepts.
        if (game.status !== "waiting" && game.status !== "pregame")
            throw new Error(
                game.status === "finished"
                    ? "Cannot leave a finished game; concede the match instead"
                    : "Cannot leave a game in progress; concede instead"
            );
        // Delete any state snapshots first, then the orphan waiting room and its
        // owning waiting Match (ADR 0029) so the user is free to start another.
        const states = await ctx.db
            .query("gameStates")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const s of states) await ctx.db.delete(s._id);
        // Tick row companion (PRD #1776 T3, issue #1778) — same defensive
        // cleanup as `gameStates` above, though a "waiting"/"pregame" game
        // has never reached `saveGameState` so this is normally a no-op.
        const ticks = await ctx.db
            .query("gameTicks")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const t of ticks) await ctx.db.delete(t._id);
        // Decklist companion (issue #2506) — same orphan risk as `gameStates`.
        await deleteGameDecks(ctx, args.gameId);
        await ctx.db.delete(args.gameId);
        if (game.matchId) {
            const match = await ctx.db.get(game.matchId);
            if (
                match &&
                (match.status === "waiting" || match.status === "pregame")
            ) {
                await deleteMatchDecks(ctx, game.matchId);
                await ctx.db.delete(game.matchId);
                // A round pairing Match abandoned before it started (issue
                // #1645): release the pairing so the seat can start it again,
                // rather than leaving it pointing at a deleted Match.
                await releaseAbandonedPairing(ctx, match);
            }
        }
    },
});

/** Clears the `matchId` a deleted, never-started pairing Match left on its
 *  pairing (issue #1645). Silent no-op for any Match that isn't a pairing
 *  Match, and for a pairing already decided — `unbindPairingMatch` owns both
 *  refusals. */
async function releaseAbandonedPairing(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    match: Doc<"matches">
): Promise<void> {
    const link = match.limitedPairing;
    if (!link || !match.limitedEventId) return;
    const event = await ctx.db.get(match.limitedEventId as Id<"limitedEvents">);
    if (!event) return;
    const rounds = unbindPairingMatch(
        event.rounds ?? [],
        link.round,
        link.seatA
    );
    if (!rounds) return;
    await ctx.db.patch(event._id, {
        rounds: asDbRounds(rounds),
        updatedAt: Date.now(),
    });
}

/**
 * Submit a player's sideboarding swaps for the between-Games gate (PRD #387 /
 * #395). Re-partitions the player's Match deck copy via the pure `applySideboard`
 * helper, which validates the size-lock (Maindeck size unchanged) and the pool
 * invariant (combined pool unchanged). Edits the MATCH copy only — `userDecks`
 * is never touched. Submitting does NOT ready the seat; `setReady` is separate,
 * so a player may revise before confirming.
 */
export const submitSideboard = mutation({
    args: {
        matchId: v.id("matches"),
        seatId: v.string(),
        maindeck: v.array(
            v.object({ cardId: v.string(), cardName: v.string() })
        ),
        sideboard: v.array(
            v.object({ cardId: v.string(), cardName: v.string() })
        ),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");
        if (match.status !== "sideboarding")
            throw new Error("Match is not in the sideboarding step");

        const seatIdx = match.players.findIndex((p) => p.id === args.seatId);
        if (seatIdx === -1) throw new Error("Seat not found in this match");
        const seat = match.players[seatIdx];
        if (!callerOwnsSeat(match, seat, user._id))
            throw new Error("You cannot sideboard for that seat");

        // The deck copy this re-partitions lives in `matchDecks` (issue #2506)
        // — the ONE path that edits deck CONTENT between Games. Read only this
        // seat's row; the opponent's is untouched and unread.
        const current = (await loadMatchSeatDecks(ctx, match, [seat.id])).get(
            seat.id
        );
        if (!current) throw new Error("Seat has no deck copy in this match");

        // Pure validation + apply (size-lock + pool preservation). Throws on an
        // illegal swap, rolling the mutation back atomically.
        const nextDeck = applySideboard(current, {
            maindeck: args.maindeck,
            sideboard: args.sideboard,
        });

        await saveMatchSeatDeck(ctx, match, seat.id, nextDeck, {
            updatedAt: Date.now(),
        });
    },
});
