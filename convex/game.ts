import { v, type GenericId } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getCardById, getCardByName, getAllCardNames } from "./cards";
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
import {
    assertLegalAction,
    getLegalActions,
    getLegalTargets,
} from "./gre/rules";
import {
    advancePhase,
    drainAutoPasses,
    applyAllCombatDamage,
} from "./gre/phases";
import type { Phase } from "./gre/types";

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
                supertypes: def.supertypes,
                loyalty: def.loyalty,
            },
            types: def.types,
            subtypes: def.subtypes ?? [],
            power: def.power,
            toughness: def.toughness,
            staticAbilities: def.staticAbilities ?? [],
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

        // Build initial state and let the phase machine advance through
        // auto-phases (UNTAP) to the first priority phase (UPKEEP).
        const initialState: GameState = {
            players: playersState,
            stack: [],
            turn: 1,
            activePlayerId: playersState[0].id,
            priorityPlayerId: playersState[0].id,
            passCount: 0,
            phase: "UNTAP" as Phase,
        };
        // UNTAP is auto → advances to UPKEEP (with entry actions along the way)
        advancePhase(initialState);

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: 0,
            state: initialState,
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
        if (state.pendingTarget) {
            throw new Error("Target selection is in progress");
        }

        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!cardInHand) throw new Error("Card not in hand");
        assertLegalAction(state, player, cardInHand, "cast");

        // Check if the card requires targets (CR 601.2c)
        const cardDef = getCardById((cardInHand.card as { id: string }).id);
        if (cardDef.targetRequirement) {
            const legalTargets = getLegalTargets(
                state,
                cardDef.targetRequirement
            );
            if (legalTargets.length === 0) {
                throw new Error("No legal targets available");
            }
            // Enter target selection phase before mana payment
            state.pendingTarget = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                targetType: cardDef.targetRequirement.type,
                count: cardDef.targetRequirement.count,
                selected: [],
            };

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
                type: "TARGET_SELECTION_STARTED",
                player: args.playerId,
                payload: {
                    cardInstanceId: args.cardInstanceId,
                    cardName: (cardInHand.card as { name?: string }).name,
                    targetType: cardDef.targetRequirement.type,
                },
                timestamp: now,
            });
            return;
        }

        // No targets needed — proceed directly to mana payment / cast
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
            drainAutoPasses(state);
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

        const types = card.types;
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
            const pendingTargets = (
                state.pendingCast as Record<string, unknown>
            ).targets as StackItem["targets"] | undefined;
            const stackItem: StackItem = {
                ...spellCard,
                castById: args.playerId,
                ...(pendingTargets ? { targets: pendingTargets } : {}),
            };
            state.stack.push(stackItem);

            const cardName = (spellCard.card as { name?: string }).name;
            state.pendingCast = undefined;
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
            drainAutoPasses(state);

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

