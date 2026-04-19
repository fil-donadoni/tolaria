import { v, type GenericId } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
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
    removePermanentTo,
    getBasicLandMana,
    payManaCost,
    commitLandsForCost,
    resolveTopOfStack,
    normalizeManaCost,
    isManaCostCovered,
} from "./gre/state";
import { assertLegalAction, getLegalTargets } from "./gre/rules";
import { projectFullState, projectPublicState } from "./gameProjections";
import {
    advancePhase,
    drainAutoPasses,
    applyAllCombatDamage,
} from "./gre/phases";
import type { Phase } from "./gre/types";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    getActivatedManaAbility,
    getActivatedManaColor,
    hasManaAbility,
} from "./gre/constants";
import { validateAttackerEligibility } from "./gre/combat";
import { checkGameOverSBA } from "./gre/sba";

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
    return await ctx.db
        .query("game_states")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .order("desc")
        .first();
}

/** Save a game state snapshot, keeping the last N for undo history. */
const MAX_SNAPSHOTS = 20;

async function saveGameState(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState | Record<string, unknown>
) {
    await ctx.db.insert("game_states", {
        gameId,
        seq,
        state,
        updatedAt: Date.now(),
    });

    // Read at most MAX_SNAPSHOTS + 1 to bound per-mutation database bandwidth.
    // In steady state .collect() returned the same count, but .take() caps reads
    // defensively if pruning ever lags (e.g., concurrent writes or bugs).
    const recent = await ctx.db
        .query("game_states")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .order("desc")
        .take(MAX_SNAPSHOTS + 1);

    if (recent.length > MAX_SNAPSHOTS) {
        await ctx.db.delete(recent[MAX_SNAPSHOTS]._id);
    }
}

/** If SBA detected game over, persist the result to the games table and emit event. */
async function finalizeGameOver(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState
) {
    if (!state.gameOver) return;

    await ctx.db.patch(gameId, {
        status: "finished",
        winner: state.gameOver.winnerId,
        updatedAt: Date.now(),
    });

    await ctx.db.insert("events", {
        gameId,
        seq,
        type: "GAME_OVER",
        player: "system",
        payload: {
            winnerId: state.gameOver.winnerId,
            loserId: state.gameOver.loserId,
            reason: state.gameOver.reason,
        },
        timestamp: Date.now(),
    });
}

/** Guard: reject actions on a finished game. */
function assertGameNotOver(state: GameState) {
    if (state.gameOver) throw new Error("Game is over");
}

// --- Queries ---

/** Public view: hides opponent's hand and all library contents. Computes legalActions only for own hand. */
export const getPublicState = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        debugAllActions: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) return null;
        return projectPublicState(
            gameState.state as GameState,
            gameState.seq,
            args.playerId,
            args.debugAllActions ?? false
        );
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
        return projectFullState(
            gameState.state as GameState,
            gameState.seq,
            args.debugAllActions ?? false
        );
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

        await saveGameState(ctx, args.gameId, 0, initialState);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);
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
        await saveGameState(ctx, args.gameId, nextSeq, state);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);
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
            await saveGameState(ctx, args.gameId, gameState.seq + 1, state);

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
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);

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
        /** Required for sources with manaChoices (duals, Birds of Paradise, Black Lotus). */
        manaChoiceIndex: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        const ability = getActivatedManaAbility(card);

        if (ability?.manaChoices) {
            // Choice-based source (dual lands, Birds of Paradise, Black Lotus).
            if (args.manaChoiceIndex === undefined) {
                throw new Error("Must choose a mana color");
            }
            const chosen = ability.manaChoices[args.manaChoiceIndex];
            if (!chosen) throw new Error("Invalid mana choice");

            const isSacrifice = ability.cost.sacrifice === true;
            if (isSacrifice) {
                // Move to graveyard instead of tapping. Cannot be undone via
                // untapForPayment — sacrifice is a one-way payment.
                moveCard(player, card.id, "battlefield", "graveyard");
            } else {
                card.isTapped = true;
                card.chosenMana = chosen;
            }

            for (const [color, amount] of Object.entries(chosen)) {
                if (color !== "X" && typeof amount === "number" && amount > 0) {
                    player.manaPool[color] =
                        (player.manaPool[color] ?? 0) + amount;
                }
            }
            state.pendingCast.tappedLandIds.push(card.id);
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (!manaColor) throw new Error("Card does not produce mana");

            card.isTapped = true;
            player.manaPool[manaColor] = (player.manaPool[manaColor] ?? 0) + 1;
            state.pendingCast.tappedLandIds.push(card.id);
        }

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
            await saveGameState(ctx, args.gameId, gameState.seq + 1, state);

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
            await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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
        if (!card) {
            throw new Error("Cannot undo: source was sacrificed");
        }

        if (card.chosenMana) {
            for (const [color, amount] of Object.entries(card.chosenMana)) {
                if (color !== "X" && typeof amount === "number" && amount > 0) {
                    player.manaPool[color] = Math.max(
                        0,
                        (player.manaPool[color] ?? 0) - amount
                    );
                }
            }
            card.chosenMana = undefined;
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (!manaColor) throw new Error("Card does not produce mana");
            player.manaPool[manaColor] = Math.max(
                0,
                (player.manaPool[manaColor] ?? 0) - 1
            );
        }

        card.isTapped = false;
        state.pendingCast.tappedLandIds.splice(idx, 1);

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        const player = getPlayer(state, args.playerId);

        // Rollback all taps. Sacrificed sources (Black Lotus) cannot be
        // un-sacrificed, so their mana contribution is left in the pool —
        // the empty-pool step at phase end will drain it.
        for (const cardId of state.pendingCast.tappedLandIds) {
            const card = player.battlefield.find((c) => c.id === cardId);
            if (!card) continue;
            card.isTapped = false;
            if (card.chosenMana) {
                for (const [color, amount] of Object.entries(card.chosenMana)) {
                    if (
                        color !== "X" &&
                        typeof amount === "number" &&
                        amount > 0
                    ) {
                        player.manaPool[color] = Math.max(
                            0,
                            (player.manaPool[color] ?? 0) - amount
                        );
                    }
                }
                card.chosenMana = undefined;
            } else {
                const manaColor =
                    getBasicLandMana(card) ?? getActivatedManaColor(card);
                if (manaColor) {
                    player.manaPool[manaColor] = Math.max(
                        0,
                        (player.manaPool[manaColor] ?? 0) - 1
                    );
                }
            }
        }

        state.pendingCast = undefined;

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
    },
});

