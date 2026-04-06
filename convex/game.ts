import { v, type GenericId } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getCardById } from "./cards";
import {
    type GameState,
    type StackItem,
    getPlayer,
    getOpponentId,
    moveCard,
    removeFromZone,
    getBasicLandMana,
    payManaCost,
    commitLandsForCost,
    resolveTopOfStack,
    normalizeManaCost,
    isManaCostCovered,
} from "./gre/state";
import { assertLegalAction, getLegalActions } from "./gre/rules";

const STARTING_HAND_SIZE = 7;

type DeckInput = {
    id: string;
    name: string;
    format: string;
    cards: { cardId: string; cardName: string }[];
};

type PlayerInput = {
    id: string;
    name: string;
    bgColor: string;
    deck: DeckInput;
};

function shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function buildPlayerState(player: PlayerInput) {
    // Create CardInstances from deck, all starting in library
    const instances = player.deck.cards.map((deckCard) => {
        const def = getCardById(deckCard.cardId);
        return {
            id: crypto.randomUUID(),
            card: {
                id: def.id,
                name: def.name,
                manaCost: def.manaCost,
                types: def.types,
                subtypes: def.subtypes,
                supertypes: def.supertypes,
                power: def.power,
                toughness: def.toughness,
                loyalty: def.loyalty,
            },
            controllerId: player.id,
            ownerId: player.id,
            zone: "library" as const,
            isTapped: false,
        };
    });

    // Shuffle library
    const shuffled = shuffle(instances);

    // Draw starting hand
    const hand = shuffled.slice(0, STARTING_HAND_SIZE).map((c) => ({
        ...c,
        zone: "hand" as const,
    }));
    const library = shuffled.slice(STARTING_HAND_SIZE);

    return {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: 20,
        deck: player.deck,
        hand,
        library,
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

// --- Helpers ---

async function getLatestGameState(
    ctx: Pick<GenericQueryCtx<DataModel>, "db">,
    gameId: GenericId<"games">
): Promise<Doc<"game_states"> | null> {
    const states = await ctx.db
        .query("game_states")
        .filter((q) => q.eq(q.field("gameId"), gameId))
        .collect();
    if (states.length === 0) return null;
    return states.reduce((a, b) => (a.seq > b.seq ? a : b));
}

// --- Queries ---

/** Public view: hides opponent's hand and all library contents. */
export const getPublicState = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) return null;

        const state = gameState.state as {
            players: Array<{
                id: string;
                hand: unknown[];
                library: unknown[];
                [key: string]: unknown;
            }>;
            [key: string]: unknown;
        };

        const players = state.players.map((player) => {
            const isMe = player.id === args.playerId;
            return {
                ...player,
                hand: isMe ? player.hand : player.hand.map(() => null),
                library: { count: player.library.length },
            };
        });

        return { ...state, players };
    },
});

/** Debug-only: returns the full unfiltered game state with legal actions. */
export const getFullState = query({
    args: {
        gameId: v.id("games"),
        debugAllActions: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) return null;

        const state = gameState.state as GameState;
        const allActions = args.debugAllActions ?? false;

        return {
            ...state,
            seq: gameState.seq,
            players: state.players.map((player) => ({
                ...player,
                hand: player.hand.map((card) => ({
                    ...card,
                    legalActions: getLegalActions(
                        state,
                        player,
                        card,
                        allActions
                    ),
                })),
            })),
        };
    },
});

/** Returns the game record (status, players). */
export const getGame = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.gameId);
    },
});

/** Returns all games waiting for a second player. */
export const listOpenGames = query({
    handler: async (ctx) => {
        const games = await ctx.db.query("games").collect();
        return games.filter((g) => g.status === "waiting");
    },
});

// --- Mutations ---

const playerValidator = v.object({
    id: v.string(),
    name: v.string(),
    bgColor: v.string(),
    deck: v.object({
        id: v.string(),
        name: v.string(),
        format: v.string(),
        cards: v.array(
            v.object({
                cardId: v.string(),
                cardName: v.string(),
            })
        ),
    }),
});

