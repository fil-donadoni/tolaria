import { ConvexError, v, type GenericId } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./auth";
import { gameBelongsToUser } from "./gameLifecycle";
import {
    buildNextGameSeats,
    findActiveMatchForUser,
    forfeitMatch as computeForfeitMatch,
    matchBelongsToUser,
} from "./matches";
import {
    appendMatchSeat,
    hydrateGameSeats,
    hydrateMatchPlayers,
    insertGameWithDecks,
    insertMatchWithDecks,
    patchGameSeats,
} from "./deckStore";
import {
    ACTIVE_GAME_MESSAGE,
    PLAYER_COLORS,
    assertTabletopDeck,
    bestOfValidator,
    buildMatchPlayers,
    assertDeckAdmitted,
    deckValidator,
    waitingMatchFormat,
    toGamePlayers,
    type PlayerInput,
} from "./gameSeats";
import { type ManualGameState, type ManualLogEntry } from "./manual";
import {
    appendManualLog,
    getLatestManualState,
    saveManualState,
    setupManualGame,
    manualMoveCard as manualMoveCardFn,
    manualSetTapped as manualSetTappedFn,
    manualUntapAll as manualUntapAllFn,
    manualAdjustLife as manualAdjustLifeFn,
    manualAdjustCounter as manualAdjustCounterFn,
    manualSetFaceDown as manualSetFaceDownFn,
    manualSetLane as manualSetLaneFn,
    manualSetBackColumn as manualSetBackColumnFn,
    manualAttach as manualAttachFn,
    manualSetArrow as manualSetArrowFn,
    manualClearArrows as manualClearArrowsFn,
    manualClearArrow as manualClearArrowFn,
    manualDraw as manualDrawFn,
    manualMill as manualMillFn,
    manualExileTop as manualExileTopFn,
    manualPeek as manualPeekFn,
    manualShuffle as manualShuffleFn,
    manualCreateToken as manualCreateTokenFn,
    manualRoll as manualRollFn,
    manualSetNote as manualSetNoteFn,
    manualSetPhase as manualSetPhaseFn,
    manualSetActivePlayer as manualSetActivePlayerFn,
    manualEndTurn as manualEndTurnFn,
    manualConcede as manualConcedeFn,
    manualReveal as manualRevealFn,
    manualRevealHand as manualRevealHandFn,
    backfillManualCardNames,
} from "./manual";

// The Tabletop (manual) side of `game.ts` (issue #4855): ADR 0080's no-automation
// table. Every function here moves rows and applies the pure `manual.ts` verbs —
// none reads a Card Definition — so this module imports neither the catalogue
// nor the GRE, where `game.ts` re-materialises both (~45 MiB of heap) on every
// drag, tap and life change.

/**
 * Create a solo Tabletop (manual) game (ADR 0080 S12): one user controls both
 * seats, no rule enforcement, no automations. Game starts in "playing"
 * immediately — no coin toss, no mulligan flow. Concede is the only terminator.
 */
export const createManualSoloGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        deck2: v.optional(deckValidator),
        bestOf: bestOfValidator,
    },
    handler: async (ctx, args) => {
        // ADR 0080 — only Tabletop-format decks can start a Tabletop game.
        assertTabletopDeck(args.deck);
        if (args.deck2) assertTabletopDeck(args.deck2);
        const user = await getCurrentUser(ctx);
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);

        const deck2 = args.deck2 ?? args.deck;

        const player1Id = `${user._id}-p1`;
        const player2Id = `${user._id}-p2`;
        const allPlayers = [
            {
                id: player1Id,
                name: `${user.nickname} (P1)`,
                bgColor: PLAYER_COLORS[0],
                deck: args.deck,
            },
            {
                id: player2Id,
                name: `${user.nickname} (P2)`,
                bgColor: PLAYER_COLORS[1],
                deck: deck2,
            },
        ];
        const now = Date.now();

        // Manual games skip the pregame/coin-toss gate — start immediately.
        const matchPlayers = buildMatchPlayers(allPlayers);
        const matchId = await insertMatchWithDecks(ctx, {
            bestOf: args.bestOf ?? 1,
            // Cockatrice fixes the Match Format to Manual (ADR 0153 § 4);
            // `assertTabletopDeck` above is that Format's admission.
            matchFormat: "manual",
            status: "playing",
            players: matchPlayers,
            currentGameNumber: 1,
            solo: true,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await insertGameWithDecks(ctx, {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "playing",
            players: toGamePlayers(allPlayers),
            solo: true,
            mode: "manual",
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        // Build the initial ManualGameState from both decks.
        const initial = setupManualGame(
            allPlayers.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                deck: p.deck.cards,
            }))
        );

        await saveManualState(ctx, gameId, 0, initial, null);
        await appendManualLog(ctx, gameId, {
            text: "Tabletop game started",
            timestamp: now,
        });

        return gameId;
    },
});