/** Select a target for a spell being announced (CR 601.2c). */
export const selectTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        targetType: v.union(
            v.literal("permanent"),
            v.literal("player"),
            v.literal("spell")
        ),
        targetId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        state.undoableBy = undefined;
        assertGameNotOver(state);

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        const target: {
            type: "permanent" | "player" | "spell";
            id: string;
        } = {
            type: args.targetType,
            id: args.targetId,
        };

        // Validate the target exists and matches the requirement
        const pt = state.pendingTarget;
        const reqTypes = Array.isArray(pt.targetType)
            ? pt.targetType
            : [pt.targetType];
        const wantsAny = reqTypes.includes("any");

        if (args.targetType === "permanent") {
            const permanentTypes = reqTypes.filter(
                (t) => t !== "player" && t !== "any" && t !== "spell"
            );
            // CR 115.4 / 120.3: "any target" only matches damageable permanents.
            const found = state.players.some((p) =>
                p.battlefield.some((c) => {
                    if (c.id !== args.targetId) return false;
                    const matchesAny =
                        wantsAny &&
                        DAMAGEABLE_PERMANENT_TYPES.some((t) =>
                            c.types.includes(t)
                        );
                    const matchesExplicit = permanentTypes.some((t) =>
                        c.types.includes(t as never)
                    );
                    return matchesAny || matchesExplicit;
                })
            );
            if (!found) throw new Error("Invalid target");
        } else if (args.targetType === "player") {
            if (!wantsAny && !reqTypes.includes("player")) {
                throw new Error("Must target a permanent");
            }
            const found = state.players.some((p) => p.id === args.targetId);
            if (!found) throw new Error("Invalid player target");
        } else {
            // "spell" target (CR 114.1): must match a stack item.
            if (!reqTypes.includes("spell")) {
                throw new Error("This spell does not target a spell");
            }
            const found = state.stack.some((s) => s.id === args.targetId);
            if (!found) throw new Error("Invalid spell target");
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
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        state.pendingTarget = undefined;

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        const idx = state.combat.attackerIds.indexOf(args.cardInstanceId);
        if (idx !== -1) {
            // Deselect
            state.combat.attackerIds.splice(idx, 1);
        } else {
            // Select — must be eligible
            const validation = validateAttackerEligibility(card);
            if (!validation.eligible) {
                throw new Error(validation.reason);
            }
            state.combat.attackerIds.push(args.cardInstanceId);
        }

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        // Check SBA after combat damage (CR 704.5)
        checkGameOverSBA(state);

        if (!state.gameOver) {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }

        const now = Date.now();
        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        // Check SBA for game-ending conditions (CR 704.5)
        checkGameOverSBA(state);

        const now = Date.now();
        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
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
        state.undoableBy = undefined;
        assertGameNotOver(state);

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

        // Check SBA after auto-pass drain (may have resolved combat damage)
        checkGameOverSBA(state);

        const now = Date.now();
        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
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
        state.undoableBy = undefined;
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            // CR 704.5b: attempting to draw from empty library
            player.hasDrawnFromEmpty = true;
            checkGameOverSBA(state);

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state);
            await finalizeGameOver(ctx, args.gameId, nextSeq, state);
            return;
        }

        const card = moveCard(player, player.library[0].id, "library", "hand");

        const now = Date.now();
        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);
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

        await saveGameState(ctx, args.gameId, nextSeq, state);

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
        state.undoableBy = undefined;
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        const card = moveCard(player, player.library[0].id, "library", "exile");

        const now = Date.now();
        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state);

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

