import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { auth, getCurrentUser } from "./auth";
import { seatBelongsToUser } from "./gameLifecycle";
import { activeGameOpponentName, findActiveMatchForUser } from "./matches";
import { loadGameSeatCards } from "./deckStore";
import { waitingMatchFormat } from "./gameSeats";
import { gamesFormatForBestOf } from "./limited/gamesFormat";
import {
    getLatestManualState,
    projectManualState,
    type ManualGameState,
} from "./manual";

// The card-free READS of a game (issue #4855, PRD #4849): every function here
// reads rows and projects them without ever consulting a Card Definition, so
// this module imports neither the catalogue nor the GRE. `game.ts` carries
// both (~41 MiB of heap per call, re-materialised on every call and every
// subscription re-execution); the wake-up tick re-runs on every write of every
// game and `myActiveGame` is subscribed by every signed-in user in the lobby.
// `scripts/__tests__/convex-card-free-seam.test.ts` pins the cut by cause.

/** Cheap wake-up signal (PRD #1776 T3, issue #1778): the `gameTicks` row
 *  companion to `getPublicState`, ~150 bytes instead of 3-9 KB. A subscriber
 *  that only needs to know "did the game state change, and does a given seat
 *  owe input" — the vs-AI driver — subscribes here and only mounts the full
 *  `getPublicState` query once its seat appears in `owedPlayerIds` (issue
 *  #1778 review finding 1 — membership, not equality with a single
 *  `expectedInputPlayerId`; see `computeOwedPlayerIds`,
 *  `convex/gre/expectedInput.ts`), instead of holding a second full-state
 *  subscription that gets discarded on every beat it doesn't own. Returns
 *  `null` before the first save — the driver fails OPEN on that (finding 4,
 *  `useVsAiDriver.ts`) rather than deadlocking a pre-existing game. */
export const getGameTick = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("gameTicks")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .first();
    },
});

/** One-shot backfill for the `gameStates.solo`/`vsAi` mirror
 *  (`convex/schema.ts`): stamps the flags onto every row written before the
 *  field existed.
 *
 *  Not required for correctness — `getPublicState` falls back to the `games`
 *  row when both flags are absent — but a row nobody backfills keeps paying
 *  the 8.3 KB fallback read on every subscription re-execution for the rest of
 *  that game's life, which is the entire cost this mirror exists to remove.
 *  Run once per deployment after deploying:
 *
 *      bunx convex run --prod gameReads:backfillGameStateMode '{}'
 *
 *  Idempotent: an already-stamped row is skipped without a write, so
 *  re-running is free. `limit` bounds one invocation's transaction; the
 *  returned `remaining` says whether to run it again. */
export const backfillGameStateMode = internalMutation({
    args: { limit: v.optional(v.number()) },
    returns: v.object({ stamped: v.number(), remaining: v.number() }),
    handler: async (ctx, args) => {
        const limit = args.limit ?? 200;
        const rows = await ctx.db.query("gameStates").collect();
        const pending = rows.filter(
            (row) => row.solo === undefined && row.vsAi === undefined
        );
        let stamped = 0;
        for (const row of pending.slice(0, limit)) {
            const game = await ctx.db.get(row.gameId);
            await ctx.db.patch(row._id, {
                solo: game?.solo === true,
                vsAi: game?.vsAi === true,
            });
            stamped += 1;
        }
        return { stamped, remaining: pending.length - stamped };
    },
});

/** Returns the game record (status, players). Since issue #2506 the decklists
 *  are NOT on it — `players[].deck` carries identity only, `cardIds` carries
 *  the art-preload manifest, and a client that needs real card entries asks
 *  `getSeatDeck` for its OWN seat. */
export const getGame = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.gameId);
    },
});

/** ONE seat's decklist (issue #2506) — the client-side read that replaces the
 *  card entries `getGame` used to carry. Two callers, both of which need real
 *  card identities rather than the id manifest: the vs-AI driver, which wires
 *  the BOT's own deck into the search adapter so fetch/tutor subtrees search
 *  real cards (issue #1509), and the Debug panel's "clone this deck into a new
 *  solo game".
 *
 *  A seat's own decklist is public knowledge to its owner (only the ORDER is
 *  hidden), so this is gated on SEAT ownership, not mere presence in the game:
 *  in solo / vs-AI both handles belong to the one user, while in a 2-player
 *  game a client can no longer read the opponent's list at all — which
 *  `getGame` incidentally allowed before the split.
 *
 *  Deliberately NOT a subscription on the `games` row: the point lookup in
 *  `loadGameSeatCards` reads only the (immutable) decklist row, so this query
 *  does not re-execute on the `games` patches that fire several times a turn. */
export const getSeatDeck = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        if (!seatBelongsToUser(args.playerId, userId)) return null;
        const cards = await loadGameSeatCards(ctx, args.gameId, args.playerId);
        if (!cards) return null;
        return { playerId: args.playerId, cards };
    },
});

/** Returns the projected ManualGameState for a viewer. Reads the latest
 *  manualStates row and strips private information (opponent hand / library /
 *  faceDown identity) via projectManualState. Returns null when no state row
 *  exists yet (the game is still in pregame). */
export const getManualState = query({
    args: {
        gameId: v.id("games"),
        viewerId: v.string(),
    },
    handler: async (ctx, args) => {
        const latest = await getLatestManualState(ctx, args.gameId);
        if (!latest) return null;
        const state = latest.state as ManualGameState;
        return projectManualState(state, args.viewerId);
    },
});

