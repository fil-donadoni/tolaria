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
    /** Instance ids of permanents this card is targeting via combat or an effect. */
    arrows?: string[];
    /** Player ids who know this card's identity through a face-down (controller,
     *  owner). Server-side metadata — never crosses the wire. */
    knownTo?: string[];
    /** Player ids this card has been explicitly revealed to (Duress, "look at
     *  what I'm drawing"). Server-side metadata — never crosses the wire. */
    revealedTo?: string[];
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
    phase?: string;
    concededBy?: string;
};

// --- Projected types (ADR 0080 S3) — the wire shape after hiding private info ---

export type ProjectedManualCard = Omit<
    ManualCardInstance,
    "knownTo" | "revealedTo"
>;
export type ProjectedManualLibrary = { count: number };

export type ProjectedManualPlayer = Omit<
    ManualPlayerState,
    "hand" | "library"
> & {
    hand: (ProjectedManualCard | null)[];
    library: ProjectedManualLibrary;
};

export type ProjectedManualGameState = Omit<ManualGameState, "players"> & {
    players: ProjectedManualPlayer[];
};

/** Sentinel card id for a face-down card whose identity the viewer may not see. */
export const MANUAL_FACE_DOWN_CARD_ID = "__faceDown";

/** Projects a single card for a given viewer: face-down cards not known to the
 *  viewer are rendered as a back. Server-side metadata (`knownTo`, `revealedTo`)
 *  is stripped so it never crosses the wire. */
function projectManualCard(
    card: ManualCardInstance,
    viewerId: string
): ProjectedManualCard {
    const { knownTo, revealedTo, ...rest } = card;
    void knownTo;
    void revealedTo;
    if (!card.faceDown) return rest;
    if (card.knownTo?.includes(viewerId)) return rest;
    if (card.revealedTo?.includes(viewerId)) return rest;
    return { ...rest, card: { id: MANUAL_FACE_DOWN_CARD_ID } };
}

/**
 * Projects a ManualGameState for a given viewer, hiding private information.
 *
 * Rules (ADR 0080 § 2):
 *   - Opponent's hand → `null[]` (own hand is visible)
 *   - Library → `{ count }` for everyone (order is private; use peek/search
 *     verbs to look)
 *   - faceDown cards → back unless viewer ∈ knownTo
 *   - revealedTo opens a card's identity to the listed players (even in an
 *     opponent's hand)
 */
export function projectManualState(
    state: ManualGameState,
    viewerId: string
): ProjectedManualGameState {
    const players = state.players.map((player): ProjectedManualPlayer => {
        const isOwn = player.id === viewerId;
        const isRevealedToViewer = (card: ManualCardInstance) =>
            card.revealedTo?.includes(viewerId) ?? false;

        return {
            ...player,
            hand: player.hand.map((card) =>
                isOwn || isRevealedToViewer(card) ? card : null
            ),
            library: { count: player.library.length },
            battlefield: player.battlefield.map((c) =>
                projectManualCard(c, viewerId)
            ),
            graveyard: player.graveyard.map((c) =>
                projectManualCard(c, viewerId)
            ),
            exile: player.exile.map((c) => projectManualCard(c, viewerId)),
        };
    });

    return { ...state, players };
}

/** Optional ManualGameState keys that survive the DB round-trip. Mirrors
 *  PERSISTED_OPTIONAL_KEYS in convex/gre/serialize.ts — every optional key
 *  on ManualGameState must appear here, or the drift guard test fails. */
export const MANUAL_STATE_OPTIONAL_KEYS: readonly string[] = [
    "phase",
    "concededBy",
];

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

// --- Manual verbs (ADR 0080 S2) — pure reducers, zero validation ----------

export type ManualLogEntry = {
    text: string;
    timestamp: number;
    playerId?: string;
};

type VerbResult = { state: ManualGameState; log: ManualLogEntry };

function playerName(state: ManualGameState, playerId: string): string {
    return state.players.find((p) => p.id === playerId)?.name ?? playerId;
}

