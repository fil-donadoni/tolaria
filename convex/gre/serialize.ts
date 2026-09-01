// Game state compression at the Convex storage boundary. Production traffic
// hits `saveGameState` (compact → write) and `getLatestGameState` (read →
// expand). Engine code keeps working on the fat `GameState` shape; only the
// row sitting in Convex is the slim form.
//
// Five layers of compression:
// 1. Library compression — every card in a player's library compresses to
//    `[instanceId, cardId]`. Owner/controller/zone/transient state are all
//    derivable (CR 400.7 + `resetBattlefieldTransientState` guarantee library
//    cards never carry battlefield-only flags).
// 2. Default stripping — booleans default to false, numbers to 0, arrays/
//    objects to empty. The compactor omits any field equal to its default.
// 3. Definition coalescing — `types`, `subtypes`, `staticAbilities`, `power`,
//    `toughness`, `controllerId === ownerId` all coalesce against the static
//    card definition or owner id, restored at expand time.
// 4. Token spec interning (issue #1780) — a synthetic token card id
//    (`tokenDefinitionId`, `convex/cards/index.ts`) embeds its whole spec,
//    URL-encoded, and is repeated verbatim on every instance/zone reference.
//    The compactor interns each DISTINCT `token:`-prefixed id once into a
//    per-document `tokenSpecs: Record<string, string>` map keyed by a short
//    `token:N` handle, and every reference becomes that short handle.
// 5. cardId string table (issue #1780) — a per-document `cardPool: string[]`
//    holds every distinct card id (real Scryfall id, or a layer-4 short
//    token handle) exactly once; every reference in the document becomes a
//    numeric index into it. Layers 4 and 5 are PURELY a compact-form
//    artifact — `GameState` itself never gains a `tokenSpecs`/`cardPool`
//    field, `card.id` is always the real full string on the fat shape, and
//    nothing outside this file ever sees the interned/indexed form.
//
// Versioning (issue #1780): the document carries `v: 2` when layers 4/5 are
// in effect. Rows written before this change have no `v` field (implicit
// v1) and store `card.id` as the raw string everywhere — `expandState`
// keeps that legacy path byte-for-byte unchanged so in-flight games written
// before this shipped keep expanding correctly. `compactState` always
// writes v2 going forward; there is no code path that writes v1 anymore.

import { tryGetDefinition } from "../cards";
import { getEffectiveStaticEffects } from "./state";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./state";
import type { Zone } from "./types";
import type { FaceDownProducer } from "./faceDown";
import type {
    CardType,
    ManaCost,
    ManaSubstitutionBreadth,
} from "../cards/types";

type CompactCard = Record<string, unknown>;
// [instanceId, cardId] for the common case; a third element carries persistent
// per-viewer knowledge (ADR 0026 / PRD #338 — scry-to-top etc.) when present.
// `cardId` is a v2 cardPool index (number) going forward; legacy v1 rows
// stored the raw string there (issue #1780 — `resolveCardId` is a passthrough
// when there is no ExpandCtx, so the v1 shape still expands unchanged).
type LibraryEntry =
    | readonly [string, string | number]
    | readonly [string, string | number, string[]];

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

// ---------------------------------------------------------------------------
// Layer 4/5 — token spec interning + cardId string table (issue #1780).
// Purely compact-form artifacts: built while walking the fat GameState in
// compactState, consumed while rebuilding it in expandState. Nothing outside
// this file ever sees a `token:N` handle or a pool index — `expandState`
// always hands back the original full card id string.
// ---------------------------------------------------------------------------

/** A synthetic token definition id (`convex/cards/index.ts: tokenDefinitionId`)
 *  is `token:<name>|<types>|...` — content-derived, can run to 400+ chars for
 *  a token with abilities/staticEffects/a back face. Real Scryfall ids never
 *  start with this prefix. */
function isTokenSpecId(cardId: string): boolean {
    return cardId.startsWith("token:");
}

/** Per-document token-spec interner: distinct `token:...` ids → short
 *  `token:N` handles, first-seen order. */
type TokenSpecPool = {
    map: Record<string, string>;
    seen: Map<string, string>;
    count: number;
};

function makeTokenSpecPool(): TokenSpecPool {
    return { map: {}, seen: new Map(), count: 0 };
}

function internTokenSpec(pool: TokenSpecPool, cardId: string): string {
    const existing = pool.seen.get(cardId);
    if (existing !== undefined) return existing;
    const handle = `token:${pool.count++}`;
    pool.map[handle] = cardId;
    pool.seen.set(cardId, handle);
    return handle;
}

/** Per-document cardId string table: distinct id strings → array index,
 *  first-seen order. Operates on whatever `internCardId` below hands it —
 *  either a real card id or a short `token:N` handle. */
type CardPool = { list: string[]; seen: Map<string, number> };

function makeCardPool(): CardPool {
    return { list: [], seen: new Map() };
}

function internPoolEntry(pool: CardPool, entry: string): number {
    const existing = pool.seen.get(entry);
    if (existing !== undefined) return existing;
    const idx = pool.list.length;
    pool.list.push(entry);
    pool.seen.set(entry, idx);
    return idx;
}

/** Compaction-side context threaded through every card/library/stack
 *  compactor — layer 4 (token interning) runs first, layer 5 (cardId pool)
 *  runs on whatever layer 4 produced, so a token handle is itself pooled
 *  like any other short id. */
type CompactCtx = { pool: CardPool; tokens: TokenSpecPool };

function internCardIdForCompact(ctx: CompactCtx, cardId: string): number {
    const forPool = isTokenSpecId(cardId)
        ? internTokenSpec(ctx.tokens, cardId)
        : cardId;
    return internPoolEntry(ctx.pool, forPool);
}

/** Expansion-side context — undefined for a legacy v1 document, in which
 *  case `resolveCardId` is a no-op passthrough (the raw string IS the id,
 *  exactly like before this change). */
type ExpandCtx = { pool: string[]; tokens: Record<string, string> };

function resolveCardId(raw: unknown, ctx?: ExpandCtx): string {
    if (!ctx) return raw as string;
    const pooled = ctx.pool[raw as number] ?? "";
    const spec = ctx.tokens[pooled];
    return spec !== undefined ? spec : pooled;
}

/** Optional `CardInstanceState` keys that round-trip through `compactCard` /
 *  `expandCard` — the card-level counterpart to `PERSISTED_OPTIONAL_KEYS`
 *  below, mechanically derived (not hand-transcribed) by cross-referencing
 *  every optional key of `CardInstanceState` (`convex/gre/state.ts`) against
 *  the `card.<field>` reads in `compactCard` and the `result.<field>` /
 *  `item.<field>` writes in `expandCard` — all 109 are currently handled in
 *  both directions (issue #2255; `indefiniteSubtypeSet` was the sole gap).
 *  Purely a classification list for the compile-time guard below — unlike
 *  `PERSISTED_OPTIONAL_KEYS`, `compactCard`/`expandCard` do NOT loop over
 *  this array (each card field needs its own default/shape check), so
 *  adding a name here documents intent but does not itself wire the field —
 *  pair every addition with the actual `compactCard`/`expandCard` branch and
 *  a round-trip test, exactly like the fix in this issue. */
export const CARD_PERSISTED_OPTIONAL_KEYS = [
    "abilitiesSuppressedBy",
    "activationsThisTurn",
    "animation",
    "attachedTo",
    "attackedDuringLastTurn",
    "bestowed",
    "canAttackDespiteDefenderThisTurn",
    "canBlockAdditional",
    "cantAttackThisTurn",
    "cantBeBlockedBySubtypesThisTurn",
    "cantBeBlockedThisTurn",
    "cantBeRegeneratedThisTurn",
    "cantBlockThisTurn",
    "castFromExileCostIncrease",
    "castFromExileManaSubstitution",
    "castFromExileWithoutPayingManaCost",
    "castFromGraveyardExilesOnResolve",
    "castFromGraveyardWithoutPayingManaCost",
    "castOffSorceryTiming",
    "castableFromExileBy",
    "castableFromExileIncludesLand",
    "castableFromExileUntilTurn",
    "castableFromGraveyardBy",
    "castableFromGraveyardUntilTurn",
    "chosenMana",
    "chosenModeId",
    "chosenName",
    "chosenPlayerId",
    "chosenSubtypes",
    "chosenXOnCast",
    "colorOverride",
    "controlChanges",
    "copiedFrom",
    "copyExcept",
    "counters",
    "countersAtLeave",
    "capturedBindings",
    "createdBy",
    "damageLockThisTurn",
    "damageMarked",
    "damagedBySources",
    "dashed",
    "dealtDamageToOpponentThisTurn",
    "dealtDeathtouchDamage",
    "echoPending",
    "enteredOnTurn",
    "escaped",
    "evoked",
    "exileOnDeath",
    "exileOnLeave",
    "exiledBySourceId",
    "faceDown",
    "faceDownBy",
    "faceDownOf",
    "grantedActivatedAbilities",
    "grantedColors",
    "grantedEnchantRestriction",
    "grantedFlashback",
    "grantedStaticAbilities",
    "grantedSubtypes",
    "grantedSubtypesAdd",
    "grantedSupertypes",
    "grantedTriggeredAbilities",
    "grantedTypes",
    "hasAttackedThisTurn",
    "hasBlockedThisTurn",
    "imagePrintId",
    "indefiniteSubtypeSet",
    "isAttacking",
    "isBlocking",
    "isSummoningSick",
    "isToken",
    "kickerPayments",
    "knownTo",
    "lifePaidThisTap",
    "linkedTokenId",
    "loyaltyActivatedThisTurn",
    "madnessExiled",
    "madnessTriggerPending",
    "manaCommitted",
    "manaCostOverride",
    "manaCounterRemoval",
    "manaPaidThisTap",
    "mustAttackThisTurn",
    "mustBlockAllThisTurn",
    "notedMana",
    "notedManaSpentOnCast",
    "pileLabel",
    "power",
    "printedSubtypes",
    "reboundExiled",
    "regenerationShields",
    "removedKeywords",
    "removedSupertypes",
    "skipNextUntap",
    "sourceTappedPTMods",
    "startedTurnUntapped",
    "staticSeq",
    "suppressedTypes",
    "tapBonusMana",
    "tapTriggerCommitted",
    "temporaryColorOverride",
    "temporaryPTMods",
    "temporaryPTSet",
    "temporaryRemovedKeywords",
    "temporarySubtypeChange",
    "textChanges",
    "toughness",
    "transformed",
    "transformedFrom",
    "triggersThisTurn",
    "untapLockedBy",
    "wasKicked",
    "worldSeq",
] as const;

/** Optional `CardInstanceState` keys deliberately NOT persisted through
 *  `compactCard`/`expandCard` — empty today (every optional card field
 *  round-trips). A future entry needs a one-line reason on its own line,
 *  mirroring `TRANSIENT_KEYS` below. Kept as a literal tuple (`as const`),
 *  not `string[]` — a widened element type would make the exhaustiveness
 *  check below vacuously pass for every field. */
export const CARD_TRANSIENT_KEYS = [] as const;

