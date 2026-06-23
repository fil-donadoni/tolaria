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
// [instanceId, cardId] for the common case; a third element carries persistent
// per-viewer knowledge (ADR 0026 / PRD #338 — scry-to-top etc.) when present.
type LibraryEntry =
    | readonly [string, string]
    | readonly [string, string, string[]];

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
    if (card.attackedDuringLastTurn) out.attackedDuringLastTurn = true;
    if (card.dealtDamageToOpponentThisTurn) {
        out.dealtDamageToOpponentThisTurn = true;
    }
    if (card.startedTurnUntapped) out.startedTurnUntapped = true;
    if (card.chosenModeId) out.chosenModeId = card.chosenModeId;
    if (card.manaCommitted) out.manaCommitted = true;
    if (card.damageMarked) out.damageMarked = card.damageMarked;
    if (card.regenerationShields) {
        out.regenerationShields = card.regenerationShields;
    }
    if (card.chosenMana) out.chosenMana = card.chosenMana;
    if (card.manaCounterRemoval)
        out.manaCounterRemoval = card.manaCounterRemoval;
    if (card.grantedStaticAbilities?.length) {
        out.grantedStaticAbilities = card.grantedStaticAbilities;
    }
    if (card.grantedActivatedAbilities?.length) {
        out.grantedActivatedAbilities = card.grantedActivatedAbilities;
    }
    if (card.grantedTriggeredAbilities?.length) {
        out.grantedTriggeredAbilities = card.grantedTriggeredAbilities;
    }
    if (card.removedKeywords?.length) {
        out.removedKeywords = card.removedKeywords;
    }
    if (card.temporaryRemovedKeywords?.length) {
        out.temporaryRemovedKeywords = card.temporaryRemovedKeywords;
    }
    if (card.abilitiesSuppressedBy?.length) {
        out.abilitiesSuppressedBy = card.abilitiesSuppressedBy;
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
    if (card.temporaryPTSet?.length) {
        out.temporaryPTSet = card.temporaryPTSet;
    }
    if (card.sourceTappedPTMods?.length) {
        out.sourceTappedPTMods = card.sourceTappedPTMods;
    }
    if (card.untapLockedBy?.length) {
        out.untapLockedBy = card.untapLockedBy;
    }
    if (card.skipNextUntap) out.skipNextUntap = true;
    if (card.counters && Object.keys(card.counters).length > 0) {
        out.counters = card.counters;
    }
    // CR 704.5m world-rule timestamp — battlefield-only, must round-trip so a
    // mid-game save/load preserves which World permanent is the newest.
    if (card.worldSeq !== undefined) out.worldSeq = card.worldSeq;
    if (
        card.activationsThisTurn &&
        Object.keys(card.activationsThisTurn).length > 0
    ) {
        out.activationsThisTurn = card.activationsThisTurn;
    }
    if (card.grantedTypes && card.grantedTypes.length > 0) {
        out.grantedTypes = card.grantedTypes;
    }
    if (card.grantedSubtypes && card.grantedSubtypes.length > 0) {
        out.grantedSubtypes = card.grantedSubtypes;
    }
    if (card.printedSubtypes && card.printedSubtypes.length > 0) {
        out.printedSubtypes = card.printedSubtypes;
    }
    if (card.grantedColors && card.grantedColors.length > 0) {
        out.grantedColors = card.grantedColors;
    }
    if (card.colorOverride && card.colorOverride.length > 0) {
        out.colorOverride = card.colorOverride;
    }
    if (card.textChanges && card.textChanges.length > 0) {
        out.textChanges = card.textChanges;
    }
    // CR 707.2 copy anchor — `card.id` already carries the copied def id; this
    // preserves the printed identity to restore on leave (`revertCopy`).
    if (card.copiedFrom) out.copiedFrom = card.copiedFrom;
    if (card.exileOnDeath) out.exileOnDeath = true;
    if (card.cantBeRegeneratedThisTurn) out.cantBeRegeneratedThisTurn = true;
    if (card.mustAttackThisTurn) out.mustAttackThisTurn = true;
    if (card.canBlockAdditional !== undefined) {
        out.canBlockAdditional = card.canBlockAdditional;
    }
    if (card.mustBlockAllThisTurn) out.mustBlockAllThisTurn = true;
    if (card.cantBlockThisTurn) out.cantBlockThisTurn = true;
    if (card.cantBeBlockedThisTurn) out.cantBeBlockedThisTurn = true;
    if (card.cantBeBlockedBySubtypesThisTurn?.length) {
        out.cantBeBlockedBySubtypesThisTurn =
            card.cantBeBlockedBySubtypesThisTurn;
    }
    if (card.chosenPlayerId) out.chosenPlayerId = card.chosenPlayerId;
    if (card.pileLabel) out.pileLabel = card.pileLabel;
    if (card.faceDown) out.faceDown = true;
    if (card.faceDownOf) out.faceDownOf = card.faceDownOf;
    if (card.createdBy) out.createdBy = card.createdBy;
    // CR 603.10 — Dance of Many copy-token leave-linkage anchor.
    if (card.linkedTokenId) out.linkedTokenId = card.linkedTokenId;
    // ADR 0026 / PRD #338 — persistent per-viewer card knowledge.
    if (card.knownTo?.length) out.knownTo = card.knownTo;
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

    if (compact.chosenModeId)
        result.chosenModeId = compact.chosenModeId as string;
    if (compact.isToken) result.isToken = true;
    if (compact.isSummoningSick) result.isSummoningSick = true;
    if (compact.isAttacking) result.isAttacking = true;
    if (compact.isBlocking) result.isBlocking = true;
    if (compact.hasAttackedThisTurn) result.hasAttackedThisTurn = true;
    if (compact.hasBlockedThisTurn) result.hasBlockedThisTurn = true;
    if (compact.attackedDuringLastTurn) result.attackedDuringLastTurn = true;
    if (compact.dealtDamageToOpponentThisTurn) {
        result.dealtDamageToOpponentThisTurn = true;
    }
    if (compact.startedTurnUntapped) result.startedTurnUntapped = true;
    if (compact.manaCommitted) result.manaCommitted = true;
    if (compact.damageMarked) {
        result.damageMarked = compact.damageMarked as number;
    }
    if (compact.regenerationShields) {
        result.regenerationShields = compact.regenerationShields as number;
    }
    if (compact.chosenMana) result.chosenMana = compact.chosenMana as ManaCost;
    if (compact.manaCounterRemoval) {
        result.manaCounterRemoval =
            compact.manaCounterRemoval as CardInstanceState["manaCounterRemoval"];
    }
    if (compact.grantedStaticAbilities) {
        result.grantedStaticAbilities =
            compact.grantedStaticAbilities as CardInstanceState["grantedStaticAbilities"];
    }
    if (compact.grantedActivatedAbilities) {
        result.grantedActivatedAbilities =
            compact.grantedActivatedAbilities as CardInstanceState["grantedActivatedAbilities"];
    }
    if (compact.grantedTriggeredAbilities) {
        result.grantedTriggeredAbilities =
            compact.grantedTriggeredAbilities as CardInstanceState["grantedTriggeredAbilities"];
    }
    if (compact.removedKeywords) {
        result.removedKeywords =
            compact.removedKeywords as CardInstanceState["removedKeywords"];
    }
    if (compact.temporaryRemovedKeywords) {
        result.temporaryRemovedKeywords =
            compact.temporaryRemovedKeywords as CardInstanceState["temporaryRemovedKeywords"];
    }
    if (compact.abilitiesSuppressedBy) {
        result.abilitiesSuppressedBy =
            compact.abilitiesSuppressedBy as CardInstanceState["abilitiesSuppressedBy"];
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
    if (compact.temporaryPTSet) {
        result.temporaryPTSet =
            compact.temporaryPTSet as CardInstanceState["temporaryPTSet"];
    }
    if (compact.sourceTappedPTMods) {
        result.sourceTappedPTMods =
            compact.sourceTappedPTMods as CardInstanceState["sourceTappedPTMods"];
    }
    if (compact.untapLockedBy) {
        result.untapLockedBy = compact.untapLockedBy as string[];
    }
    if (compact.skipNextUntap) result.skipNextUntap = true;
    if (compact.counters) {
        result.counters = compact.counters as Record<string, number>;
    }
    if (compact.worldSeq !== undefined) {
        result.worldSeq = compact.worldSeq as number;
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
    if (compact.grantedSubtypes) {
        result.grantedSubtypes =
            compact.grantedSubtypes as CardInstanceState["grantedSubtypes"];
    }
    if (compact.printedSubtypes) {
        result.printedSubtypes = compact.printedSubtypes as string[];
    }
    if (compact.grantedColors) {
        result.grantedColors =
            compact.grantedColors as CardInstanceState["grantedColors"];
    }
    if (compact.colorOverride) {
        result.colorOverride =
            compact.colorOverride as CardInstanceState["colorOverride"];
    }
    if (compact.textChanges) {
        result.textChanges =
            compact.textChanges as CardInstanceState["textChanges"];
    }
    if (compact.copiedFrom) result.copiedFrom = compact.copiedFrom as string;
    if (compact.exileOnDeath) result.exileOnDeath = true;
    if (compact.cantBeRegeneratedThisTurn)
        result.cantBeRegeneratedThisTurn = true;
    if (compact.mustAttackThisTurn) result.mustAttackThisTurn = true;
    if (compact.canBlockAdditional !== undefined) {
        result.canBlockAdditional = compact.canBlockAdditional as number;
    }
    if (compact.mustBlockAllThisTurn) result.mustBlockAllThisTurn = true;
    if (compact.cantBlockThisTurn) result.cantBlockThisTurn = true;
    if (compact.cantBeBlockedThisTurn) result.cantBeBlockedThisTurn = true;
    if (compact.cantBeBlockedBySubtypesThisTurn) {
        result.cantBeBlockedBySubtypesThisTurn =
            compact.cantBeBlockedBySubtypesThisTurn as string[];
    }
    if (compact.chosenPlayerId) {
        result.chosenPlayerId = compact.chosenPlayerId as string;
    }
    if (compact.pileLabel) result.pileLabel = compact.pileLabel as string;
    if (compact.faceDown) result.faceDown = true;
    if (compact.faceDownOf) result.faceDownOf = compact.faceDownOf as string;
    if (compact.createdBy) result.createdBy = compact.createdBy as string;
    if (compact.linkedTokenId) {
        result.linkedTokenId = compact.linkedTokenId as string;
    }
    if (compact.knownTo) result.knownTo = compact.knownTo as string[];
    return result;
}

/** Library cards are always default-state (CR 400.7 + `resetBattlefieldTransientState`).
 *  We compress each to `[instanceId, cardId]`; everything else is derived
 *  from the card def and the owning player. */
function compactLibrary(library: CardInstanceState[]): LibraryEntry[] {
    return library.map((c) => {
        const cardId = (c.card as { id?: string }).id ?? "";
        // ADR 0026 — preserve persistent knowledge across the DB boundary;
        // omit the third element for the overwhelmingly common unknown card.
        return c.knownTo?.length
            ? ([c.id, cardId, c.knownTo] as const)
            : ([c.id, cardId] as const);
    });
}

function expandLibrary(
    library: (LibraryEntry | CompactCard)[],
    ownerId: string
): CardInstanceState[] {
    return library.map((entry) => {
        // Backward-compat: rows written before the tuple format (≈5 weeks ago)
        // stored library cards as full compact-card objects like hand/graveyard.
        if (!Array.isArray(entry)) {
            return expandCard(entry as CompactCard, {
                ownerId,
                zone: "library",
            });
        }
        const [id, cardId, knownTo] = entry as
            | readonly [string, string]
            | readonly [string, string, string[]];
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
        if (knownTo?.length) card.knownTo = [...knownTo];
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
    restrictedMana?: PlayerState["restrictedMana"];
    hasDrawnFromEmpty?: boolean;
    landsPlayedThisTurn?: number;
    lastDrawnCardId?: string;
    drawnThisTurn?: string[];
    turnsTaken?: number;
    grantedAbilities?: PlayerState["grantedAbilities"];
    skipNextTurn?: boolean;
    maxHandSizeOverride?: number | "unlimited";
    qualifyingActionThisTurn?: boolean;
    qualifyingActionLastTurn?: boolean;
    poisonCounters?: number;
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
    if (player.restrictedMana?.length) {
        out.restrictedMana = player.restrictedMana;
    }
    if (player.hasDrawnFromEmpty) out.hasDrawnFromEmpty = true;
    if (player.landsPlayedThisTurn) {
        out.landsPlayedThisTurn = player.landsPlayedThisTurn;
    }
    if (player.lastDrawnCardId) {
        out.lastDrawnCardId = player.lastDrawnCardId;
    }
    if (player.drawnThisTurn?.length) {
        out.drawnThisTurn = player.drawnThisTurn;
    }
    if (player.turnsTaken) out.turnsTaken = player.turnsTaken;
    if (player.grantedAbilities?.length) {
        out.grantedAbilities = player.grantedAbilities;
    }
    if (player.skipNextTurn) out.skipNextTurn = true;
    if (player.maxHandSizeOverride !== undefined) {
        out.maxHandSizeOverride = player.maxHandSizeOverride;
    }
    // Arboria (CR 508.1c) — per-turn qualifying-action history.
    if (player.qualifyingActionThisTurn) {
        out.qualifyingActionThisTurn = true;
    }
    if (player.qualifyingActionLastTurn) {
        out.qualifyingActionLastTurn = true;
    }
    // Poison counters (CR 122) — persisted so the loss SBA (CR 704.5c) survives
    // a save/load round-trip.
    if (player.poisonCounters) out.poisonCounters = player.poisonCounters;
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
    if (player.restrictedMana?.length) {
        result.restrictedMana = player.restrictedMana.map((r) => ({ ...r }));
    }
    if (player.hasDrawnFromEmpty) result.hasDrawnFromEmpty = true;
    if (player.landsPlayedThisTurn !== undefined) {
        result.landsPlayedThisTurn = player.landsPlayedThisTurn;
    }
    if (player.lastDrawnCardId !== undefined) {
        result.lastDrawnCardId = player.lastDrawnCardId;
    }
    if (player.drawnThisTurn !== undefined) {
        result.drawnThisTurn = player.drawnThisTurn.map((id) => id);
    }
    if (player.turnsTaken !== undefined) {
        result.turnsTaken = player.turnsTaken;
    }
    if (player.grantedAbilities) {
        result.grantedAbilities = player.grantedAbilities;
    }
    if (player.skipNextTurn) result.skipNextTurn = true;
    if (player.maxHandSizeOverride !== undefined) {
        result.maxHandSizeOverride = player.maxHandSizeOverride;
    }
    if (player.qualifyingActionThisTurn) {
        result.qualifyingActionThisTurn = true;
    }
    if (player.qualifyingActionLastTurn) {
        result.qualifyingActionLastTurn = true;
    }
    if (player.poisonCounters) result.poisonCounters = player.poisonCounters;
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
    if (item.isCopy) base.isCopy = item.isCopy;
    if (item.exileOnResolve) base.exileOnResolve = item.exileOnResolve;
    // Acting Player (ADR 0037): persist the controlled-cast override so a
    // suspended Word of Command resolution survives a DB round-trip.
    if (item.actingPlayerId) base.actingPlayerId = item.actingPlayerId;
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
    if (compact.isCopy) item.isCopy = compact.isCopy as boolean;
    if (compact.exileOnResolve) {
        item.exileOnResolve = compact.exileOnResolve as boolean;
    }
    // Acting Player (ADR 0037) — rehydrate the controlled-cast override.
    if (compact.actingPlayerId) {
        item.actingPlayerId = compact.actingPlayerId as string;
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
    "queuedEndTurn",
    "combat",
    "nextGrantSeq",
    "mulligan",
    "gameOver",
    "extraTurns",
    "preventionEffects",
    "targetPreventionShields",
    "playerDamagePrevention",
    "delayedTriggers",
    "nextDelayedSeq",
    "nextTokenSeq",
    "nextWorldSeq",
    "nextInstanceId",
    "pendingEvents",
    "deathsThisTurn",
    "pendingUntapStep",
    "pendingCleanupDiscard",
    "damageDealtToPlayerThisTurn",
    "artifactDamageToPlayerThisTurn",
    "damageRedirections",
    "combatBlockRestrictions",
    "playerPreferences",
    "landPlayLocked",
    "preventAllCombatDamageThisTurn",
    "assignsNoCombatDamageThisTurn",
    "landManaReplacedToBlueThisTurn",
    "highTideThisTurn",
    "damageCapShields",
    "islandSanctuaryProtection",
    "allCreaturesMustAttack",
    "destroyReplacementShields",
    "combatDamageImmunity",
    "damageTriggeredLifegain",
    "phasedOut",
    "exileHeld",
    "drawLookReplacements",
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
    // CR 702.26 — phased-out bundles hold full battlefield-shaped permanents.
    // Slim their `card` fat field down to `{ id }` like every other zone so
    // the registry hydrates the definition on expand (the generic loop above
    // stored them raw; overwrite with the compacted form).
    if (state.phasedOut?.length) {
        out.phasedOut = state.phasedOut.map((b) => ({
            ...b,
            cards: b.cards.map((c) => ({
                // Carry `ownerId` explicitly: bundle cards have no surrounding
                // player to default it from on expand (unlike battlefield
                // arrays, which key the owner off the containing player).
                ...compactCard(c, { ownerId: c.ownerId }),
                ownerId: c.ownerId,
            })),
        }));
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
    // CR 702.26 — rehydrate phased-out bundle permanents from their slim form
    // (mirror of `compactState`). Phased permanents are logically still
    // battlefield permanents, so expand them with `zone: "battlefield"`.
    const compactBundles = data.phasedOut as
        | { id: string; cards: CompactCard[]; [key: string]: unknown }[]
        | undefined;
    if (compactBundles) {
        result.phasedOut = compactBundles.map((b) => ({
            ...b,
            cards: b.cards.map((c) =>
                expandCard(c, {
                    ownerId: (c.ownerId as string | undefined) ?? "",
                    zone: "battlefield",
                })
            ),
        })) as GameState["phasedOut"];
    }
    return result;
}
