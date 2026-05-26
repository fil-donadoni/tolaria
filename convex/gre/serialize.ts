// Game state compression at the Convex storage boundary. Production traffic
// hits `saveGameState` (compact → write) and `getLatestGameState` (read →
// expand). Engine code keeps working on the fat `GameState` shape; only the
// row sitting in Convex is the slim form.
//
// Three layers of compression:
// 1. Library compression — every card in a player's library compresses to
//    `[instanceId, cardId]`. Owner/controller/zone/transient state are all
//    derivable (CR 400.7 + `resetBattlefieldTransientState` guarantee library
//    cards never carry battlefield-only flags).
// 2. Default stripping — booleans default to false, numbers to 0, arrays/
//    objects to empty. The compactor omits any field equal to its default.
// 3. Definition coalescing — `types`, `subtypes`, `staticAbilities`, `power`,
//    `toughness`, `controllerId === ownerId` all coalesce against the static
//    card definition or owner id, restored at expand time.

import { tryGetCardById } from "../cards";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./state";
import type { Zone } from "./types";
import type { CardType, ManaCost } from "../cards/types";

type CompactCard = Record<string, unknown>;
type LibraryEntry = readonly [string, string]; // [instanceId, cardId]

const MANA_KEYS = ["W", "U", "B", "R", "G", "C"] as const;