// Compile-time card-level drift guard (issue #2255) — NOT a runtime check.
// tsc computes every optional key of CardInstanceState, subtracts
// CARD_PERSISTED_OPTIONAL_KEYS and CARD_TRANSIENT_KEYS, and the assignment
// below type-checks only when nothing is left over. A newly added optional
// CardInstanceState field that is classified in neither list fails
// `tsc -b` (part of `bun run check:all`), naming the field in the reported
// type: `["unlisted CardInstanceState keys:", "someNewField"]`. The mapped
// type is repeated inline (not hoisted to a named alias) on purpose — tsc
// only expands an anonymous mapped-type union in an error message, not one
// reached through a type alias, generic or not (verified by hand while
// building this guard).
// prettier-ignore
const _cardKeysExhaustive: Exclude<{ [K in keyof CardInstanceState]-?: object extends Pick<CardInstanceState, K> ? K : never }[keyof CardInstanceState], (typeof CARD_PERSISTED_OPTIONAL_KEYS)[number] | (typeof CARD_TRANSIENT_KEYS)[number]> extends never
    ? true
    : ["unlisted CardInstanceState keys:", Exclude<{ [K in keyof CardInstanceState]-?: object extends Pick<CardInstanceState, K> ? K : never }[keyof CardInstanceState], (typeof CARD_PERSISTED_OPTIONAL_KEYS)[number] | (typeof CARD_TRANSIENT_KEYS)[number]>] = true;
void _cardKeysExhaustive;

function compactCard(
    card: CardInstanceState,
    opts: { ownerId: string },
    ctx: CompactCtx
): CompactCard {
    const cardId = (card.card as { id?: string }).id ?? "";
    const def = tryGetDefinition(cardId);
    const out: CompactCard = {
        id: card.id,
        card: { id: internCardIdForCompact(ctx, cardId) },
    };

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
    // CR 400.7 (issue #1458) — the entered-this-turn stamp must survive a
    // mid-turn stable-point round-trip, or an effect resolving after a save
    // would stop seeing permanents that entered earlier in the same turn.
    if (card.enteredOnTurn !== undefined)
        out.enteredOnTurn = card.enteredOnTurn;
    if (card.echoPending) out.echoPending = true;
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
    if (card.chosenName) out.chosenName = card.chosenName;
    if (card.manaCommitted) out.manaCommitted = true;
    if (card.tapTriggerCommitted) out.tapTriggerCommitted = true;
    if (card.damageMarked) out.damageMarked = card.damageMarked;
    // CR 606.3 — the per-permanent "a loyalty ability was activated this turn"
    // lock must survive a save/load mid-turn, or a planeswalker could activate
    // a second loyalty ability after a reload.
    if (card.loyaltyActivatedThisTurn) out.loyaltyActivatedThisTurn = true;
    if (card.dealtDeathtouchDamage) out.dealtDeathtouchDamage = true;
    if (card.regenerationShields) {
        out.regenerationShields = card.regenerationShields;
    }
    if (card.chosenMana) out.chosenMana = card.chosenMana;
    if (card.manaCounterRemoval)
        out.manaCounterRemoval = card.manaCounterRemoval;
    if (card.lifePaidThisTap) out.lifePaidThisTap = card.lifePaidThisTap;
    if (card.manaPaidThisTap) out.manaPaidThisTap = card.manaPaidThisTap;
    if (card.tapBonusMana) out.tapBonusMana = card.tapBonusMana;
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
    if (card.temporarySubtypeChange) {
        out.temporarySubtypeChange = card.temporarySubtypeChange;
    }
    // CR 400.7 / 611.2a (issue #1746) — indefinite subtype-set restore anchor.
    // No duration ticks this out; its only end is the permanent leaving the
    // battlefield (`resetBattlefieldTransientState`). Must round-trip or a
    // save/load boundary loses the anchor while the mutated `subtypes` array
    // (which IS persisted) survives — the permanent never reverts (#2255).
    if (card.indefiniteSubtypeSet) {
        out.indefiniteSubtypeSet = card.indefiniteSubtypeSet;
    }
    if (card.temporaryColorOverride) {
        out.temporaryColorOverride = card.temporaryColorOverride;
    }
    if (card.sourceTappedPTMods?.length) {
        out.sourceTappedPTMods = card.sourceTappedPTMods;
    }
    if (card.untapLockedBy?.length) {
        out.untapLockedBy = card.untapLockedBy;
    }
    if (card.skipNextUntap) out.skipNextUntap = true;
    if (card.canAttackDespiteDefenderThisTurn)
        out.canAttackDespiteDefenderThisTurn = true;
    if (card.counters && Object.keys(card.counters).length > 0) {
        out.counters = card.counters;
    }
    // CR 608.2h — the moment-of-departure counter snapshot outlives the
    // permanent, so a death trigger resolving after a save/load boundary still
    // reads it (see `CardInstanceState.countersAtLeave`).
    if (card.countersAtLeave && Object.keys(card.countersAtLeave).length > 0) {
        out.countersAtLeave = card.countersAtLeave;
    }
    // CR 608.2h / 400.7 (issue #2384) — the cross-ability binding memory
    // outlives the resolution that wrote it BY DESIGN (Skyclave Apparition's
    // ETB exile is read by its own leave-trigger many turns later), so it must
    // round-trip: state is saved at every stable point, and a memory that did
    // not survive the save would silently make the later ability do nothing.
    if (
        card.capturedBindings &&
        Object.keys(card.capturedBindings).length > 0
    ) {
        out.capturedBindings = card.capturedBindings;
    }
    // CR 704.5m world-rule timestamp — battlefield-only, must round-trip so a
    // mid-game save/load preserves which World permanent is the newest.
    if (card.worldSeq !== undefined) out.worldSeq = card.worldSeq;
    // CR 613.7 layer timestamp (issue #1715) — battlefield-only, must
    // round-trip or a mid-game save/load re-orders every co-applying layer-4/6
    // static effect the next time one of them is re-applied.
    if (card.staticSeq !== undefined) out.staticSeq = card.staticSeq;
    if (
        card.activationsThisTurn &&
        Object.keys(card.activationsThisTurn).length > 0
    ) {
        out.activationsThisTurn = card.activationsThisTurn;
    }
    // CR 603.2 per-turn trigger cap tally — same round-trip contract as
    // `activationsThisTurn`: a mid-turn save/load must not refund a capped
    // ability's spent triggers (Nadu, Winged Wisdom).
    if (
        card.triggersThisTurn &&
        Object.keys(card.triggersThisTurn).length > 0
    ) {
        out.triggersThisTurn = card.triggersThisTurn;
    }
    if (card.grantedTypes && card.grantedTypes.length > 0) {
        out.grantedTypes = card.grantedTypes;
    }
    if (card.suppressedTypes && card.suppressedTypes.length > 0) {
        out.suppressedTypes = card.suppressedTypes;
    }
    if (card.grantedSubtypes && card.grantedSubtypes.length > 0) {
        out.grantedSubtypes = card.grantedSubtypes;
    }
    // Layer-4 ADD grants (CR 305.7 — Urborg / Yavimaya). Load-bearing since
    // issue #1715: `composeMaterializedSubtypes` replays this record against
    // `grantedSubtypes` on every re-apply, so dropping it across a save/load
    // would make the added land type vanish at the next SBA refresh.
    if (card.grantedSubtypesAdd && card.grantedSubtypesAdd.length > 0) {
        out.grantedSubtypesAdd = card.grantedSubtypesAdd;
    }
    if (card.printedSubtypes && card.printedSubtypes.length > 0) {
        out.printedSubtypes = card.printedSubtypes;
    }
    if (card.grantedColors && card.grantedColors.length > 0) {
        out.grantedColors = card.grantedColors;
    }
    if (card.grantedSupertypes && card.grantedSupertypes.length > 0) {
        out.grantedSupertypes = card.grantedSupertypes;
    }
    if (card.removedSupertypes && card.removedSupertypes.length > 0) {
        out.removedSupertypes = card.removedSupertypes;
    }
    if (card.colorOverride && card.colorOverride.length > 0) {
        out.colorOverride = card.colorOverride;
    }
    if (card.textChanges && card.textChanges.length > 0) {
        out.textChanges = card.textChanges;
    }
    // CR 707.2's "except it's N/N" clause, stamped on this copy so a copy OF
    // it inherits the exception (CR 707.3, issue #2076). Persisted rather than
    // transient: it is a copiable value of a permanent that survives across
    // saves, exactly like the copy anchor below.
    if (card.copyExcept) out.copyExcept = card.copyExcept;
    // CR 707.2 copy anchor — `card.id` already carries the copied def id; this
    // preserves the printed identity to restore on leave (`revertCopy`).
    if (card.copiedFrom) out.copiedFrom = card.copiedFrom;
    // CR 707.2 / 202.3 — the "except it has no mana cost" override (Eternalize
    // / Embalm token). Persisted even when EMPTY: `{}` IS the override, and a
    // truthiness/length test would drop exactly the case that matters.
    if (card.manaCostOverride) out.manaCostOverride = card.manaCostOverride;
    // CR 111 — cosmetic art pin for a copy with its own printed token card.
    if (card.imagePrintId) out.imagePrintId = card.imagePrintId;
    if (card.exileOnDeath) out.exileOnDeath = true;
    if (card.damageLockThisTurn) out.damageLockThisTurn = true;
    if (card.exileOnLeave) out.exileOnLeave = true;
    if (card.cantBeRegeneratedThisTurn) out.cantBeRegeneratedThisTurn = true;
    if (card.mustAttackThisTurn) out.mustAttackThisTurn = true;
    if (card.canBlockAdditional !== undefined) {
        out.canBlockAdditional = card.canBlockAdditional;
    }
    if (card.mustBlockAllThisTurn) out.mustBlockAllThisTurn = true;
    if (card.cantBlockThisTurn) out.cantBlockThisTurn = true;
    if (card.cantAttackThisTurn) out.cantAttackThisTurn = true;
    if (card.cantBeBlockedThisTurn) out.cantBeBlockedThisTurn = true;
    if (card.cantBeBlockedBySubtypesThisTurn?.length) {
        out.cantBeBlockedBySubtypesThisTurn =
            card.cantBeBlockedBySubtypesThisTurn;
    }
    if (card.chosenPlayerId) out.chosenPlayerId = card.chosenPlayerId;
    if (card.chosenSubtypes?.length) out.chosenSubtypes = card.chosenSubtypes;
    if (card.pileLabel) out.pileLabel = card.pileLabel;
    if (card.faceDown) out.faceDown = true;
    if (card.faceDownBy) out.faceDownBy = card.faceDownBy;
    if (card.faceDownOf) out.faceDownOf = card.faceDownOf;
    // CR 712 / ADR 0067 (issue #1210) — transform face flag + the front
    // face's own definition id, so a later flip back can restore it. Public
    // to both players (unlike faceDown/faceDownOf), no per-viewer stripping.
    if (card.transformed) out.transformed = true;
    if (card.transformedFrom) out.transformedFrom = card.transformedFrom;
    if (card.createdBy) out.createdBy = card.createdBy;
    // CR 603.10 — Dance of Many copy-token leave-linkage anchor.
    if (card.linkedTokenId) out.linkedTokenId = card.linkedTokenId;
    // ADR 0026 / PRD #338 — persistent per-viewer card knowledge.
    if (card.knownTo?.length) out.knownTo = card.knownTo;
    // CR 106.10 — noted-mana battery (Jeweled Amulet / Ice Cauldron); the noted
    // type/amount lives on the artifact and must survive a save/load.
    if (card.notedMana) out.notedMana = card.notedMana;
    // CR 601.3 — Ice Cauldron's cast-from-exile permission on an exiled card.
    if (card.castableFromExileBy) {
        out.castableFromExileBy = card.castableFromExileBy;
    }
    // CR 514.2 / 608.2g — the turn-scoped expiry marker for an impulse play
    // grant (Headliner Scarlett / Expressive Iteration) must survive a save/load
    // so the cleanup revocation fires on the right turn.
    if (card.castableFromExileUntilTurn !== undefined) {
        out.castableFromExileUntilTurn = card.castableFromExileUntilTurn;
    }
    // CR 601.3 / 117.6 (issue #1156) — Dauthi Voidwalker's free-cast waiver
    // rides `castableFromExileBy`'s permission window and must survive a
    // save/load the same way.
    if (card.castFromExileWithoutPayingManaCost) {
        out.castFromExileWithoutPayingManaCost = true;
    }
    // CR 305.9 (issue #1689) — the land-inclusive marker rides
    // `castableFromExileBy`'s permission window and must survive a save/load
    // the same way, so a reloaded exiled land under a "play"-worded grant
    // (Headliner Scarlett et al.) stays playable.
    if (card.castableFromExileIncludesLand) {
        out.castableFromExileIncludesLand = true;
    }
    // CR 609.4b (issue #2890) — the "spend mana as though it were mana of any
    // color/type" marker rides `castableFromExileBy`'s permission window and
    // must survive a save/load the same way, or a reloaded Robber exile becomes
    // uncastable for an off-colour caster.
    if (card.castFromExileManaSubstitution) {
        out.castFromExileManaSubstitution = card.castFromExileManaSubstitution;
    }
    // CR 601.2f (issue #2383) — the object-scoped cost tax (Elite Spellbinder)
    // rides `castableFromExileBy`'s permission window and must survive a
    // save/load the same way, or a reloaded exiled card becomes castable for
    // its untaxed printed cost.
    if (card.castFromExileCostIncrease) {
        out.castFromExileCostIncrease = card.castFromExileCostIncrease;
    }
    // CR 111 (issue #791) — the per-source exile provenance link (Currency
    // Converter's "exiled with this artifact") must survive a save/load so the
    // retrieval ability still finds its linked cards after a round-trip.
    if (card.exiledBySourceId) {
        out.exiledBySourceId = card.exiledBySourceId;
    }
    // CR 601.3 / 117.6-analog (issue #1344) — Malcolm, Alluring Scoundrel's
    // per-card cast-from-graveyard grant on a graveyard card, mirroring
    // `castableFromExileBy` above.
    if (card.castableFromGraveyardBy) {
        out.castableFromGraveyardBy = card.castableFromGraveyardBy;
    }
    // CR 514.2 / 608.2g — the turn-scoped expiry marker for the graveyard
    // grant's impulse window must survive a save/load so the cleanup
    // revocation fires on the right turn.
    if (card.castableFromGraveyardUntilTurn !== undefined) {
        out.castableFromGraveyardUntilTurn =
            card.castableFromGraveyardUntilTurn;
    }
    // CR 601.3 / 117.6-analog (issue #1344) — Malcolm's free-cast waiver
    // rides `castableFromGraveyardBy`'s permission window and must survive a
    // save/load the same way.
    // issue #2380 — the "exile it instead" rider on the same grant window;
    // same round-trip requirement as the cost waiver above.
    if (card.castFromGraveyardExilesOnResolve) {
        out.castFromGraveyardExilesOnResolve = true;
    }
    if (card.castFromGraveyardWithoutPayingManaCost) {
        out.castFromGraveyardWithoutPayingManaCost = true;
    }
    // CR 702.34 — an instance-level Flashback grant (Snapcaster Mage) on a
    // graveyard card must survive a save/load until it expires at cleanup.
    if (card.grantedFlashback) {
        out.grantedFlashback = card.grantedFlashback;
    }
    // CR 303.4 / 704.5m — a RUNTIME-granted enchant restriction ("it becomes
    // an Aura with enchant creature") exists only on the instance: there is no
    // definition to re-derive it from, unlike a printed Aura's cast-time
    // `targetRequirement`. Dropped here, the Aura would read as having no
    // restriction after a save/load and the very next SBA sweep would bin it
    // (CR 704.5m) with its host still on the battlefield.
    if (card.grantedEnchantRestriction) {
        out.grantedEnchantRestriction = card.grantedEnchantRestriction;
    }
    // CR 702.138b — a permanent that escaped carries the flag for the life of
    // the permanent (Uro/Phlage "unless it escaped", Nethergoyf "as long as ~
    // escaped"); it must survive save/load.
    if (card.escaped) {
        out.escaped = card.escaped;
    }
    // CR 702.35c — the madness-exile marker on a discarded-and-exiled card must
    // survive a save/load so the cast window stays consistent.
    if (card.madnessExiled) {
        out.madnessExiled = card.madnessExiled;
    }
    // CR 702.35a — the pending-reflexive-trigger marker must survive a save/load
    // between the discard→exile and the trigger being built by collectTriggers.
    if (card.madnessTriggerPending) {
        out.madnessTriggerPending = card.madnessTriggerPending;
    }
    // CR 702.88a — the rebound-exile marker on a resolved-from-hand card must
    // survive a save/load so the reflexive cast window stays consistent while
    // it awaits its next-upkeep delayed trigger (possibly turns away).
    if (card.reboundExiled) {
        out.reboundExiled = card.reboundExiled;
    }
    // CR 702.74a — the Evoke cast marker must survive a save/load between the
    // cast committing and the "sacrifice if evoked" trigger resolving.
    if (card.evoked) {
        out.evoked = card.evoked;
    }
    // CR 702.109a — the Dash cast marker must survive a save/load between the
    // cast committing and the "gains haste, returned to hand" trigger
    // resolving.
    if (card.dashed) {
        out.dashed = card.dashed;
    }
    // CR 702.103b — the Bestow marker must survive a save/load for the whole
    // life of the bestowed object: it is the live discriminator the CR 702.103f
    // Aura-SBA exception (`sba.ts`) and the CR 702.103e resolution exception
    // (`state.ts`) both read, so a dropped flag turns a bestowed Nantuko into
    // an ordinary Aura and the next SBA sweep bins it to the graveyard. The
    // type-line half of the change rides the ordinary `types`/`subtypes`
    // definition-diff above.
    if (card.bestowed) {
        out.bestowed = card.bestowed;
    }
    // CR 307.1 / 117.1a / 601.3a (issue #2473) — the "cast when a sorcery
    // couldn't have been cast" timing snapshot must survive a save/load
    // between the cast committing and a later check-time predicate (e.g. a
    // cleanup-step delayed trigger reading it) resolving.
    if (card.castOffSorceryTiming) {
        out.castOffSorceryTiming = card.castOffSorceryTiming;
    }
    // CR 106.4 / 202.3 — the persistent per-colour spent-mana record (issue
    // #900) must survive a save/load so a later ETB trigger's condition still
    // reads it correctly after a DB round-trip.
    if (
        card.notedManaSpentOnCast &&
        Object.keys(card.notedManaSpentOnCast).length > 0
    ) {
        out.notedManaSpentOnCast = card.notedManaSpentOnCast;
    }
    // CR 702.33 / 614.1c (issue #1716) — the one-shot "was kicked" marker must
    // survive a save/load so a later check-time predicate (a `keyword-grant`
    // `applies`, an "if this creature was kicked" trigger condition) reads
    // the same fixed answer after a DB round-trip.
    if (card.wasKicked) {
        out.wasKicked = card.wasKicked;
    }
    // CR 702.33 (ADR 0079, issue #1950) — `wasKicked`'s per-Kicker-id twin
    // must survive the same save/load window: a two-Kicker permanent's ETB
    // trigger (Nightscape Battlemage — "if it was kicked with its {2}{U}
    // kicker") re-checks its CR 603.4 intervening-if only once the trigger
    // resolves, which can be after a stable point was already written.
    if (card.kickerPayments && Object.keys(card.kickerPayments).length > 0) {
        out.kickerPayments = card.kickerPayments;
    }
    // CR 107.3 / 601.2b (issue #674) — the chosen {X} snapshot must survive a
    // save/load: Ravenous's ETB trigger goes on the stack, the game reaches a
    // stable point (state written to `game_state`), and only THEN does the
    // trigger resolve and re-check its CR 603.4 intervening-if. Dropped here,
    // "if X is 5 or greater" would read 0 on every real game.
    if (card.chosenXOnCast !== undefined) {
        out.chosenXOnCast = card.chosenXOnCast;
    }
    return out;
}