/**
 * Open a MULTIPLAYER Tabletop (manual) table (ADR 0080 S12): a `waiting` Match
 * another human completes with `joinManualGame`. Structurally identical to
 * `createGame`'s waiting room — same `buildMatchPlayers` / `toGamePlayers`
 * primitives, same single-active-match guard — with two differences: the row
 * carries `mode: "manual"`, and the Match never enters the `pregame` coin-toss
 * gate, because a Tabletop game has no automated turn structure to hand to a
 * first player (roll the die verb, then "you start", exactly as at a table).
 */
export const createManualGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
        bestOf: bestOfValidator,
    },
    returns: v.id("games"),
    handler: async (ctx, args) => {
        assertTabletopDeck(args.deck);
        const user = await getCurrentUser(ctx);
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);

        const now = Date.now();
        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[0],
            deck: args.deck,
        };

        const matchId = await insertMatchWithDecks(ctx, {
            bestOf: args.bestOf ?? 1,
            // Cockatrice fixes the Match Format to Manual (ADR 0153 § 4).
            matchFormat: "manual",
            status: "waiting",
            players: buildMatchPlayers([player]),
            currentGameNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await insertGameWithDecks(ctx, {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "waiting",
            players: toGamePlayers([player]),
            mode: "manual",
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        return gameId;
    },
});

/**
 * Sit down at an open multiplayer Tabletop table (ADR 0080 S12). The mirror of
 * `joinGame` for manual mode — and it must be a SEPARATE mutation, not a branch
 * inside it: `joinGame` rejects a manual deck fail-closed (invariant 1, the
 * engine's only seam), builds a `pregame` coin-toss gate the Tabletop has no
 * use for, and runs the real-engine setup. Both seats' decks are snapshotted
 * into the initial `ManualGameState`; the game is immediately playable.
 */
export const joinManualGame = mutation({
    args: {
        gameId: v.id("games"),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        assertTabletopDeck(args.deck);
        const user = await getCurrentUser(ctx);
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);

        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        if (game.mode !== "manual")
            throw new Error(
                "That table is a real game — join it with a real deck."
            );
        if (game.status !== "waiting") throw new Error("Game is not open");
        if (game.players.length >= 2) throw new Error("Game is full");
        if (game.players.some((p) => p.id === user._id))
            throw new Error("Cannot join a game you are already in");
        // Match Format admission (ADR 0153): the join inherits the host's.
        const match = game.matchId ? await ctx.db.get(game.matchId) : null;
        const matchFormat = waitingMatchFormat(match, game);
        if (matchFormat !== null) assertDeckAdmitted(args.deck, matchFormat);

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[1],
            deck: args.deck,
        };
        // The host's decklist lives in `gameDecks` now (issue #2506) — hydrate
        // it, because the seats written back must carry BOTH decks.
        const allPlayers = [
            ...(await hydrateGameSeats(ctx, game)),
            ...toGamePlayers([player]),
        ];
        const now = Date.now();

        // No coin toss, no pregame gate: the table is live the moment the
        // second player sits down (ADR 0080 — no automation, concede is the
        // only terminator).
        if (match) {
            await appendMatchSeat(ctx, match, buildMatchPlayers([player])[0], {
                status: "playing",
                updatedAt: now,
            });
        }

        await patchGameSeats(ctx, args.gameId, allPlayers, {
            status: "playing",
            updatedAt: now,
        });

        const initial = setupManualGame(
            allPlayers.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                deck: p.deck.cards,
            }))
        );
        await saveManualState(ctx, args.gameId, 0, initial, null);
        await appendManualLog(ctx, args.gameId, {
            text: "Tabletop game started",
            timestamp: now,
        });

        return null;
    },
});

// --- Manual Mode mutations (ADR 0080 S2) ------------------------------------

type VerbResult = { state: ManualGameState; log: ManualLogEntry };

