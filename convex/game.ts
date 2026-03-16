import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCardById } from "./cards";
import { type GameState, getPlayer, moveCard } from "./gre/state";
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
        stack: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

// --- Queries ---

/** Public view: hides opponent's hand and all library contents. */
export const getPublicState = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await ctx.db
            .query("game_states")
            .filter((q) => q.eq(q.field("gameId"), args.gameId))
            .first();

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
    },
    handler: async (ctx, args) => {
        const gameState = await ctx.db
            .query("game_states")
            .filter((q) => q.eq(q.field("gameId"), args.gameId))
            .first();

        if (!gameState) return null;

        const state = gameState.state as GameState;

        return {
            ...state,
            players: state.players.map((player) => ({
                ...player,
                hand: player.hand.map((card) => ({
                    ...card,
                    legalActions: getLegalActions(state, player, card),
                })),
            })),
        };
    },
});

// --- Mutations ---

export const initGame = mutation({
    args: {
        name: v.string(),
        players: v.array(
            v.object({
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
            })
        ),
    },
    handler: async (ctx, args) => {
        const now = Date.now();

        // Create game record
        const gameId = await ctx.db.insert("games", {
            name: args.name,
            players: args.players.map((p) => p.id),
            createdAt: now,
            updatedAt: now,
        });

        // Build initial state for each player
        const playersState = args.players.map(buildPlayerState);

        // Save initial game state
        await ctx.db.insert("game_states", {
            gameId,
            state: {
                players: playersState,
                turn: 1,
                activePlayerId: playersState[0].id,
                phase: "BEGINNING",
            },
            updatedAt: now,
        });

        // Log init event
        await ctx.db.insert("events", {
            gameId,
            seq: 0,
            type: "GAME_INITIALIZED",
            player: "system",
            payload: {
                playerIds: args.players.map((p) => p.id),
            },
            timestamp: now,
        });

        return gameId;
    },
});

export const playCard = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await ctx.db
            .query("game_states")
            .filter((q) => q.eq(q.field("gameId"), args.gameId))
            .first();
        if (!gameState) throw new Error("Game not found");

        const state = gameState.state as GameState;
        const player = getPlayer(state, args.playerId);

        // Validate: card must be in hand and "play" must be legal
        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!cardInHand) throw new Error("Card not in hand");
        assertLegalAction(state, player, cardInHand, "play");

        const card = moveCard(
            player,
            args.cardInstanceId,
            "hand",
            "battlefield"
        );

        const now = Date.now();
        await ctx.db.patch(gameState._id, { state, updatedAt: now });

        // Get next seq number
        const lastEvent = await ctx.db
            .query("events")
            .filter((q) => q.eq(q.field("gameId"), args.gameId))
            .order("desc")
            .first();
        const seq = (lastEvent?.seq ?? -1) + 1;

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq,
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