function expandCard(
    compact: CompactCard,
    opts: { ownerId: string; zone: Zone },
    ctx?: ExpandCtx
): CardInstanceState {
    const cardRef = compact.card as { id: string | number };
    const cardId = resolveCardId(cardRef.id, ctx);
    const def = tryGetDefinition(cardId);
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
        card: { id: cardId },
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
    if (compact.chosenName) result.chosenName = compact.chosenName as string;
    if (compact.isToken) result.isToken = true;
    if (compact.isSummoningSick) result.isSummoningSick = true;
    if (typeof compact.enteredOnTurn === "number") {
        result.enteredOnTurn = compact.enteredOnTurn;
    }
    if (compact.echoPending) result.echoPending = true;
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
    if (compact.tapTriggerCommitted) result.tapTriggerCommitted = true;
    if (compact.damageMarked) {
        result.damageMarked = compact.damageMarked as number;
    }
    if (compact.loyaltyActivatedThisTurn) {
        result.loyaltyActivatedThisTurn = true;
    }
    if (compact.dealtDeathtouchDamage) {
        result.dealtDeathtouchDamage = true;
    }
    if (compact.regenerationShields) {
        result.regenerationShields = compact.regenerationShields as number;
    }
    if (compact.chosenMana) result.chosenMana = compact.chosenMana as ManaCost;
    if (compact.manaCounterRemoval) {
        result.manaCounterRemoval =
            compact.manaCounterRemoval as CardInstanceState["manaCounterRemoval"];
    }
    if (compact.lifePaidThisTap) {
        result.lifePaidThisTap = compact.lifePaidThisTap as number;
    }
    if (compact.manaPaidThisTap) {
        result.manaPaidThisTap = compact.manaPaidThisTap as ManaCost;
    }
    if (compact.tapBonusMana) {
        result.tapBonusMana = compact.tapBonusMana as ManaCost;
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
        // Rows persisted before the field carried a layer timestamp hold bare
        // source-id STRINGS (CR 613.7 ordering was added later). Coerce them to
        // seq 0 — the earliest possible stamp, so every grant on that permanent
        // reads as later and survives, matching the pre-change behaviour for a
        // game already in flight.
        result.abilitiesSuppressedBy = (
            compact.abilitiesSuppressedBy as unknown[]
        ).map((s) =>
            typeof s === "string" ? { sourceId: s, seq: 0 } : s
        ) as CardInstanceState["abilitiesSuppressedBy"];
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
    if (compact.temporarySubtypeChange) {
        result.temporarySubtypeChange =
            compact.temporarySubtypeChange as CardInstanceState["temporarySubtypeChange"];
    }
    if (compact.indefiniteSubtypeSet) {
        result.indefiniteSubtypeSet =
            compact.indefiniteSubtypeSet as CardInstanceState["indefiniteSubtypeSet"];
    }
    if (compact.temporaryColorOverride) {
        result.temporaryColorOverride =
            compact.temporaryColorOverride as CardInstanceState["temporaryColorOverride"];
    }
    if (compact.sourceTappedPTMods) {
        result.sourceTappedPTMods =
            compact.sourceTappedPTMods as CardInstanceState["sourceTappedPTMods"];
    }
    if (compact.untapLockedBy) {
        result.untapLockedBy = compact.untapLockedBy as string[];
    }
    if (compact.skipNextUntap) result.skipNextUntap = true;
    if (compact.canAttackDespiteDefenderThisTurn)
        result.canAttackDespiteDefenderThisTurn = true;
    if (compact.counters) {
        result.counters = compact.counters as Record<string, number>;
    }
    if (compact.countersAtLeave) {
        result.countersAtLeave = compact.countersAtLeave as Record<
            string,
            number
        >;
    }
    if (compact.capturedBindings) {
        result.capturedBindings = compact.capturedBindings as Record<
            string,
            string[]
        >;
    }
    if (compact.worldSeq !== undefined) {
        result.worldSeq = compact.worldSeq as number;
    }
    if (compact.staticSeq !== undefined) {
        result.staticSeq = compact.staticSeq as number;
    }
    if (compact.activationsThisTurn) {
        result.activationsThisTurn = compact.activationsThisTurn as Record<
            string,
            number
        >;
    }
    if (compact.triggersThisTurn) {
        result.triggersThisTurn = compact.triggersThisTurn as Record<
            string,
            number
        >;
    }
    if (compact.grantedTypes) {
        result.grantedTypes =
            compact.grantedTypes as CardInstanceState["grantedTypes"];
    }
    if (compact.suppressedTypes) {
        result.suppressedTypes =
            compact.suppressedTypes as CardInstanceState["suppressedTypes"];
    }
    if (compact.grantedSubtypesAdd) {
        result.grantedSubtypesAdd =
            compact.grantedSubtypesAdd as CardInstanceState["grantedSubtypesAdd"];
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
    if (compact.grantedSupertypes) {
        result.grantedSupertypes =
            compact.grantedSupertypes as CardInstanceState["grantedSupertypes"];
    }
    if (compact.removedSupertypes) {
        result.removedSupertypes =
            compact.removedSupertypes as CardInstanceState["removedSupertypes"];
    }
    if (compact.colorOverride) {
        result.colorOverride =
            compact.colorOverride as CardInstanceState["colorOverride"];
    }
    if (compact.textChanges) {
        result.textChanges =
            compact.textChanges as CardInstanceState["textChanges"];
    }
    if (compact.copyExcept) {
        result.copyExcept =
            compact.copyExcept as CardInstanceState["copyExcept"];
    }
    if (compact.copiedFrom) result.copiedFrom = compact.copiedFrom as string;
    // CR 707.2 / 202.3 — `{}` is a meaningful override, so test for PRESENCE
    // (`!== undefined`), never truthiness of its contents.
    if (compact.manaCostOverride !== undefined) {
        result.manaCostOverride =
            compact.manaCostOverride as CardInstanceState["manaCostOverride"];
    }
    if (compact.imagePrintId) {
        result.imagePrintId = compact.imagePrintId as string;
    }
    if (compact.exileOnDeath) result.exileOnDeath = true;
    if (compact.damageLockThisTurn) result.damageLockThisTurn = true;
    if (compact.exileOnLeave) result.exileOnLeave = true;
    if (compact.cantBeRegeneratedThisTurn)
        result.cantBeRegeneratedThisTurn = true;
    if (compact.mustAttackThisTurn) result.mustAttackThisTurn = true;
    if (compact.canBlockAdditional !== undefined) {
        result.canBlockAdditional = compact.canBlockAdditional as number;
    }
    if (compact.mustBlockAllThisTurn) result.mustBlockAllThisTurn = true;
    if (compact.cantBlockThisTurn) result.cantBlockThisTurn = true;
    if (compact.cantAttackThisTurn) result.cantAttackThisTurn = true;
    if (compact.cantBeBlockedThisTurn) result.cantBeBlockedThisTurn = true;
    if (compact.cantBeBlockedBySubtypesThisTurn) {
        result.cantBeBlockedBySubtypesThisTurn =
            compact.cantBeBlockedBySubtypesThisTurn as string[];
    }
    if (compact.chosenPlayerId) {
        result.chosenPlayerId = compact.chosenPlayerId as string;
    }
    if (compact.chosenSubtypes) {
        result.chosenSubtypes = compact.chosenSubtypes as string[];
    }
    if (compact.pileLabel) result.pileLabel = compact.pileLabel as string;
    if (compact.faceDown) result.faceDown = true;
    if (compact.faceDownBy) {
        result.faceDownBy = compact.faceDownBy as FaceDownProducer;
    }
    if (compact.faceDownOf) result.faceDownOf = compact.faceDownOf as string;
    if (compact.transformed) result.transformed = true;
    if (compact.transformedFrom) {
        result.transformedFrom = compact.transformedFrom as string;
    }
    if (compact.createdBy) result.createdBy = compact.createdBy as string;
    if (compact.linkedTokenId) {
        result.linkedTokenId = compact.linkedTokenId as string;
    }
    if (compact.knownTo) result.knownTo = compact.knownTo as string[];
    if (compact.notedMana) {
        result.notedMana = compact.notedMana as CardInstanceState["notedMana"];
    }
    if (compact.castableFromExileBy) {
        result.castableFromExileBy = compact.castableFromExileBy as string;
    }
    if (compact.castableFromExileUntilTurn !== undefined) {
        result.castableFromExileUntilTurn =
            compact.castableFromExileUntilTurn as number;
    }
    if (compact.castFromExileWithoutPayingManaCost) {
        result.castFromExileWithoutPayingManaCost = true;
    }
    if (compact.castableFromExileIncludesLand) {
        result.castableFromExileIncludesLand = true;
    }
    if (compact.castFromExileManaSubstitution) {
        result.castFromExileManaSubstitution =
            compact.castFromExileManaSubstitution as ManaSubstitutionBreadth;
    }
    if (compact.castFromExileCostIncrease) {
        result.castFromExileCostIncrease =
            compact.castFromExileCostIncrease as ManaCost;
    }
    if (compact.exiledBySourceId) {
        result.exiledBySourceId = compact.exiledBySourceId as string;
    }
    if (compact.castableFromGraveyardBy) {
        result.castableFromGraveyardBy =
            compact.castableFromGraveyardBy as string;
    }
    if (compact.castableFromGraveyardUntilTurn !== undefined) {
        result.castableFromGraveyardUntilTurn =
            compact.castableFromGraveyardUntilTurn as number;
    }
    if (compact.castFromGraveyardExilesOnResolve) {
        result.castFromGraveyardExilesOnResolve = true;
    }
    if (compact.castFromGraveyardWithoutPayingManaCost) {
        result.castFromGraveyardWithoutPayingManaCost = true;
    }
    if (compact.grantedFlashback) {
        result.grantedFlashback =
            compact.grantedFlashback as CardInstanceState["grantedFlashback"];
    }
    // CR 303.4 / 704.5m — restore the runtime-granted enchant restriction; see
    // the compact side for why losing it is fatal to the Aura.
    if (compact.grantedEnchantRestriction) {
        result.grantedEnchantRestriction =
            compact.grantedEnchantRestriction as CardInstanceState["grantedEnchantRestriction"];
    }
    // CR 702.138b — restore the escaped flag on the permanent.
    if (compact.escaped) {
        result.escaped = compact.escaped as boolean;
    }
    // CR 702.35c — restore the madness-exile marker.
    if (compact.madnessExiled) {
        result.madnessExiled = compact.madnessExiled as boolean;
    }
    // CR 702.35a — restore the pending-reflexive-trigger marker.
    if (compact.madnessTriggerPending) {
        result.madnessTriggerPending = compact.madnessTriggerPending as boolean;
    }
    // CR 702.88a — restore the rebound-exile marker.
    if (compact.reboundExiled) {
        result.reboundExiled = compact.reboundExiled as boolean;
    }
    // CR 702.74a — restore the Evoke cast marker.
    if (compact.evoked) {
        result.evoked = compact.evoked as boolean;
    }
    // CR 702.109a — restore the Dash cast marker.
    if (compact.dashed) {
        result.dashed = compact.dashed as boolean;
    }
    // CR 702.103b — restore the Bestow marker, and with it the ONE part of the
    // bestow characteristic change the definition-diff cannot carry. A
    // bestowed object is an Aura enchantment with NO power or toughness
    // (CR 205.1a), so `compactCard` writes `power: undefined` — and an
    // explicit `undefined` does not survive JSON, which makes the
    // `"power" in compact` fallback above hand back the printed 1/1 instead.
    // Re-clearing here keeps the round-trip exact.
    if (compact.bestowed) {
        result.bestowed = compact.bestowed as boolean;
        delete result.power;
        delete result.toughness;
    }
    // CR 307.1 / 117.1a / 601.3a (issue #2473) — restore the "cast off
    // sorcery timing" snapshot.
    if (compact.castOffSorceryTiming) {
        result.castOffSorceryTiming = compact.castOffSorceryTiming as boolean;
    }
    // CR 106.4 / 202.3 — restore the persistent per-colour spent-mana record.
    if (compact.notedManaSpentOnCast) {
        result.notedManaSpentOnCast = compact.notedManaSpentOnCast as Record<
            string,
            number
        >;
    }
    // CR 702.33 / 614.1c (issue #1716) — restore the one-shot "was kicked"
    // marker.
    if (compact.wasKicked) {
        result.wasKicked = compact.wasKicked as boolean;
    }
    // CR 702.33 (ADR 0079, issue #1950) — restore the per-Kicker-id payment
    // record.
    if (compact.kickerPayments) {
        result.kickerPayments = compact.kickerPayments as Record<
            string,
            number
        >;
    }
    // CR 107.3 / 601.2b (issue #674) — restore the chosen {X} snapshot.
    if (compact.chosenXOnCast !== undefined) {
        result.chosenXOnCast = compact.chosenXOnCast as number;
    }
    return result;
}

/** Library cards are always default-state (CR 400.7 + `resetBattlefieldTransientState`).
 *  We compress each to `[instanceId, cardId]`; everything else is derived
 *  from the card def and the owning player. */
function compactLibrary(
    library: CardInstanceState[],
    ctx: CompactCtx
): LibraryEntry[] {
    return library.map((c) => {
        const cardId = (c.card as { id?: string }).id ?? "";
        const idx = internCardIdForCompact(ctx, cardId);
        // ADR 0026 — preserve persistent knowledge across the DB boundary;
        // omit the third element for the overwhelmingly common unknown card.
        return c.knownTo?.length
            ? ([c.id, idx, c.knownTo] as const)
            : ([c.id, idx] as const);
    });
}

function expandLibrary(
    library: (LibraryEntry | CompactCard)[],
    ownerId: string,
    ctx?: ExpandCtx
): CardInstanceState[] {
    return library.map((entry) => {
        // Backward-compat: rows written before the tuple format (≈5 weeks ago)
        // stored library cards as full compact-card objects like hand/graveyard.
        if (!Array.isArray(entry)) {
            return expandCard(
                entry as CompactCard,
                { ownerId, zone: "library" },
                ctx
            );
        }
        const [id, rawCardId, knownTo] = entry as
            | readonly [string, string | number]
            | readonly [string, string | number, string[]];
        const cardId = resolveCardId(rawCardId, ctx);
        const def = tryGetDefinition(cardId);
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
    spellsCastThisTurn?: number;
    spellsCastThisGame?: number;
    lastDrawnCardId?: string;
    drawnThisTurn?: string[];
    turnsTaken?: number;
    grantedAbilities?: PlayerState["grantedAbilities"];
    /** COUNT of pending skipped turns (CR 614.10a, issue #1957) — see
     *  `PlayerState.skipNextTurn`. Reads a legacy persisted `true` (rows
     *  written before the boolean→count migration) as 1 on expand; never
     *  written as a boolean by `compactPlayer` going forward. */
    skipNextTurn?: number | boolean;
    maxHandSizeOverride?: number | "unlimited";
    qualifyingActionThisTurn?: boolean;
    qualifyingActionLastTurn?: boolean;
    poisonCounters?: number;
    energyCounters?: number;
    experienceCounters?: number;
    permanentYouControlledLeftThisTurn?: boolean;
    /** Companion slot (CR 702.139, ADR 0064). `instance` is a fat
     *  `CardInstanceState` outside every real zone array, so it needs the
     *  SAME `compactCard`/`expandCard` coalescing as a hand/battlefield card
     *  (`card` slims to `{ id }`, types/subtypes/staticAbilities coalesce
     *  against the definition). `used` rides alongside, uncompacted (a plain
     *  boolean). */
    companion?: { instance: CompactCard; used: boolean };
};

function compactPlayer(player: PlayerState, ctx: CompactCtx): CompactPlayer {
    const out: CompactPlayer = {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: player.life,
        hand: player.hand.map((c) =>
            compactCard(c, { ownerId: player.id }, ctx)
        ),
        library: compactLibrary(player.library, ctx),
        graveyard: player.graveyard.map((c) =>
            compactCard(c, { ownerId: player.id }, ctx)
        ),
        exile: player.exile.map((c) =>
            compactCard(c, { ownerId: player.id }, ctx)
        ),
        battlefield: player.battlefield.map((c) =>
            compactCard(c, { ownerId: player.id }, ctx)
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
    if (player.spellsCastThisTurn) {
        out.spellsCastThisTurn = player.spellsCastThisTurn;
    }
    if (player.spellsCastThisGame) {
        out.spellsCastThisGame = player.spellsCastThisGame;
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
    if (player.skipNextTurn) out.skipNextTurn = player.skipNextTurn;
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
    // Energy counters (CR 122.1) — persisted so a player's energy pool survives
    // a save/load round-trip (issue #697).
    if (player.energyCounters) out.energyCounters = player.energyCounters;
    // Experience counters (CR 122.1) — persisted so a player's experience total
    // survives a save/load round-trip (issue #1969). Load-bearing beyond the
    // usual: no rule ever removes an experience counter, and CR 122.2's
    // zone-change loss is OBJECT-scoped, so this total is meant to persist for
    // the whole GAME — a drop here silently resets Otharri's scaling to zero at
    // every save point. `PlayerState` has no exhaustiveness guard (the
    // `_cardKeysExhaustive` one at the top of this file covers
    // `CardInstanceState` only), so nothing but the round-trip test in
    // `serialize.test.ts` catches an omission.
    if (player.experienceCounters) {
        out.experienceCounters = player.experienceCounters;
    }
    // Revolt (CR 702.RV) — persisted so the flag survives a save/load round-trip.
    if (player.permanentYouControlledLeftThisTurn) {
        out.permanentYouControlledLeftThisTurn = true;
    }
    if (player.companion) {
        out.companion = {
            instance: compactCard(
                player.companion.instance,
                { ownerId: player.id },
                ctx
            ),
            used: player.companion.used,
        };
    }
    return out;
}

function expandPlayer(player: CompactPlayer, ctx?: ExpandCtx): PlayerState {
    const result: PlayerState = {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: player.life,
        hand: player.hand.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "hand" }, ctx)
        ),
        library: expandLibrary(player.library, player.id, ctx),
        graveyard: player.graveyard.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "graveyard" }, ctx)
        ),
        exile: player.exile.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "exile" }, ctx)
        ),
        battlefield: player.battlefield.map((c) =>
            expandCard(c, { ownerId: player.id, zone: "battlefield" }, ctx)
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
    if (player.spellsCastThisTurn !== undefined) {
        result.spellsCastThisTurn = player.spellsCastThisTurn;
    }
    if (player.spellsCastThisGame !== undefined) {
        result.spellsCastThisGame = player.spellsCastThisGame;
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
    // issue #1957 — boolean→count migration: a legacy persisted `true`
    // (written before this change) reads as 1 pending skip; a current-format
    // numeric count is passed through verbatim.
    if (player.skipNextTurn) {
        result.skipNextTurn =
            typeof player.skipNextTurn === "number" ? player.skipNextTurn : 1;
    }
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
    if (player.energyCounters) result.energyCounters = player.energyCounters;
    if (player.experienceCounters) {
        result.experienceCounters = player.experienceCounters;
    }
    if (player.permanentYouControlledLeftThisTurn) {
        result.permanentYouControlledLeftThisTurn = true;
    }
    if (player.companion) {
        result.companion = {
            // CR 702.139 (ADR 0064) — the companion slot is NOT a real zone;
            // `zone` is a nominal tag only (`CardInstanceState` requires one).
            // "exile" is the closest existing zone semantically ("outside the
            // game", never battlefield/hand/library/graveyard/stack) — no
            // zone-enumerating code ever reads `player.exile` to find it, since
            // the instance lives on the dedicated `player.companion` field, not
            // in any zone array.
            instance: expandCard(
                player.companion.instance,
                { ownerId: player.id, zone: "exile" },
                ctx
            ),
            used: player.companion.used,
        };
    }
    return result;
}

function compactStackItem(item: StackItem, ctx: CompactCtx): CompactCard {
    const base = compactCard(item, { ownerId: item.ownerId }, ctx);
    base.ownerId = item.ownerId;
    base.castById = item.castById;
    if (item.targets?.length) base.targets = item.targets;
    if (item.chosenX !== undefined) base.chosenX = item.chosenX;
    // CR 702.33 — persist the PER-KICKER payment record so an "if this spell was
    // kicked" resolution (Overload, Burst Lightning, Everflowing Chalice's ETB
    // counters) and a per-Kicker intervening-if ("if it was kicked with its
    // {2}{U} kicker", ADR 0079) both survive a DB round-trip while the spell
    // sits on the stack. A plain `Record<string, number>`, so it round-trips as
    // raw JSON like `targetAmounts` below.
    if (item.kickerPayments) base.kickerPayments = item.kickerPayments;
    if (item.targetAmounts) base.targetAmounts = item.targetAmounts;
    if (item.chosenModeId) base.chosenModeId = item.chosenModeId;
    if (item.additionalSacrificeSnapshot) {
        base.additionalSacrificeSnapshot = item.additionalSacrificeSnapshot;
    }
    // CR 106.10 — noted-mana battery: the mana spent on the activation must
    // survive a save/load while the ability is on the stack waiting to resolve.
    if (item.notedManaSpent && Object.keys(item.notedManaSpent).length > 0) {
        base.notedManaSpent = item.notedManaSpent;
    }
    if (item.abilityId) base.abilityId = item.abilityId;
    if (item.grantedSourceCardId) {
        base.grantedSourceCardId = item.grantedSourceCardId;
    }
    if (item.triggeredAbilityId) {
        base.triggeredAbilityId = item.triggeredAbilityId;
    }
    if (item.triggerSourceId) base.triggerSourceId = item.triggerSourceId;
    // CR 608.2h / 113.7a (issue #2042) — the departure-time LKI snapshot of
    // this trigger's source permanent must survive a save taken while the
    // trigger sits on the stack (a pending choice between the blink and the
    // trigger's resolution is a stable save point). Without it the reloaded
    // item falls back to the live same-id permanent and the CR 603.4
    // intervening-if re-check reads the wrong object again. Recurses through
    // `compactCard`, exactly like `stormSnapshot` recurses through
    // `compactStackItem`, so it never ships a fat card def.
    if (item.sourceLki) {
        const lki = compactCard(
            item.sourceLki,
            { ownerId: item.sourceLki.ownerId },
            ctx
        );
        // `compactCard` omits `ownerId` when it equals the `opts` owner, so
        // force-write it: the snapshot is a standalone record with no
        // containing zone to imply an owner (same trick `compactStackItem`
        // uses for the stack item itself, two lines into this function).
        lki.ownerId = item.sourceLki.ownerId;
        base.sourceLki = lki;
    }
    if (item.triggerEvent) base.triggerEvent = item.triggerEvent;
    // CR 603.3b (issue #2954) — a `oncePerEventBatch` trigger's full firing
    // batch must survive a save taken while the trigger sits on the stack (a
    // pending "copy one of them" choice is a stable save point); without it the
    // reloaded item collapses back to `triggerEvent`'s first member and the
    // resolver copies the wrong creature.
    if (item.triggerEventBatch) {
        base.triggerEventBatch = item.triggerEventBatch;
    }
    // CR 114 — an emblem-sourced trigger resolves its effect from the emblem
    // registry keyed by `emblemSourceId` (`resolveTopOfStack`, state.ts). It
    // must survive a save/load while the trigger sits on the stack awaiting
    // target selection / priority — else the reloaded item fails the
    // `emblemSourceId` guard and resolves dealing NOTHING (Chandra, Torch of
    // Defiance −7 emblem: "deal 5 damage to any target" silently dealt 0).
    if (item.emblemSourceId) base.emblemSourceId = item.emblemSourceId;
    // CR 122 / 603.3 (issue #1189) — the per-item "already tallied" guard
    // must survive a DB round-trip while a suspended triggered ability
    // (Scythecat Cub's target pick) sits on the stack, or a save/resume would
    // re-tally the resolution on resume and read the wrong escalation branch.
    if (item.abilityResolutionRecorded) {
        base.abilityResolutionRecorded = item.abilityResolutionRecorded;
    }
    // CR 702.35a — the reflexive Madness cast-trigger marker (the exiled card's
    // id) must survive a save/load while the trigger sits on the stack.
    if (item.madnessTrigger) base.madnessTrigger = item.madnessTrigger;
    // CR 702.88a — the reflexive Rebound cast-trigger marker (the exiled card's
    // id) must survive a save/load while the trigger sits on the stack.
    if (item.reboundTrigger) base.reboundTrigger = item.reboundTrigger;
    // Storm (CR 702.40, ADR 0052) — the cast-trigger's detached snapshot and
    // remaining-copies counter must survive a save/load while the trigger
    // sits on the stack awaiting priority (or a per-copy retarget answer).
    // The snapshot is itself a full StackItem, so it recurses through this
    // same compactor rather than duplicating its field list.
    if (item.stormSnapshot) {
        base.stormSnapshot = compactStackItem(item.stormSnapshot, ctx);
    }
    if (item.stormCopiesRemaining !== undefined) {
        base.stormCopiesRemaining = item.stormCopiesRemaining;
    }
    if (item.delayedTriggerId) base.delayedTriggerId = item.delayedTriggerId;
    if (item.delayedPayload) base.delayedPayload = item.delayedPayload;
    // ADR 0048 — an inline delayed-trigger body (pure JSON) must survive a
    // save while the fired trigger sits on the stack awaiting priority.
    if (item.delayedEffects) base.delayedEffects = item.delayedEffects;
    if (item.delayedOracleText) base.delayedOracleText = item.delayedOracleText;
    // CR 725 (issue #1305) — a source-less inherent designation trigger (the
    // Monarch's end-step draw) keys its marker-card art + name off this id; it
    // must survive a save while the trigger sits on the stack, or the client
    // falls back to the empty "Token"/"Delayed trigger" placeholder.
    if (item.designationId) base.designationId = item.designationId;
    // Per-source marker art override (issue #1305) — must survive a save so the
    // themed Monarch tile keeps the granting card's printing after a reload.
    if (item.designationImagePrintId) {
        base.designationImagePrintId = item.designationImagePrintId;
    }
    // CR 603.12/603.3d — a reflexive trigger sits on the stack awaiting
    // priority like any other; its marker and its inline target requirement
    // must survive a save taken while it is there (the requirement is what
    // `raiseTriggerTargetSelection` re-reads if targeting is still owed).
    if (item.reflexiveTrigger) base.reflexiveTrigger = item.reflexiveTrigger;
    if (item.inlineTargetRequirement) {
        base.inlineTargetRequirement = item.inlineTargetRequirement;
    }
    if (item.resolutionStep !== undefined) {
        base.resolutionStep = item.resolutionStep;
    }
    if (item.collectedChoices) base.collectedChoices = item.collectedChoices;
    if (item.massRiderTargets?.length) {
        base.massRiderTargets = item.massRiderTargets;
    }
    if (item.isCopy) base.isCopy = item.isCopy;
    if (item.exileOnResolve) base.exileOnResolve = item.exileOnResolve;
    // CR 702.27a — persist the Buyback-paid flag so the "return to hand
    // instead of the graveyard" resolution redirect survives a DB round-trip
    // while the spell sits on the stack.
    if (item.buybackPaid) base.buybackPaid = item.buybackPaid;
    // issue #898 — persist the self-shuffle-into-library redirect flag so a
    // mid-resolution save (suspended on a choice) survives a DB round-trip.
    if (item.shuffleIntoLibraryOnResolve) {
        base.shuffleIntoLibraryOnResolve = item.shuffleIntoLibraryOnResolve;
    }
    // CR 702.34 — persist the Flashback cast marker so an "if this spell was
    // cast from a graveyard" resolution (Sevinne's Reclamation) survives a DB
    // round-trip mid-resolution.
    if (item.castFromGraveyard) base.castFromGraveyard = item.castFromGraveyard;
    // CR 702.88a — persist the Rebound from-hand marker so the exile
    // redirect + delayed-trigger scheduling survives a DB round-trip
    // mid-resolution.
    if (item.reboundFromHand) base.reboundFromHand = item.reboundFromHand;
    // Acting Player (ADR 0037): persist the controlled-cast override so a
    // suspended Word of Command resolution survives a DB round-trip.
    if (item.actingPlayerId) base.actingPlayerId = item.actingPlayerId;
    // CR 106.6 / 701.13 (issue #1559, Delighted Halfling) — persist the
    // per-cast "can't be countered" rider so it survives the save taken
    // immediately after cast (before the opponent gets priority to counter).
    // Without this, `counter()` never sees the flag on a reloaded stack item.
    if (item.dynamicCantBeCountered) {
        base.dynamicCantBeCountered = item.dynamicCantBeCountered;
    }
    return base;
}

function expandStackItem(compact: CompactCard, ctx?: ExpandCtx): StackItem {
    const ownerId = compact.ownerId as string;
    const base = expandCard(compact, { ownerId, zone: "stack" }, ctx);
    const item: StackItem = {
        ...base,
        castById: compact.castById as string,
    };
    if (compact.targets) {
        item.targets = compact.targets as StackItem["targets"];
    }
    if (compact.chosenX !== undefined) item.chosenX = compact.chosenX as number;
    if (compact.kickerPayments) {
        item.kickerPayments = compact.kickerPayments as Record<string, number>;
    }
    if (compact.targetAmounts) {
        item.targetAmounts = compact.targetAmounts as Record<string, number>;
    }
    if (compact.chosenModeId)
        item.chosenModeId = compact.chosenModeId as string;
    if (compact.additionalSacrificeSnapshot) {
        item.additionalSacrificeSnapshot =
            compact.additionalSacrificeSnapshot as StackItem["additionalSacrificeSnapshot"];
    }
    if (compact.notedManaSpent) {
        item.notedManaSpent = compact.notedManaSpent as Record<string, number>;
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
    // CR 608.2h / 113.7a (issue #2042) — rehydrate the source's departure-time
    // LKI snapshot. `zone: "battlefield"` because the snapshot is by
    // construction the permanent as it last sat on the battlefield.
    if (compact.sourceLki) {
        item.sourceLki = expandCard(
            compact.sourceLki as CompactCard,
            {
                ownerId: (compact.sourceLki as CompactCard).ownerId as string,
                zone: "battlefield",
            },
            ctx
        );
    }
    if (compact.triggerEvent) {
        item.triggerEvent = compact.triggerEvent as StackItem["triggerEvent"];
    }
    // CR 603.3b (issue #2954) — rehydrate the full firing batch.
    if (compact.triggerEventBatch) {
        item.triggerEventBatch =
            compact.triggerEventBatch as StackItem["triggerEventBatch"];
    }
    if (compact.emblemSourceId) {
        item.emblemSourceId = compact.emblemSourceId as string;
    }
    if (compact.abilityResolutionRecorded) {
        item.abilityResolutionRecorded =
            compact.abilityResolutionRecorded as boolean;
    }
    // CR 702.35a — restore the reflexive Madness cast-trigger marker.
    if (compact.madnessTrigger) {
        item.madnessTrigger = compact.madnessTrigger as string;
    }
    // CR 702.88a — restore the reflexive Rebound cast-trigger marker.
    if (compact.reboundTrigger) {
        item.reboundTrigger = compact.reboundTrigger as string;
    }
    // Storm (CR 702.40, ADR 0052) — rehydrate the cast-trigger's detached
    // snapshot (recursing through this same expander) and remaining-copies
    // counter.
    if (compact.stormSnapshot) {
        item.stormSnapshot = expandStackItem(
            compact.stormSnapshot as CompactCard,
            ctx
        );
    }
    if (compact.stormCopiesRemaining !== undefined) {
        item.stormCopiesRemaining = compact.stormCopiesRemaining as number;
    }
    if (compact.delayedTriggerId) {
        item.delayedTriggerId = compact.delayedTriggerId as string;
    }
    if (compact.delayedPayload) {
        item.delayedPayload = compact.delayedPayload as Record<string, string>;
    }
    // ADR 0048 — rehydrate the inline delayed-trigger body.
    if (compact.delayedEffects) {
        item.delayedEffects =
            compact.delayedEffects as StackItem["delayedEffects"];
    }
    if (compact.delayedOracleText) {
        item.delayedOracleText = compact.delayedOracleText as string;
    }
    // CR 725 (issue #1305) — rehydrate the designation-marker id so the
    // Monarch's on-stack draw keeps its marker art after a save/load.
    if (compact.designationId) {
        item.designationId = compact.designationId as string;
    }
    if (compact.designationImagePrintId) {
        item.designationImagePrintId =
            compact.designationImagePrintId as string;
    }
    // CR 603.12/603.3d — restore the reflexive-trigger marker and its inline
    // target requirement.
    if (compact.reflexiveTrigger) {
        item.reflexiveTrigger = compact.reflexiveTrigger as boolean;
    }
    if (compact.inlineTargetRequirement) {
        item.inlineTargetRequirement =
            compact.inlineTargetRequirement as StackItem["inlineTargetRequirement"];
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
    if (compact.massRiderTargets) {
        item.massRiderTargets = compact.massRiderTargets as string[];
    }
    if (compact.isCopy) item.isCopy = compact.isCopy as boolean;
    if (compact.exileOnResolve) {
        item.exileOnResolve = compact.exileOnResolve as boolean;
    }
    if (compact.buybackPaid) {
        item.buybackPaid = compact.buybackPaid as boolean;
    }
    if (compact.shuffleIntoLibraryOnResolve) {
        item.shuffleIntoLibraryOnResolve =
            compact.shuffleIntoLibraryOnResolve as boolean;
    }
    if (compact.castFromGraveyard) {
        item.castFromGraveyard = compact.castFromGraveyard as boolean;
    }
    if (compact.reboundFromHand) {
        item.reboundFromHand = compact.reboundFromHand as boolean;
    }
    // CR 702.138b — rehydrate the escaped marker mid-resolution so the resulting
    // permanent still reads as having escaped.
    if (compact.escaped) {
        item.escaped = compact.escaped as boolean;
    }
    // Acting Player (ADR 0037) — rehydrate the controlled-cast override.
    if (compact.actingPlayerId) {
        item.actingPlayerId = compact.actingPlayerId as string;
    }
    // CR 106.6 / 701.13 (issue #1559, Delighted Halfling) — rehydrate the
    // per-cast "can't be countered" rider.
    if (compact.dynamicCantBeCountered) {
        item.dynamicCantBeCountered = compact.dynamicCantBeCountered as boolean;
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
    // CR 116.2 / 702.139a (ADR 0064) — the {3} companion-summon payment.
    // Plain scalars (playerId/manaCost/tappedLandIds), no fat card refs, so
    // it round-trips via the generic optional-key loop with no per-field
    // compaction, exactly like pendingCast/pendingActivation.
    "pendingCompanionPay",
    "pendingTarget",
    "pendingChoices",
    // CR 603.3b / ADR 0058 — the off-stack simultaneous-trigger batch held while
    // its controllers order it. A pending `trigger-order` choice is a stable save
    // point, so the batch must survive a DB round-trip (round-trips as raw JSON —
    // its StackItems already carry `card: { id }`, no fat defs).
    "pendingTriggerBatch",
    // CR 603.12 — reflexive triggered abilities queued by a still-resolving
    // effect. Normally drained at the end of the resolution that made them,
    // but a script can suspend on a player choice AFTER its `reflexiveTrigger`
    // Op ran — a stable save point with the queue non-empty — so it must
    // round-trip. Raw JSON, same shape as `pendingTriggerBatch`.
    "pendingReflexiveTriggers",
    "pendingReveals",
    "autoPassPlayers",
    "singleShotAutoPass",
    "queuedEndTurn",
    "combat",
    "nextGrantSeq",
    "mulligan",
    "gameOver",
    "extraTurns",
    "extraPhases",
    "extraCombatsThisTurn",
    "preventionEffects",
    "targetPreventionShields",
    "preventionTallies",
    "playerDamagePrevention",
    "delayedTriggers",
    "nextDelayedSeq",
    "nextTokenSeq",
    "emblems",
    "nextEmblemSeq",
    "nextWorldSeq",
    "nextInstanceId",
    "pendingEvents",
    "deathsThisTurn",
    // Storm (CR 702.40a, ADR 0052) — the per-turn spell tally must survive a
    // DB round-trip while the turn is in progress (e.g. saved mid-priority
    // between two casts).
    "spellsCastThisTurn",
    "pendingUntapStep",
    "pendingCleanupDiscard",
    // CR 514.3a (issue #2472) — the "another cleanup step begins" obligation.
    // Set while the cleanup step's one priority window is open (itself a stable
    // save point), so it must survive the DB round-trip; undefined otherwise.
    "pendingExtraCleanupStep",
    // CR 514.3a (issue #2472) — the turn whose once-per-turn cleanup
    // bookkeeping already ran. Read on every subsequent cleanup step of the
    // same turn, and the 514.3a window between them spans mutations, so it
    // must survive the DB round-trip.
    "cleanupBookkeepingTurn",
    // CR 702.35a — the open Madness cast window. Transiently set only while its
    // owner owes a cast-or-decline decision (itself a stable save point), so it
    // must survive the DB round-trip. Undefined at a fully-resolved point.
    "madnessCastWindow",
    // CR 702.88a — the open Rebound cast window. Transiently set only while
    // its caster owes a cast-or-decline decision (itself a stable save
    // point), so it must survive the DB round-trip. Undefined at a
    // fully-resolved point.
    "reboundCastWindow",
    "damageDealtToPlayerThisTurn",
    "artifactDamageToPlayerThisTurn",
    // CR 119.3 per-turn life-gain tally (issue #1457) — read by "if you gained
    // life this turn" intervening-ifs at any later point in the SAME turn, so
    // it must survive every stable-point DB round-trip within the turn.
    "lifeGainedThisTurn",
    "damageRedirections",
    "combatBlockRestrictions",
    "camouflageCombat",
    "meleeCombat",
    "playerPreferences",
    "landPlayLocked",
    "preventAllCombatDamageThisTurn",
    "sourcePreventionShields",
    "cannotCastSpellsThisTurn",
    "cannotActivateAbilitiesThisTurn",
    "combatDamageRedirectToPermanent",
    "gazeOfPainActiveThisTurn",
    "landManaReplacedToBlueThisTurn",
    "highTideThisTurn",
    "landManaRidersThisTurn",
    "damageCapShields",
    "islandSanctuaryProtection",
    "playerProtectionFromEverything",
    "castTimingFlashGrants",
    "spellManaSubstitutionGrants",
    "allCreaturesMustAttack",
    "abilityResolutionCounts",
    "destroyReplacementShields",
    "graveyardBoundRedirectThisTurn",
    "graveyardPlayPermissionThisTurn",
    "graveyardPermanentCastUsedThisTurn",
    "combatDamageImmunity",
    "damageTriggeredLifegain",
    "phasedOut",
    "exileHeld",
    // CR 720 (issue #1199) — the Monarch designation. `monarchId` is a plain
    // string scalar and `monarchReturnWatch` (Palace Jailer) is pure metadata
    // (sourceId/controllerId strings, no fat card refs) — both round-trip via
    // the generic optional-key loop with no per-field compaction needed.
    "monarchId",
    "monarchReturnWatch",
    // CR 702.131 (Ascend, issue #1460) — the City's Blessing designation.
    // `cityBlessingIds` is a plain array of player-id strings (no fat card
    // refs); it round-trips via the generic optional-key loop. MONOTONIC — once
    // a player is in the set they stay for the rest of the game — so it must
    // survive every DB write, exactly like `monarchId`.
    "cityBlessingIds",
    // Cosmetic crown provenance (issue #1305) — a plain string scalar keying
    // the end-step draw tile's themed marker art; round-trips generically.
    "monarchSourceCardId",
    // CR 614.1c / 614.12a (ADR 0100 D2) — permanents held off every zone while
    // their controller owes an "as it enters" choice (the CR 303.4f Aura host
    // pick among them). Transiently non-empty only while a matching choice is
    // pending (which is itself a stable save point), so it must survive the DB
    // round-trip. Empty (undefined) at a fully-resolved point. Carries a FAT
    // card, so it has per-field compact/rehydrate halves below — the generic
    // loop alone would store the definition raw and never re-register it.
    "stagedEntries",
    "drawLookReplacements",
    // ADR 0047 — authoritative Expected Input. Plain-data discriminated union,
    // so it round-trips through the DB as-is.
    "expectedInput",
    // CR 504.1 (issue #1097 — Elfhame Sanctuary) — a one-shot per-player
    // draw-step-skip flag, armed at upkeep and consumed at that player's own
    // draw step LATER THE SAME TURN. A save/load between the two must not
    // lose it (a plain string[] of player ids, no fat card refs — round-trips
    // via the generic optional-key loop with no per-field compaction).
    "skipDrawStepThisTurn",
    // CR 506.3 / 508.1 — "a creature attacked this turn" (a plain boolean),
    // read at the end step by Keldon Twilight's CR 603.4 intervening-if. The
    // save point between attacker declaration and the end step is several
    // priority rounds wide, so losing it across the DB write would silently
    // re-arm the trigger on a turn where combat happened.
    "creatureAttackedThisTurn",
    // Control continuity (`gre/controlContinuity.ts`) — the turn-scoped ledger
    // of instance ids whose controller changed this turn. A plain string[] of
    // instance ids, no fat card refs, so it round-trips through the generic
    // optional-key loop. It cannot be reconstructed after the fact (the control
    // change has already happened and may even have been reverted), so dropping
    // it across a write would silently widen what may be sacrificed.
    "controlChangedThisTurn",
    // CR 608.2h / 111.12 (ADR 0086) — last known copiable values of recently
    // departed permanents. Listed here so the drift guard is satisfied and the
    // generic loop carries it, but the value it stores raw is OVERWRITTEN
    // below by a compacted form: the entry's definition id goes through the v2
    // cardId string table (issue #1780) rather than embedding a raw uuid per
    // departure in the hottest row in the system.
    "lastKnownCopiable",
    // ADR 0082 / PRD #2064 — the Continuous Effects Registry. PERSISTED, and
    // the choice is forced rather than conventional: an entry whose expiry is
    // `duration` or `indefinite` is the residue of a spell that has already
    // resolved and left (CR 611.2a), so there is NO source on any zone from
    // which a load could rebuild it. Dropping the key across a write would
    // silently end every until-end-of-turn pump and every "loses all
    // abilities" the game had in effect. A plain-data array by construction —
    // payloads reference a card definition's `staticEffects[]` by
    // `(sourceCardId, effectIndex)` and never embed a closure
    // (`gre/continuousEffects.ts`) — so it round-trips through the generic
    // optional-key loop with no per-field compaction.
    "continuousEffects",
] as const;

/** Optional GameState keys that are intentionally ephemeral — never
 *  persisted to the DB. The schema drift guard test accepts keys in this
 *  set without requiring them in PERSISTED_OPTIONAL_KEYS. */
export const TRANSIENT_KEYS = new Set<string>([]);

/** Pack a GameState into the slim Convex-storage form. Always writes v2
 *  (issue #1780 — token spec interning + cardId string table); there is no
 *  code path left that writes the legacy v1 shape. */
export function compactState(state: GameState): Record<string, unknown> {
    const ctx: CompactCtx = {
        pool: makeCardPool(),
        tokens: makeTokenSpecPool(),
    };
    const out: Record<string, unknown> = {
        players: state.players.map((p) => compactPlayer(p, ctx)),
        stack: state.stack.map((s) => compactStackItem(s, ctx)),
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
                ...compactCard(c, { ownerId: c.ownerId }, ctx),
                ownerId: c.ownerId,
            })),
        }));
    }
    // CR 614.1c / 614.12a (ADR 0100 D2) — a staged entry holds a FULL card
    // object off every zone. Same treatment as `phasedOut` above and for the
    // same reason: the generic loop stored it raw, so its fat `card` never went
    // through `compactCard` and the definition would not be re-registered on
    // expand. `ownerId` rides explicitly — a staged entry has no surrounding
    // player to default it from.
    //
    // An `origin: "spell"` entry IS a `StackItem` (the parked permanent spell
    // itself — `finalizeSpellResolution` stages the popped item), so it goes
    // through `compactStackItem`, not `compactCard`: the latter is a WHITELIST
    // and would silently drop `castById`, `targets`, `chosenX`,
    // `kickerPayments`, `targetAmounts`, `additionalSacrificeSnapshot`,
    // `notedManaSpent` and `isCopy`. A pending choice is a stable save point,
    // so this round-trip is the normal case, not an edge one — and a lost
    // `castById` throws `Player not found: undefined` out of the entry tail
    // (`finalizeSpellResolution`) the moment the choice is answered.
    if (state.stagedEntries?.length) {
        out.stagedEntries = state.stagedEntries.map((e) => ({
            ...e,
            card:
                e.origin === "spell"
                    ? compactStackItem(e.card as StackItem, ctx)
                    : {
                          ...compactCard(
                              e.card,
                              { ownerId: e.card.ownerId },
                              ctx
                          ),
                          ownerId: e.card.ownerId,
                      },
        }));
    }
    // CR 608.2h / 111.12 (ADR 0086) — the LKI copiable-values store. The
    // generic optional-key loop above wrote it raw; overwrite with the
    // compacted form so each entry's definition id is a cardPool INDEX, not a
    // repeated uuid (issue #1780). Every departure this turn and last writes
    // one entry into the row every mutation rewrites, so the per-entry cost is
    // the whole point: `{ d: 12, t: 7 }` rather than a 36-char id.
    //
    // A token's id is a long content-derived `token:...` string, which is
    // exactly what `internCardIdForCompact` interns to a short handle first —
    // so the token case, the one the CR 704.5d sweep makes this store
    // necessary for, is also the one that compacts best.
    if (state.lastKnownCopiable && !isPlainEmpty(state.lastKnownCopiable)) {
        const packed: Record<string, unknown> = {};
        for (const [id, entry] of Object.entries(state.lastKnownCopiable)) {
            packed[id] = {
                d: internCardIdForCompact(ctx, entry.defId),
                t: entry.turn,
                ...(entry.copyExcept ? { e: entry.copyExcept } : {}),
            };
        }
        out.lastKnownCopiable = packed;
    }
    // Layers 4/5 (issue #1780) — every card compacted above ran through
    // `ctx`, so `ctx.pool`/`ctx.tokens` are now fully populated. `v: 2` is
    // the version marker `expandState` branches on; `tokenSpecs` is omitted
    // entirely when the document has no tokens (the overwhelmingly common
    // case), same convention as every other optional key in this file.
    out.v = 2;
    out.cardPool = ctx.pool.list;
    if (ctx.tokens.count > 0) out.tokenSpecs = ctx.tokens.map;
    return out;
}