/** Select a target for a spell being announced (CR 601.2c). */
export const selectTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        targetType: v.union(v.literal("creature"), v.literal("player")),
        targetId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        // Validate target is legal
        // TargetSelection uses "permanent" for all permanent types (creature, land, etc.)
        const target: { type: "permanent" | "player"; id: string } = {
            type: args.targetType === "player" ? "player" : "permanent",
            id: args.targetId,
        };
        if (args.targetType === "creature") {
            const found = state.players.some((p) =>
                p.battlefield.some((c) => {
                    if (c.id !== args.targetId) return false;
                    const types = c.types;
                    return types.includes("Creature");
                })
            );
            if (!found) throw new Error("Invalid creature target");
        } else {
            const found = state.players.some((p) => p.id === args.targetId);
            if (!found) throw new Error("Invalid player target");
        }

        // Check target type compatibility
        const pt = state.pendingTarget;
        if (pt.targetType === "Creature" && args.targetType !== "creature") {
            throw new Error("Must target a creature");
        }
        if (pt.targetType === "player" && args.targetType !== "player") {
            throw new Error("Must target a player");
        }

        pt.selected.push(target);

        if (pt.selected.length >= pt.count) {
            // All targets selected — proceed to mana payment
            const targets = [...pt.selected];
            const cardInstanceId = pt.cardInstanceId;
            state.pendingTarget = undefined;

            const player = getPlayer(state, args.playerId);
            const cardInHand = player.hand.find((c) => c.id === cardInstanceId);
            if (!cardInHand) throw new Error("Card not in hand");

            const rawCost = (
                cardInHand.card as {
                    manaCost?: Record<string, number | string | undefined>;
                }
            ).manaCost;
            const manaCost = rawCost ? normalizeManaCost(rawCost) : {};

            if (
                Object.keys(manaCost).length === 0 ||
                isManaCostCovered(player.manaPool, manaCost)
            ) {
                if (Object.keys(manaCost).length > 0) {
                    payManaCost(player.manaPool, manaCost);
                    commitLandsForCost(player, manaCost);
                }
                const card = removeFromZone(player, cardInstanceId, "hand");
                const stackItem: StackItem = {
                    ...card,
                    castById: args.playerId,
                    targets,
                };
                state.stack.push(stackItem);
                state.passCount = 0;
                state.priorityPlayerId = getOpponentId(state, args.playerId);
                drainAutoPasses(state);
            } else {
                state.pendingCast = {
                    playerId: args.playerId,
                    cardInstanceId,
                    manaCost,
                    tappedLandIds: [],
                };
                // Store targets temporarily — they'll be added to stack item when payment completes
                (state.pendingCast as Record<string, unknown>).targets =
                    targets;
            }
        }

        const now = Date.now();
        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: now,
        });

        if (!state.pendingTarget) {
            await ctx.db.insert("events", {
                gameId: args.gameId,
                seq: gameState.seq + 1,
                type: state.pendingCast ? "CAST_ANNOUNCED" : "SPELL_CAST",
                player: args.playerId,
                payload: {
                    cardInstanceId:
                        state.pendingCast?.cardInstanceId ?? args.targetId,
                    targetType: args.targetType,
                    targetId: args.targetId,
                },
                timestamp: now,
            });
        }
    },
});

/** Cancel target selection and abort the cast. */
export const cancelTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        state.pendingTarget = undefined;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Toggle a creature in/out of the attacker selection (visible to both clients in real-time). */
export const toggleAttacker = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "DECLARE_ATTACKERS") {
            throw new Error("Not in DECLARE_ATTACKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player can declare attackers");
        }
        if (!state.combat || state.combat.confirmed) {
            throw new Error("Attacker selection is not open");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        const types = card.types;
        if (!types.includes("Creature")) {
            throw new Error("Only creatures can attack");
        }

        const idx = state.combat.attackerIds.indexOf(args.cardInstanceId);
        if (idx !== -1) {
            // Deselect
            state.combat.attackerIds.splice(idx, 1);
        } else {
            // Select — must be eligible
            if (card.staticAbilities.includes("defender")) {
                throw new Error("Creatures with defender cannot attack");
            }
            if (card.isTapped)
                throw new Error("Tapped creatures cannot attack");
            if (card.isSummoningSick) {
                throw new Error("Creature has summoning sickness");
            }
            state.combat.attackerIds.push(args.cardInstanceId);
        }

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Lock in the attacker selection, tap attackers, and pass priority. */
export const confirmAttackers = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "DECLARE_ATTACKERS") {
            throw new Error("Not in DECLARE_ATTACKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player can confirm attackers");
        }
        if (!state.combat || state.combat.confirmed) {
            throw new Error("Attacker selection is not open");
        }

        const player = getPlayer(state, args.playerId);

        // Tap and mark each attacker (vigilance creatures don't tap)
        for (const attackerId of state.combat.attackerIds) {
            const card = player.battlefield.find((c) => c.id === attackerId);
            if (card) {
                if (!card.staticAbilities.includes("vigilance")) {
                    card.isTapped = true;
                }
                card.isAttacking = true;
            }
        }

        state.combat.confirmed = true;
        state.combat.blockerAssignments = {};
        state.combat.blockersConfirmed = false;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);

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
            type: "ATTACKERS_DECLARED",
            player: args.playerId,
            payload: {
                attackerIds: state.combat.attackerIds,
            },
            timestamp: now,
        });
    },
});