export const createGame = mutation({
    args: {
        name: v.string(),
        player: playerValidator,
    },
    handler: async (ctx, args) => {
        const now = Date.now();

        const gameId = await ctx.db.insert("games", {
            name: args.name,
            status: "waiting",
            players: [args.player],
            createdAt: now,
            updatedAt: now,
        });

        return gameId;
    },
});

export const joinGame = mutation({
    args: {
        gameId: v.id("games"),
        player: playerValidator,
    },
    handler: async (ctx, args) => {
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        if (game.status !== "waiting") throw new Error("Game is not open");
        if (game.players.length >= 2) throw new Error("Game is full");

        const allPlayers = [...game.players, args.player];
        const now = Date.now();

        // Update game record
        await ctx.db.patch(args.gameId, {
            status: "playing",
            players: allPlayers,
            updatedAt: now,
        });

        // Build initial state for both players
        const playersState = allPlayers.map(buildPlayerState);

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: 0,
            state: {
                players: playersState,
                stack: [],
                turn: 1,
                activePlayerId: playersState[0].id,
                priorityPlayerId: playersState[0].id,
                passCount: 0,
                phase: "BEGINNING",
            },
            updatedAt: now,
        });

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: 0,
            type: "GAME_INITIALIZED",
            player: "system",
            payload: {
                playerIds: allPlayers.map((p) => p.id),
            },
            timestamp: now,
        });
    },
});

export const playCard = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        skipValidation: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        const player = getPlayer(state, args.playerId);

        // Validate: card must be in hand and "play" must be legal
        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!cardInHand) throw new Error("Card not in hand");
        if (!args.skipValidation) {
            assertLegalAction(state, player, cardInHand, "play");
        }

        const card = moveCard(
            player,
            args.cardInstanceId,
            "hand",
            "battlefield"
        );

        const now = Date.now();
        const nextSeq = gameState.seq + 1;

        // Insert new snapshot (don't overwrite previous)
        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: nextSeq,
            state,
            updatedAt: now,
        });

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
            type: "CARD_PLAYED",
            player: args.playerId,
            payload: {
                cardInstanceId: card.id,
                cardName: (card.card as { name?: string }).name,
                from: "hand",
                to: "battlefield",
            },
            timestamp: now,
        });
    },
});

/** Step 1 of casting: announce the spell, enter payment phase (CR 601.2a). */
export const announceCast = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        const player = getPlayer(state, args.playerId);

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }
        if (state.pendingCast) {
            throw new Error("Another spell is already being cast");
        }

        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!cardInHand) throw new Error("Card not in hand");
        assertLegalAction(state, player, cardInHand, "cast");

        const rawCost = (
            cardInHand.card as {
                manaCost?: Record<string, number | string | undefined>;
            }
        ).manaCost;

        const manaCost = rawCost ? normalizeManaCost(rawCost) : {};

        // If cost is zero or pool already covers it, commit immediately
        if (
            Object.keys(manaCost).length === 0 ||
            isManaCostCovered(player.manaPool, manaCost)
        ) {
            if (Object.keys(manaCost).length > 0) {
                payManaCost(player.manaPool, manaCost);
                commitLandsForCost(player, manaCost);
            }
            const card = removeFromZone(player, args.cardInstanceId, "hand");
            const stackItem: StackItem = {
                ...card,
                castById: args.playerId,
            };
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
        } else {
            // Enter payment phase for remaining mana
            state.pendingCast = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                manaCost,
                tappedLandIds: [],
            };
        }

        const now = Date.now();
        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: now,
        });

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            type: state.pendingCast ? "CAST_ANNOUNCED" : "SPELL_CAST",
            player: args.playerId,
            payload: {
                cardInstanceId: args.cardInstanceId,
                cardName: (cardInHand.card as { name?: string }).name,
            },
            timestamp: now,
        });
    },
});