/** Expand the slim Convex-storage form back into a full GameState. A `v: 2`
 *  document (issue #1780) resolves `card.id` through the per-document
 *  cardPool/tokenSpecs tables; a legacy document (no `v` field) is expanded
 *  exactly as before this change — `card.id` is already the real string. */
export function expandState(data: Record<string, unknown>): GameState {
    const ctx: ExpandCtx | undefined =
        data.v === 2
            ? {
                  pool: (data.cardPool as string[] | undefined) ?? [],
                  tokens:
                      (data.tokenSpecs as Record<string, string> | undefined) ??
                      {},
              }
            : undefined;
    const players = (data.players as CompactPlayer[]).map((p) =>
        expandPlayer(p, ctx)
    );
    const result: GameState = {
        players,
        stack: (data.stack as CompactCard[]).map((s) =>
            expandStackItem(s, ctx)
        ),
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
    // CR 608.2h / 111.12 (ADR 0086) — mirror of `compactState`: the generic
    // loop above installed the COMPACT form (pooled definition indices), so
    // rebuild the real entries. A legacy row that predates this key simply has
    // nothing here.
    const compactLki = data.lastKnownCopiable as
        | Record<
              string,
              {
                  d: unknown;
                  t: number;
                  e?: { basePower?: number; baseToughness?: number };
              }
          >
        | undefined;
    if (compactLki) {
        const unpacked: NonNullable<GameState["lastKnownCopiable"]> = {};
        for (const [id, entry] of Object.entries(compactLki)) {
            unpacked[id] = {
                defId: resolveCardId(entry.d, ctx),
                turn: entry.t,
                ...(entry.e ? { copyExcept: entry.e } : {}),
            };
        }
        result.lastKnownCopiable = unpacked;
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
                expandCard(
                    c,
                    {
                        ownerId: (c.ownerId as string | undefined) ?? "",
                        zone: "battlefield",
                    },
                    ctx
                )
            ),
        })) as GameState["phasedOut"];
    }
    // CR 614.1c / 614.12a (ADR 0100 D2) — rehydrate staged entries (mirror of
    // `compactState`). The zone is `"stack"`, NOT `phasedOut`'s
    // `"battlefield"`: a staged permanent has NOT entered the battlefield —
    // that is the whole point of the park, and hydrating it as a battlefield
    // permanent would be the one lie the SBA/layer readers could act on if the
    // value ever leaked. `"stack"` is the nearest honest "in transit, in no
    // player's zone array" value; every entry tail overwrites `.zone` as the
    // permanent actually enters (`stageReanimatedOnBattlefield`,
    // `finalizeSpellResolution`, `finishTokenEntry`), so the hydrated value is
    // never read as a location.
    const compactStaged = data.stagedEntries as
        | {
              card: CompactCard & { ownerId?: string };
              origin?: string;
              [key: string]: unknown;
          }[]
        | undefined;
    if (compactStaged) {
        result.stagedEntries = compactStaged.map((e) => ({
            ...e,
            // Mirror of `compactState`: the spell row rehydrates through
            // `expandStackItem` so the parked permanent SPELL comes back with
            // its cast-time bookkeeping (`castById` above all — the entry tail
            // reads it) intact. `expandStackItem` already hydrates with
            // `zone: "stack"`, the same honest "in transit, in no player's zone
            // array" value the effect/token rows use below.
            card:
                e.origin === "spell"
                    ? expandStackItem(e.card, ctx)
                    : expandCard(
                          e.card,
                          { ownerId: e.card.ownerId ?? "", zone: "stack" },
                          ctx
                      ),
        })) as GameState["stagedEntries"];
    }
    backfillLegacyStaticSeq(result);
    return result;
}