function findCard(
    state: ManualGameState,
    instanceId: string
): { card: ManualCardInstance; player: ManualPlayerState } | null {
    for (const player of state.players) {
        for (const arr of [
            player.hand,
            player.library,
            player.battlefield,
            player.graveyard,
            player.exile,
        ]) {
            const card = arr.find((c) => c.id === instanceId);
            if (card) return { card, player };
        }
    }
    return null;
}

function removeCardFromZones(
    state: ManualGameState,
    instanceId: string
): ManualCardInstance | null {
    for (const player of state.players) {
        for (const [, arr] of [
            ["hand", player.hand],
            ["library", player.library],
            ["battlefield", player.battlefield],
            ["graveyard", player.graveyard],
            ["exile", player.exile],
        ] as const) {
            const idx = arr.findIndex((c) => c.id === instanceId);
            if (idx !== -1) {
                const [card] = arr.splice(idx, 1);
                return card;
            }
        }
    }
    return null;
}

function zoneArray(
    player: ManualPlayerState,
    zone: ManualZone
): ManualCardInstance[] {
    switch (zone) {
        case "hand":
            return player.hand;
        case "library":
            return player.library;
        case "battlefield":
            return player.battlefield;
        case "graveyard":
            return player.graveyard;
        case "exile":
            return player.exile;
    }
}

function cloneState(state: ManualGameState): ManualGameState {
    return JSON.parse(JSON.stringify(state));
}

// --- Verb reducers ---

export function manualMoveCard(
    state: ManualGameState,
    instanceId: string,
    toZone: ManualZone,
    index?: number
): VerbResult {
    const s = cloneState(state);
    const card = removeCardFromZones(s, instanceId);
    if (!card)
        return {
            state,
            log: {
                text: `moveCard(${instanceId}, ${toZone}): card not found`,
                timestamp: Date.now(),
            },
        };
    card.zone = toZone;
    if (toZone === "battlefield") {
        card.isTapped = false;
    }
    const targetZone = zoneArray(
        s.players.find((p) => p.id === card.ownerId) ?? s.players[0],
        toZone
    );
    if (index !== undefined && index >= 0 && index <= targetZone.length) {
        targetZone.splice(index, 0, card);
    } else {
        targetZone.push(card);
    }
    const pn = playerName(state, card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} moves ${instanceId} → ${toZone}`,
            timestamp: Date.now(),
            playerId: card.ownerId,
        },
    };
}

export function manualSetTapped(
    state: ManualGameState,
    instanceId: string,
    tapped: boolean
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `setTapped(${instanceId}, ${tapped}): card not found`,
                timestamp: Date.now(),
            },
        };
    found.card.isTapped = tapped;
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} ${tapped ? "taps" : "untaps"} ${instanceId}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualUntapAll(
    state: ManualGameState,
    playerId: string
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `untapAll(${playerId}): player not found`,
                timestamp: Date.now(),
            },
        };
    for (const zone of [
        player.battlefield,
        player.hand,
        player.library,
        player.graveyard,
        player.exile,
    ]) {
        for (const card of zone) {
            card.isTapped = false;
        }
    }
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: { text: `${pn} untaps all`, timestamp: Date.now(), playerId },
    };
}

export function manualAdjustLife(
    state: ManualGameState,
    playerId: string,
    delta: number
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `adjustLife(${playerId}, ${delta}): player not found`,
                timestamp: Date.now(),
            },
        };
    const before = player.life;
    player.life += delta;
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} sets life ${before} → ${player.life}`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualAdjustCounter(
    state: ManualGameState,
    instanceId: string,
    type: string,
    delta: number
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `adjustCounter(${instanceId}, ${type}, ${delta}): card not found`,
                timestamp: Date.now(),
            },
        };
    const counters = found.card.counters ?? {};
    const before = counters[type] ?? 0;
    counters[type] = (counters[type] ?? 0) + delta;
    if (counters[type] <= 0) delete counters[type];
    found.card.counters =
        Object.keys(counters).length > 0 ? counters : undefined;
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} adjusts ${type} counter on ${instanceId}: ${before} → ${before + delta}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualSetFaceDown(
    state: ManualGameState,
    instanceId: string,
    faceDown: boolean
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `setFaceDown(${instanceId}, ${faceDown}): card not found`,
                timestamp: Date.now(),
            },
        };
    if (faceDown) {
        found.card.faceDown = true;
        const newViewers = [found.card.controllerId, found.card.ownerId];
        found.card.knownTo = [
            ...new Set([...(found.card.knownTo ?? []), ...newViewers]),
        ];
    } else {
        delete found.card.faceDown;
        delete found.card.knownTo;
    }
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} sets ${instanceId} face ${faceDown ? "down" : "up"}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualSetLane(
    state: ManualGameState,
    instanceId: string,
    lane: "main" | "combat"
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `setLane(${instanceId}, ${lane}): card not found`,
                timestamp: Date.now(),
            },
        };
    found.card.lane = lane;
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} puts ${instanceId} on ${lane} lane`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualAttach(
    state: ManualGameState,
    instanceId: string,
    targetId: string
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `attach(${instanceId}, ${targetId}): card not found`,
                timestamp: Date.now(),
            },
        };
    found.card.attachedTo = targetId;
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} attaches ${instanceId} to ${targetId}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualSetArrow(
    state: ManualGameState,
    instanceId: string,
    targetId: string
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `setArrow(${instanceId}, ${targetId}): card not found`,
                timestamp: Date.now(),
            },
        };
    found.card.arrows = [...(found.card.arrows ?? []), targetId];
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} points arrow from ${instanceId} → ${targetId}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualClearArrows(
    state: ManualGameState,
    playerId: string
): VerbResult {
    const s = cloneState(state);
    let cleared = 0;
    for (const player of s.players) {
        const arrs = [
            player.battlefield,
            player.hand,
            player.library,
            player.graveyard,
            player.exile,
        ];
        for (const zone of arrs) {
            for (const card of zone) {
                if (card.arrows && card.arrows.length > 0) {
                    delete card.arrows;
                    cleared++;
                }
            }
        }
    }
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} clears ${cleared} arrows`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