/** Select a blocker (or deselect/unassign if already selected/assigned). */
export const selectBlocker = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        if (args.playerId === state.activePlayerId) {
            throw new Error("Only the defending player can declare blockers");
        }

        // If this card is already assigned as a blocker, unassign it
        if (
            state.combat.blockerAssignments[args.cardInstanceId] !== undefined
        ) {
            delete state.combat.blockerAssignments[args.cardInstanceId];
            if (state.combat.pendingBlockerId === args.cardInstanceId) {
                state.combat.pendingBlockerId = undefined;
            }
        } else if (state.combat.pendingBlockerId === args.cardInstanceId) {
            // If it's the current pending, deselect
            state.combat.pendingBlockerId = undefined;
        } else {
            // Select as pending: validate it's an eligible creature
            const player = getPlayer(state, args.playerId);
            const card = player.battlefield.find(
                (c) => c.id === args.cardInstanceId
            );
            if (!card) throw new Error("Card not on battlefield");
            const types = card.types;
            if (!types.includes("Creature")) {
                throw new Error("Only creatures can block");
            }
            if (card.isTapped) throw new Error("Tapped creatures cannot block");
            state.combat.pendingBlockerId = args.cardInstanceId;
        }

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Assign the pending blocker to an attacker. */
export const assignBlockerTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        attackerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        if (args.playerId === state.activePlayerId) {
            throw new Error("Only the defending player can assign blockers");
        }
        if (!state.combat.pendingBlockerId) {
            throw new Error("No blocker selected");
        }
        if (!state.combat.attackerIds.includes(args.attackerId)) {
            throw new Error("Target is not an attacker");
        }

        // Flying check: attacker with flying can only be blocked by creatures with flying or reach (CR 509.1b)
        const activePlayer = getPlayer(state, state.activePlayerId);
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === args.attackerId
        );
        if (attacker?.staticAbilities.includes("flying")) {
            const defender = getPlayer(state, args.playerId);
            const blocker = defender.battlefield.find(
                (c) => c.id === state.combat!.pendingBlockerId
            );
            if (
                blocker &&
                !blocker.staticAbilities.includes("flying") &&
                !blocker.staticAbilities.includes("reach")
            ) {
                throw new Error(
                    "Only creatures with flying or reach can block a creature with flying"
                );
            }
        }

        state.combat.blockerAssignments[state.combat.pendingBlockerId] =
            args.attackerId;
        state.combat.pendingBlockerId = undefined;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Confirm blocker declarations. */
export const confirmBlockers = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        if (args.playerId === state.activePlayerId) {
            throw new Error("Only the defending player can confirm blockers");
        }

        const player = getPlayer(state, args.playerId);

        // Mark each assigned blocker
        for (const blockerId of Object.keys(state.combat.blockerAssignments)) {
            const card = player.battlefield.find((c) => c.id === blockerId);
            if (card) card.isBlocking = true;
        }

        state.combat.pendingBlockerId = undefined;
        state.combat.blockersConfirmed = true;

        // Build blockerOrder: attackerId → ordered blocker IDs (CR 510.1)
        // If any attacker has 2+ blockers, the attacking player must order them
        const blockerOrder: Record<string, string[]> = {};
        let needsOrdering = false;
        for (const [blockerId, attackerId] of Object.entries(
            state.combat.blockerAssignments
        )) {
            if (!blockerOrder[attackerId]) blockerOrder[attackerId] = [];
            blockerOrder[attackerId].push(blockerId);
        }
        for (const blockerIds of Object.values(blockerOrder)) {
            if (blockerIds.length >= 2) needsOrdering = true;
        }

        if (needsOrdering) {
            // Default order: declaration order. Attacking player must confirm/reorder.
            state.combat.blockerOrder = blockerOrder;
            state.combat.blockerOrderConfirmed = false;
        } else {
            // Single or zero blockers per attacker: order is trivial, skip ordering step
            state.combat.blockerOrder = blockerOrder;
            state.combat.blockerOrderConfirmed = true;
        }

        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);

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
            type: "BLOCKERS_DECLARED",
            player: args.playerId,
            payload: {
                blockerAssignments: state.combat.blockerAssignments,
            },
            timestamp: now,
        });
    },
});