/** One (field, id-key) pair per CR 613.7-timestamped layer-4/6 record a
 *  continuous-effect SOURCE can own on some OTHER permanent's card state
 *  (`gre/state.ts`'s `applySourceStaticEffects`). `idKey` is whichever field
 *  the record uses to name its owning source: `auraId` for the four record
 *  kinds that ALSO serve non-static-effect grant paths (duration-, counter-
 *  or resolving-ability-sourced, none of which can ever name a legacy
 *  battlefield card's id), `sourceId` for the three written only by a
 *  continuous static effect. Shared between `backfillLegacyStaticSeq`'s
 *  order-mining pass and its stamping pass so the two can never drift apart
 *  on which record kinds are in scope. */
const LEGACY_SEQ_RECORD_SPECS: {
    field:
        | "grantedStaticAbilities"
        | "grantedActivatedAbilities"
        | "grantedTriggeredAbilities"
        | "removedKeywords"
        | "abilitiesSuppressedBy"
        | "grantedSubtypes"
        | "grantedSubtypesAdd";
    idKey: "sourceId" | "auraId";
}[] = [
    { field: "grantedStaticAbilities", idKey: "auraId" },
    { field: "grantedActivatedAbilities", idKey: "auraId" },
    { field: "grantedTriggeredAbilities", idKey: "auraId" },
    { field: "removedKeywords", idKey: "sourceId" },
    { field: "abilitiesSuppressedBy", idKey: "sourceId" },
    { field: "grantedSubtypes", idKey: "sourceId" },
    { field: "grantedSubtypesAdd", idKey: "auraId" },
];