/** Activate a non-mana ability on a permanent (CR 602.2). Pays costs and puts ability on stack. */
export const activateAbility = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        abilityId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        state.undoableBy = undefined;
        assertGameNotOver(state);

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }
        if (state.pendingCast) {
            throw new Error("Another spell is already being cast");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        const cardId = (card.card as { id?: string }).id;
        if (!cardId) throw new Error("Card has no definition");

        const cardDef = getCardById(cardId);
        const ability = cardDef.activatedAbilities?.find(
            (a) => a.id === args.abilityId
        );
        if (!ability) throw new Error("Ability not found");
        if (!ability.useStack) {
            throw new Error("Use tapUntap for mana abilities");
        }

        // Pay costs (CR 602.2b)
        if (ability.cost.tap) {
            if (card.isTapped) throw new Error("Card is already tapped");
            card.isTapped = true;
        }

        if (ability.cost.mana) {
            const manaCost = normalizeManaCost(ability.cost.mana);
            if (!isManaCostCovered(player.manaPool, manaCost)) {
                throw new Error("Not enough mana");
            }
            payManaCost(player.manaPool, manaCost);
            commitLandsForCost(player, manaCost);
        }

        if (ability.cost.sacrifice) {
            removePermanentTo(state, card.id, "graveyard");
        }

        // Put ability on stack (clone card state as a virtual stack item)
        const stackItem: StackItem = {
            ...structuredClone(card),
            zone: "stack" as const,
            castById: args.playerId,
            abilityId: args.abilityId,
        };
        state.stack.push(stackItem);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, args.playerId);
        drainAutoPasses(state);

        const now = Date.now();
        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state);

        await ctx.db.insert("events", {
            gameId: args.gameId,
            seq: nextSeq,
            type: "ABILITY_ACTIVATED",
            player: args.playerId,
            payload: {
                cardInstanceId: card.id,
                cardName: (card.card as { name?: string }).name,
                abilityId: args.abilityId,
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
        manaChoiceIndex: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        state.undoableBy = undefined;
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        // Cannot manually tap/untap during payment phase
        if (state.pendingCast) {
            throw new Error("Use tapForPayment/untapForPayment during casting");
        }

        // CR 605.3b: a mana ability can be activated only while the player
        // has priority (or while paying a mana cost — handled above).
        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("Cannot activate mana ability without priority");
        }

        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        if (!hasManaAbility(card)) {
            throw new Error("Card has no mana ability to tap/untap");
        }

        const ability = getActivatedManaAbility(card);
        const isSacrifice = ability?.cost.sacrifice === true;
        const wasTapped = card.isTapped;

        // Sacrifice abilities are one-way — cannot "untap"
        if (isSacrifice && wasTapped) {
            throw new Error("Cannot untap a sacrifice ability");
        }

        // Block untap if mana was spent on a cast
        if (wasTapped && card.manaCommitted) {
            throw new Error("Cannot untap: mana already spent");
        }

        // Determine mana to add/remove
        if (ability?.manaChoices) {
            // Choice-based mana ability (e.g. Birds of Paradise, Black Lotus)
            if (!wasTapped) {
                if (args.manaChoiceIndex === undefined) {
                    throw new Error("Must choose a mana color");
                }
                const chosen = ability.manaChoices[args.manaChoiceIndex];
                if (!chosen) throw new Error("Invalid mana choice");

                // Pay cost: tap (+ sacrifice if required)
                if (isSacrifice) {
                    moveCard(player, card.id, "battlefield", "graveyard");
                } else {
                    card.isTapped = true;
                    // Remember the exact mana produced so untap can refund it.
                    // Fixed-color abilities use manaProduced and don't need this.
                    card.chosenMana = chosen;
                }

                // Add chosen mana to pool
                for (const [color, amount] of Object.entries(chosen)) {
                    if (
                        color !== "X" &&
                        typeof amount === "number" &&
                        amount > 0
                    ) {
                        player.manaPool[color as keyof typeof player.manaPool] =
                            (player.manaPool[
                                color as keyof typeof player.manaPool
                            ] ?? 0) + amount;
                    }
                }
            } else {
                // Untap: refund exactly the mana that was chosen on tap.
                // Falls back to manaProduced for legacy instances (pre-chosenMana).
                const refund = card.chosenMana;
                if (refund) {
                    for (const [color, amount] of Object.entries(refund)) {
                        if (
                            color !== "X" &&
                            typeof amount === "number" &&
                            amount > 0
                        ) {
                            const key = color as keyof typeof player.manaPool;
                            player.manaPool[key] = Math.max(
                                0,
                                (player.manaPool[key] ?? 0) - amount
                            );
                        }
                    }
                }
                card.chosenMana = undefined;
                card.isTapped = false;
            }
        } else {
            // Fixed mana ability (lands, Mox)
            card.isTapped = !card.isTapped;
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (manaColor) {
                if (!wasTapped) {
                    player.manaPool[manaColor] =
                        (player.manaPool[manaColor] ?? 0) + 1;
                } else {
                    player.manaPool[manaColor] =
                        (player.manaPool[manaColor] ?? 0) - 1;
                }
            }
        }

        // Mana ability activation is undoable
        state.undoableBy = args.playerId;

        // Save updated state
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
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

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
    },
});