/** Step 2: tap a land during payment to add mana. Auto-commits when cost is covered. */
export const tapForPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");
        if (card.isTapped) throw new Error("Card already tapped");

        const types = (card.card as { types?: string[] }).types ?? [];
        if (!types.includes("Land")) {
            throw new Error("Only lands can be tapped for mana");
        }

        const manaColor = getBasicLandMana(card);
        if (!manaColor) throw new Error("Land does not produce mana");

        // Tap and add mana
        card.isTapped = true;
        player.manaPool[manaColor] = (player.manaPool[manaColor] ?? 0) + 1;
        state.pendingCast.tappedLandIds.push(card.id);

        // Check if cost is now covered → auto-commit
        if (isManaCostCovered(player.manaPool, state.pendingCast.manaCost)) {
            // Pay the cost from pool and commit the lands
            payManaCost(player.manaPool, state.pendingCast.manaCost);
            commitLandsForCost(player, state.pendingCast.manaCost);

            // Move spell from hand to stack
            const spellCard = removeFromZone(
                player,
                state.pendingCast.cardInstanceId,
                "hand"
            );
            const stackItem: StackItem = {
                ...spellCard,
                castById: args.playerId,
            };
            state.stack.push(stackItem);

            const cardName = (spellCard.card as { name?: string }).name;
            state.pendingCast = undefined;
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);

            const now = Date.now();
            await ctx.db.insert("game_states", {
                gameId: args.gameId,
                seq: gameState.seq + 1,
                state,
                updatedAt: now,
            });

            await ctx.db.insert("events", {
                gameId: args.gameId,
                seq: gameState.seq + 1,
                type: "SPELL_CAST",
                player: args.playerId,
                payload: {
                    cardInstanceId: spellCard.id,
                    cardName,
                },
                timestamp: now,
            });
        } else {
            // Just save the tap
            const now = Date.now();
            await ctx.db.insert("game_states", {
                gameId: args.gameId,
                seq: gameState.seq + 1,
                state,
                updatedAt: now,
            });
        }
    },
});

/** Untap a land during payment (undo). */
export const untapForPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        // Only lands tapped during this payment can be untapped
        const idx = state.pendingCast.tappedLandIds.indexOf(
            args.cardInstanceId
        );
        if (idx === -1) {
            throw new Error("This land was not tapped during this cast");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        const manaColor = getBasicLandMana(card);
        if (!manaColor) throw new Error("Land does not produce mana");

        card.isTapped = false;
        player.manaPool[manaColor] = Math.max(
            0,
            (player.manaPool[manaColor] ?? 0) - 1
        );
        state.pendingCast.tappedLandIds.splice(idx, 1);

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Cancel a pending cast: rollback all taps (CR 601.2 reversal). */
export const cancelCast = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        const player = getPlayer(state, args.playerId);

        // Rollback all taps
        for (const landId of state.pendingCast.tappedLandIds) {
            const land = player.battlefield.find((c) => c.id === landId);
            if (land) {
                land.isTapped = false;
                const manaColor = getBasicLandMana(land);
                if (manaColor) {
                    player.manaPool[manaColor] = Math.max(
                        0,
                        (player.manaPool[manaColor] ?? 0) - 1
                    );
                }
            }
        }

        state.pendingCast = undefined;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

export const passPriority = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }

        state.passCount += 1;

        if (state.passCount >= 2 && state.stack.length > 0) {
            // Both players passed consecutively — resolve top of stack (CR 117.3d)
            const resolved = resolveTopOfStack(state);

            // After resolution, priority goes to active player (CR 117.3b)
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;

            const now = Date.now();
            const nextSeq = gameState.seq + 1;

            await ctx.db.insert("game_states", {
                gameId: args.gameId,
                seq: nextSeq,
                state,
                updatedAt: now,
            });

            await ctx.db.insert("events", {
                gameId: args.gameId,
                seq: nextSeq,
                type: "SPELL_RESOLVED",
                player: args.playerId,
                payload: {
                    cardInstanceId: resolved.id,
                    cardName: (resolved.card as { name?: string }).name,
                    destination: resolved.zone,
                },
                timestamp: now,
            });
        } else {
            // Pass priority to opponent
            state.priorityPlayerId = getOpponentId(state, args.playerId);

            const now = Date.now();
            const nextSeq = gameState.seq + 1;

            await ctx.db.insert("game_states", {
                gameId: args.gameId,
                seq: nextSeq,
                state,
                updatedAt: now,
            });

            await ctx.db.insert("events", {
                gameId: args.gameId,
                seq: nextSeq,
                type: "PRIORITY_PASSED",
                player: args.playerId,
                payload: {},
                timestamp: now,
            });
        }
    },
});