/** Reads one record array off `card` loosely-typed — every shape in
 *  `LEGACY_SEQ_RECORD_SPECS` is a plain `{ [idKey]: string, seq?: number,
 *  ... }[]`, but they don't share a common TS interface, so this is the one
 *  place that casts through `Record<string, unknown>` rather than scattering
 *  the cast at every call site. */
function legacySeqRecords(
    card: CardInstanceState,
    field: (typeof LEGACY_SEQ_RECORD_SPECS)[number]["field"]
): Record<string, unknown>[] {
    return (
        (card as unknown as Record<string, Record<string, unknown>[]>)[field] ??
        []
    );
}

/** CR 613.7 (issue #1750, part c) — backfill `staticSeq` for every
 *  battlefield card saved before issue #1715/#1730 introduced the field.
 *  `expandState` is the ONE place that sees a freshly-loaded board before any
 *  SBA pass touches it, so this is also the only place that can fix the
 *  order ONCE rather than let it drift.
 *
 *  Without this, an undated card reads via `?? 0` everywhere the timestamp is
 *  consulted (`composeMaterializedSubtypes`, the `keyword-grant`
 *  `outrankedBy` check) — harmless AS LONG AS it stays undated, since every
 *  other undated card ties with it the same way. The moment ONE of them is
 *  next touched by `refreshCounterGatedStatics` (any counter- or
 *  condition-gated static effect), `applySourceStaticEffects`'s
 *  `preserveTimestamp && source.staticSeq !== undefined` guard is false, so
 *  it mints a BRAND NEW timestamp — the current board's highest — jumping
 *  that one card from "tied earliest with everyone else" to "strictly
 *  latest" while its still-untouched neighbours stay at 0. That is a real
 *  reorder, not a restamp: two sources that agreed before now disagree, and
 *  WHICH one gets refreshed first (an SBA-pass accident, not a rule) decides
 *  the outcome (Cyclopean Tomb + Blood Moon on a mired nonbasic land: the
 *  land's type flips between "Mountain" and "Swamp" depending on how many
 *  SBA passes have run since load).
 *
 *  Fix: give every undated SOURCE an EXPLICIT, stable timestamp before
 *  anything can read `?? 0` for it — AND stamp every layer-4/6 RECORD that
 *  source already owns on any target with that same value (issue #1750
 *  round 2). A card-level restamp alone is not enough: those records
 *  (`grantedSubtypes[].seq` etc., see `LEGACY_SEQ_RECORD_SPECS`) are what
 *  `composeMaterializedSubtypes` / the `keyword-grant` `outrankedBy` check
 *  actually read, and `applySourceStaticEffects`'s `already = grants.some(g
 *  => g.sourceId === source.id)` guard means a plain re-apply never revisits
 *  an existing record to fix its `seq` — only a full unapply+reapply
 *  (`refreshCounterGatedStatics`) replaces the entry, and by then it copies
 *  the NEW `staticSeq` this pass assigns. Left unstamped, a record kept
 *  reading `?? 0` = tied-earliest even after its owning source stopped being
 *  tied — exactly the bug this function exists to remove, just moved one
 *  layer down.
 *
 *  Assigned NEGATIVE, strictly increasing — negative so a backfilled
 *  (necessarily pre-#1730) source always sorts BEFORE any card that already
 *  carries a real (non-negative) timestamp. `allocStaticTimestamp`
 *  (`gre/state.ts`) is untouched by this choice: it only ever takes a MAX
 *  over live `staticSeq`/grant `seq` values, so a negative backfilled value
 *  never collides with, or gets exceeded by, a freshly-minted one.
 *
 *  **Order is mined from the surviving RECORD evidence, not battlefield
 *  encounter order (CR 613.7a/613.7m).** Battlefield order is player-major
 *  (`for (player of state.players) for (card of player.battlefield)`), which
 *  dates every permanent of the FIRST player strictly before every permanent
 *  of the SECOND — never a real CR 613.7a application order across two
 *  players. What DOES survive a legacy blob is each target's layer-4/6
 *  record ARRAY order: every write site pushes onto a target's record list
 *  at the moment its source applies, so two sources that both touch the same
 *  target leave their relative apply order encoded in that array's element
 *  order, whatever timestamps did or didn't exist at the time. This pass
 *  mines that evidence into a partial order (Kahn's topological sort over
 *  "consecutive entries in the same target's record array" edges) and falls
 *  back to battlefield encounter order ONLY to break a tie between two
 *  sources with no surviving record to order them against each other (a
 *  source whose static effects never touch a shared target, or a
 *  first-ever load with no records at all).
 *
 *  **Gated on `getEffectiveStaticEffects` being non-empty** — the SAME
 *  condition `applySourceStaticEffects` itself early-returns on
 *  (`effects.length === 0`). The overwhelming majority of battlefield cards
 *  (a vanilla creature, a basic land) never author a `staticSeq` at all —
 *  not because they are legacy, but because nothing ever asks them to order
 *  against anything. Backfilling those too is not just unnecessary, it is a
 *  live bug: `compactState` never persists a `staticSeq` a card doesn't
 *  have, so backfilling every seq-less card unconditionally would stamp a
 *  fresh, made-up timestamp onto EVERY plain permanent on EVERY load,
 *  failing the compact/expand round-trip for ordinary boards that were never
 *  the target of this fix (caught by `serialize.test.ts`'s round-trip
 *  assertion, which is exactly why this gate exists). */