/** Undo the last mana ability activation (tap, untap, sacrifice). Only valid while undoableBy is set. */
export const undoManaAbility = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = gameState.state as GameState;
        if (state.undoableBy !== args.playerId) {
            throw new Error("Nothing to undo");
        }

        // Delete the latest snapshot to revert to previous state
        await ctx.db.delete(gameState._id);
    },
});

/** Debug: undo last action by deleting the latest snapshot. */
export const debugUndo = mutation({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const latest = await ctx.db
            .query("game_states")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .order("desc")
            .first();

        if (!latest || latest.seq <= 0) {
            throw new Error("Nothing to undo");
        }

        await ctx.db.delete(latest._id);
    },
});

/** Debug: reset game — rebuild initial state from the game record. */
export const debugResetGame = mutation({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");

        // Delete all existing snapshots
        const states = await ctx.db
            .query("game_states")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const s of states) {
            await ctx.db.delete(s._id);
        }

        // Rebuild initial state from game players
        const playersState = game.players.map((p) =>
            buildPlayerState(p as PlayerInput)
        );
        const initialState: GameState = {
            players: playersState,
            stack: [],
            turn: 1,
            activePlayerId: playersState[0].id,
            priorityPlayerId: playersState[0].id,
            passCount: 0,
            phase: "UNTAP" as Phase,
        };
        advancePhase(initialState);

        await saveGameState(ctx, args.gameId, 0, initialState);

        // Reset game status in case it was finished
        await ctx.db.patch(args.gameId, {
            status: "playing",
            winner: undefined,
            updatedAt: Date.now(),
        });
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
                zone: v.optional(
                    v.union(v.literal("hand"), v.literal("battlefield"))
                ),
                tapped: v.optional(v.boolean()),
            })
        ),
        phase: v.optional(v.string()),
        /** Give each player this many Plains. Default 0. */
        landCount: v.optional(v.number()),
        /** Fill each player's library with this many Plains. Default: unchanged. */
        libraryCount: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        state.undoableBy = undefined;
        const p1 = state.players[0];
        const p2 = state.players[1];

        // Clear battlefields and hands
        p1.battlefield = [];
        p2.battlefield = [];
        p1.hand = [];
        p2.hand = [];

        // Helper to create an instance from a card name
        function makeInstance(
            cardName: string,
            controllerId: string,
            zone: "hand" | "battlefield" | "library",
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
                zone,
                isTapped: opts?.tapped ?? false,
                isSummoningSick: false,
            };
        }

        // Place requested cards
        for (const entry of args.cards) {
            const player = entry.owner === "me" ? p1 : p2;
            const zone = entry.zone ?? "battlefield";
            const instance = makeInstance(entry.name, player.id, zone, {
                tapped: entry.tapped,
            });
            if (zone === "hand") {
                player.hand.push(instance);
            } else {
                player.battlefield.push(instance);
            }
        }

        // Add lands (only if explicitly requested)
        const landCount = args.landCount ?? 0;
        for (let i = 0; i < landCount; i++) {
            p1.battlefield.push(makeInstance("Plains", p1.id, "battlefield"));
            p2.battlefield.push(makeInstance("Plains", p2.id, "battlefield"));
        }

        // Fill libraries if requested
        if (args.libraryCount !== undefined) {
            p1.library = [];
            p2.library = [];
            for (let i = 0; i < args.libraryCount; i++) {
                p1.library.push(makeInstance("Plains", p1.id, "library"));
                p2.library.push(makeInstance("Plains", p2.id, "library"));
            }
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

        await saveGameState(ctx, args.gameId, gameState.seq + 1, state);
    },
});