function eqArray(a: readonly unknown[], b: readonly unknown[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function isPlainEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
}

function compactCard(
    card: CardInstanceState,
    opts: { ownerId: string }
): CompactCard {
    const cardId = (card.card as { id?: string }).id ?? "";
    const def = tryGetCardById(cardId);
    const out: CompactCard = { id: card.id, card: { id: cardId } };

    if (card.ownerId !== opts.ownerId) out.ownerId = card.ownerId;
    if (card.controllerId !== card.ownerId) {
        out.controllerId = card.controllerId;
    }

    if (!def || !eqArray(card.types, def.types)) out.types = card.types;
    const defSub = def?.subtypes ?? [];
    if (!eqArray(card.subtypes, defSub)) out.subtypes = card.subtypes;
    const defStatic = def?.staticAbilities ?? [];
    if (!eqArray(card.staticAbilities, defStatic)) {
        out.staticAbilities = card.staticAbilities;
    }
    if (card.power !== def?.power) out.power = card.power;
    if (card.toughness !== def?.toughness) out.toughness = card.toughness;

    if (card.isTapped) out.isTapped = true;
    if (card.isToken) out.isToken = true;
    if (card.isSummoningSick) out.isSummoningSick = true;
    if (card.isAttacking) out.isAttacking = true;
    if (card.isBlocking) out.isBlocking = true;
    if (card.hasAttackedThisTurn) out.hasAttackedThisTurn = true;
    if (card.hasBlockedThisTurn) out.hasBlockedThisTurn = true;
    if (card.manaCommitted) out.manaCommitted = true;
    if (card.damageMarked) out.damageMarked = card.damageMarked;
    if (card.regenerationShields) {
        out.regenerationShields = card.regenerationShields;
    }
    if (card.chosenMana) out.chosenMana = card.chosenMana;
    if (card.grantedStaticAbilities?.length) {
        out.grantedStaticAbilities = card.grantedStaticAbilities;
    }
    if (card.grantedActivatedAbilities?.length) {
        out.grantedActivatedAbilities = card.grantedActivatedAbilities;
    }
    if (card.damagedBySources?.length) {
        out.damagedBySources = card.damagedBySources;
    }
    if (card.attachedTo) out.attachedTo = card.attachedTo;
    if (card.controlChanges?.length) out.controlChanges = card.controlChanges;
    if (card.animation) out.animation = card.animation;
    if (card.temporaryPTMods?.length) {
        out.temporaryPTMods = card.temporaryPTMods;
    }
    if (card.counters && Object.keys(card.counters).length > 0) {
        out.counters = card.counters;
    }
    if (
        card.activationsThisTurn &&
        Object.keys(card.activationsThisTurn).length > 0
    ) {
        out.activationsThisTurn = card.activationsThisTurn;
    }
    if (card.grantedTypes && card.grantedTypes.length > 0) {
        out.grantedTypes = card.grantedTypes;
    }
    if (card.exileOnDeath) out.exileOnDeath = true;
    return out;
}

function expandCard(
    compact: CompactCard,
    opts: { ownerId: string; zone: Zone }
): CardInstanceState {
    const cardRef = compact.card as { id: string };
    const def = tryGetCardById(cardRef.id);
    const ownerId = (compact.ownerId as string | undefined) ?? opts.ownerId;
    const controllerId =
        (compact.controllerId as string | undefined) ?? ownerId;

    const types =
        (compact.types as CardType[] | undefined) ??
        (def?.types ? [...def.types] : []);
    const subtypes =
        (compact.subtypes as string[] | undefined) ??
        (def?.subtypes ? [...def.subtypes] : []);
    const staticAbilities =
        (compact.staticAbilities as string[] | undefined) ??
        (def?.staticAbilities ? [...def.staticAbilities] : []);

    const result: CardInstanceState = {
        id: compact.id as string,
        card: { id: cardRef.id },
        controllerId,
        ownerId,
        zone: opts.zone,
        types: [...types],
        subtypes: [...subtypes],
        staticAbilities: [...staticAbilities],
        isTapped: Boolean(compact.isTapped),
    };

    const power =
        "power" in compact ? (compact.power as number | undefined) : def?.power;
    const toughness =
        "toughness" in compact
            ? (compact.toughness as number | undefined)
            : def?.toughness;
    if (power !== undefined) result.power = power;
    if (toughness !== undefined) result.toughness = toughness;

    if (compact.isToken) result.isToken = true;
    if (compact.isSummoningSick) result.isSummoningSick = true;
    if (compact.isAttacking) result.isAttacking = true;
    if (compact.isBlocking) result.isBlocking = true;
    if (compact.hasAttackedThisTurn) result.hasAttackedThisTurn = true;
    if (compact.hasBlockedThisTurn) result.hasBlockedThisTurn = true;
    if (compact.manaCommitted) result.manaCommitted = true;
    if (compact.damageMarked) {
        result.damageMarked = compact.damageMarked as number;
    }
    if (compact.regenerationShields) {
        result.regenerationShields = compact.regenerationShields as number;
    }
    if (compact.chosenMana) result.chosenMana = compact.chosenMana as ManaCost;
    if (compact.grantedStaticAbilities) {
        result.grantedStaticAbilities =
            compact.grantedStaticAbilities as CardInstanceState["grantedStaticAbilities"];
    }
    if (compact.grantedActivatedAbilities) {
        result.grantedActivatedAbilities =
            compact.grantedActivatedAbilities as CardInstanceState["grantedActivatedAbilities"];
    }
    if (compact.damagedBySources) {
        result.damagedBySources = compact.damagedBySources as string[];
    }
    if (compact.attachedTo) result.attachedTo = compact.attachedTo as string;
    if (compact.controlChanges) {
        result.controlChanges =
            compact.controlChanges as CardInstanceState["controlChanges"];
    }
    if (compact.animation) {
        result.animation = compact.animation as CardInstanceState["animation"];
    }
    if (compact.temporaryPTMods) {
        result.temporaryPTMods =
            compact.temporaryPTMods as CardInstanceState["temporaryPTMods"];
    }
    if (compact.counters) {
        result.counters = compact.counters as Record<string, number>;
    }
    if (compact.activationsThisTurn) {
        result.activationsThisTurn = compact.activationsThisTurn as Record<
            string,
            number
        >;
    }
    if (compact.grantedTypes) {
        result.grantedTypes =
            compact.grantedTypes as CardInstanceState["grantedTypes"];
    }
    if (compact.exileOnDeath) result.exileOnDeath = true;
    return result;
}

/** Library cards are always default-state (CR 400.7 + `resetBattlefieldTransientState`).
 *  We compress each to `[instanceId, cardId]`; everything else is derived
 *  from the card def and the owning player. */
function compactLibrary(library: CardInstanceState[]): LibraryEntry[] {
    return library.map((c) => [c.id, (c.card as { id?: string }).id ?? ""]);
}

function expandLibrary(
    library: LibraryEntry[],
    ownerId: string
): CardInstanceState[] {
    return library.map(([id, cardId]) => {
        const def = tryGetCardById(cardId);
        const card: CardInstanceState = {
            id,
            card: { id: cardId },
            controllerId: ownerId,
            ownerId,
            zone: "library",
            types: def?.types ? [...def.types] : [],
            subtypes: def?.subtypes ? [...def.subtypes] : [],
            staticAbilities: def?.staticAbilities
                ? [...def.staticAbilities]
                : [],
            isTapped: false,
        };
        if (def?.power !== undefined) card.power = def.power;
        if (def?.toughness !== undefined) card.toughness = def.toughness;
        return card;
    });
}

function compactManaPool(pool: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of MANA_KEYS) {
        const v = pool[k] ?? 0;
        if (v !== 0) out[k] = v;
    }
    for (const [k, v] of Object.entries(pool)) {
        if (MANA_KEYS.includes(k as (typeof MANA_KEYS)[number])) continue;
        if (v !== 0) out[k] = v;
    }
    return out;
}

