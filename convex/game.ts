import { v, type GenericId } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { auth, getCurrentUser } from "./auth";
import { mutation, query } from "./_generated/server";
import {
    getAllCardNames,
    getCardById,
    getCardByName,
    getInstanceManaCost,
    tryGetCardById,
} from "./cards";
import {
    type CardInstanceState,
    type GameState,
    type PendingActivation,
    type PendingTarget,
    type PlayerState,
    type StackItem,
    getPlayer,
    getOpponentId,
    drawCard as drawCardFromLibrary,
    matchesPermanentFilter,
    moveCard,
    removeFromZone,
    removePermanentTo,
    applySourceStaticEffects,
    getBasicLandMana,
    payManaCost,
    payRemoveCounterCost,
    commitLandsForCost,
    resolveTopOfStack,
    normalizeManaCost,
    isManaCostCovered,
    emitSpellCastEvent,
    emitPermanentTapped,
    discardPermanentTappedEvent,
    processPendingActionTriggers,
    getPendingChoiceMax,
    allocInstanceId,
} from "./gre/state";
import type { Color, ManaCost, SpellMode } from "./cards/types";
import {
    assertLegalAction,
    getLegalTargets,
    getPendingTargetSourceColors,
    hasColor,
    isProtectedFromColors,
    matchesCmcFilter,
    resolveCmcFilter,
} from "./gre/rules";
import { STATIC_EFFECT_CTX, getEffectivePower } from "./gre/layers";
import { projectFullState, projectPublicState } from "./gameProjections";
import { compactState, expandState } from "./gre/serialize";
import {
    advancePhase,
    drainAutoPasses,
    applyAllCombatDamage,
    untapStep,
    computeHardSkipFilters,
    effectivePermanentView,
} from "./gre/phases";
import { freshSeed, seededShuffle } from "./gre/rng";
import {
    applyMulliganBottomChoice,
    finalizeMulligan,
    makeMulliganState,
    recordDeclaration,
} from "./gre/mulligan";
import type { Phase } from "./gre/types";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    getActivatedManaAbility,
    getActivatedManaColor,
    getFixedManaAmount,
    hasManaAbility,
    isTapLockedBySummoningSickness,
} from "./gre/constants";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    getRequiredAttackerIds,
    mustAttack,
} from "./gre/combat";
import { checkStateBasedActions } from "./gre/sba";

export const STARTING_HAND_SIZE = 7;

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

function buildPlayerState(
    player: PlayerInput,
    counter: { nextInstanceId?: number }
): PlayerState {
    const instances = player.deck.cards.map((deckCard) => {
        const def = getCardById(deckCard.cardId);
        return {
            id: allocInstanceId(counter),
            card: { id: def.id },
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

    return {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: 20,
        hand: [],
        library: instances,
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
    const doc = await ctx.db
        .query("game_states")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .order("desc")
        .first();
    if (!doc) return null;
    return {
        ...doc,
        state: expandState(doc.state as Record<string, unknown>),
    };
}

/** Save a game state. We keep exactly one row per game and patch it in
 *  place — there's no server-side undo history. Convex read bandwidth was
 *  dominated by snapshot reads, so collapsing to a single row plus a patch
 *  cuts per-mutation cost to 1 read (the handler's `getLatestGameState`) +
 *  1 write. Callers pass that already-fetched doc as `existing` so we don't
 *  re-query. Pass `null` for first-time inserts (game creation paths). */
async function saveGameState(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState | Record<string, unknown>,
    existing: Doc<"game_states"> | null
) {
    const stored = compactState(state as GameState);
    const _blobSize = JSON.stringify(stored).length;
    console.log(
        `[BANDWIDTH] blob=${_blobSize} bytes, seq=${seq}, gameId=${gameId}`
    );
    if (existing) {
        await ctx.db.patch(existing._id, {
            seq,
            state: stored,
            updatedAt: Date.now(),
        });
        return;
    }

    await ctx.db.insert("game_states", {
        gameId,
        seq,
        state: stored,
        updatedAt: Date.now(),
    });
}

/** If SBA detected game over, persist the result to the games table. */
async function finalizeGameOver(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    _seq: number,
    state: GameState
) {
    if (!state.gameOver) return;

    await ctx.db.patch(gameId, {
        status: "finished",
        winner: state.gameOver.winnerId,
        updatedAt: Date.now(),
    });
}

/** Guard: reject actions on a finished game. */
function assertGameNotOver(state: GameState) {
    if (state.gameOver) throw new Error("Game is over");
}

/** Guard: reject actions while the engine is suspended awaiting
 *  mid-resolution player choices (CR 608.2). Priority is frozen in this
 *  window — only `selectResolutionChoice` is legal.
 *
 *  CR 117.3a exception: while a player is being asked an optional may-pay
 *  question, they may activate mana abilities to make the mana required.
 *  Pass `allowManaForMayPay: true` from the tap/untap mana mutations so
 *  they can run during the pending may-pay's payment window for that
 *  player. Other mid-resolution choice kinds keep the strict guard. */
function assertNoPendingChoices(
    state: GameState,
    opts: { allowManaForMayPay?: { playerId: string } } = {}
) {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) return;
    const head = queue[0];
    const allow = opts.allowManaForMayPay;
    if (allow && head.kind === "may-pay" && head.playerId === allow.playerId) {
        return;
    }
    throw new Error(
        "Waiting for resolution choices — complete them before acting"
    );
}

/** Taps a battlefield card as a mana source during a payment phase (pendingCast
 *  or pendingActivation) and adds its mana to the player's pool. Shared by
 *  tapForPayment and tapForActivationPayment — the logic is identical, only
 *  the bookkeeping state differs. Mutates `card`, `player.manaPool`, and
 *  pushes the card id onto `tappedLandIds`. */
function tapSourceIntoPayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    manaChoiceIndex: number | undefined,
    tappedLandIds: string[]
): void {
    if (card.isTapped) throw new Error("Card already tapped");
    // CR 302.1 — creatures with summoning sickness cannot pay a {T} cost.
    // Lands and other non-creature mana sources are unaffected.
    if (isTapLockedBySummoningSickness(card)) {
        throw new Error("Creature has summoning sickness");
    }
    const ability = getActivatedManaAbility(card);

    if (ability?.manaChoices) {
        if (manaChoiceIndex === undefined) {
            throw new Error("Must choose a mana color");
        }
        const chosen = ability.manaChoices[manaChoiceIndex];
        if (!chosen) throw new Error("Invalid mana choice");

        const isSacrifice = ability.cost.sacrifice === true;
        // CR 605.2 — emit "tapped for mana" before the sacrifice path moves
        // the card off the battlefield, so the event carries the permanent's
        // pre-sacrifice types/subtypes for trigger predicates.
        emitPermanentTapped(state, card, true, chosen);
        if (isSacrifice) {
            moveCard(player, card.id, "battlefield", "graveyard");
        } else {
            card.isTapped = true;
            card.chosenMana = chosen;
        }
        for (const [color, amount] of Object.entries(chosen)) {
            if (color !== "X" && typeof amount === "number" && amount > 0) {
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        }
        tappedLandIds.push(card.id);
        return;
    }

    const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
    if (!manaColor) throw new Error("Card does not produce mana");
    card.isTapped = true;
    const amount = getFixedManaAmount(card, manaColor);
    player.manaPool[manaColor] = (player.manaPool[manaColor] ?? 0) + amount;
    emitPermanentTapped(state, card, true, { [manaColor]: amount } as ManaCost);
    tappedLandIds.push(card.id);
}

/** Reverses a single tap recorded in `tappedLandIds` — refunds the mana and
 *  untaps the source. Shared by untapForPayment and untapForActivationPayment. */
function untapSourceFromPayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): void {
    discardPermanentTappedEvent(state, card.id);
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
        const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
        if (!manaColor) throw new Error("Card does not produce mana");
        const amount = getFixedManaAmount(card, manaColor);
        player.manaPool[manaColor] = Math.max(
            0,
            (player.manaPool[manaColor] ?? 0) - amount
        );
    }
    card.isTapped = false;
}

/** If the activator's pool now covers pendingActivation, pay mana, apply the
 *  deferred tap/sacrifice costs on the source, push the ability on the stack,
 *  and swap priority. Mirrors tryAutoCommitPendingCast for abilities. Returns
 *  the source card name on commit, or null if nothing was committed. */
function tryAutoCommitPendingActivation(
    state: GameState,
    playerId: string
): { cardInstanceId: string; abilityId: string; cardName?: string } | null {
    const pa = state.pendingActivation;
    if (!pa || pa.playerId !== playerId) return null;

    const player = getPlayer(state, playerId);
    if (!isManaCostCovered(player.manaPool, pa.manaCost)) return null;

    const card = player.battlefield.find((c) => c.id === pa.cardInstanceId);
    if (!card) {
        // Source vanished (e.g. removed by an opposing effect). Drop the
        // payment silently — lands stay tapped (same policy as cancelCast for
        // sacrificed sources).
        state.pendingActivation = undefined;
        return null;
    }

    payManaCost(player.manaPool, pa.manaCost);
    commitLandsForCost(player, pa.manaCost);

    // Deferred non-mana costs (CR 602.1) — applied now so cancellation leaves
    // the source untouched.
    if (pa.tapSource) {
        if (card.isTapped) {
            throw new Error("Source became tapped during payment");
        }
        card.isTapped = true;
    }
    if (pa.removeCounterCost) {
        payRemoveCounterCost(card, pa.removeCounterCost);
    }
    if (pa.sacrificeSource) {
        removePermanentTo(state, card.id, "graveyard");
    }

    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId: pa.abilityId,
        ...(pa.targets && pa.targets.length > 0 ? { targets: pa.targets } : {}),
        ...(pa.chosenX !== undefined ? { chosenX: pa.chosenX } : {}),
        ...(pa.grantedSourceCardId
            ? { grantedSourceCardId: pa.grantedSourceCardId }
            : {}),
    };
    state.stack.push(stackItem);
    recordActivation(card, pa.abilityId);

    const keepPriority = pa.keepPriority;
    state.pendingActivation = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;
    drainAutoPasses(state);

    // CR 603.2 — flush PERMANENT_TAPPED events queued during payment so
    // mana-tap triggers (Manabarbs / Mana Flare / Wild Growth) land on top
    // of the freshly-pushed activated ability.
    processPendingActionTriggers(state);

    return {
        cardInstanceId: pa.cardInstanceId,
        abilityId: pa.abilityId,
        cardName: (card.card as { name?: string }).name,
    };
}