async function manualVerbHandler(
    ctx: MutationCtx,
    gameId: GenericId<"games">,
    apply: (state: ManualGameState) => VerbResult
): Promise<void> {
    const game = await ctx.db.get(gameId);
    if (!game) throw new ConvexError("Game not found");
    if (game.mode !== "manual") throw new ConvexError("Not a manual game");
    const user = await getCurrentUser(ctx);
    if (!gameBelongsToUser(game, user._id))
        throw new ConvexError("Not a player in this game");

    const existing = await getLatestManualState(ctx, gameId);
    if (!existing) throw new Error("Manual state not found");

    const state = existing.state as ManualGameState;
    // Self-repair for games started before cards carried their name (see
    // `backfillManualCardNames`): the decklists moved to `gameDecks` (issue
    // #2506), so this is now one point lookup per seat rather than free.
    const nameByPrintId = new Map<string, string>();
    for (const player of await hydrateGameSeats(ctx, game)) {
        for (const card of player.deck.cards) {
            if (!nameByPrintId.has(card.cardId))
                nameByPrintId.set(card.cardId, card.cardName);
        }
    }
    backfillManualCardNames(state, nameByPrintId);

    const result = apply(state);

    await saveManualState(
        ctx,
        gameId,
        existing.seq + 1,
        result.state,
        existing
    );
    await appendManualLog(ctx, gameId, result.log);
}

export const manualMoveCard = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        toZone: v.union(
            v.literal("library"),
            v.literal("hand"),
            v.literal("battlefield"),
            v.literal("graveyard"),
            v.literal("exile")
        ),
        index: v.optional(v.number()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualMoveCardFn(state, args.instanceId, args.toZone, args.index)
        );
        return null;
    },
});

export const manualSetTapped = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        tapped: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetTappedFn(state, args.instanceId, args.tapped)
        );
        return null;
    },
});

export const manualUntapAll = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualUntapAllFn(state, args.playerId)
        );
        return null;
    },
});

export const manualAdjustLife = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        delta: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualAdjustLifeFn(state, args.playerId, args.delta)
        );
        return null;
    },
});

export const manualAdjustCounter = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        type: v.string(),
        delta: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualAdjustCounterFn(state, args.instanceId, args.type, args.delta)
        );
        return null;
    },
});

export const manualSetFaceDown = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        faceDown: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetFaceDownFn(state, args.instanceId, args.faceDown)
        );
        return null;
    },
});

export const manualSetLane = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        lane: v.union(v.literal("main"), v.literal("combat")),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetLaneFn(state, args.instanceId, args.lane)
        );
        return null;
    },
});

export const manualSetBackColumn = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        column: v.union(v.literal("left"), v.literal("right")),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetBackColumnFn(state, args.instanceId, args.column)
        );
        return null;
    },
});

export const manualAttach = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        targetId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualAttachFn(state, args.instanceId, args.targetId)
        );
        return null;
    },
});

export const manualSetArrow = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        targetId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetArrowFn(state, args.instanceId, args.targetId)
        );
        return null;
    },
});

export const manualClearArrows = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualClearArrowsFn(state, args.playerId)
        );
        return null;
    },
});

export const manualClearArrow = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualClearArrowFn(state, args.instanceId)
        );
        return null;
    },
});

export const manualDraw = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualDrawFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualMill = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualMillFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualExileTop = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualExileTopFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualPeek = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualPeekFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualShuffle = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualShuffleFn(state, args.playerId)
        );
        return null;
    },
});

export const manualCreateToken = mutation({
    args: {
        gameId: v.id("games"),
        cardId: v.string(),
        controllerId: v.string(),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualCreateTokenFn(
                state,
                args.cardId,
                args.controllerId,
                args.playerId
            )
        );
        return null;
    },
});

export const manualRoll = mutation({
    args: {
        gameId: v.id("games"),
        sides: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualRollFn(state, args.sides)
        );
        return null;
    },
});

export const manualSetNote = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        text: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetNoteFn(state, args.instanceId, args.text)
        );
        return null;
    },
});

export const manualSetPhase = mutation({
    args: {
        gameId: v.id("games"),
        phase: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetPhaseFn(state, args.phase)
        );
        return null;
    },
});

export const manualSetActivePlayer = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetActivePlayerFn(state, args.playerId)
        );
        return null;
    },
});

export const manualEndTurn = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualEndTurnFn(state, args.playerId)
        );
        return null;
    },
});

// `manualConcede` — a mutation that ran `manualConcedeFn` and stopped there —
// was DELETED here. It stamped `concededBy` on the manual state and nothing,
// client or server, ever read that field, so the board's Concede button
// dispatched a write that ended no game: the whole visible symptom of the QA
// report. There is exactly one concede in Manual Mode and it is
// `manualConcedeMatch` below, which finishes the game row too.