/** Set the blocker damage ordering for a specific attacker (CR 510.1). */
export const setBlockerOrder = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        attackerId: v.string(),
        orderedBlockerIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the attacking player can order blockers");
        }
        if (
            !state.combat ||
            !state.combat.blockersConfirmed ||
            state.combat.blockerOrderConfirmed
        ) {
            throw new Error("Blocker ordering is not open");
        }

        // Validate: same set of blocker IDs, just reordered
        const existing = state.combat.blockerOrder?.[args.attackerId] ?? [];
        const sorted = [...args.orderedBlockerIds].sort();
        const expectedSorted = [...existing].sort();
        if (
            sorted.length !== expectedSorted.length ||
            sorted.some((id, i) => id !== expectedSorted[i])
        ) {
            throw new Error(
                "Ordered blocker IDs must be the same set as the declared blockers"
            );
        }

        state.combat.blockerOrder![args.attackerId] = args.orderedBlockerIds;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Confirm the blocker ordering and proceed. */
export const confirmBlockerOrder = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error(
                "Only the attacking player can confirm blocker order"
            );
        }
        if (
            !state.combat ||
            !state.combat.blockersConfirmed ||
            state.combat.blockerOrderConfirmed
        ) {
            throw new Error("Blocker ordering is not open");
        }

        state.combat.blockerOrderConfirmed = true;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);

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
            type: "BLOCKER_ORDER_CONFIRMED",
            player: args.playerId,
            payload: {
                blockerOrder: state.combat.blockerOrder,
            },
            timestamp: now,
        });
    },
});

/** Set damage distribution for an attacker with multiple blockers. */
export const setDamageAssignment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        attackerId: v.string(),
        assignments: v.any(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "COMBAT_DAMAGE") {
            throw new Error("Not in COMBAT_DAMAGE phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player assigns combat damage");
        }
        if (!state.combat || state.combat.damageConfirmed !== false) {
            throw new Error("Damage assignment is not open");
        }

        const assignments = args.assignments as Record<string, number>;

        // Validate: attacker exists and total equals power
        const player = getPlayer(state, args.playerId);
        const attacker = player.battlefield.find(
            (c) => c.id === args.attackerId
        );
        if (!attacker) throw new Error("Attacker not on battlefield");

        const power = Math.max(0, attacker.power ?? 0);
        const total = Object.values(assignments).reduce((sum, n) => sum + n, 0);
        if (total > power) {
            throw new Error(
                `Damage total (${total}) exceeds attacker power (${power})`
            );
        }

        const hasTrample = attacker.staticAbilities.includes("trample");
        const defenderId = getOpponentId(state, args.playerId);

        // Validate: all targets are valid blockers of this attacker (or defender if trample)
        for (const targetId of Object.keys(assignments)) {
            if (targetId === defenderId) {
                if (!hasTrample) {
                    throw new Error(
                        "Only creatures with trample can assign damage to the defending player"
                    );
                }
                continue;
            }
            if (state.combat.blockerAssignments[targetId] !== args.attackerId) {
                throw new Error(`${targetId} is not blocking this attacker`);
            }
        }

        if (!state.combat.damageAssignments) {
            state.combat.damageAssignments = {};
        }
        state.combat.damageAssignments[args.attackerId] = assignments;

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});

/** Confirm damage assignments and apply all combat damage. */
export const confirmDamage = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;

        if (state.phase !== "COMBAT_DAMAGE") {
            throw new Error("Not in COMBAT_DAMAGE phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player confirms damage");
        }
        if (!state.combat || state.combat.damageConfirmed !== false) {
            throw new Error("Damage assignment is not open");
        }

        applyAllCombatDamage(state, state.combat.damageAssignments ?? {});
        state.combat.damageConfirmed = true;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);

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
            type: "COMBAT_DAMAGE_DEALT",
            player: args.playerId,
            payload: {},
            timestamp: now,
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

        // Cannot pass priority before confirming attackers
        if (
            state.phase === "DECLARE_ATTACKERS" &&
            state.combat &&
            !state.combat.confirmed
        ) {
            throw new Error("Must declare attackers before passing priority");
        }

        // Cannot pass priority before confirming blockers
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            !state.combat.blockersConfirmed
        ) {
            throw new Error("Must declare blockers before passing priority");
        }

        // Cannot pass priority before confirming blocker order (CR 510.1)
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            state.combat.blockerOrderConfirmed === false
        ) {
            throw new Error(
                "Must confirm blocker order before passing priority"
            );
        }

        // Cannot pass priority before confirming damage assignments
        if (
            state.phase === "COMBAT_DAMAGE" &&
            state.combat &&
            state.combat.damageConfirmed === false
        ) {
            throw new Error(
                "Must assign combat damage before passing priority"
            );
        }

        state.passCount += 1;

        if (state.passCount >= 2 && state.stack.length > 0) {
            // Both players passed consecutively — resolve top of stack (CR 117.3d)
            resolveTopOfStack(state);
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        } else if (state.passCount >= 2 && state.stack.length === 0) {
            // Both passed with empty stack → advance phase/step
            advancePhase(state);
        } else {
            // Pass priority to opponent
            state.priorityPlayerId = getOpponentId(state, args.playerId);
        }

        // If the new priority holder has autoPass, keep draining
        drainAutoPasses(state);

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
            type: "PRIORITY_PASSED",
            player: args.playerId,
            payload: { phase: state.phase, turn: state.turn },
            timestamp: now,
        });
    },
});