function expandManaPool(pool: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const [k, v] of Object.entries(pool)) out[k] = v;
    return out;
}

type CompactPlayer = {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    hand: CompactCard[];
    library: LibraryEntry[];
    graveyard: CompactCard[];
    exile: CompactCard[];
    battlefield: CompactCard[];
    manaPool: Record<string, number>;
    hasDrawnFromEmpty?: boolean;
    landsPlayedThisTurn?: number;
    turnsTaken?: number;
    grantedAbilities?: PlayerState["grantedAbilities"];
};

function compactPlayer(player: PlayerState): CompactPlayer {
    const out: CompactPlayer = {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: player.life,
        hand: player.hand.map((c) => compactCard(c, { ownerId: player.id })),
        library: compactLibrary(player.library),
        graveyard: player.graveyard.map((c) =>
            compactCard(c, { ownerId: player.id })
        ),
        exile: player.exile.map((c) => compactCard(c, { ownerId: player.id })),
        battlefield: player.battlefield.map((c) =>
            compactCard(c, { ownerId: player.id })
        ),
        manaPool: compactManaPool(player.manaPool),
    };
    if (player.hasDrawnFromEmpty) out.hasDrawnFromEmpty = true;
    if (player.landsPlayedThisTurn) {
        out.landsPlayedThisTurn = player.landsPlayedThisTurn;
    }
    if (player.turnsTaken) out.turnsTaken = player.turnsTaken;
    if (player.grantedAbilities?.length) {
        out.grantedAbilities = player.grantedAbilities;
    }
    return out;
}

function expandPlayer(player: CompactPlayer): PlayerState {
    const result: PlayerState = {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: player.life,
        hand: player.hand.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "hand" })
        ),
        library: expandLibrary(player.library, player.id),
        graveyard: player.graveyard.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "graveyard" })
        ),
        exile: player.exile.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "exile" })
        ),
        battlefield: player.battlefield.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "battlefield" })
        ),
        manaPool: expandManaPool(player.manaPool),
    };
    if (player.hasDrawnFromEmpty) result.hasDrawnFromEmpty = true;
    if (player.landsPlayedThisTurn !== undefined) {
        result.landsPlayedThisTurn = player.landsPlayedThisTurn;
    }
    if (player.turnsTaken !== undefined) {
        result.turnsTaken = player.turnsTaken;
    }
    if (player.grantedAbilities) {
        result.grantedAbilities = player.grantedAbilities;
    }
    return result;
}

function compactStackItem(item: StackItem): CompactCard {
    const base = compactCard(item, { ownerId: item.ownerId });
    base.ownerId = item.ownerId;
    base.castById = item.castById;
    if (item.targets?.length) base.targets = item.targets;
    if (item.chosenX !== undefined) base.chosenX = item.chosenX;
    if (item.chosenModeId) base.chosenModeId = item.chosenModeId;
    if (item.additionalSacrificeSnapshot) {
        base.additionalSacrificeSnapshot = item.additionalSacrificeSnapshot;
    }
    if (item.abilityId) base.abilityId = item.abilityId;
    if (item.grantedSourceCardId) {
        base.grantedSourceCardId = item.grantedSourceCardId;
    }
    if (item.triggeredAbilityId) {
        base.triggeredAbilityId = item.triggeredAbilityId;
    }
    if (item.triggerSourceId) base.triggerSourceId = item.triggerSourceId;
    if (item.triggerEvent) base.triggerEvent = item.triggerEvent;
    if (item.delayedTriggerId) base.delayedTriggerId = item.delayedTriggerId;
    if (item.delayedPayload) base.delayedPayload = item.delayedPayload;
    if (item.resolutionStep !== undefined) {
        base.resolutionStep = item.resolutionStep;
    }
    if (item.collectedChoices) base.collectedChoices = item.collectedChoices;
    return base;
}