export const drawCard = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        const card = moveCard(player, player.library[0].id, "library", "hand");

        const now = Date.now();
        const nextSeq = gameState.seq + 1;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: nextSeq,
            state,
            updatedAt: now,
        });

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
            type: "CARD_DRAWN",
            player: args.playerId,
            payload: {
                cardInstanceId: card.id,
                cardName: (card.card as { name?: string }).name,
            },
            timestamp: now,
        });
    },
});

export const mill = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        const card = moveCard(
            player,
            player.library[0].id,
            "library",
            "graveyard"
        );

        const now = Date.now();
        const nextSeq = gameState.seq + 1;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: nextSeq,
            state,
            updatedAt: now,
        });

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
            type: "CARD_MILLED",
            player: args.playerId,
            payload: {
                cardInstanceId: card.id,
                cardName: (card.card as { name?: string }).name,
            },
            timestamp: now,
        });
    },
});

export const exileFromLibrary = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        const card = moveCard(player, player.library[0].id, "library", "exile");

        const now = Date.now();
        const nextSeq = gameState.seq + 1;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: nextSeq,
            state,
            updatedAt: now,
        });

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
            type: "CARD_EXILED",
            player: args.playerId,
            payload: {
                cardInstanceId: card.id,
                cardName: (card.card as { name?: string }).name,
                from: "library",
            },
            timestamp: now,
        });
    },
});

export const tapUntap = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        const player = getPlayer(state, args.playerId);

        // Cannot manually tap/untap during payment phase
        if (state.pendingCast) {
            throw new Error("Use tapForPayment/untapForPayment during casting");
        }

        // Mana abilities don't require priority (CR 605.3a)

        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        const types = (card.card as { types?: string[] }).types ?? [];
        if (!types.includes("Land")) {
            throw new Error("Only lands can be tapped/untapped manually");
        }

        const wasTapped = card.isTapped;

        // Block untap if land is committed (mana was spent on a cast)
        if (wasTapped && card.manaCommitted) {
            throw new Error("Cannot untap: mana already spent");
        }

        card.isTapped = !card.isTapped;

        // Mana ability: basic land subtypes produce mana on tap, remove on untap
        const manaColor = getBasicLandMana(card);
        if (manaColor) {
            if (!wasTapped) {
                player.manaPool[manaColor] =
                    (player.manaPool[manaColor] ?? 0) + 1;
            } else {
                player.manaPool[manaColor] =
                    (player.manaPool[manaColor] ?? 0) - 1;
            }
        }

        // Save updated state (tap/untap persists with the current snapshot)
        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Debug: patch any value in the game state by dot-separated path. */
export const debugPatchState = mutation({
    args: {
        gameId: v.id("games"),
        path: v.string(),
        value: v.any(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as Record<
            string,
            unknown
        >;
        const keys = args.path.split(".");
        let target: Record<string, unknown> = state;

        for (let i = 0; i < keys.length - 1; i++) {
            target = target[keys[i]] as Record<string, unknown>;
            if (!target) throw new Error(`Invalid path: ${args.path}`);
        }

        target[keys[keys.length - 1]] = args.value;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Debug: undo last action by deleting the latest snapshot. */
export const debugUndo = mutation({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const states = await ctx.db
            .query("game_states")
            .filter((q) => q.eq(q.field("gameId"), args.gameId))
            .collect();

        if (states.length <= 1) {
            throw new Error("Nothing to undo");
        }

        // Find and delete the one with highest seq
        const latest = states.reduce((a, b) => (a.seq > b.seq ? a : b));
        await ctx.db.delete(latest._id);
    },
});

/** Debug: reset game to initial state (seq 0). */
export const debugResetGame = mutation({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const states = await ctx.db
            .query("game_states")
            .filter((q) => q.eq(q.field("gameId"), args.gameId))
            .collect();

        // Delete all except seq 0
        for (const s of states) {
            if (s.seq > 0) {
                await ctx.db.delete(s._id);
            }
        }
    },
});