function backfillLegacyStaticSeq(state: GameState): void {
    const legacy: CardInstanceState[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.staticSeq !== undefined) continue;
            const cardId = (card.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects = getEffectiveStaticEffects(def, card.chosenModeId);
            if (effects.length === 0) continue;
            legacy.push(card);
        }
    }
    if (legacy.length === 0) return;

    const legacyIds = new Set(legacy.map((c) => c.id));
    const fallbackIndex = new Map(legacy.map((c, i) => [c.id, i]));

    // Mine "u applied before v" edges from every target's record arrays —
    // this is the ONLY surviving evidence of true application order; see the
    // doc comment above.
    const dependents = new Map<string, Set<string>>(); // u -> {v applied after u}
    const inboundCount = new Map<string, number>();
    const addEdge = (u: string, v: string) => {
        if (u === v) return;
        let set = dependents.get(u);
        if (!set) {
            set = new Set();
            dependents.set(u, set);
        }
        if (!set.has(v)) {
            set.add(v);
            inboundCount.set(v, (inboundCount.get(v) ?? 0) + 1);
        }
    };
    for (const player of state.players) {
        for (const target of player.battlefield) {
            for (const spec of LEGACY_SEQ_RECORD_SPECS) {
                const ids = legacySeqRecords(target, spec.field)
                    .map((entry) => entry[spec.idKey] as string | undefined)
                    .filter(
                        (id): id is string =>
                            id !== undefined && legacyIds.has(id)
                    );
                for (let i = 1; i < ids.length; i++) {
                    addEdge(ids[i - 1], ids[i]);
                }
            }
        }
    }

    // Kahn's topological sort. Ties (no mined edge decides between two
    // "ready" sources) are broken by battlefield encounter order — the
    // fallback of last resort once the records run out.
    const ready = legacy
        .filter((c) => (inboundCount.get(c.id) ?? 0) === 0)
        .map((c) => c.id)
        .sort((a, b) => fallbackIndex.get(a)! - fallbackIndex.get(b)!);
    const order: string[] = [];
    while (ready.length > 0) {
        const id = ready.shift()!;
        order.push(id);
        for (const next of dependents.get(id) ?? []) {
            const remaining = (inboundCount.get(next) ?? 0) - 1;
            inboundCount.set(next, remaining);
            if (remaining === 0) {
                const insertAt = fallbackIndex.get(next)!;
                let pos = ready.findIndex(
                    (r) => fallbackIndex.get(r)! > insertAt
                );
                if (pos === -1) pos = ready.length;
                ready.splice(pos, 0, next);
            }
        }
    }
    // A cycle would mean two targets' record arrays disagree about which of
    // two sources applied first — should never happen, since every array is
    // independently written in true application order — but rather than
    // silently drop a card's stamp, append whatever is left in fallback
    // order.
    if (order.length < legacy.length) {
        const placed = new Set(order);
        for (const card of legacy) {
            if (!placed.has(card.id)) order.push(card.id);
        }
    }

    const seqById = new Map<string, number>();
    order.forEach((id, i) => seqById.set(id, i - legacy.length));
    for (const card of legacy) {
        card.staticSeq = seqById.get(card.id)!;
    }

    // Stamp every record a legacy source owns on any target with that
    // source's freshly assigned seq — the actual fix (see doc comment).
    for (const player of state.players) {
        for (const target of player.battlefield) {
            for (const spec of LEGACY_SEQ_RECORD_SPECS) {
                for (const entry of legacySeqRecords(target, spec.field)) {
                    if (entry.seq !== undefined) continue;
                    const id = entry[spec.idKey] as string | undefined;
                    if (id === undefined) continue;
                    const seq = seqById.get(id);
                    if (seq !== undefined) entry.seq = seq;
                }
            }
        }
    }
}