/**
 * Concede and finalize the WHOLE manual Match (ADR 0080 S12), regardless of
 * `bestOf` — the ADR 0080 S12 twin of the `forfeitMatch` mutation for GRE
 * Matches, and reuses the same pure transition (`computeForfeitMatch`) for
 * exactly that reason. The conceding player's opponent is awarded the games
 * they still need to win and the Match is marked "finished".
 *
 * Deliberately NOT `recordGameResult` (#2400 review round 2): that transition
 * only ends the CURRENT Game, and for a Bo3 mid-Match it advances the Match to
 * "sideboarding" — still an `ACTIVE_MATCH_STATUSES` member, so
 * `findActiveMatchForUser` still finds it. `manualConcedeMatch` has exactly
 * two callers today (the lobby's "Concede Match" banner and the Scenarios
 * admin panel's active-game dialog) and both mean "abandon the whole Match so
 * I'm free to start something else" — never "advance to the next Bo3 game",
 * which has its own explicit action (`continueManualMatch`).
 *
 * `computeForfeitMatch` returning `null` (the seat named isn't actually in
 * this Match) fails CLOSED — the mutation throws instead of silently
 * attributing the win/loss to the wrong seat, the same fail-closed shape
 * `forfeitMatch` already has.
 *
 * The manual state persists for the completed game — the log is the only
 * artefact worth reading.
 */
export const manualConcedeMatch = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualConcedeFn(state, args.playerId)
        );

        const now = Date.now();
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new ConvexError("Game not found");
        if (!game.matchId) throw new Error("Game has no Match");

        const match = await ctx.db.get(game.matchId);
        if (!match) throw new Error("Match not found");
        if (match.status === "finished") return;

        const patch = computeForfeitMatch(match, args.playerId);
        if (!patch) throw new Error("Seat not found in this match");

        // Mark the game row finished BEFORE the match patch, so the status
        // subscription sees a finished game with a winner.
        await ctx.db.patch(args.gameId, {
            status: "finished",
            winner: patch.winner,
            updatedAt: now,
        });

        await ctx.db.patch(game.matchId, { ...patch, updatedAt: now });

        // Clean up manualStates — the game is over, and the log is the only
        // artefact worth keeping (ADR 0080 S12 open decision).
        const manualRows = await ctx.db
            .query("manualStates")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const row of manualRows) await ctx.db.delete(row._id);
    },
});

/**
 * Start the next game of a Tabletop Bo3 Match (ADR 0080 S12). Reshuffles both
 * decks, draws 7, resets life to 20 — no coin toss, no sideboarding. The Match
 * must be in "sideboarding" status.
 */
export const continueManualMatch = mutation({
    args: {
        matchId: v.id("matches"),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");
        if (match.status !== "sideboarding")
            throw new Error("Match is not awaiting the next game");

        const now = Date.now();
        const gameNumber = (match.currentGameNumber ?? 1) + 1;

        // Build the next game's inputs from the Match's stored decks.
        // The Match deck copies live in `matchDecks` now (issue #2506) — the
        // next Game's library is built from them, so this path hydrates.
        const seats = buildNextGameSeats({
            players: await hydrateMatchPlayers(ctx, match),
        });
        const gameId = await insertGameWithDecks(ctx, {
            name: `Tabletop game ${gameNumber}`,
            matchId: args.matchId,
            gameNumber,
            status: "playing",
            players: toGamePlayers(seats),
            solo: true,
            mode: "manual",
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(args.matchId, {
            status: "playing",
            currentGameId: gameId,
            currentGameNumber: gameNumber,
            updatedAt: now,
        });

        // Fresh manual state from the stored decks.
        const initial = setupManualGame(
            seats.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                deck: p.deck.cards,
            }))
        );

        await saveManualState(ctx, gameId, 0, initial, null);
        await appendManualLog(ctx, gameId, {
            text: `Game ${gameNumber} started`,
            timestamp: now,
        });

        return { gameId, gameNumber };
    },
});

export const manualReveal = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        toPlayerIds: v.array(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualRevealFn(state, args.instanceId, args.toPlayerIds)
        );
        return null;
    },
});

export const manualRevealHand = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        toPlayerIds: v.array(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualRevealHandFn(state, args.playerId, args.toPlayerIds)
        );
        return null;
    },
});