/** If the caster's mana pool now covers pendingCast, pay the cost, move the
 *  spell to the stack, clear pendingCast, and swap priority — mirroring the
 *  tail of tapForPayment. Returns the card name on commit (for SPELL_CAST
 *  event logging), or null if nothing was committed. */
function tryAutoCommitPendingCast(
    state: GameState,
    playerId: string
): { cardInstanceId: string; cardName: string | undefined } | null {
    if (!state.pendingCast || state.pendingCast.playerId !== playerId) {
        return null;
    }
    const player = getPlayer(state, playerId);
    if (!isManaCostCovered(player.manaPool, state.pendingCast.manaCost)) {
        return null;
    }
    // CR 117.9 / 601.2f: commit is blocked until the additional cost has
    // been picked. The player completes payment via selectAdditionalCost.
    const ac = state.pendingCast.additionalCost;
    if (ac && !ac.pickedId) {
        return null;
    }

    payManaCost(player.manaPool, state.pendingCast.manaCost);
    commitLandsForCost(player, state.pendingCast.manaCost);

    // Sacrifice the picked permanent (CR 117.9) and snapshot its mana value
    // for the stack item — the resolve reads it via
    // SpellContext.getAdditionalSacrificeCmc.
    let additionalSacrificeSnapshot: StackItem["additionalSacrificeSnapshot"];
    if (ac?.pickedId) {
        const sacrificed = player.battlefield.find((c) => c.id === ac.pickedId);
        if (!sacrificed) {
            // Picked permanent vanished between selection and commit —
            // refuse to push the spell, drop pendingCast silently. Lands
            // already tapped stay tapped (mirrors cancelCast policy).
            state.pendingCast = undefined;
            return null;
        }
        const sacCardId = (sacrificed.card as { id?: string }).id;
        const sacDef = sacCardId ? tryGetCardById(sacCardId) : undefined;
        const cmc = sacDef?.manaCost
            ? Object.entries(sacDef.manaCost).reduce<number>(
                  (acc, [, v]) => acc + (typeof v === "number" ? v : 0),
                  0
              )
            : 0;
        additionalSacrificeSnapshot = {
            cardInstanceId: sacrificed.id,
            cmc,
        };
        removePermanentTo(state, sacrificed.id, "graveyard");
    }

    const spellCard = removeFromZone(
        player,
        state.pendingCast.cardInstanceId,
        "hand"
    );
    const pendingTargets = (state.pendingCast as Record<string, unknown>)
        .targets as StackItem["targets"] | undefined;
    const pendingChosenX = state.pendingCast.chosenX;
    const pendingChosenModeId = state.pendingCast.chosenModeId;
    const stackItem: StackItem = {
        ...spellCard,
        castById: playerId,
        ...(pendingTargets ? { targets: pendingTargets } : {}),
        ...(pendingChosenX !== undefined ? { chosenX: pendingChosenX } : {}),
        ...(pendingChosenModeId ? { chosenModeId: pendingChosenModeId } : {}),
        ...(additionalSacrificeSnapshot ? { additionalSacrificeSnapshot } : {}),
    };
    state.stack.push(stackItem);

    const cardName = (spellCard.card as { name?: string }).name;
    const keepPriority = state.pendingCast.keepPriority;
    state.pendingCast = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;
    drainAutoPasses(state);

    // CR 601.2i — the spell is now on the stack. Emit SPELL_CAST and run a
    // trigger pass so abilities like Verduran Enchantress and the sphere
    // cycle land on top before either player gets priority.
    emitSpellCastEvent(state, stackItem);
    processPendingActionTriggers(state);

    return { cardInstanceId: spellCard.id, cardName };
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
        const game = await ctx.db.get(args.gameId);
        const state = gameState.state as GameState;
        // In solo mode, the single user controls both players: the viewer follows
        // whoever currently has priority so the UI shows that player's hand and
        // legal actions automatically.
        const viewerId =
            game?.solo === true
                ? (state.priorityPlayerId ?? state.activePlayerId)
                : args.playerId;
        return projectPublicState(
            state,
            gameState.seq,
            viewerId,
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

/** Returns the unique set of card IDs across both players' decks for a game.
 *  Used by the client to preload all card images at game start. */
export const getGameCardIds = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const game = await ctx.db.get(args.gameId);
        if (!game) return [];
        const ids = new Set<string>();
        for (const p of game.players) {
            for (const c of p.deck.cards) ids.add(c.cardId);
        }
        return Array.from(ids);
    },
});

/** Returns all games waiting for a second player, excluding any the caller
 *  is already part of. Auth is required. Uses the `by_status` index so the
 *  subscription only re-fires (and reads docs) for `waiting` games — not the
 *  whole table. Finished/solo games never enter this query's bandwidth. */
export const listOpenGames = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return [];
        const waiting = await ctx.db
            .query("games")
            .withIndex("by_status", (q) => q.eq("status", "waiting"))
            .collect();
        return waiting.filter((g) => !g.players.some((p) => p.id === userId));
    },
});

// --- Mutations ---

const PLAYER_COLORS = ["#4B5A6C", "#63768D"];

const deckValidator = v.object({
    id: v.string(),
    name: v.string(),
    format: v.string(),
    cards: v.array(
        v.object({
            cardId: v.string(),
            cardName: v.string(),
        })
    ),
});

export const createGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const now = Date.now();

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[0],
            deck: args.deck,
        };

        const gameId = await ctx.db.insert("games", {
            name: args.name,
            status: "waiting",
            players: [player],
            createdAt: now,
            updatedAt: now,
        });

        return gameId;
    },
});

/**
 * Create a solo game: a single user controls both players. The viewer
 * auto-follows the priority player on the client. Game starts in "playing"
 * immediately — no second user needs to join.
 */
export const createSoloGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        deck2: v.optional(deckValidator),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const deck2 = args.deck2 ?? args.deck;

        const player1: PlayerInput = {
            id: `${user._id}-p1`,
            name: `${user.nickname} (P1)`,
            bgColor: PLAYER_COLORS[0],
            deck: args.deck,
        };
        const player2: PlayerInput = {
            id: `${user._id}-p2`,
            name: `${user.nickname} (P2)`,
            bgColor: PLAYER_COLORS[1],
            deck: deck2,
        };

        const allPlayers = [player1, player2];
        const now = Date.now();

        const gameId = await ctx.db.insert("games", {
            name: args.name,
            status: "playing",
            players: allPlayers,
            solo: true,
            createdAt: now,
            updatedAt: now,
        });

        const idCounter: { nextInstanceId?: number } = {};
        const playersState = allPlayers.map((p) =>
            buildPlayerState(p, idCounter)
        );
        // CR 500.1: starting player begins their first turn at game start.
        playersState[0].turnsTaken = 1;

        const rngSeed = freshSeed();
        const initialState: GameState = {
            players: playersState,
            stack: [],
            turn: 1,
            activePlayerId: playersState[0].id,
            priorityPlayerId: playersState[0].id,
            passCount: 0,
            phase: "UNTAP" as Phase,
            rngSeed,
            rngCounter: 0,
            nextInstanceId: idCounter.nextInstanceId,
        };

        for (const player of initialState.players) {
            seededShuffle(initialState, player.library);
            for (let i = 0; i < STARTING_HAND_SIZE; i++)
                drawCardFromLibrary(player);
        }

        // CR 103.5: enter the mulligan phase — declarations begin with the
        // starting player. advancePhase is deferred to finalizeMulligan.
        initialState.phase = "MULLIGAN" as Phase;
        initialState.mulligan = makeMulliganState(initialState);
        initialState.priorityPlayerId = initialState.mulligan.declaringPlayerId;

        await saveGameState(ctx, gameId, 0, initialState, null);

        return gameId;
    },
});