function expandStackItem(compact: CompactCard): StackItem {
    const ownerId = compact.ownerId as string;
    const base = expandCard(compact, { ownerId, zone: "stack" });
    const item: StackItem = {
        ...base,
        castById: compact.castById as string,
    };
    if (compact.targets) {
        item.targets = compact.targets as StackItem["targets"];
    }
    if (compact.chosenX !== undefined) item.chosenX = compact.chosenX as number;
    if (compact.chosenModeId)
        item.chosenModeId = compact.chosenModeId as string;
    if (compact.additionalSacrificeSnapshot) {
        item.additionalSacrificeSnapshot =
            compact.additionalSacrificeSnapshot as StackItem["additionalSacrificeSnapshot"];
    }
    if (compact.abilityId) item.abilityId = compact.abilityId as string;
    if (compact.grantedSourceCardId) {
        item.grantedSourceCardId = compact.grantedSourceCardId as string;
    }
    if (compact.triggeredAbilityId) {
        item.triggeredAbilityId = compact.triggeredAbilityId as string;
    }
    if (compact.triggerSourceId) {
        item.triggerSourceId = compact.triggerSourceId as string;
    }
    if (compact.triggerEvent) {
        item.triggerEvent = compact.triggerEvent as StackItem["triggerEvent"];
    }
    if (compact.delayedTriggerId) {
        item.delayedTriggerId = compact.delayedTriggerId as string;
    }
    if (compact.delayedPayload) {
        item.delayedPayload = compact.delayedPayload as Record<string, string>;
    }
    if (compact.resolutionStep !== undefined) {
        item.resolutionStep = compact.resolutionStep as number;
    }
    if (compact.collectedChoices) {
        item.collectedChoices = compact.collectedChoices as Record<
            string,
            string[]
        >;
    }
    return item;
}

/** Optional GameState keys that are persisted through the DB round-trip.
 *  Single source of truth — used by both compactState and expandState.
 *  The schema drift guard test in serialize.test.ts asserts every optional
 *  GameState key appears here or in TRANSIENT_KEYS. */
export const PERSISTED_OPTIONAL_KEYS = [
    "pendingCast",
    "pendingActivation",
    "pendingTarget",
    "pendingChoices",
    "autoPassPlayers",
    "singleShotAutoPass",
    "combat",
    "nextGrantSeq",
    "mulligan",
    "gameOver",
    "extraTurns",
    "preventionEffects",
    "targetPreventionShields",
    "delayedTriggers",
    "nextDelayedSeq",
    "nextTokenSeq",
    "nextInstanceId",
    "pendingEvents",
    "deathsThisTurn",
    "pendingUntapStep",
    "damageDealtToPlayerThisTurn",
    "damageRedirections",
    "playerPreferences",
    "preventAllCombatDamageThisTurn",
] as const;

/** Optional GameState keys that are intentionally ephemeral — never
 *  persisted to the DB. The schema drift guard test accepts keys in this
 *  set without requiring them in PERSISTED_OPTIONAL_KEYS. */
export const TRANSIENT_KEYS = new Set<string>([]);

/** Pack a GameState into the slim Convex-storage form. */
export function compactState(state: GameState): Record<string, unknown> {
    const out: Record<string, unknown> = {
        players: state.players.map(compactPlayer),
        stack: state.stack.map(compactStackItem),
        turn: state.turn,
        activePlayerId: state.activePlayerId,
        priorityPlayerId: state.priorityPlayerId,
        passCount: state.passCount,
        phase: state.phase,
        rngSeed: state.rngSeed,
        rngCounter: state.rngCounter,
    };
    for (const k of PERSISTED_OPTIONAL_KEYS) {
        const v = (state as Record<string, unknown>)[k];
        if (v === undefined || v === null) continue;
        if (isPlainEmpty(v)) continue;
        out[k] = v;
    }
    return out;
}

/** Expand the slim Convex-storage form back into a full GameState. */
export function expandState(data: Record<string, unknown>): GameState {
    const players = (data.players as CompactPlayer[]).map(expandPlayer);
    const result: GameState = {
        players,
        stack: (data.stack as CompactCard[]).map(expandStackItem),
        turn: data.turn as number,
        activePlayerId: data.activePlayerId as string,
        priorityPlayerId: data.priorityPlayerId as string,
        passCount: data.passCount as number,
        phase: data.phase as GameState["phase"],
        rngSeed: data.rngSeed as number,
        rngCounter: data.rngCounter as number,
    };
    for (const k of PERSISTED_OPTIONAL_KEYS) {
        const v = data[k];
        if (v === undefined || v === null) continue;
        (result as Record<string, unknown>)[k] = v;
    }
    return result;
}