/** Clears the outgoing arrows OF ONE CARD (issue #2171) — the per-card
 *  counterpart to {@link manualClearArrows}' board-wide sweep. This is what
 *  "remove an arrow from the acting card's menu" (AC) needs: a player
 *  un-declaring their own card's arrow(s) must not also erase every other
 *  arrow on the board. A card with no arrows is a no-op, not an error — the
 *  menu only ever offers this verb when `card.arrows` is non-empty, but the
 *  reducer stays defensive against a stale render offering it anyway. */
export function manualClearArrow(
    state: ManualGameState,
    instanceId: string
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `clearArrow(${instanceId}): card not found`,
                timestamp: Date.now(),
            },
        };
    const count = found.card.arrows?.length ?? 0;
    delete found.card.arrows;
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} clears ${count} arrow(s) from ${instanceId}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualDraw(
    state: ManualGameState,
    playerId: string,
    n: number
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `draw(${playerId}, ${n}): player not found`,
                timestamp: Date.now(),
            },
        };
    const drawn: string[] = [];
    for (let i = 0; i < n && player.library.length > 0; i++) {
        const card = player.library.pop()!;
        card.zone = "hand";
        player.hand.push(card);
        drawn.push(card.card.id);
    }
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} draws ${drawn.length} card(s)`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualMill(
    state: ManualGameState,
    playerId: string,
    n: number
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `mill(${playerId}, ${n}): player not found`,
                timestamp: Date.now(),
            },
        };
    const milled: string[] = [];
    for (let i = 0; i < n && player.library.length > 0; i++) {
        const card = player.library.pop()!;
        card.zone = "graveyard";
        player.graveyard.push(card);
        milled.push(card.card.id);
    }
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} mills ${milled.length} card(s)`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualExileTop(
    state: ManualGameState,
    playerId: string,
    n: number
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `exileTop(${playerId}, ${n}): player not found`,
                timestamp: Date.now(),
            },
        };
    const exiled: string[] = [];
    for (let i = 0; i < n && player.library.length > 0; i++) {
        const card = player.library.pop()!;
        card.zone = "exile";
        card.faceDown = true;
        card.knownTo = [
            ...new Set([
                ...(card.knownTo ?? []),
                card.controllerId,
                card.ownerId,
            ]),
        ];
        player.exile.push(card);
        exiled.push(card.card.id);
    }
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} exiles ${exiled.length} card(s) from top`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualPeek(
    state: ManualGameState,
    playerId: string,
    n: number
): VerbResult {
    const player = state.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `peek(${playerId}, ${n}): player not found`,
                timestamp: Date.now(),
            },
        };
    const topN = player.library
        .slice(Math.max(0, player.library.length - n))
        .reverse();
    const pn = playerName(state, playerId);
    return {
        state: cloneState(state),
        log: {
            text: `${pn} looks at top ${n} of library: ${topN.map((c) => c.card.id).join(", ")}`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualShuffle(
    state: ManualGameState,
    playerId: string
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `shuffle(${playerId}): player not found`,
                timestamp: Date.now(),
            },
        };
    const seed = manualRngSeed();
    shuffle(player.library, seed);
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} shuffles their library`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualCreateToken(
    state: ManualGameState,
    cardId: string,
    controllerId: string,
    playerId: string
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `createToken(${cardId}): player not found`,
                timestamp: Date.now(),
            },
        };
    const instanceId = allocInstanceId();
    const token: ManualCardInstance = {
        id: instanceId,
        card: { id: cardId },
        zone: "battlefield",
        controllerId,
        ownerId: playerId,
        isTapped: false,
    };
    player.battlefield.push(token);
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} creates token ${cardId} (id: ${instanceId})`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualRoll(state: ManualGameState, sides: number): VerbResult {
    const result = Math.floor(Math.random() * sides) + 1;
    return {
        state: cloneState(state),
        log: { text: `rolled d${sides}: ${result}`, timestamp: Date.now() },
    };
}

export function manualSetNote(
    state: ManualGameState,
    instanceId: string,
    text: string
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `setNote(${instanceId}): card not found`,
                timestamp: Date.now(),
            },
        };
    if (text.length > 0) {
        found.card.note = text;
    } else {
        delete found.card.note;
    }
    const pn = playerName(state, found.card.ownerId);
    return {
        state: s,
        log: {
            text: `${pn} sets note on ${instanceId}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}