export const joinGame = mutation({
    args: {
        gameId: v.id("games"),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        if (game.status !== "waiting") throw new Error("Game is not open");
        if (game.players.length >= 2) throw new Error("Game is full");
        if (game.players.some((p) => p.id === user._id))
            throw new Error("Cannot join a game you are already in");

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[1],
            deck: args.deck,
        };
        const allPlayers = [...game.players, player];
        const now = Date.now();

        // Update game record
        await ctx.db.patch(args.gameId, {
            status: "playing",
            players: allPlayers,
            updatedAt: now,
        });

        const idCounter: { nextInstanceId?: number } = {};
        const playersState = allPlayers.map((p) =>
            buildPlayerState(p, idCounter)
        );
        // CR 500.1: starting player begins their first turn at game start.
        playersState[0].turnsTaken = 1;

        const rngSeed = freshSeed();
        const initialState: GameState = {
            players: playersState,
            stack: [],
            turn: 1,
            activePlayerId: playersState[0].id,
            priorityPlayerId: playersState[0].id,
            passCount: 0,
            phase: "UNTAP" as Phase,
            rngSeed,
            rngCounter: 0,
            nextInstanceId: idCounter.nextInstanceId,
        };

        for (const player of initialState.players) {
            seededShuffle(initialState, player.library);
            for (let i = 0; i < STARTING_HAND_SIZE; i++)
                drawCardFromLibrary(player);
        }

        // CR 103.5: enter the mulligan phase — declarations begin with the
        // starting player. advancePhase is deferred to finalizeMulligan.
        initialState.phase = "MULLIGAN" as Phase;
        initialState.mulligan = makeMulliganState(initialState);
        initialState.priorityPlayerId = initialState.mulligan.declaringPlayerId;

        await saveGameState(ctx, args.gameId, 0, initialState, null);
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
        assertGameNotOver(state);
        assertNoPendingChoices(state);
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

        // CR 305.2: track the land drop. The legality check above already
        // enforces the per-turn limit; this only records the spend so the
        // next call to getLegalActions returns no "play" action.
        if (card.types.includes("Land")) {
            player.landsPlayedThisTurn = (player.landsPlayedThisTurn ?? 0) + 1;
        }

        const nextSeq = gameState.seq + 1;

        // Insert new snapshot (don't overwrite previous)
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** Resolves an activated ability id on a battlefield card. Returns the
 *  template and, when the ability was granted to this permanent by another
 *  card (CR 113.1, e.g. Zombie Master's "{B}: Regenerate ~" grant), the
 *  granting card def id. Returns null if no matching ability exists. */
function resolveActivatedAbility(
    card: CardInstanceState,
    abilityId: string
): {
    ability: NonNullable<
        ReturnType<typeof getCardById>["activatedAbilities"]
    >[number];
    grantedSourceCardId?: string;
} | null {
    const cardId = (card.card as { id?: string }).id;
    if (cardId) {
        const native = getCardById(cardId).activatedAbilities?.find(
            (a) => a.id === abilityId
        );
        if (native) return { ability: native };
    }
    const grant = card.grantedActivatedAbilities?.find(
        (g) => g.abilityId === abilityId
    );
    if (grant) {
        const tmpl = getCardById(grant.sourceCardId).grantTemplates?.find(
            (a) => a.id === abilityId
        );
        if (tmpl) {
            return { ability: tmpl, grantedSourceCardId: grant.sourceCardId };
        }
    }
    return null;
}

/** Throws a descriptive Error if the activated ability's CR 602.5 timing
 *  restrictions (controller-turn-only, once-per-turn cap) are violated
 *  against the current state. Called by every activation entry point before
 *  cost lock so the rejection is surfaced before any mutation. */
function assertActivationTimingLegal(
    state: GameState,
    card: CardInstanceState,
    ability: { id: string; controllerTurnOnly?: boolean; oncePerTurn?: boolean }
): void {
    if (
        ability.controllerTurnOnly &&
        state.activePlayerId !== card.controllerId
    ) {
        throw new Error("Activate only during your turn");
    }
    if (ability.oncePerTurn) {
        const used = card.activationsThisTurn?.[ability.id] ?? 0;
        if (used >= 1) {
            throw new Error("Activate only once each turn");
        }
    }
}

/** Records one activation of `abilityId` against `card` for the current turn
 *  (CR 602.5 — `oncePerTurn` enforcement). Initialises the counter map on
 *  first activation. Called at every activation commit site. */
function recordActivation(card: CardInstanceState, abilityId: string): void {
    const map: Record<string, number> = card.activationsThisTurn ?? {};
    map[abilityId] = (map[abilityId] ?? 0) + 1;
    card.activationsThisTurn = map;
}

/** Minimum number of targets required for a TargetRequirement.count value.
 *  Fixed N → N; range → min. Used to validate confirmTargets (CR 601.2c). */
function minTargetCount(count: number | { min: number; max?: number }): number {
    return typeof count === "number" ? count : count.min;
}

/** Resolves the literal `"X"` target-count form to a fixed number using the
 *  cast's `chosenX` (CR 107.3 / 601.2c). Returns the input unchanged for
 *  numeric / range counts. Used only on the cast path — activated abilities
 *  don't carry chosenX, so passing `"X"` without chosenX throws. */
function resolveTargetCount(
    count: number | "X" | { min: number; max?: number },
    chosenX: number | undefined
): number | { min: number; max?: number } {
    if (count === "X") {
        if (chosenX === undefined) {
            throw new Error('Target count "X" requires chosenX');
        }
        return chosenX;
    }
    return count;
}

/** True when the selected targets have reached the maximum allowed for this
 *  requirement. Fixed N → selected >= N; range → selected >= max (undefined
 *  max means no upper limit, so this never triggers auto-advance). */
function isTargetCountMaxReached(
    count: number | { min: number; max?: number },
    selected: number
): boolean {
    if (typeof count === "number") return selected >= count;
    if (count.max === undefined) return false;
    return selected >= count.max;
}

/** Finalizes target selection and either places the spell on the stack (if
 *  the caster can already pay) or transitions into the payment phase.
 *  Mutates `state` in place. Handles chosenX propagation and the per-target
 *  additional generic cost modifier (CR 601.2f). */
function finalizeTargetSelection(
    state: GameState,
    pt: PendingTarget,
    playerId: string
): void {
    const targets = [...pt.selected];
    const cardInstanceId = pt.cardInstanceId;
    const keepPriority = pt.keepPriority;
    const chosenX = pt.chosenX;
    const chosenModeId = pt.chosenModeId;
    const kind = pt.kind ?? "cast";
    const abilityId = pt.abilityId;
    state.pendingTarget = undefined;

    const player = getPlayer(state, playerId);

    // Activated-ability targeting branch (CR 602.2b). Targets were chosen
    // first; costs are paid NOW. If mana isn't in the pool, enter a
    // pendingActivation payment phase — the already-selected targets ride
    // along and are re-applied at commit.
    if (kind === "ability") {
        if (!abilityId) throw new Error("pendingTarget.abilityId missing");
        const card = player.battlefield.find((c) => c.id === cardInstanceId);
        if (!card) throw new Error("Ability source not on battlefield");
        const resolved = resolveActivatedAbility(card, abilityId);
        if (!resolved) throw new Error("Ability not found");
        const ability = resolved.ability;
        const grantedSourceCardId =
            pt.grantedSourceCardId ?? resolved.grantedSourceCardId;
        if (ability.cost.tap && card.isTapped) {
            throw new Error("Card is already tapped");
        }
        if (ability.cost.removeCounter) {
            const have = card.counters?.[ability.cost.removeCounter.type] ?? 0;
            if (have < ability.cost.removeCounter.count) {
                throw new Error("Not enough counters to pay activation cost");
            }
        }
        if (
            ability.canActivate !== undefined &&
            !ability.canActivate(card, state)
        ) {
            throw new Error("Ability cannot be activated right now");
        }
        assertActivationTimingLegal(state, card, ability);

        const hasXInCost =
            ability.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        const abilityChosenX = hasXInCost ? chosenX : undefined;
        if (hasXInCost && abilityChosenX === undefined) {
            throw new Error("This ability requires a chosen X value");
        }
        const manaCost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana, {
                  chosenX: abilityChosenX,
              })
            : undefined;

        // Enter pendingActivation (deferred commit) if mana isn't covered.
        if (manaCost && !isManaCostCovered(player.manaPool, manaCost)) {
            state.pendingActivation = {
                playerId,
                cardInstanceId: card.id,
                abilityId,
                manaCost,
                tappedLandIds: [],
                tapSource: !!ability.cost.tap,
                sacrificeSource: !!ability.cost.sacrifice,
                ...(ability.cost.removeCounter
                    ? { removeCounterCost: { ...ability.cost.removeCounter } }
                    : {}),
                ...(abilityChosenX !== undefined
                    ? { chosenX: abilityChosenX }
                    : {}),
                keepPriority,
                targets,
                ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            };
            return;
        }

        // Commit immediately.
        if (ability.cost.tap) card.isTapped = true;
        if (manaCost) {
            payManaCost(player.manaPool, manaCost);
            commitLandsForCost(player, manaCost);
        }
        if (ability.cost.removeCounter) {
            payRemoveCounterCost(card, ability.cost.removeCounter);
        }
        if (ability.cost.sacrifice) {
            removePermanentTo(state, card.id, "graveyard");
        }

        const stackItem: StackItem = {
            ...structuredClone(card),
            zone: "stack" as const,
            castById: playerId,
            abilityId,
            targets,
            ...(abilityChosenX !== undefined
                ? { chosenX: abilityChosenX }
                : {}),
            ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
        };
        state.stack.push(stackItem);
        recordActivation(card, abilityId);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, playerId);
        state.singleShotAutoPass = keepPriority ? undefined : playerId;
        drainAutoPasses(state);
        return;
    }

    // Spell cast branch (CR 601.2c).
    const cardInHand = player.hand.find((c) => c.id === cardInstanceId);
    if (!cardInHand) throw new Error("Card not in hand");
    const cardDef = getCardById((cardInHand.card as { id: string }).id);

    const rawCost = getInstanceManaCost(cardInHand);
    const extraPer = cardDef.additionalGenericPerExtraTarget ?? 0;
    const additionalGeneric =
        extraPer > 0 ? Math.max(0, targets.length - 1) * extraPer : 0;
    const manaCost = rawCost
        ? normalizeManaCost(rawCost, { chosenX, additionalGeneric })
        : {};

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
            castById: playerId,
            targets,
            ...(chosenX !== undefined ? { chosenX } : {}),
            ...(chosenModeId ? { chosenModeId } : {}),
        };
        state.stack.push(stackItem);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, playerId);
        state.singleShotAutoPass = keepPriority ? undefined : playerId;
        drainAutoPasses(state);
        emitSpellCastEvent(state, stackItem);
        processPendingActionTriggers(state);
    } else {
        state.pendingCast = {
            playerId,
            cardInstanceId,
            manaCost,
            tappedLandIds: [],
            keepPriority,
            chosenX,
            ...(chosenModeId ? { chosenModeId } : {}),
        };
        // Targets ride along on pendingCast until payment completes.
        (state.pendingCast as Record<string, unknown>).targets = targets;
    }
}