/** Set auto-pass: automatically pass priority for the rest of this turn. */
export const endTurn = mutation({
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

        // Add player to autoPass list
        const autoPassPlayers = state.autoPassPlayers ?? [];
        if (!autoPassPlayers.includes(args.playerId)) {
            autoPassPlayers.push(args.playerId);
        }
        state.autoPassPlayers = autoPassPlayers;

        // Immediately pass priority (and keep resolving as long as auto-pass applies)
        drainAutoPasses(state);

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
            type: "AUTO_PASS_SET",
            player: args.playerId,
            payload: {},
            timestamp: now,
        });
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

        const types = card.types;
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

/** Returns all available card names for the debug scenario builder. */
export const debugListCards = query({
    handler: () => getAllCardNames(),
});

/**
 * Debug: set up a board scenario for testing.
 * Each entry places a card (by name) on a player's battlefield.
 * Optionally sets the phase and clears hands/stack.
 */
export const debugSetupScenario = mutation({
    args: {
        gameId: v.id("games"),
        /** Cards to place. "me" = player 1, "opp" = player 2. */
        cards: v.array(
            v.object({
                name: v.string(),
                owner: v.union(v.literal("me"), v.literal("opp")),
                tapped: v.optional(v.boolean()),
            })
        ),
        phase: v.optional(v.string()),
        /** Give each player this many Plains. Default 7. */
        landCount: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        const p1 = state.players[0];
        const p2 = state.players[1];

        // Clear battlefields
        p1.battlefield = [];
        p2.battlefield = [];

        // Helper to create an instance from a card name
        function makeInstance(
            cardName: string,
            controllerId: string,
            opts?: { tapped?: boolean }
        ) {
            const def = getCardByName(cardName);
            return {
                id: crypto.randomUUID(),
                card: {
                    id: def.id,
                    name: def.name,
                    manaCost: def.manaCost,
                    supertypes: def.supertypes,
                    loyalty: def.loyalty,
                },
                types: def.types,
                subtypes: def.subtypes ?? [],
                power: def.power,
                toughness: def.toughness,
                staticAbilities: def.staticAbilities ?? [],
                controllerId,
                ownerId: controllerId,
                zone: "battlefield" as const,
                isTapped: opts?.tapped ?? false,
                isSummoningSick: false, // Scenario cards are ready to act
            };
        }

        // Place requested cards
        for (const entry of args.cards) {
            const player = entry.owner === "me" ? p1 : p2;
            player.battlefield.push(
                makeInstance(entry.name, player.id, { tapped: entry.tapped })
            );
        }

        // Add lands (default 7 Plains each)
        const landCount = args.landCount ?? 7;
        for (let i = 0; i < landCount; i++) {
            p1.battlefield.push(makeInstance("Plains", p1.id));
            p2.battlefield.push(makeInstance("Plains", p2.id));
        }

        // Set phase if requested
        if (args.phase) {
            state.phase = args.phase as Phase;
            if (args.phase === "DECLARE_ATTACKERS") {
                state.combat = {
                    attackerIds: [],
                    confirmed: false,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                };
            }
        }

        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        state.pendingCast = undefined;
        state.stack = [];

        await ctx.db.insert("game_states", {
            gameId: args.gameId,
            seq: gameState.seq + 1,
            state,
            updatedAt: Date.now(),
        });
    },
});