/**
 * The top N cards of one seat's library, TOP FIRST — what the "Peek top N…" /
 * "Peek all" pile verbs actually show (manual-mode QA round 3, item 2).
 *
 * A dedicated query rather than a field on the projected state, because the
 * library is projected as `{ count }` for EVERYONE (`projectManualState`) and
 * must stay that way: peeking is an action a player takes, logged as such by
 * `manualPeek`, not a standing view. Subscribing to it keeps the open dialog
 * live — a card drawn or milled while it is up disappears from it.
 *
 * `n` omitted means the whole library ("Peek all" / searching). Private
 * metadata (`knownTo` / `revealedTo`) is stripped exactly as the state
 * projection strips it. Access follows `getManualState`'s convention (the
 * caller names the seat): a Manual Game enforces nothing, and one user
 * routinely steers both seats.
 */
export const getManualLibraryTop = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const latest = await getLatestManualState(ctx, args.gameId);
        if (!latest) return null;
        const state = latest.state as ManualGameState;
        const player = state.players.find((p) => p.id === args.playerId);
        if (!player) return null;
        const count =
            args.n === undefined
                ? player.library.length
                : Math.max(0, Math.min(args.n, player.library.length));
        const top = player.library
            .slice(player.library.length - count)
            .reverse()
            .map((card) => {
                const { knownTo, revealedTo, ...rest } = card;
                void knownTo;
                void revealedTo;
                return rest;
            });
        return { cards: top, libraryCount: player.library.length };
    },
});

/** Lightweight info for the invite antechamber (`/join/<gameId>`). Deliberately
 *  does NOT return either player's decklist — a prospective joiner must never
 *  see the host's cards. Exposes only what the join page renders: who created
 *  the game, its Match Format (ADR 0153 — the joiner's deck list is filtered by
 *  `isDeckAdmitted`; `joinGame` enforces it) and Games Format, and whether the
 *  game is still joinable. Returns `null` for an unknown id. */
export const getJoinInfo = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) return null;
        const host = game.players[0];
        const isHost = game.players.some((p) => p.id === user._id);
        const match = game.matchId ? await ctx.db.get(game.matchId) : null;
        return {
            gameId: game._id,
            name: game.name,
            hostName: host?.name ?? "Unknown",
            // A seatless row shouldn't surface here; fall back defensively.
            matchFormat: waitingMatchFormat(match, game) ?? "freeform",
            gamesFormat: gamesFormatForBestOf(match?.bestOf ?? 1),
            status: game.status,
            playerCount: game.players.length,
            isHost,
            // Joinable only while open, not yet full, and not the caller's own
            // game — mirrors the `joinGame` mutation guards (authoritative there).
            joinable:
                game.status === "waiting" && game.players.length < 2 && !isHost,
        };
    },
});

/** Returns all games waiting for a second player, excluding any the caller
 *  is already part of. Auth is required. Uses the `by_status` index so the
 *  subscription only re-fires (and reads docs) for `waiting` games — not the
 *  whole table. Finished/solo games never enter this query's bandwidth.
 *
 *  Each row carries the owning Match's Match Format (ADR 0153) and Games Format
 *  (PRD #387 / #397) so the join UI can surface and gate on them BEFORE the
 *  player commits — a joiner inherits both from the creator, not from their own
 *  lobby selection. */
export const listOpenGames = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return [];
        const waiting = await ctx.db
            .query("games")
            .withIndex("by_status", (q) => q.eq("status", "waiting"))
            .collect();
        const mine = waiting.filter(
            // Limited Event challenges (issue #1577) are PRIVATE to their two
            // paired seats — surfaced on the event page, never in the public
            // open-games lobby. An UNLISTED table (issue #4670) is reached by
            // its invite link or code alone, never by the broadcast.
            (g) =>
                !g.limitedChallenge &&
                !g.unlisted &&
                !g.players.some((p) => p.id === userId)
        );
        return Promise.all(
            mine.map(async (g) => {
                // The Match owns both Formats; a waiting Game always has a
                // matchId (createGame inserts both). A Match that is gone reads
                // as Bo1 with its host's Deck Format.
                const match = g.matchId ? await ctx.db.get(g.matchId) : null;
                // A join code is the HOST's to share (issue #2649). This query
                // spreads the raw row, so without the strip every open table's
                // code would ride every other player's lobby subscription —
                // handing out by broadcast the one thing a code is for.
                const { joinCode, ...row } = g;
                void joinCode;
                return {
                    ...row,
                    matchFormat: waitingMatchFormat(match, g) ?? "freeform",
                    gamesFormat: gamesFormatForBestOf(match?.bestOf ?? 1),
                };
            })
        );
    },
});

/** #155 (match-scoped): the caller's current active match's game, or null. The
 *  lobby uses this to surface an existing match instead of letting the user
 *  attempt a (rejected) second creation. Derived from the active Match so the
 *  Match is the single source of truth, but the wire shape is unchanged for the
 *  lobby (gameId + status flags) with the Match id added.
 *
 *  `matchStatus` rides along (issue #3336) because the GAME status alone is
 *  not enough to describe the banner's situation: a `finished` Game under a
 *  `sideboarding` Match is a Bo3 between Games, while the same Game under a
 *  `playing` Match is an orphan. The two read identically on `game.status`. */
export const myActiveGame = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        const match = await findActiveMatchForUser(ctx, userId);
        if (!match || !match.currentGameId) return null;
        const game = await ctx.db.get(match.currentGameId);
        if (!game) return null;
        const solo = game.solo === true;
        const vsAi = game.vsAi === true;
        const opponentName = activeGameOpponentName(match, userId, solo, vsAi);
        return {
            gameId: game._id,
            matchId: match._id,
            name: game.name,
            status: game.status,
            matchStatus: match.status,
            solo,
            vsAi,
            mode: game.mode ?? null,
            opponentName,
        };
    },
});