/** Step 1 of casting: announce the spell, enter payment phase (CR 601.2a). */
export const announceCast = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        /** If true, the caster keeps priority after the spell hits the stack
         *  (Ctrl-initiated cast). Default is to auto-skip the caster's next
         *  priority window so they don't respond to their own spell. */
        keepPriority: v.optional(v.boolean()),
        /** Value chosen for X at cast-time (CR 107.3, 601.2b). Required when
         *  the spell has `X: "X"` in its mana cost. */
        chosenX: v.optional(v.number()),
        /** Mode chosen for modal spells (CR 700.2 / 700.2c). Required when
         *  the card defines `modes`. */
        chosenModeId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);
        const player = getPlayer(state, args.playerId);

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }
        if (state.pendingCast) {
            throw new Error("Another spell is already being cast");
        }
        if (state.pendingActivation) {
            throw new Error("An ability is already being activated");
        }
        if (state.pendingTarget) {
            throw new Error("Target selection is in progress");
        }

        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!cardInHand) throw new Error("Card not in hand");
        assertLegalAction(state, player, cardInHand, "cast");

        const cardDef = getCardById((cardInHand.card as { id: string }).id);

        // Validate X is provided iff the cost contains a string X (CR 107.3).
        const hasX =
            typeof (cardDef.manaCost as { X?: unknown } | undefined)?.X ===
            "string";
        if (hasX && (args.chosenX === undefined || args.chosenX < 0)) {
            throw new Error("Must choose X (≥ 0) for this spell");
        }
        const chosenX = hasX ? args.chosenX : undefined;

        // Modal spell — caster locks in a mode at announcement (CR 700.2c).
        // The chosen mode's targetRequirement / resolve drive the rest of
        // the announcement and resolution flow.
        let chosenMode: SpellMode | undefined;
        if (cardDef.modes && cardDef.modes.length > 0) {
            if (!args.chosenModeId) {
                throw new Error(
                    "Modal spell — must choose a mode at announcement"
                );
            }
            chosenMode = cardDef.modes.find((m) => m.id === args.chosenModeId);
            if (!chosenMode) {
                throw new Error(
                    `Unknown mode id "${args.chosenModeId}" for ${cardDef.name}`
                );
            }
        } else if (args.chosenModeId) {
            throw new Error(
                "Card is not modal — chosenModeId must not be supplied"
            );
        }

        // For modal spells, the chosen mode's targetRequirement drives target
        // selection (CR 700.2d). Falls back to the card-level requirement for
        // non-modal spells.
        const activeTargetRequirement =
            chosenMode?.targetRequirement ?? cardDef.targetRequirement;

        // Check if the card requires targets (CR 601.2c). When `count: "X"`
        // resolves to 0 (X chosen as 0), the spell takes no targets — fall
        // through to the no-target cast path (CR 107.3, e.g. Volcanic
        // Eruption with X=0 destroys 0 Mountains and deals 0 damage).
        const resolvedCount = activeTargetRequirement
            ? resolveTargetCount(activeTargetRequirement.count, chosenX)
            : undefined;
        const requiresTargets =
            activeTargetRequirement !== undefined &&
            (typeof resolvedCount !== "number" || resolvedCount > 0);

        if (activeTargetRequirement && requiresTargets) {
            // CR 202.2 / 702.16b: source colors derived from the casting
            // card's mana cost, so getLegalTargets can exclude permanents
            // with protection from any of those colors.
            const sourceColors = STATIC_EFFECT_CTX.getColors(cardInHand);
            const legalTargets = getLegalTargets(
                state,
                activeTargetRequirement,
                sourceColors,
                args.playerId,
                chosenX
            );
            if (legalTargets.length === 0) {
                throw new Error("No legal targets available");
            }
            // CR 601.2c: must be able to choose enough legal targets.
            const required = minTargetCount(resolvedCount!);
            if (legalTargets.length < required) {
                throw new Error("Not enough legal targets");
            }
            const subtypeFilter = activeTargetRequirement.subtypeFilter
                ? Array.isArray(activeTargetRequirement.subtypeFilter)
                    ? activeTargetRequirement.subtypeFilter
                    : [activeTargetRequirement.subtypeFilter]
                : undefined;
            const resolvedCmcFilter = resolveCmcFilter(
                activeTargetRequirement.cmcFilter,
                chosenX
            );
            // Enter target selection phase before mana payment
            state.pendingTarget = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                targetType: activeTargetRequirement.type,
                count: resolvedCount!,
                selected: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                ...(activeTargetRequirement.zone
                    ? { zone: activeTargetRequirement.zone }
                    : {}),
                ...(activeTargetRequirement.controller
                    ? { controller: activeTargetRequirement.controller }
                    : {}),
                ...(subtypeFilter ? { subtypeFilter } : {}),
                ...(activeTargetRequirement.powerFilter
                    ? { powerFilter: activeTargetRequirement.powerFilter }
                    : {}),
                ...(resolvedCmcFilter ? { cmcFilter: resolvedCmcFilter } : {}),
            };

            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );

            return;
        }

        // No targets needed — proceed to additional-cost picker (CR 117.9 /
        // 601.2f) or directly to mana payment / cast if no additional cost.
        const rawCost = getInstanceManaCost(cardInHand);

        const manaCost = rawCost ? normalizeManaCost(rawCost, { chosenX }) : {};

        const additionalCostSpec = cardDef.additionalCosts;
        if (additionalCostSpec?.sacrificeFilter) {
            // CR 117.9: the cast is illegal if the player can't pay the
            // additional cost. Validate up-front before entering pendingCast.
            const candidates = player.battlefield.filter((c) =>
                matchesPermanentFilter(c, additionalCostSpec.sacrificeFilter)
            );
            if (candidates.length === 0) {
                throw new Error(
                    "No legal permanent to pay the additional cost"
                );
            }
            // Open pendingCast in additional-cost picker mode. Commit is
            // gated on the pickedId being set, regardless of mana coverage.
            state.pendingCast = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                manaCost,
                tappedLandIds: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                additionalCost: {
                    kind: "sacrifice",
                    filter: additionalCostSpec.sacrificeFilter,
                },
            };

            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

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
                ...(chosenX !== undefined ? { chosenX } : {}),
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
            };
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
            state.singleShotAutoPass = args.keepPriority
                ? undefined
                : args.playerId;
            drainAutoPasses(state);
            emitSpellCastEvent(state, stackItem);
            processPendingActionTriggers(state);
        } else {
            // Enter payment phase for remaining mana
            state.pendingCast = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                manaCost,
                tappedLandIds: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
            };
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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
            // CR 605.2 — emit "tapped for mana" before any sacrifice path
            // moves the card off the battlefield, so the event still carries
            // the permanent's pre-sacrifice types/subtypes.
            emitPermanentTapped(state, card, true, chosen);
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
            const amount = getFixedManaAmount(card, manaColor);
            player.manaPool[manaColor] =
                (player.manaPool[manaColor] ?? 0) + amount;
            emitPermanentTapped(state, card, true, {
                [manaColor]: amount,
            } as ManaCost);
            state.pendingCast.tappedLandIds.push(card.id);
        }

        // Check if cost is now covered → auto-commit
        tryAutoCommitPendingCast(state, args.playerId);
        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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
            const amount = getFixedManaAmount(card, manaColor);
            player.manaPool[manaColor] = Math.max(
                0,
                (player.manaPool[manaColor] ?? 0) - amount
            );
        }

        card.isTapped = false;
        discardPermanentTappedEvent(state, card.id);
        state.pendingCast.tappedLandIds.splice(idx, 1);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Cancel a pending cast: rollback all taps (CR 601.2 reversal). */
/** Picks a permanent to pay the spell's additional cost (CR 117.9 /
 *  601.2f). Only valid while pendingCast is in its additional-cost picker
 *  stage. On selection, attempts auto-commit; if mana isn't yet covered the
 *  player continues to tap lands and commit completes via tryAutoCommitPendingCast. */
export const selectAdditionalCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }
        const ac = state.pendingCast.additionalCost;
        if (!ac) {
            throw new Error("This spell has no additional cost picker");
        }
        if (ac.pickedId) {
            throw new Error("Additional cost already paid");
        }
        const player = getPlayer(state, args.playerId);
        const candidate = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!candidate) {
            throw new Error("Selected permanent not on your battlefield");
        }
        if (!matchesPermanentFilter(candidate, ac.filter)) {
            throw new Error(
                "Selected permanent does not match the additional cost filter"
            );
        }
        ac.pickedId = args.cardInstanceId;

        // tryAutoCommitPendingCast clears pendingCast and emits SPELL_CAST
        // when it succeeds. If mana isn't yet covered, the cast remains in
        // pendingCast and the player completes payment via tapForPayment.
        tryAutoCommitPendingCast(state, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

export const cancelCast = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
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
            discardPermanentTappedEvent(state, cardId);
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
                    const amount = getFixedManaAmount(card, manaColor);
                    player.manaPool[manaColor] = Math.max(
                        0,
                        (player.manaPool[manaColor] ?? 0) - amount
                    );
                }
            }
        }

        state.pendingCast = undefined;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Tap a land during an activated-ability payment phase. Auto-commits the
 *  ability onto the stack when the mana cost is fully covered. */
