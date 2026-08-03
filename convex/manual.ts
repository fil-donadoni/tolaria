// Manual Mode (ADR 0080) — state model, setup, and persistence.
//
// This module runs BESIDE the GRE, not inside it: it imports NOTHING from
// convex/gre/. An import-graph boundary guard test enforces this — a
// convention alone would erode at the first "just this once". The real
// engine's only seam is three rejection lines in convex/game.ts.

import type { GenericId } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";

/** Shaped as a subset of CardInstance (ADR 0080): the fields presentational
 *  components consume, and the fields manual verbs mutate. Definition
 *  hydration is NOT a dependency — `card: { id }` is the whole reference,
 *  and the client resolves the image from the full catalogue. */
export type ManualCardInstance = {
    id: string;
    card: { id: string };
    zone: ManualZone;
    controllerId: string;
    ownerId: string;
    isTapped: boolean;
    faceDown?: boolean;
    lane?: "main" | "combat";
    /** Counters carried by the card (any named type). */
    counters?: Record<string, number>;
    /** Instance id of the permanent this card is attached to (Aura / Equipment). */
    attachedTo?: string;
    /** Free-text note a player can pin to a card (e.g. "Copied from GY"). */
    note?: string;
};

export type ManualZone =
    | "library"
    | "hand"
    | "battlefield"
    | "graveyard"
    | "exile";

export type ManualPlayerState = {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    hand: ManualCardInstance[];
    library: ManualCardInstance[];
    graveyard: ManualCardInstance[];
    exile: ManualCardInstance[];
    battlefield: ManualCardInstance[];
};

export type ManualGameState = {
    players: ManualPlayerState[];
    turn: number;
    activePlayerId: string;
};

/** Optional ManualGameState keys that survive the DB round-trip. Mirrors
 *  PERSISTED_OPTIONAL_KEYS in convex/gre/serialize.ts — every optional key
 *  on ManualGameState must appear here, or the drift guard test fails. */
export const MANUAL_STATE_OPTIONAL_KEYS: readonly string[] = [];

type ManualDeckCard = { cardId: string; cardName: string };

/** Fresh seed for the manual-game RNG (separate from the GRE's seeded RNG). */
function manualRngSeed(): number {
    return Math.floor(Math.random() * 0x7fffffff);
}

/** Fisher–Yates shuffle (in-place). A plain implementation with no dependency
 *  on convex/gre/rng. */
function shuffle<T>(arr: T[], seed: number): void {
    let s = seed;
    for (let i = arr.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        const j = s % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

let nextInstanceCounter = 0;
function allocInstanceId(): string {
    return String(++nextInstanceCounter);
}

/**
 * Builds the fresh initial ManualGameState from player decks.
 * Shuffles each library, draws 7 cards, sets life to 20.
 */
export function setupManualGame(
    inputs: {
        id: string;
        name: string;
        bgColor: string;
        deck: ManualDeckCard[];
    }[],
    opts?: { seed?: number }
): ManualGameState {
    const seed = opts?.seed ?? manualRngSeed();
    const players: ManualPlayerState[] = inputs.map((input, index) => {
        const library: ManualCardInstance[] = input.deck.map((c) => ({
            id: allocInstanceId(),
            card: { id: c.cardId },
            zone: "library",
            controllerId: input.id,
            ownerId: input.id,
            isTapped: false,
        }));
        shuffle(library, seed + index);
        const hand: ManualCardInstance[] = [];
        for (let i = 0; i < 7 && library.length > 0; i++) {
            const card = library.pop()!;
            card.zone = "hand";
            hand.push(card);
        }
        return {
            id: input.id,
            name: input.name,
            bgColor: input.bgColor,
            life: 20,
            hand,
            library,
            graveyard: [],
            exile: [],
            battlefield: [],
        };
    });

    return {
        players,
        turn: 1,
        activePlayerId: players[0].id,
    };
}

// --- Database persistence (mirrors saveGameState / getLatestGameState) ------

/** Type-safe rehydrated state row — the opaque v.any() stored in
 *  manualStates.state comes back as raw JSON and is cast here. */
type ManualStateRow = {
    _id: Id<"manualStates">;
    _creationTime: number;
    gameId: Id<"games">;
    seq: number;
    state: unknown;
    updatedAt: number;
};

export async function getLatestManualState(
    ctx: Pick<GenericQueryCtx<DataModel>, "db">,
    gameId: GenericId<"games">
): Promise<ManualStateRow | null> {
    const doc = await ctx.db
        .query("manualStates")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .order("desc")
        .first();
    if (!doc) return null;
    return doc as ManualStateRow;
}

/** Save a manual game state, patching the single row in place. Mirrors
 *  saveGameState — callers pass an already-fetched `existing` row. */
export async function saveManualState(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: ManualGameState,
    existing: ManualStateRow | null
): Promise<void> {
    const now = Date.now();
    if (existing) {
        await ctx.db.patch(existing._id, {
            seq,
            state: state as unknown, // opaque JSON — no compact form
            updatedAt: now,
        });
    } else {
        await ctx.db.insert("manualStates", {
            gameId: gameId as Id<"games">,
            seq,
            state: state as unknown,
            updatedAt: now,
        });
    }
}

/** Append one action to the manual log for a game. */
export async function appendManualLog(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    action: unknown
): Promise<void> {
    await ctx.db.insert("manualLog", {
        gameId: gameId as Id<"games">,
        action,
        createdAt: Date.now(),
    });
}
