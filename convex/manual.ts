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
    /**
     * The card's printed NAME, copied off the decklist row at setup
     * (`ManualDeckCard.cardName`) — never derived from a `CardDefinition`,
     * so ADR 0080's fourth invariant holds.
     *
     * It exists because a print id is NOT a reliable name key here: a manual
     * deck may carry any Scryfall printing (the builder's edition dropdown
     * lists every one of them, `result-card.tsx`), while the Full Catalogue
     * asset keeps ONE representative printing per card. Roughly a third of
     * the ids the app already produces are absent from it, and those rendered
     * in the action log as a raw UUID. Carrying the name the decklist already
     * knew fixes that for every printing, past and future, at zero asset
     * cost.
     *
     * Optional because a state persisted before this field existed has none —
     * those log entries keep resolving through the catalogue placeholder path
     * (`ManualLogEntry.cards`). No backfill.
     */
    name?: string;
    zone: ManualZone;
    controllerId: string;
    ownerId: string;
    isTapped: boolean;
    faceDown?: boolean;
    lane?: "main" | "combat";
    /**
     * Which of the back row's TWO columns this permanent sits in — the manual
     * counterpart of the GRE board's automatic "lands flush-left, other
     * noncreatures flush-right" split (`splitRowLayout`).
     *
     * A Manual Game cannot derive that split: it would have to know a card is
     * a land, and the Full Catalogue misses the printing outright for a third
     * of the ids in play, so the row sorted itself half-right and looked
     * arbitrary. So the player says it, by dragging — the same answer
     * {@link lane} gives for the creature row. Unset means "the classifier may
     * guess from the catalogue type line", which is still right whenever the
     * catalogue does resolve the card.
     */
    backColumn?: "left" | "right";
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
    // The name is as much of the card's identity as its print id — a hidden
    // face-down card must shed BOTH, or the back renders with its own name
    // beside it.
    return { ...rest, name: undefined, card: { id: MANUAL_FACE_DOWN_CARD_ID } };
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
            // The decklist already knows the name — carrying it is what makes
            // the action log readable for a printing the Full Catalogue never
            // censused. See `ManualCardInstance.name`.
            name: c.cardName,
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

/**
 * Fills in `name` on every card that has none, from a print id → name map
 * (the game's own decklists). Mutates `state` in place and reports whether it
 * changed anything.
 *
 * A repair, not a feature: {@link ManualCardInstance.name} is written at setup,
 * so only games STARTED before it existed have nameless cards — and those are
 * exactly the games whose action log reads as a column of raw UUIDs. Running it
 * on every verb (the game row is already loaded there for the mode check, so it
 * costs one map build) means such a game fixes itself on its owner's next
 * action instead of staying broken for its whole life. A card the decklists
 * don't name — a token created mid-game — keeps no name and keeps falling back
 * to the client-side catalogue lookup, which is the pre-existing behaviour.
 */
export function backfillManualCardNames(
    state: ManualGameState,
    nameByPrintId: ReadonlyMap<string, string>
): boolean {
    let changed = false;
    for (const player of state.players) {
        for (const zone of [
            player.hand,
            player.library,
            player.battlefield,
            player.graveyard,
            player.exile,
        ]) {
            for (const card of zone) {
                if (card.name !== undefined) continue;
                const name = nameByPrintId.get(card.card.id);
                if (name === undefined) continue;
                card.name = name;
                changed = true;
            }
        }
    }
    return changed;
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
    /**
     * Fallback / audit string. Legacy entries (written before #2350) have no
     * `cards` field and no placeholders here — they render exactly as
     * before, id and all (no backfill). New entries embed `{{card:N}}`
     * placeholders where a card is referenced, positionally keyed to
     * `cards[N]`.
     */
    text: string;
    timestamp: number;
    playerId?: string;
    /**
     * Print ids (`card.card.id`) this entry refers to, one per `{{card:N}}`
     * placeholder in `text` (N = array index). The server has no name to
     * interpolate — `ManualCardInstance` carries only `card: { id }`
     * (ADR 0080's fourth invariant forbids hydrating a `CardDefinition`
     * here) — so the client resolves each id to a name through the Full
     * Catalogue (`makeCatalogueRowLookup`, `src/lib/manual-band.ts`). An id
     * the catalogue can't resolve renders as the raw id: never blank, never
     * a crash.
     */
    cards?: string[];
};

type VerbResult = { state: ManualGameState; log: ManualLogEntry };