export function manualSetPhase(
    state: ManualGameState,
    phase: string
): VerbResult {
    const s = cloneState(state);
    s.phase = phase;
    return {
        state: s,
        log: { text: `Phase: ${phase}`, timestamp: Date.now() },
    };
}

export function manualSetActivePlayer(
    state: ManualGameState,
    playerId: string
): VerbResult {
    const s = cloneState(state);
    s.activePlayerId = playerId;
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: { text: `Active player: ${pn}`, timestamp: Date.now(), playerId },
    };
}

export function manualEndTurn(
    state: ManualGameState,
    playerId: string
): VerbResult {
    const s = cloneState(state);
    for (const player of s.players) {
        for (const card of player.battlefield) {
            if (
                card.counters?.damage !== undefined &&
                card.counters.damage !== 0
            ) {
                const counters = { ...card.counters };
                delete counters.damage;
                card.counters =
                    Object.keys(counters).length > 0 ? counters : undefined;
            }
        }
    }
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: {
            text: `${pn} ends the turn (damage cleared)`,
            timestamp: Date.now(),
            playerId,
        },
    };
}

export function manualConcede(
    state: ManualGameState,
    playerId: string
): VerbResult {
    const s = cloneState(state);
    s.concededBy = playerId;
    const pn = playerName(state, playerId);
    return {
        state: s,
        log: { text: `${pn} concedes`, timestamp: Date.now(), playerId },
    };
}

export function manualReveal(
    state: ManualGameState,
    instanceId: string,
    toPlayerIds: string[]
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `reveal(${instanceId}): card not found`,
                timestamp: Date.now(),
            },
        };
    const existing = found.card.revealedTo ?? [];
    found.card.revealedTo = [...new Set([...existing, ...toPlayerIds])];
    const pn = playerName(state, found.card.ownerId);
    const toNames = toPlayerIds.map((id) => playerName(state, id)).join(", ");
    return {
        state: s,
        log: {
            text: `${pn} reveals ${instanceId} to ${toNames}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
        },
    };
}