export const tapForActivationPayment = mutation({
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
        assertGameNotOver(state);

        const pa = state.pendingActivation;
        if (!pa) throw new Error("No ability being activated");
        if (pa.playerId !== args.playerId) {
            throw new Error("Not your pending activation");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        tapSourceIntoPayment(
            state,
            player,
            card,
            args.manaChoiceIndex,
            pa.tappedLandIds
        );

        // If the pool now covers pendingActivation, pay mana, apply deferred
        // tap/sacrifice costs and push the ability on the stack.
        tryAutoCommitPendingActivation(state, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Untap a land during activation payment (undo). */
export const untapForActivationPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const pa = state.pendingActivation;
        if (!pa) throw new Error("No ability being activated");
        if (pa.playerId !== args.playerId) {
            throw new Error("Not your pending activation");
        }

        const idx = pa.tappedLandIds.indexOf(args.cardInstanceId);
        if (idx === -1) {
            throw new Error("This land was not tapped during this activation");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Cannot undo: source was sacrificed");

        untapSourceFromPayment(state, player, card);
        pa.tappedLandIds.splice(idx, 1);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Cancel a pending activation: rollback all taps. The source permanent is
 *  untouched because tap/sacrifice costs are deferred until commit. */
export const cancelActivation = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const pa = state.pendingActivation;
        if (!pa) throw new Error("No ability being activated");
        if (pa.playerId !== args.playerId) {
            throw new Error("Not your pending activation");
        }

        const player = getPlayer(state, args.playerId);
        for (const cardId of pa.tappedLandIds) {
            const card = player.battlefield.find((c) => c.id === cardId);
            if (!card) continue;
            untapSourceFromPayment(state, player, card);
        }

        state.pendingActivation = undefined;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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
            v.literal("spell"),
            v.literal("graveyard-card")
        ),
        targetId: v.string(),
        /** Owner of the zone the target lives in. Required for non-
         *  battlefield zones (e.g. "graveyard-card") so the same instance id
         *  is unambiguous; ignored for battlefield/player/spell targets. */
        targetPlayerId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        const target: {
            type: "permanent" | "player" | "spell" | "graveyard-card";
            id: string;
            playerId?: string;
        } = {
            type: args.targetType,
            id: args.targetId,
            ...(args.targetPlayerId ? { playerId: args.targetPlayerId } : {}),
        };

        // Validate the target exists and matches the requirement
        const pt = state.pendingTarget;
        const reqTypes = Array.isArray(pt.targetType)
            ? pt.targetType
            : [pt.targetType];
        const wantsAny = reqTypes.includes("any");

        if (args.targetType === "graveyard-card") {
            // CR 109.2 / 400.7: graveyard-zone target. The chooser names a
            // specific player's graveyard via `targetPlayerId`; the engine
            // validates that the card sits there, matches the requested
            // CardType filter, and that the graveyard's owner satisfies the
            // controller-relationship constraint ("you" / "opponent" / any).
            if (pt.zone !== "graveyard") {
                throw new Error("This spell does not target a graveyard card");
            }
            if (!args.targetPlayerId) {
                throw new Error("targetPlayerId required for graveyard target");
            }
            const owner = state.players.find(
                (p) => p.id === args.targetPlayerId
            );
            if (!owner) throw new Error("Invalid graveyard owner");
            const controllerFilter = pt.controller ?? "any";
            if (controllerFilter === "you" && owner.id !== args.playerId) {
                throw new Error("Must target a card in your graveyard");
            }
            if (controllerFilter === "opponent" && owner.id === args.playerId) {
                throw new Error("Must target a card in opponent's graveyard");
            }
            const matchedCard = owner.graveyard.find(
                (c) => c.id === args.targetId
            );
            if (!matchedCard) throw new Error("Invalid graveyard target");
            const wantsAnyCard = reqTypes.includes("card");
            const cardTypes = reqTypes.filter(
                (t) =>
                    t !== "player" &&
                    t !== "any" &&
                    t !== "spell" &&
                    t !== "card"
            );
            if (
                !wantsAnyCard &&
                !cardTypes.some((t) => matchedCard.types.includes(t as never))
            ) {
                throw new Error("Card type mismatch for graveyard target");
            }
        } else if (args.targetType === "permanent") {
            const permanentTypes = reqTypes.filter(
                (t) =>
                    t !== "player" &&
                    t !== "any" &&
                    t !== "spell" &&
                    t !== "card"
            );
            // CR 115.4 / 120.3: "any target" only matches damageable permanents.
            let matchedCard: CardInstanceState | null = null;
            for (const p of state.players) {
                for (const c of p.battlefield) {
                    if (c.id !== args.targetId) continue;
                    const matchesAny =
                        wantsAny &&
                        DAMAGEABLE_PERMANENT_TYPES.some((t) =>
                            c.types.includes(t)
                        );
                    const matchesExplicit = permanentTypes.some((t) =>
                        c.types.includes(t as never)
                    );
                    if (matchesAny || matchesExplicit) matchedCard = c;
                }
            }
            if (!matchedCard) throw new Error("Invalid target");
            // CR 205.3: subtype-restricted choice (e.g. "target Mountains").
            if (pt.subtypeFilter && pt.subtypeFilter.length > 0) {
                const matchedSubtype = pt.subtypeFilter.some((s) =>
                    matchedCard!.subtypes.includes(s)
                );
                if (!matchedSubtype) {
                    throw new Error(
                        `Target must be ${pt.subtypeFilter.join(" or ")}`
                    );
                }
            }
            // CR 202.2: color-restricted choice (e.g. Circle of Protection).
            if (
                pt.colorFilter &&
                !hasColor(matchedCard, pt.colorFilter as Color)
            ) {
                throw new Error(`Target must be ${pt.colorFilter}`);
            }
            // CR 613 layer 7c: power-bounded target (Dwarven Warriors).
            if (pt.powerFilter) {
                const power = getEffectivePower(state, matchedCard);
                if (
                    pt.powerFilter.min !== undefined &&
                    power < pt.powerFilter.min
                ) {
                    throw new Error(
                        `Target must have power ≥ ${pt.powerFilter.min}`
                    );
                }
                if (
                    pt.powerFilter.max !== undefined &&
                    power > pt.powerFilter.max
                ) {
                    throw new Error(
                        `Target must have power ≤ ${pt.powerFilter.max}`
                    );
                }
            }
            // CR 202.3: cmcFilter narrows by mana value (X already resolved
            // upstream in resolveCmcFilter).
            if (pt.cmcFilter) {
                const cardId = (matchedCard.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                const cmc =
                    def && def.manaCost
                        ? Object.entries(def.manaCost).reduce<number>(
                              (acc, [, v]) =>
                                  acc + (typeof v === "number" ? v : 0),
                              0
                          )
                        : 0;
                if (!matchesCmcFilter(pt.cmcFilter, cmc)) {
                    throw new Error(
                        "Target does not match the required mana value"
                    );
                }
            }
            // CR 702.16b: a permanent with protection from [color] can't be
            // targeted by a spell/ability whose source has that color.
            const sourceColors = getPendingTargetSourceColors(
                state,
                pt.cardInstanceId,
                pt.kind ?? "cast"
            );
            if (isProtectedFromColors(matchedCard, sourceColors)) {
                throw new Error("Target has protection from this source");
            }
        } else if (args.targetType === "player") {
            if (!wantsAny && !reqTypes.includes("player")) {
                throw new Error("Must target a permanent");
            }
            if (pt.colorFilter) {
                throw new Error("Players have no color");
            }
            const found = state.players.some((p) => p.id === args.targetId);
            if (!found) throw new Error("Invalid player target");
        } else {
            // "spell" target (CR 114.1): must match a stack item.
            if (!reqTypes.includes("spell")) {
                throw new Error("This spell does not target a spell");
            }
            const spell = state.stack.find((s) => s.id === args.targetId);
            if (!spell) throw new Error("Invalid spell target");
            if (pt.colorFilter && !hasColor(spell, pt.colorFilter as Color)) {
                throw new Error(`Target must be ${pt.colorFilter}`);
            }
            if (pt.cmcFilter) {
                const cardId = (spell.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                const baseCmc =
                    def && def.manaCost
                        ? Object.entries(def.manaCost).reduce<number>(
                              (acc, [, v]) =>
                                  acc + (typeof v === "number" ? v : 0),
                              0
                          )
                        : 0;
                const cmc = baseCmc + (spell.chosenX ?? 0);
                if (!matchesCmcFilter(pt.cmcFilter, cmc)) {
                    throw new Error(
                        "Target does not match the required mana value"
                    );
                }
            }
        }

        pt.selected.push(target);

        const maxReached = isTargetCountMaxReached(
            pt.count,
            pt.selected.length
        );
        if (maxReached) {
            finalizeTargetSelection(state, pt, args.playerId);
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Finalize target selection for spells with a variable number of targets
 *  (CR 601.2c). Legal once at least `min` targets have been chosen. Fixed-N
 *  target requirements auto-advance in selectTarget and do not need this. */
export const confirmTargets = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        const pt = state.pendingTarget;
        if (pt.selected.length < minTargetCount(pt.count)) {
            throw new Error(
                `At least ${minTargetCount(pt.count)} target(s) required`
            );
        }
        finalizeTargetSelection(state, pt, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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
        assertGameNotOver(state);

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        state.pendingTarget = undefined;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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

        const defenderBattlefield = getPlayer(
            state,
            getOpponentId(state, args.playerId)
        ).battlefield;
        const idx = state.combat.attackerIds.indexOf(args.cardInstanceId);
        if (idx !== -1) {
            // CR 508.1d: can't deselect a creature required to attack
            if (mustAttack(card, defenderBattlefield)) {
                throw new Error(
                    `${getCardById(card.card.id as string).name} must attack this combat if able`
                );
            }
            state.combat.attackerIds.splice(idx, 1);
        } else {
            // Select — must be eligible
            const validation = validateAttackerEligibility(
                card,
                defenderBattlefield
            );
            if (!validation.eligible) {
                throw new Error(validation.reason);
            }
            state.combat.attackerIds.push(args.cardInstanceId);
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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

        // CR 508.1d: auto-include any eligible creature required to attack
        // that the player didn't manually select.
        const defenderBattlefield = getPlayer(
            state,
            getOpponentId(state, args.playerId)
        ).battlefield;
        for (const requiredId of getRequiredAttackerIds(
            player.battlefield,
            defenderBattlefield
        )) {
            if (!state.combat.attackerIds.includes(requiredId)) {
                state.combat.attackerIds.push(requiredId);
            }
        }

        // Tap and mark each attacker (vigilance creatures don't tap)
        for (const attackerId of state.combat.attackerIds) {
            const card = player.battlefield.find((c) => c.id === attackerId);
            if (card) {
                if (!card.staticAbilities.includes("vigilance")) {
                    card.isTapped = true;
                }
                card.isAttacking = true;
                card.hasAttackedThisTurn = true;
            }
        }

        state.combat.confirmed = true;
        state.combat.blockerAssignments = {};
        state.combat.blockersConfirmed = false;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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

        // Evasion checks (CR 509.1b): flying (CR 702.9) + landwalk (CR 702.13).
        const activePlayer = getPlayer(state, state.activePlayerId);
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === args.attackerId
        );
        const defender = getPlayer(state, args.playerId);
        const blocker = defender.battlefield.find(
            (c) => c.id === state.combat!.pendingBlockerId
        );
        if (attacker && blocker) {
            const check = validateBlockerEligibility(
                attacker,
                blocker,
                defender.battlefield,
                state
            );
            if (!check.eligible) {
                throw new Error(check.reason);
            }
        }

        state.combat.blockerAssignments[state.combat.pendingBlockerId] =
            args.attackerId;
        state.combat.pendingBlockerId = undefined;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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

        // CR 509.2 — active player gets priority immediately after blockers
        // are declared. The historic damage-assignment-order turn-based
        // action was removed: per CR 510.1c/d the attacking player divides
        // combat damage freely among multiple blockers during the combat
        // damage step.
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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
        assertGameNotOver(state);

        if (
            state.phase !== "FIRST_STRIKE_DAMAGE" &&
            state.phase !== "COMBAT_DAMAGE"
        ) {
            throw new Error("Not in a combat damage step");
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

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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
        assertGameNotOver(state);

        if (
            state.phase !== "FIRST_STRIKE_DAMAGE" &&
            state.phase !== "COMBAT_DAMAGE"
        ) {
            throw new Error("Not in a combat damage step");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player confirms damage");
        }
        if (!state.combat || state.combat.damageConfirmed !== false) {
            throw new Error("Damage assignment is not open");
        }

        const kind =
            state.phase === "FIRST_STRIKE_DAMAGE" ? "first-strike" : "regular";
        applyAllCombatDamage(state, state.combat.damageAssignments ?? {}, kind);
        state.combat.damageConfirmed = true;

        // Check SBA after combat damage (CR 704.5)
        checkStateBasedActions(state);

        if (!state.gameOver) {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
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
        assertGameNotOver(state);
        assertNoPendingChoices(state);

        // CR 103.5: no priority is given during the pre-game mulligan phase.
        if (state.phase === "MULLIGAN") {
            throw new Error("Cannot pass priority during mulligan phase");
        }

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

        // Cannot pass priority before confirming damage assignments
        if (
            (state.phase === "FIRST_STRIKE_DAMAGE" ||
                state.phase === "COMBAT_DAMAGE") &&
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
            if ((state.pendingChoices?.length ?? 0) > 0) {
                // Resolution suspended awaiting player choices (CR 608.2).
                // Hand priority to the chooser; the gate on passPriority and
                // other priority-driven mutations prevents any action other
                // than selectResolutionChoice.
                state.priorityPlayerId = state.pendingChoices![0].playerId;
            } else {
                state.priorityPlayerId = state.activePlayerId;
                state.passCount = 0;
            }
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
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Submit one pick for the currently-active mid-resolution choice (CR 608.2).
 *  Accumulates `cardInstanceId` into `pendingChoices[0].selected`; auto-
 *  finalizes when the count is reached by (a) moving the picks into the
 *  stack item's `collectedChoices`, (b) shifting the head off the queue,
 *  and (c) if the queue is empty, resuming the resolution via
 *  `resolveTopOfStack`. If the resume re-suspends on a new choice, priority
 *  is handed to the next chooser; otherwise priority returns to the active
 *  player and the pass count resets. */
export const selectResolutionChoice = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const queue = state.pendingChoices ?? [];
        if (queue.length === 0) throw new Error("No pending choice");
        const head = queue[0];
        if (head.playerId !== args.playerId) {
            throw new Error("Not your pending choice");
        }
        if (head.kind === "may-pay") {
            throw new Error("Use submitMayPay for may-pay choices");
        }
        if (head.selected.includes(args.cardInstanceId)) {
            throw new Error("Already selected");
        }

        // CR 608.2 — the zone being picked from is `zoneOwnerId ?? playerId`
        // (default: chooser's own zone). When `zoneOwnerId` is set, the
        // chooser is picking from another player's zone (e.g. Demonic Hordes
        // → opponent picks a Land from controller's battlefield).
        const zoneOwner = getPlayer(state, head.zoneOwnerId ?? args.playerId);
        if (head.zone === "battlefield") {
            const card = zoneOwner.battlefield.find(
                (c) => c.id === args.cardInstanceId
            );
            if (!card) throw new Error("Card not on battlefield");
            if (head.filter && !matchesPermanentFilter(card, head.filter)) {
                throw new Error("Card does not match the required filter");
            }
            // Untap-pick (CR 502.1): can only pick a tapped permanent that
            // is allowed to untap. `does-not-untap` markers (Basalt Monolith
            // / Mana Vault / Paralyze's grant to its host) make the
            // permanent ineligible regardless of filter match.
            if (head.kind === "untap-pick") {
                if (!card.isTapped) {
                    throw new Error("Card is not tapped");
                }
                if (card.staticAbilities.includes("does-not-untap")) {
                    throw new Error("Card cannot untap");
                }
                // CR 502.1 defense-in-depth: reject picks matching any
                // hard-skip restriction (maxUntap === 0). The dispatcher
                // already excludes these from the eligible set, but stale
                // client state could send a forbidden id.
                const vetoFilters = computeHardSkipFilters(state);
                const view = effectivePermanentView(state, card);
                if (vetoFilters.some((f) => matchesPermanentFilter(view, f))) {
                    throw new Error("Card cannot untap");
                }
            }
        } else if (head.zone === "hand") {
            const card = zoneOwner.hand.find(
                (c) => c.id === args.cardInstanceId
            );
            if (!card) throw new Error("Card not in hand");
        } else {
            const card = zoneOwner.library.find(
                (c) => c.id === args.cardInstanceId
            );
            if (!card) throw new Error("Card not in library");
        }

        head.selected.push(args.cardInstanceId);

        if (head.selected.length >= getPendingChoiceMax(head.count)) {
            if (head.kind === "untap-pick") {
                // Untap-step cap (CR 502.1) reached its max: finalize the
                // pick — untap the chosen ids on the chooser's BF, dequeue,
                // and resume the untap dispatcher. The dispatcher may
                // enqueue the next restriction's prompt or fall through to
                // flag cleanup; in the latter case advancePhase leaves UNTAP.
                finalizeUntapPick(state, head.selected);
            } else if (head.kind === "mulligan-bottom") {
                // Pre-game mulligan bottoming (CR 103.5) — no stack item; the
                // mulligan module moves the picks to the bottom of the
                // library, pops the queue, and either advances priority to
                // the next chooser or finalizes the mulligan phase
                // (advancing to UPKEEP of turn 1).
                applyMulliganBottomChoice(state);
                state.pendingChoices =
                    (state.pendingChoices?.length ?? 0) > 0
                        ? state.pendingChoices
                        : undefined;
                if ((state.pendingChoices?.length ?? 0) === 0) {
                    // finalizeMulligan ran — priority is set by advancePhase.
                    state.priorityPlayerId = state.activePlayerId;
                    state.passCount = 0;
                    drainAutoPasses(state);
                }
                // SBA not run during MULLIGAN (no game-over conditions apply
                // pre-game, CR 704.3); after finalizeMulligan we're in UPKEEP
                // and the next mutation will run SBA as usual.
            } else {
                // Mid-resolution choice (CR 608.2) — commit into the stack
                // item's collectedChoices so the next invocation of the step
                // reads it back via requestChoice.
                const stackItem = state.stack.find(
                    (s) => s.id === head.stackItemId
                );
                if (!stackItem) throw new Error("Stack item not found");
                const key = `${head.step}:${head.choiceId}`;
                stackItem.collectedChoices = {
                    ...(stackItem.collectedChoices ?? {}),
                    [key]: head.selected,
                };

                queue.shift();
                state.pendingChoices = queue.length > 0 ? queue : undefined;

                // If the queue is empty, resume resolution. The resolve may
                // enqueue fresh pending choices (next step) — treat that as a
                // new suspension and hand priority to the new chooser.
                if ((state.pendingChoices?.length ?? 0) === 0) {
                    resolveTopOfStack(state);
                    if ((state.pendingChoices?.length ?? 0) > 0) {
                        state.priorityPlayerId =
                            state.pendingChoices![0].playerId;
                    } else {
                        // Full resolution completed — priority returns to the
                        // active player (CR 117.3d) and the pass count resets.
                        state.priorityPlayerId = state.activePlayerId;
                        state.passCount = 0;
                        drainAutoPasses(state);
                    }
                    checkStateBasedActions(state);
                } else {
                    // More choices queued within the same step — move
                    // priority to the next chooser.
                    state.priorityPlayerId = state.pendingChoices![0].playerId;
                }
            }
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Commits an `untap-pick` `PendingChoice` (CR 502.1): untaps the chosen
 *  ids on the chooser's battlefield, pops the choice off the queue, and
 *  resumes the untap dispatcher (`untapStep`). If the dispatcher enqueues
 *  the next restriction's prompt, priority stays with the chooser; if all
 *  restrictions are resolved, `advancePhase` leaves UNTAP and routes
 *  priority to the active player for UPKEEP. */
function finalizeUntapPick(state: GameState, selectedIds: string[]): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (!head || head.kind !== "untap-pick") return;
    const chooser = getPlayer(state, head.zoneOwnerId ?? head.playerId);
    for (const id of selectedIds) {
        const card = chooser.battlefield.find((c) => c.id === id);
        if (card) card.isTapped = false;
    }
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
    untapStep(state);
    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
        return;
    }
    // No more restrictions to resolve — leave UNTAP and continue the
    // normal auto-phase recursion (UNTAP → UPKEEP, granting priority).
    advancePhase(state);
    drainAutoPasses(state);
}

/** Commits the current `untap-pick` selection (CR 502.1) with whatever
 *  ids the chooser has accumulated in `head.selected` — including the
 *  empty list (the ADR 0003 "untap zero" tactical zero-branch surfaced
 *  in the UI as the "Skip untap" action). `selectResolutionChoice`
 *  remains the path that auto-commits once `selected.length` reaches
 *  `max`; this mutation handles the early-commit / skip case where the
 *  chooser is satisfied with `[min, max)` picks. */
export const confirmUntapPick = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const queue = state.pendingChoices ?? [];
        if (queue.length === 0) throw new Error("No pending choice");
        const head = queue[0];
        if (head.kind !== "untap-pick") {
            throw new Error("Pending choice is not an untap-pick");
        }
        if (head.playerId !== args.playerId) {
            throw new Error("Not your pending choice");
        }

        finalizeUntapPick(state, [...head.selected]);
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Submits a yes/no decision to a pending `may-pay` choice (CR 117.3a / 118.4).
 *  When `accept` is true and the choice carries a mana cost, the cost is
 *  validated against the player's mana pool and paid; if the pool can't
 *  cover, the call throws (forcing the player to either tap mana abilities
 *  before submitting or decline). Lands tapped to make mana for this
 *  payment go through the normal `tapForPayment` flow. */
export const submitMayPay = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        accept: v.boolean(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const queue = state.pendingChoices ?? [];
        if (queue.length === 0) throw new Error("No pending choice");
        const head = queue[0];
        if (head.kind !== "may-pay") {
            throw new Error("Pending choice is not a may-pay");
        }
        if (head.playerId !== args.playerId) {
            throw new Error("Not your pending choice");
        }

        if (args.accept && head.cost) {
            const player = getPlayer(state, args.playerId);
            const normalized = normalizeManaCost(head.cost);
            if (!isManaCostCovered(player.manaPool, normalized)) {
                throw new Error(
                    "Cannot pay the cost from your current mana pool"
                );
            }
            payManaCost(player.manaPool, normalized);
            commitLandsForCost(player, normalized);
        }

        head.selected = [args.accept ? "yes" : "no"];

        // Commit into the stack item's collectedChoices so the resolve step
        // re-invocation reads the answer back via requestMayPay.
        const stackItem = state.stack.find((s) => s.id === head.stackItemId);
        if (!stackItem) throw new Error("Stack item not found");
        const key = `${head.step}:${head.choiceId}`;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [key]: head.selected,
        };

        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;

        if ((state.pendingChoices?.length ?? 0) === 0) {
            resolveTopOfStack(state);
            if ((state.pendingChoices?.length ?? 0) > 0) {
                state.priorityPlayerId = state.pendingChoices![0].playerId;
            } else {
                state.priorityPlayerId = state.activePlayerId;
                state.passCount = 0;
                drainAutoPasses(state);
            }
            checkStateBasedActions(state);
        } else {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Declare keep / mulligan during the pre-game mulligan phase (CR 103.5,
 *  London mulligan). Sequential per round in turn order from the starting
 *  player. Once every still-unlocked player has declared this round, the
 *  mulligan engine executes the round (mull players reshuffle + redraw 7,
 *  keep players lock). When all players are locked, bottoming PendingChoices
 *  are enqueued for any player who took at least one mulligan; their picks
 *  are applied via `selectResolutionChoice` (kind "mulligan-bottom"). */
export const declareMulligan = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        decision: v.union(v.literal("keep"), v.literal("mull")),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.phase !== "MULLIGAN") {
            throw new Error("Mulligan declarations only legal during MULLIGAN");
        }
        if (!state.mulligan) {
            throw new Error("Mulligan state missing");
        }
        if (state.mulligan.bottoming) {
            throw new Error("Cannot declare mulligan during bottoming");
        }

        recordDeclaration(state, args.playerId, args.decision);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
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
        assertGameNotOver(state);
        assertNoPendingChoices(state);

        if (state.phase === "MULLIGAN") {
            throw new Error("Cannot end turn during mulligan phase");
        }

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
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Cancel auto-pass: stop auto-passing the next time priority returns. Priority
 *  is NOT reclaimed from the opponent — they keep holding it until they act. */
export const cancelAutoPass = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const autoPassPlayers = state.autoPassPlayers ?? [];
        const wasAutoPass = autoPassPlayers.includes(args.playerId);
        const wasSingleShot = state.singleShotAutoPass === args.playerId;
        if (!wasAutoPass && !wasSingleShot) return;

        if (wasAutoPass) {
            const remaining = autoPassPlayers.filter(
                (id) => id !== args.playerId
            );
            state.autoPassPlayers =
                remaining.length > 0 ? remaining : undefined;
        }
        if (wasSingleShot) {
            state.singleShotAutoPass = undefined;
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** CR 104.3a: a player can concede the game at any time. That player loses. */
export const concede = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        getPlayer(state, args.playerId);
        const winnerId = getOpponentId(state, args.playerId);

        state.gameOver = {
            winnerId,
            loserId: args.playerId,
            reason: "concede",
        };

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
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
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            // CR 704.5b: attempting to draw from empty library
            player.hasDrawnFromEmpty = true;
            checkStateBasedActions(state);

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
            await finalizeGameOver(ctx, args.gameId, nextSeq, state);
            return;
        }

        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
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
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        moveCard(player, player.library[0].id, "library", "graveyard");

        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
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
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        moveCard(player, player.library[0].id, "library", "exile");

        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** Activate a non-mana ability on a permanent (CR 602.2). Pays costs and puts ability on stack. */
export const activateAbility = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        abilityId: v.string(),
        /** If true, the activator keeps priority after the ability hits the stack. */
        keepPriority: v.optional(v.boolean()),
        /** Value chosen for X at activation time for abilities with X in
         *  their mana cost (CR 107.3 / 601.2b). Ignored for abilities without
         *  X in their cost. */
        chosenX: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }
        if (state.pendingCast) {
            throw new Error("Another spell is already being cast");
        }
        if (state.pendingActivation) {
            throw new Error("Another ability is already being activated");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        const cardId = (card.card as { id?: string }).id;
        if (!cardId) throw new Error("Card has no definition");

        const resolved = resolveActivatedAbility(card, args.abilityId);
        if (!resolved) throw new Error("Ability not found");
        const ability = resolved.ability;
        const grantedSourceCardId = resolved.grantedSourceCardId;
        if (!ability.useStack) {
            throw new Error("Use tapUntap for mana abilities");
        }
        // CR 602.5 — phase-restricted activated abilities ("activate only
        // during combat" etc.) are illegal outside their declared phase
        // allow-list. Mirrors spell-level `castPhaseRestriction`.
        if (
            ability.activationPhaseRestriction &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            throw new Error("Ability cannot be activated during this phase");
        }

        // CR 602.2b: if the ability has targets, choose them before paying
        // costs. Mana availability is deferred to finalizeTargetSelection
        // (which enters pendingActivation when the pool doesn't cover the
        // cost — mirrors the spell announceCast flow).
        if (ability.targetRequirement) {
            if (state.pendingTarget) {
                throw new Error("Target selection is in progress");
            }
            if (ability.cost.tap && card.isTapped) {
                throw new Error("Card is already tapped");
            }
            // CR 302.1 — creatures with summoning sickness cannot pay a {T}
            // cost on an activated ability (mana or otherwise).
            if (ability.cost.tap && isTapLockedBySummoningSickness(card)) {
                throw new Error("Creature has summoning sickness");
            }
            if (ability.cost.removeCounter) {
                const have =
                    card.counters?.[ability.cost.removeCounter.type] ?? 0;
                if (have < ability.cost.removeCounter.count) {
                    throw new Error(
                        "Not enough counters to pay activation cost"
                    );
                }
            }
            if (
                ability.canActivate !== undefined &&
                !ability.canActivate(card, state)
            ) {
                throw new Error("Ability cannot be activated right now");
            }
            // CR 107.3 / 601.2b — chosenX must accompany abilities with X in
            // their mana cost. Stashed on pendingTarget; finalizeTargetSelection
            // forwards it to pendingActivation / the stack item.
            const targetHasXInCost =
                ability.cost.mana?.X !== undefined &&
                typeof ability.cost.mana.X === "string";
            if (
                targetHasXInCost &&
                (args.chosenX === undefined || args.chosenX < 0)
            ) {
                throw new Error("This ability requires a chosen X value");
            }
            const targetChosenX = targetHasXInCost ? args.chosenX : undefined;
            // CR 202.2 / 702.16b: the source's colors come from the
            // permanent owning the activated ability.
            const abilitySourceColors = STATIC_EFFECT_CTX.getColors(card);
            const legal = getLegalTargets(
                state,
                ability.targetRequirement,
                abilitySourceColors,
                args.playerId,
                targetChosenX
            );
            if (legal.length === 0) {
                throw new Error("No legal targets available");
            }
            const abilityCount = resolveTargetCount(
                ability.targetRequirement.count,
                targetChosenX
            );
            const abilitySubtypeFilter = ability.targetRequirement.subtypeFilter
                ? Array.isArray(ability.targetRequirement.subtypeFilter)
                    ? ability.targetRequirement.subtypeFilter
                    : [ability.targetRequirement.subtypeFilter]
                : undefined;
            state.pendingTarget = {
                playerId: args.playerId,
                cardInstanceId: card.id,
                targetType: ability.targetRequirement.type,
                count: abilityCount,
                colorFilter: ability.targetRequirement.colorFilter,
                selected: [],
                keepPriority: args.keepPriority,
                kind: "ability",
                abilityId: args.abilityId,
                ...(targetChosenX !== undefined
                    ? { chosenX: targetChosenX }
                    : {}),
                ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
                ...(ability.targetRequirement.zone
                    ? { zone: ability.targetRequirement.zone }
                    : {}),
                ...(ability.targetRequirement.controller
                    ? { controller: ability.targetRequirement.controller }
                    : {}),
                ...(abilitySubtypeFilter
                    ? { subtypeFilter: abilitySubtypeFilter }
                    : {}),
                ...(ability.targetRequirement.powerFilter
                    ? { powerFilter: ability.targetRequirement.powerFilter }
                    : {}),
                ...(() => {
                    const resolved = resolveCmcFilter(
                        ability.targetRequirement.cmcFilter,
                        targetChosenX
                    );
                    return resolved ? { cmcFilter: resolved } : {};
                })(),
            };

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
            return;
        }

        // Pay costs (CR 602.1). Up-front checks before we mutate anything:
        if (ability.cost.tap && card.isTapped) {
            throw new Error("Card is already tapped");
        }
        // CR 302.1 — creatures with summoning sickness cannot pay a {T} cost.
        if (ability.cost.tap && isTapLockedBySummoningSickness(card)) {
            throw new Error("Creature has summoning sickness");
        }
        // CR 122.6 — counter-removal cost: source must have enough counters
        // of the declared type. Validated up-front so we never enter a
        // pendingActivation that can't be paid.
        if (ability.cost.removeCounter) {
            const have = card.counters?.[ability.cost.removeCounter.type] ?? 0;
            if (have < ability.cost.removeCounter.count) {
                throw new Error("Not enough counters to pay activation cost");
            }
        }
        // CR 602.5 — activated abilities may declare a custom precondition
        // (e.g. Clockwork Beast: "Activate only if it has fewer than seven
        // +1/+0 counters on it.") read against current source state.
        if (
            ability.canActivate !== undefined &&
            !ability.canActivate(card, state)
        ) {
            throw new Error("Ability cannot be activated right now");
        }
        assertActivationTimingLegal(state, card, ability);
        // CR 107.3 / 601.2b — chosenX is required for abilities whose mana
        // cost has X. Validate up-front; pass to normalizeManaCost so the
        // generic portion includes X * (the chosen value).
        const hasXInCost =
            ability.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        if (hasXInCost && (args.chosenX === undefined || args.chosenX < 0)) {
            throw new Error("This ability requires a chosen X value");
        }
        const chosenX = hasXInCost ? args.chosenX : undefined;
        const manaCost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana, { chosenX })
            : undefined;

        // If mana isn't covered, enter a pendingActivation payment phase that
        // mirrors pendingCast: the player taps lands, and auto-commit applies
        // the deferred tap/sacrifice and pushes the ability on the stack.
        // Tap/sacrifice are DEFERRED so cancel leaves the source untouched.
        if (manaCost && !isManaCostCovered(player.manaPool, manaCost)) {
            const pending: PendingActivation = {
                playerId: args.playerId,
                cardInstanceId: card.id,
                abilityId: args.abilityId,
                manaCost,
                tappedLandIds: [],
                tapSource: !!ability.cost.tap,
                sacrificeSource: !!ability.cost.sacrifice,
                ...(ability.cost.removeCounter
                    ? { removeCounterCost: { ...ability.cost.removeCounter } }
                    : {}),
                ...(chosenX !== undefined ? { chosenX } : {}),
                keepPriority: args.keepPriority,
                ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            };
            state.pendingActivation = pending;

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
            return;
        }

        // Mana already covered (or no mana cost) — commit immediately.
        if (ability.cost.tap) {
            card.isTapped = true;
        }
        if (manaCost) {
            payManaCost(player.manaPool, manaCost);
            commitLandsForCost(player, manaCost);
        }
        if (ability.cost.removeCounter) {
            payRemoveCounterCost(card, ability.cost.removeCounter);
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
            ...(chosenX !== undefined ? { chosenX } : {}),
            ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
        };
        state.stack.push(stackItem);
        recordActivation(card, args.abilityId);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, args.playerId);
        state.singleShotAutoPass = args.keepPriority
            ? undefined
            : args.playerId;
        drainAutoPasses(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
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
        assertGameNotOver(state);
        // CR 117.3a / 605.3b — while answering a may-pay choice, the player
        // may activate mana abilities to make the mana the cost requires.
        // Other pending-choice kinds (keep-permanents, etc.) still freeze
        // priority and reject mana ability activation.
        const mayPayHead = state.pendingChoices?.[0];
        const isMayPayPaymentWindow =
            mayPayHead?.kind === "may-pay" &&
            mayPayHead.playerId === args.playerId;
        assertNoPendingChoices(state, {
            allowManaForMayPay: { playerId: args.playerId },
        });
        const player = getPlayer(state, args.playerId);

        // Cannot manually tap/untap during a payment phase — must go through
        // the specific payment mutation so pendingCast/pendingActivation
        // bookkeeping stays consistent.
        if (state.pendingCast) {
            throw new Error("Use tapForPayment/untapForPayment during casting");
        }
        if (state.pendingActivation) {
            throw new Error(
                "Use tapForActivationPayment/untapForActivationPayment during ability activation"
            );
        }

        // CR 605.3b: a mana ability can be activated only while the player
        // has priority (or while paying a mana cost — handled above).
        // Mana payment for an active may-pay choice also qualifies.
        if (
            !isMayPayPaymentWindow &&
            state.priorityPlayerId !== args.playerId
        ) {
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

        // CR 302.1 — creatures with summoning sickness cannot activate an
        // ability whose cost includes {T}. Untap (refunding floating mana)
        // is allowed since it reverses an earlier activation, not a fresh one.
        const requiresTap =
            !!getBasicLandMana(card) || ability?.cost.tap === true;
        if (!wasTapped && requiresTap && isTapLockedBySummoningSickness(card)) {
            throw new Error("Creature has summoning sickness");
        }

        // Block untap if mana was spent on a cast
        if (wasTapped && card.manaCommitted) {
            throw new Error("Cannot untap: mana already spent");
        }

        // Track produced mana so we can carry it on the PERMANENT_TAPPED event
        // (CR 605.2 / 603.2 — Mana Flare reads `manaProduced` to add the
        // matching color). Set on the tap branches, undefined on untap.
        let producedThisActivation: ManaCost | undefined;

        // Determine mana to add/remove
        if (ability?.manaChoices) {
            // Choice-based mana ability (e.g. Birds of Paradise, Black Lotus)
            if (!wasTapped) {
                if (args.manaChoiceIndex === undefined) {
                    throw new Error("Must choose a mana color");
                }
                const chosen = ability.manaChoices[args.manaChoiceIndex];
                if (!chosen) throw new Error("Invalid mana choice");

                // CR 605.2 — emit before any sacrifice path moves the card off
                // the battlefield, so the event still carries the source's
                // pre-sacrifice types/subtypes.
                emitPermanentTapped(state, card, true, chosen);
                producedThisActivation = chosen;

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
            // Fixed mana ability (lands, Mox, Sol Ring)
            card.isTapped = !card.isTapped;
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (manaColor) {
                const amount = getFixedManaAmount(card, manaColor);
                if (!wasTapped) {
                    player.manaPool[manaColor] =
                        (player.manaPool[manaColor] ?? 0) + amount;
                    producedThisActivation = {
                        [manaColor]: amount,
                    } as ManaCost;
                    emitPermanentTapped(
                        state,
                        card,
                        true,
                        producedThisActivation
                    );
                } else {
                    player.manaPool[manaColor] =
                        (player.manaPool[manaColor] ?? 0) - amount;
                }
            }
        }

        // CR 603.2 — flush the PERMANENT_TAPPED event into a trigger pass so
        // Manabarbs / Mana Flare / Wild Growth land on the stack right after
        // the mana ability resolves. Skip on untap (no event was emitted).
        if (producedThisActivation) {
            processPendingActionTriggers(state);
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Activate an ability that was granted to a player by an effect (e.g.
 *  Channel's "Pay 1 life: Add {C}." — CR 113.1). Mirrors activateAbility
 *  but scoped to player-granted templates rather than battlefield cards.
 *  Mana abilities (useStack:false) resolve immediately; stack abilities
 *  push to the stack. */
export const activatePlayerAbility = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        grantedAbilityInstanceId: v.string(),
        keepPriority: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);

        const player = getPlayer(state, args.playerId);
        const instance = player.grantedAbilities?.find(
            (g) => g.id === args.grantedAbilityInstanceId
        );
        if (!instance) throw new Error("Granted ability not found");

        const sourceCard = getCardById(instance.sourceCardId);
        const ability = sourceCard.activatedAbilities?.find(
            (a) => a.id === instance.abilityId
        );
        if (!ability) throw new Error("Ability template not found");
        // CR 602.5 — phase-restricted templates are equally illegal when
        // activated via a player-scoped grant.
        if (
            ability.activationPhaseRestriction &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            throw new Error("Ability cannot be activated during this phase");
        }

        // CR 605.3a — mana abilities can be activated (a) when the player has
        // priority, or (b) while paying a mana cost of a spell/ability. Mirror
        // tapUntap / tapForPayment timing: allow either gate.
        const hasPriority = state.priorityPlayerId === args.playerId;
        const isInPayment =
            state.pendingCast?.playerId === args.playerId ||
            state.pendingActivation?.playerId === args.playerId;
        if (!ability.useStack) {
            if (!hasPriority && !isInPayment) {
                throw new Error(
                    "Cannot activate mana ability without priority"
                );
            }
        } else {
            if (!hasPriority) throw new Error("You don't have priority");
            if (state.pendingCast) {
                throw new Error("Another spell is already being cast");
            }
            if (state.pendingActivation) {
                throw new Error("Another ability is already being activated");
            }
        }

        // Player-scoped grants have no source permanent — tap/sacrifice costs
        // are not meaningful here. Reject templates that require them.
        if (ability.cost.tap) {
            throw new Error(
                "Granted ability cannot require tap (no source permanent)"
            );
        }
        if (ability.cost.sacrifice) {
            throw new Error(
                "Granted ability cannot require sacrifice (no source permanent)"
            );
        }

        if (ability.cost.mana) {
            const manaCost = normalizeManaCost(ability.cost.mana);
            if (!isManaCostCovered(player.manaPool, manaCost)) {
                throw new Error("Not enough mana");
            }
            payManaCost(player.manaPool, manaCost);
            commitLandsForCost(player, manaCost);
        }

        // CR 118.4 — a player can't pay more life than they have.
        if (ability.cost.life !== undefined) {
            if (player.life < ability.cost.life) {
                throw new Error("Not enough life");
            }
        }

        if (!ability.useStack) {
            // Mana abilities resolve immediately (CR 605.3c) — no SBA pass.
            // Pay life after mana, then run the effect via a minimal context
            // exposing only addMana (ActivatedAbilityContext).
            if (ability.cost.life !== undefined) {
                player.life -= ability.cost.life;
            }
            ability.effect?.({
                addMana: (amount) => {
                    for (const [color, count] of Object.entries(amount)) {
                        if (
                            color !== "X" &&
                            typeof count === "number" &&
                            count > 0
                        ) {
                            const key = color as keyof typeof player.manaPool;
                            player.manaPool[key] =
                                (player.manaPool[key] ?? 0) + count;
                        }
                    }
                },
            });
        } else {
            // Stack path: synthesize a stack item carrying the template's
            // source card reference. Not exercised by Channel yet, but kept
            // for future granted stack abilities.
            if (ability.cost.life !== undefined) {
                player.life -= ability.cost.life;
            }
            const stackItem: StackItem = {
                id: `granted-${instance.id}`,
                card: { id: instance.sourceCardId },
                controllerId: args.playerId,
                ownerId: args.playerId,
                zone: "stack",
                types: sourceCard.types,
                subtypes: sourceCard.subtypes ?? [],
                staticAbilities: [],
                isTapped: false,
                castById: args.playerId,
                abilityId: instance.abilityId,
            };
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
            state.singleShotAutoPass = args.keepPriority
                ? undefined
                : args.playerId;
            drainAutoPasses(state);
        }

        // If a pendingCast or pendingActivation is now payable thanks to the
        // freshly produced mana, auto-commit it (mirrors tapForPayment).
        const committedCast = tryAutoCommitPendingCast(state, args.playerId);
        if (!committedCast) {
            tryAutoCommitPendingActivation(state, args.playerId);
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
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

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
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

        const existing = await getLatestGameState(ctx, args.gameId);

        const idCounter: { nextInstanceId?: number } = {};
        const playersState = game.players.map((p) =>
            buildPlayerState(p as PlayerInput, idCounter)
        );
        // CR 500.1: starting player begins their first turn at game start.
        playersState[0].turnsTaken = 1;
        const rngSeed = freshSeed();
        const initialState: GameState = {
            players: playersState,
            stack: [],
            turn: 1,
            activePlayerId: playersState[0].id,
            priorityPlayerId: playersState[0].id,
            passCount: 0,
            phase: "UNTAP" as Phase,
            rngSeed,
            rngCounter: 0,
            nextInstanceId: idCounter.nextInstanceId,
        };
        for (const player of initialState.players) {
            seededShuffle(initialState, player.library);
            for (let i = 0; i < STARTING_HAND_SIZE; i++)
                drawCardFromLibrary(player);
        }
        initialState.phase = "MULLIGAN" as Phase;
        initialState.mulligan = makeMulliganState(initialState);
        initialState.priorityPlayerId = initialState.mulligan.declaringPlayerId;

        await saveGameState(ctx, args.gameId, 0, initialState, existing);

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
                    v.union(
                        v.literal("hand"),
                        v.literal("battlefield"),
                        v.literal("graveyard")
                    )
                ),
                tapped: v.optional(v.boolean()),
                count: v.optional(v.number()),
                /** Marked damage (CR 120.3) on a battlefield creature. */
                damageMarked: v.optional(v.number()),
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
        // If the game is still in the pre-game mulligan phase (CR 103.5),
        // confirm the mulligan for both players so the scenario takes over a
        // clean turn-1 state. The scenario's own `phase` override (later in
        // this handler) wins if specified.
        if (state.mulligan) {
            finalizeMulligan(state);
        }

        const p1 = state.players[0];
        const p2 = state.players[1];

        // Clear battlefields, hands, graveyards
        p1.battlefield = [];
        p2.battlefield = [];
        p1.hand = [];
        p2.hand = [];
        p1.graveyard = [];
        p2.graveyard = [];

        // Helper to create an instance from a card name
        function makeInstance(
            cardName: string,
            controllerId: string,
            zone: "hand" | "battlefield" | "library" | "graveyard",
            opts?: { tapped?: boolean }
        ) {
            const def = getCardByName(cardName);
            return {
                id: allocInstanceId(state),
                card: { id: def.id },
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
            const count = entry.count ?? 1;
            for (let i = 0; i < count; i++) {
                const instance = makeInstance(entry.name, player.id, zone, {
                    tapped: entry.tapped,
                });
                if (zone === "hand") {
                    player.hand.push(instance);
                } else if (zone === "graveyard") {
                    player.graveyard.push(instance);
                } else {
                    if (entry.damageMarked && entry.damageMarked > 0) {
                        (instance as CardInstanceState).damageMarked =
                            entry.damageMarked;
                    }
                    player.battlefield.push(instance);
                }
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

        // CR 611.2 — replay continuous keyword-grant / activated-grant static
        // effects across the freshly-built battlefield. The placement loop
        // bypasses `finalizeSpellResolution`'s entry hooks, so a Zombie Master
        // dropped via the scenario doesn't naturally reach its Zombies. One
        // pass per source is enough: each call walks every permanent and
        // pushes matching grants — order-independent because the predicate is
        // a function of subtype/id, not of timestamp.
        for (const player of state.players) {
            for (const source of player.battlefield) {
                applySourceStaticEffects(state, source);
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

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});