/**
 * Collects the card references of ONE log entry.
 *
 * Two ways a card can be named in an entry, in this order:
 *
 *   1. `card.name` — the decklist's own spelling, carried on the instance
 *      since {@link ManualCardInstance.name}. Interpolated as PLAIN TEXT: it
 *      cannot fail to resolve, and it is right for a printing the Full
 *      Catalogue never carried (the majority failure mode — see that field's
 *      doc).
 *   2. `{{card:N}}` placeholder + the print id pushed onto `cards[]` — the
 *      pre-existing client-side path (`resolveManualLogText` in
 *      `manual-log.tsx`), still the only option for a state persisted before
 *      instances carried a name, and for a token created from a bare card id.
 *
 * Indices stay consistent because a placeholder is emitted only when an id is
 * pushed, so `{{card:N}}` always addresses `cards[N]`.
 */
function cardRefs(): {
    of: (
        card: Pick<ManualCardInstance, "name" | "card"> | null | undefined,
        fallbackPrintId?: string
    ) => string;
    cards: () => string[] | undefined;
} {
    const collected: string[] = [];
    return {
        of(card, fallbackPrintId) {
            if (card?.name) return card.name;
            const printId = card?.card.id ?? fallbackPrintId;
            if (printId === undefined) return "a card";
            collected.push(printId);
            return `{{card:${collected.length - 1}}}`;
        },
        cards: () => (collected.length > 0 ? collected : undefined),
    };
}

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
    const refs = cardRefs();
    const label = refs.of(card);
    return {
        state: s,
        log: {
            text: `${pn} moves ${label} → ${toZone}`,
            timestamp: Date.now(),
            playerId: card.ownerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text: `${pn} ${tapped ? "taps" : "untaps"} ${label}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text: `${pn} adjusts ${type} counter on ${label}: ${before} → ${before + delta}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text: `${pn} sets ${label} face ${faceDown ? "down" : "up"}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text: `${pn} puts ${label} on ${lane} lane`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
        },
    };
}

/** Places a permanent in one of the back row's two columns
 *  ({@link ManualCardInstance.backColumn}) — the horizontal counterpart of
 *  {@link manualSetLane}, and the only way a Manual Game can put lands in a
 *  column of their own, since it never learns that a card IS a land. */
export function manualSetBackColumn(
    state: ManualGameState,
    instanceId: string,
    column: "left" | "right"
): VerbResult {
    const s = cloneState(state);
    const found = findCard(s, instanceId);
    if (!found)
        return {
            state,
            log: {
                text: `setBackColumn(${instanceId}, ${column}): card not found`,
                timestamp: Date.now(),
            },
        };
    found.card.backColumn = column;
    const pn = playerName(state, found.card.ownerId);
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text: `${pn} puts ${label} in the ${column} column`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    // Falls back to the raw `targetId` in the (shouldn't-happen) case a caller
    // attaches to an id with no matching card, same "never blank, never a
    // crash" contract the client-side lookup itself upholds for an
    // unresolvable print id.
    const targetLabel = refs.of(findCard(s, targetId)?.card, targetId);
    return {
        state: s,
        log: {
            text: `${pn} attaches ${label} to ${targetLabel}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
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
    // A declaration, not an event log: shift-dragging A onto B twice is a
    // normal, non-toggling action (no click-to-remove affordance exists), so
    // re-declaring an already-present target is a no-op rather than a second
    // identical entry (#2338 review — duplicate `arrows[]` entries collide on
    // `buildManualArrowPairs`' `manual:from->to` key and crash React with a
    // duplicate-key error).
    const existing = found.card.arrows ?? [];
    found.card.arrows = existing.includes(targetId)
        ? existing
        : [...existing, targetId];
    const pn = playerName(state, found.card.ownerId);
    const refs = cardRefs();
    const label = refs.of(found.card);
    const targetLabel = refs.of(findCard(s, targetId)?.card, targetId);
    return {
        state: s,
        log: {
            text: `${pn} points arrow from ${label} → ${targetLabel}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text: `${pn} clears ${count} arrow(s) from ${label}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const labels = topN.map((c) => refs.of(c)).join(", ");
    // "Peek all" (the pile verb passes the library's own size) reads as what
    // it is at a table — searching the library — rather than "top 47".
    const scope =
        n >= player.library.length
            ? "their whole library"
            : `top ${n} of library`;
    return {
        state: cloneState(state),
        log: {
            text: `${pn} looks at ${scope}: ${labels}`,
            timestamp: Date.now(),
            playerId,
            cards: refs.cards(),
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
    playerId: string,
    /** The token's printed name, when the caller knows it (the token picker
     *  does). Absent, the log falls back to the catalogue placeholder path. */
    cardName?: string
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
        name: cardName,
        zone: "battlefield",
        controllerId,
        ownerId: playerId,
        isTapped: false,
    };
    player.battlefield.push(token);
    const pn = playerName(state, playerId);
    const refs = cardRefs();
    const label = refs.of(token);
    return {
        state: s,
        log: {
            text: `${pn} creates token ${label} (id: ${instanceId})`,
            timestamp: Date.now(),
            playerId,
            cards: refs.cards(),
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text:
                text.length > 0
                    ? `${pn} notes "${text}" on ${label}`
                    : `${pn} clears the note on ${label}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
        },
    };
}

/**
 * The turn's phases and steps in CR 500.1 order — a FREE marker, not a
 * structure the mode enforces (ADR 0080): nothing in a Manual Game consults
 * it for legality, it only tells both players where they agreed they are.
 *
 * Single authority for the ordering, so the server's turn rollover
 * ({@link manualEndTurn} → back to `UNTAP`) and the client's Space hotkey
 * (`manual-phase.ts`) step through the SAME list. The client's phase-marker
 * validator (`manual-game-context.ts`) is derived from it too — a phase this
 * array does not name cannot be reached.
 */
export const MANUAL_PHASE_ORDER = [
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
    "CLEANUP",
] as const;

export type ManualPhase = (typeof MANUAL_PHASE_ORDER)[number];

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

/**
 * Ends the turn: clears damage, then HANDS THE TURN OVER — turn number up by
 * one, the next seat becomes active, the phase marker back to `UNTAP`.
 *
 * The rollover half is new (manual-mode QA round 3, item 5). Before it, "End
 * Turn" only wiped damage: `turn` and `activePlayerId` never moved, so the
 * turn counter read 1 all game and nothing on the board said whose turn it
 * was. That is not a rule the mode declines to enforce (ADR 0080) — it is a
 * marker the players set by hand at a table, and this is the verb that sets
 * it. Nothing else changes: no untap, no draw, no cleanup discard. Those stay
 * the player's own verbs.
 *
 * Seat order is roster order, wrapping — the same "next player" a 2-player
 * table has. `playerId` is who PRESSED the button (for the log), not
 * necessarily the active player: at a table either player can say "ok, my
 * turn's done".
 */
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
    const activeIndex = s.players.findIndex((p) => p.id === s.activePlayerId);
    const next = s.players[(Math.max(activeIndex, 0) + 1) % s.players.length];
    if (next) s.activePlayerId = next.id;
    s.turn += 1;
    s.phase = MANUAL_PHASE_ORDER[0];
    const pn = playerName(state, playerId);
    const nextName = next ? playerName(state, next.id) : "—";
    return {
        state: s,
        log: {
            text: `${pn} ends the turn (damage cleared) — turn ${s.turn}, ${nextName} is active`,
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
    const refs = cardRefs();
    const label = refs.of(found.card);
    return {
        state: s,
        log: {
            text: `${pn} reveals ${label} to ${toNames}`,
            timestamp: Date.now(),
            playerId: found.card.ownerId,
            cards: refs.cards(),
        },
    };
}

/**
 * Reveals a player's WHOLE HAND to the listed players (issue: manual-mode QA
 * round 3, item 3) — the "I show you my hand" table action (Duress, Hymn to
 * Tourach, or simply proving a hellbent).
 *
 * Not a loop over {@link manualReveal} at the call site, for two reasons: it
 * is ONE table action and must be ONE log line and ONE state write, and the
 * reveal must apply to the hand as it is NOW — a per-card client loop would
 * race the projection it is reading its own card ids from.
 *
 * Reveals are additive and permanent for the cards involved, exactly as the
 * per-card verb is: a card that later leaves the hand keeps its `revealedTo`
 * (it was genuinely seen), and there is no un-reveal verb.
 */
export function manualRevealHand(
    state: ManualGameState,
    playerId: string,
    toPlayerIds: string[]
): VerbResult {
    const s = cloneState(state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player)
        return {
            state,
            log: {
                text: `revealHand(${playerId}): player not found`,
                timestamp: Date.now(),
            },
        };
    for (const card of player.hand) {
        card.revealedTo = [
            ...new Set([...(card.revealedTo ?? []), ...toPlayerIds]),
        ];
    }
    const pn = playerName(state, playerId);
    const toNames = toPlayerIds.map((id) => playerName(state, id)).join(", ");
    return {
        state: s,
        log: {
            text: `${pn} reveals their hand (${player.hand.length} card(s)) to ${toNames}`,
            timestamp: Date.now(),
            playerId,
        },
    };
}
