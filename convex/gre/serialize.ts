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
import { allocStaticTimestamp, getEffectiveStaticEffects } from "./state";
import type { ContinuousEffect } from "./continuousEffects";
import type { Duration } from "./state";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./state";
import type { Zone } from "./types";
import type {
    CardFieldCodec,
    CustomCardFieldKey,
    OptionalCardInstanceKey,
} from "./state/cardFieldLifecycle";
import {
    CARD_FIELD_KEYS,
    CARD_FIELD_LIFECYCLE,
} from "./state/cardFieldLifecycle";
import type { FaceDownProducer } from "./faceDown";
import { isFaceDownProducer } from "./faceDown";
import type {
    CardDefinition,
    CardSupertype,
    CardType,
    TextChange,
} from "../cards/types";
import {
    INDEFINITE_SOURCE_ID,
    recomposeLayers2to5ForInstance,
} from "./layers2to5";
import { migrateLegacyAbilityLossHolds } from "./layer6";
import { resolveZoneCharacteristics } from "./zoneCharacteristics";
import { declaresAsEntersMode } from "./constants";
import type { GrantedAbilityOrigin } from "./activatedAbilities";
import { resolveGrantedActivatedAbility } from "./activatedAbilities";

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

/** The card-level wire is TABLE-DRIVEN (issue #4453): `compactCard` /
 *  `expandCard` walk `CARD_FIELD_LIFECYCLE` (`gre/state/cardFieldLifecycle.ts`)
 *  in key order and apply each row's `codec`. The rows below are the ones no
 *  predicate expresses — a definition diff, a legacy-shape coercion, a
 *  conditional restore — one hand-written pair per `custom` row, exhaustive
 *  over them (a `custom` row without a pair, or a pair for a non-`custom`
 *  row, reds `check:ts`). Each pair runs at its row's position in the walk, so
 *  table order stays wire order. */
type CardCodecCtx = { def: CardDefinition | null | undefined };
type CustomCardCodec = {
    compact: (
        card: CardInstanceState,
        out: CompactCard,
        ctx: CardCodecCtx
    ) => void;
    expand: (
        compact: CompactCard,
        result: CardInstanceState,
        ctx: CardCodecCtx
    ) => void;
};

/** issue #3001 — a RETIRED producer ("impulse-exile") survives in any
 *  `gameStates` row written before the impulse idiom went face up, and the
 *  `faceDownBy` seam is a bare assertion that would believe it. Drop it, and
 *  drop the per-viewer grant it accompanied (`knownTo`): together they ARE the
 *  retired behaviour, and a half-healed row is worse than either — the knower
 *  would be handed a `faceDown: true` for a card whose face the client can no
 *  longer resolve. A card with NO producer at all is pre-#2904 state and is
 *  left exactly as it is. */
function hasRetiredFaceDownProducer(compact: CompactCard): boolean {
    return (
        compact.faceDownBy !== undefined &&
        !isFaceDownProducer(compact.faceDownBy)
    );
}

const CARD_FIELD_CUSTOM_CODECS: {
    readonly [K in CustomCardFieldKey]: CustomCardCodec;
} = {
    // Definition diff: written only when the instance differs from the printed
    // value, read back through a presence test so an explicit `undefined`
    // (written when the instance has NO P/T) falls back to the printed one —
    // see `docs/findings/2388-expandcard-restores-printed-pt-over-a-cleared-one.md`
    // and the `bestowed` re-clear below.
    power: {
        compact: (card, out, { def }) => {
            if (card.power !== def?.power) out.power = card.power;
        },
        expand: (compact, result, { def }) => {
            const power =
                "power" in compact
                    ? (compact.power as number | undefined)
                    : def?.power;
            if (power !== undefined) result.power = power;
        },
    },
    toughness: {
        compact: (card, out, { def }) => {
            if (card.toughness !== def?.toughness) {
                out.toughness = card.toughness;
            }
        },
        expand: (compact, result, { def }) => {
            const toughness =
                "toughness" in compact
                    ? (compact.toughness as number | undefined)
                    : def?.toughness;
            if (toughness !== undefined) result.toughness = toughness;
        },
    },
    // CR 606.3 — the per-permanent "loyalty abilities activated this turn"
    // tally must survive a save/load mid-turn, or a planeswalker could activate
    // a whole second allowance after a reload.
    loyaltyActivationsThisTurn: {
        compact: (card, out) => {
            if (card.loyaltyActivationsThisTurn) {
                out.loyaltyActivationsThisTurn =
                    card.loyaltyActivationsThisTurn;
            }
        },
        expand: (compact, result) => {
            if (compact.loyaltyActivationsThisTurn) {
                result.loyaltyActivationsThisTurn =
                    compact.loyaltyActivationsThisTurn as number;
            } else if (compact.loyaltyActivatedThisTurn) {
                // LEGACY (issue #3339) — the boolean lock this tally replaced. A
                // game saved mid-turn before the rename carries the old key;
                // read it as the one activation it stood for, or a reload would
                // hand every planeswalker on the board a fresh allowance in the
                // middle of a turn. Write-only-forward: `compactCard` never
                // emits it again, so the key dies out on the first save after
                // the upgrade.
                result.loyaltyActivationsThisTurn = 1;
            }
        },
    },
    abilitiesSuppressedBy: {
        compact: (card, out) => {
            if (card.abilitiesSuppressedBy?.length) {
                out.abilitiesSuppressedBy = card.abilitiesSuppressedBy;
            }
        },
        expand: (compact, result) => {
            if (!compact.abilitiesSuppressedBy) return;
            // Rows persisted before the field carried a layer timestamp hold
            // bare source-id STRINGS (CR 613.7 ordering was added later).
            // Coerce them to seq 0 — the earliest possible stamp, so every
            // grant on that permanent reads as later and survives, matching
            // the pre-change behaviour for a game already in flight.
            result.abilitiesSuppressedBy = (
                compact.abilitiesSuppressedBy as unknown[]
            ).map((s) =>
                typeof s === "string" ? { sourceId: s, seq: 0 } : s
            ) as CardInstanceState["abilitiesSuppressedBy"];
        },
    },
    faceDownBy: {
        compact: (card, out) => {
            if (card.faceDownBy) out.faceDownBy = card.faceDownBy;
        },
        expand: (compact, result) => {
            if (compact.faceDownBy && !hasRetiredFaceDownProducer(compact)) {
                result.faceDownBy = compact.faceDownBy as FaceDownProducer;
            }
        },
    },
    // ADR 0026 / PRD #338 — persistent per-viewer card knowledge.
    knownTo: {
        compact: (card, out) => {
            if (card.knownTo?.length) out.knownTo = card.knownTo;
        },
        expand: (compact, result) => {
            if (compact.knownTo && !hasRetiredFaceDownProducer(compact)) {
                result.knownTo = compact.knownTo as string[];
            }
        },
    },
    // CR 702.103b — the Bestow marker must survive a save/load for the whole
    // life of the bestowed object: it is the live discriminator the CR 702.103f
    // Aura-SBA exception (`sba.ts`) and the CR 702.103e resolution exception
    // (`state.ts`) both read, so a dropped flag turns a bestowed Nantuko into
    // an ordinary Aura and the next SBA sweep bins it to the graveyard. The
    // type-line half of the change rides the ordinary `types`/`subtypes`
    // definition-diff. On expand it restores the ONE part of the bestow
    // characteristic change the definition-diff cannot carry: a bestowed
    // object is an Aura enchantment with NO power or toughness (CR 208.3), so
    // `compactCard` writes `power: undefined` — and an explicit `undefined`
    // does not survive JSON, which makes the `"power" in compact` fallback
    // hand back the printed 1/1 instead. Re-clearing here keeps the round-trip
    // exact. (The layer-4 half of the pre-slice shape is migrated in
    // `migrateLegacyBestowTypeLine`, at the END of `expandState`.)
    bestowed: {
        compact: (card, out) => {
            if (card.bestowed) out.bestowed = card.bestowed;
        },
        expand: (compact, result) => {
            if (!compact.bestowed) return;
            result.bestowed = compact.bestowed as boolean;
            delete result.power;
            delete result.toughness;
        },
    },
};

function compactCardField(
    card: CardInstanceState,
    out: CompactCard,
    key: OptionalCardInstanceKey,
    ctx: CardCodecCtx
): void {
    const value: unknown = card[key];
    // Widened on purpose: no `transient` row exists today, and the switch
    // must still name the case the table type allows.
    const codec = CARD_FIELD_LIFECYCLE[key].codec as CardFieldCodec;
    switch (codec) {
        case "flag":
            if (value) out[key] = true;
            return;
        case "scalar":
            if (value) out[key] = value;
            return;
        case "defined":
            if (value !== undefined) out[key] = value;
            return;
        case "list":
            if ((value as unknown[] | undefined)?.length) out[key] = value;
            return;
        case "record":
            if (value && Object.keys(value).length > 0) out[key] = value;
            return;
        case "transient":
            return;
        case "custom":
            CARD_FIELD_CUSTOM_CODECS[key as CustomCardFieldKey].compact(
                card,
                out,
                ctx
            );
            return;
    }
}

function expandCardField(
    compact: CompactCard,
    result: CardInstanceState,
    key: OptionalCardInstanceKey,
    ctx: CardCodecCtx
): void {
    const value = compact[key];
    const slot = result as Record<string, unknown>;
    // Widened on purpose: no `transient` row exists today, and the switch
    // must still name the case the table type allows.
    const codec = CARD_FIELD_LIFECYCLE[key].codec as CardFieldCodec;
    switch (codec) {
        case "flag":
            if (value) slot[key] = true;
            return;
        case "scalar":
        case "list":
        case "record":
            if (value) slot[key] = value;
            return;
        case "defined":
            if (value !== undefined) slot[key] = value;
            return;
        case "transient":
            return;
        case "custom":
            CARD_FIELD_CUSTOM_CODECS[key as CustomCardFieldKey].expand(
                compact,
                result,
                ctx
            );
            return;
    }
}

function compactCard(
    card: CardInstanceState,
    opts: { ownerId: string },
    ctx: CompactCtx
): CompactCard {
    const cardId = (card.card as { id?: string }).id ?? "";
    const def = tryGetDefinition(cardId);
    const codecCtx: CardCodecCtx = { def };
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
    // Wire key order is frozen by the pre-table fixture
    // (`__tests__/fixtures/cardFieldLifecycle.compact.json.txt`): the two
    // definition-diffed rows, then the required `isTapped`, then the rest of
    // the table in its own order.
    compactCardField(card, out, "power", codecCtx);
    compactCardField(card, out, "toughness", codecCtx);
    if (card.isTapped) out.isTapped = true;
    for (const key of CARD_FIELD_KEYS) {
        if (key === "power" || key === "toughness") continue;
        compactCardField(card, out, key, codecCtx);
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
    const codecCtx: CardCodecCtx = { def };
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

    // Table order matters here too: the `bestowed` pair re-clears the P/T the
    // `power` / `toughness` pairs restored, and the table lists them first.
    for (const key of CARD_FIELD_KEYS) {
        expandCardField(compact, result, key, codecCtx);
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
        // CR 113.6c (issue #3278) — the library tuple stores only
        // `[instanceId, cardId]`, so expansion REBUILDS the characteristics
        // rather than restoring them, and rebuilding from the printed line
        // silently undoes the materialisation for a card whose static ability
        // functions in a library (Grist, the Hunger Tide). Hand / graveyard /
        // exile need nothing here: `compactCard` persists their line
        // field-by-field, so a divergent one survives the round trip on its
        // own. `null` back is the ~100% case and the printed line stands.
        const zoned = resolveZoneCharacteristics(def, "library");
        const card: CardInstanceState = {
            id,
            card: { id: cardId },
            controllerId: ownerId,
            ownerId,
            zone: "library",
            types: zoned?.types ?? (def?.types ? [...def.types] : []),
            subtypes:
                zoned?.subtypes ?? (def?.subtypes ? [...def.subtypes] : []),
            staticAbilities: def?.staticAbilities
                ? [...def.staticAbilities]
                : [],
            isTapped: false,
        };
        const power = zoned ? zoned.power : def?.power;
        const toughness = zoned ? zoned.toughness : def?.toughness;
        if (power !== undefined) card.power = power;
        if (toughness !== undefined) card.toughness = toughness;
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
    spellsWarpedThisTurn?: number;
    spellsCastThisGame?: number;
    lastDrawnCardId?: string;
    drawnThisTurn?: string[];
    leftGraveyardThisTurn?: number;
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
    // CR 702.185c (issue #1268) — "a spell was warped this turn". Persisted
    // alongside the cast tally above: both are per-turn facts a save inside the
    // turn must not erase.
    if (player.spellsWarpedThisTurn) {
        out.spellsWarpedThisTurn = player.spellsWarpedThisTurn;
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
    // CR 400.7 — "a card left your graveyard this turn" (Gau, Feral Youth).
    // A per-turn tally that gates an end-step intervening if, so it has to
    // survive a save/load taken between the two end steps of the same turn.
    if (player.leftGraveyardThisTurn) {
        out.leftGraveyardThisTurn = player.leftGraveyardThisTurn;
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
    // `CARD_FIELD_LIFECYCLE` `satisfies` clause,
    // `gre/state/cardFieldLifecycle.ts`, covers `CardInstanceState`
    // only), so nothing but the round-trip test in
    // `serialize.test.ts` catches an omission.
    if (player.experienceCounters) {
        out.experienceCounters = player.experienceCounters;
    }
    // Revolt, an ability word (CR 207.2c) — persisted so the flag survives
    // a save/load round-trip.
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
    if (player.spellsWarpedThisTurn !== undefined) {
        result.spellsWarpedThisTurn = player.spellsWarpedThisTurn;
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
    if (player.leftGraveyardThisTurn !== undefined) {
        result.leftGraveyardThisTurn = player.leftGraveyardThisTurn;
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
    // CR 608.2b (issue #2985) — the resolution-time illegal-SLOT verdict rides
    // the round-trip beside the announced list it indexes into. A resolution
    // that suspends on a choice is a stable save point, and a reload that lost
    // this would resume treating every announced target as legal again.
    if (item.illegalTargetSlots?.length) {
        base.illegalTargetSlots = item.illegalTargetSlots;
    }
    if (item.chosenX !== undefined) base.chosenX = item.chosenX;
    // CR 702.33 — persist the PER-KICKER payment record so an "if this spell was
    // kicked" resolution (Overload, Burst Lightning, Everflowing Chalice's ETB
    // counters) and a per-Kicker intervening-if ("if it was kicked with its
    // {2}{U} kicker", ADR 0079) both survive a DB round-trip while the spell
    // sits on the stack. A plain `Record<string, number>`, so it round-trips as
    // raw JSON like `targetAmounts` below.
    if (item.kickerPayments) base.kickerPayments = item.kickerPayments;
    // CR 702.33d / 702.175a (ADR 0085) — the sibling record rides the same
    // round-trip: a spell whose OFFSPRING cost was paid must still read
    // `{ additionalCostPaid: "<id>" }` true after a save/load on the stack,
    // while staying unkicked for `wasKicked` and the `spellWasKicked` filter.
    if (item.unkickedCostPayments) {
        base.unkickedCostPayments = item.unkickedCostPayments;
    }
    // CR 702.47c (issue #2394) — the text a splice reveal added to this spell
    // is applied AS IT WAS CAST, so the snapshot of which cards were revealed
    // must survive a save/load while the spell sits on the stack: the merged
    // Effect Script is rebuilt from this field on every resolution attempt, and
    // a lost field would resolve the spell with its printed text alone.
    if (item.splicedCardIds) base.splicedCardIds = item.splicedCardIds;
    if (item.targetAmounts) base.targetAmounts = item.targetAmounts;
    // ADR 0094 — the announced mode instances and their target spans. (A
    // parked as-enters mode is the PERMANENT-domain `chosenModeId`, which
    // `compactCard` above already carries.)
    if (item.chosenModeIds?.length) base.chosenModeIds = item.chosenModeIds;
    if (item.modeTargetCounts) base.modeTargetCounts = item.modeTargetCounts;
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
    // CR 113.1 (issue #2943) — the origin rides with the def id or the
    // template lookup resolves against the wrong list after a save/load.
    if (item.grantedAbilityOrigin) {
        base.grantedAbilityOrigin = item.grantedAbilityOrigin;
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
    // `compactCard`, exactly like `castCopySnapshot` recurses through
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
    // CR 702.185a — the Warp exile-trigger marker (the watched permanent's id)
    // must survive a save/load while the trigger sits on the stack at the end
    // step; without it the reloaded item resolves as a no-op card-def lookup and
    // the permanent is never exiled.
    if (item.warpTrigger) base.warpTrigger = item.warpTrigger;
    // Cast-Copy (CR 702.40 Storm / CR 702.56 Replicate, ADR 0052) — the
    // cast-copy trigger's detached snapshot and
    // remaining-copies counter must survive a save/load while the trigger
    // sits on the stack awaiting priority (or a per-copy retarget answer).
    // The snapshot is itself a full StackItem, so it recurses through this
    // same compactor rather than duplicating its field list.
    if (item.castCopySnapshot) {
        base.castCopySnapshot = compactStackItem(item.castCopySnapshot, ctx);
    }
    if (item.castCopiesRemaining !== undefined) {
        base.castCopiesRemaining = item.castCopiesRemaining;
    }
    if (item.delayedTriggerId) base.delayedTriggerId = item.delayedTriggerId;
    if (item.delayedPayload) base.delayedPayload = item.delayedPayload;
    // ADR 0048 — an inline delayed-trigger body (pure JSON) must survive a
    // save while the fired trigger sits on the stack awaiting priority.
    if (item.delayedEffects) base.delayedEffects = item.delayedEffects;
    if (item.delayedOracleText) base.delayedOracleText = item.delayedOracleText;
    // CR 701.27f (issue #3249) — a fired delayed trigger waiting on the stack
    // must still know which `delayed-N` creation it answers to.
    if (item.delayedOrigin) base.delayedOrigin = item.delayedOrigin;
    // CR 701.27f (issue #3537) — an ability waiting on the stack must still
    // know its source's transform count at the moment it was put there.
    if (item.stackTransformStamp) {
        base.stackTransformStamp = item.stackTransformStamp;
    }
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
    // CR 106.6 / 611.2c (issue #3354, Arena of Glory) — persist the per-cast
    // haste rider for the same reason: the save is taken while the creature
    // spell is still on the stack, and the flag is what the resolution turns
    // into the until-end-of-turn grant. Dropped here, the creature resolves
    // summoning-sick after a reload.
    if (item.dynamicHasteFromMana) {
        base.dynamicHasteFromMana = item.dynamicHasteFromMana;
    }
    return base;
}

/** ADR 0094 deserialize shim — a stack row written before the announcement
 *  path moved to `chosenModeIds` carries its one announced mode under the
 *  singular key, which the card half of the row ALSO uses for the permanent
 *  domain (a parked as-enters pick, or a permanent's pick cloned onto its
 *  ability). Read it back as `[id]` only when it names a mode of the list the
 *  item ANNOUNCES from — a modal spell that does not choose as it enters, or a
 *  modal activated / triggered ability — so an in-flight row resolves the mode
 *  it was cast with and a permanent-domain value is never mistaken for one. */
function legacyAnnouncedModeIds(
    item: StackItem,
    modeId: string
): string[] | undefined {
    const def = tryGetDefinition((item.card as { id: string }).id);
    if (!def) return undefined;
    const modes = item.triggeredAbilityId
        ? def.triggeredAbilities?.find((t) => t.id === item.triggeredAbilityId)
              ?.modes
        : item.abilityId
          ? (item.grantedSourceCardId
                ? resolveGrantedActivatedAbility(
                      item.grantedSourceCardId,
                      item.abilityId,
                      item.grantedAbilityOrigin
                  )
                : def.activatedAbilities?.find((a) => a.id === item.abilityId)
            )?.modes
          : declaresAsEntersMode(def)
            ? undefined
            : def.modes;
    return modes?.some((m) => m.id === modeId) ? [modeId] : undefined;
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
    if (compact.illegalTargetSlots) {
        item.illegalTargetSlots = compact.illegalTargetSlots as number[];
    }
    if (compact.chosenX !== undefined) item.chosenX = compact.chosenX as number;
    if (compact.kickerPayments) {
        item.kickerPayments = compact.kickerPayments as Record<string, number>;
    }
    if (compact.unkickedCostPayments) {
        item.unkickedCostPayments = compact.unkickedCostPayments as Record<
            string,
            number
        >;
    }
    if (compact.splicedCardIds) {
        item.splicedCardIds = compact.splicedCardIds as string[];
    }
    if (compact.targetAmounts) {
        item.targetAmounts = compact.targetAmounts as Record<string, number>;
    }
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
    // Issue #2943 — the MIRROR of the write above. `expandStackItem` is an
    // explicit key whitelist with no passthrough, so a written-but-unread key
    // is silently dropped and the template lookup runs against the wrong list
    // on the very next load — an ability-copy activation that survives a save
    // pops as a no-op, the issue #2468 shape one field over.
    if (compact.grantedAbilityOrigin) {
        item.grantedAbilityOrigin =
            compact.grantedAbilityOrigin as GrantedAbilityOrigin;
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
    if (compact.warpTrigger) {
        item.warpTrigger = compact.warpTrigger as string;
    }
    // Cast-Copy (ADR 0052) — rehydrate the cast-trigger's detached
    // snapshot (recursing through this same expander) and remaining-copies
    // counter.
    // Read-back of the pre-#2100 compact keys (`stormSnapshot` /
    // `stormCopiesRemaining`): a game saved with a storm trigger on the stack
    // before the rename would otherwise lose its copies on load.
    const castCopySnapshot = compact.castCopySnapshot ?? compact.stormSnapshot;
    if (castCopySnapshot) {
        item.castCopySnapshot = expandStackItem(
            castCopySnapshot as CompactCard,
            ctx
        );
    }
    const castCopiesRemaining =
        compact.castCopiesRemaining ?? compact.stormCopiesRemaining;
    if (castCopiesRemaining !== undefined) {
        item.castCopiesRemaining = castCopiesRemaining as number;
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
    if (compact.delayedOrigin) {
        item.delayedOrigin =
            compact.delayedOrigin as StackItem["delayedOrigin"];
    }
    if (compact.stackTransformStamp) {
        item.stackTransformStamp =
            compact.stackTransformStamp as StackItem["stackTransformStamp"];
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
    // CR 106.6 / 611.2c (issue #3354, Arena of Glory) — rehydrate the per-cast
    // haste rider.
    if (compact.dynamicHasteFromMana) {
        item.dynamicHasteFromMana = compact.dynamicHasteFromMana as boolean;
    }
    // ADR 0094 — last, because the legacy shim reads `abilityId` /
    // `triggeredAbilityId` to find the mode list the item announced from.
    if (compact.chosenModeIds) {
        item.chosenModeIds = compact.chosenModeIds as string[];
    } else if (typeof compact.chosenModeId === "string") {
        const legacy = legacyAnnouncedModeIds(item, compact.chosenModeId);
        if (legacy) item.chosenModeIds = legacy;
    }
    if (compact.modeTargetCounts) {
        item.modeTargetCounts = compact.modeTargetCounts as number[];
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
    "nextRevealSeq",
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
    "damageUnpreventableThisTurn",
    "sourcePreventionShields",
    "recipientPreventionShields",
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
    // CR 601.2f / 514.2 (issue #3340) — the floating turn-scoped spell-cost
    // reductions (Urza, Planeswalker's +2). Plain data (a player id, a filter
    // of string arrays, a `ManaCost` of integers) with no fat card refs, so it
    // round-trips through the generic optional-key loop; it must survive the DB
    // round-trip because the reduction has to still apply to a cast announced
    // at any later stable point in the SAME turn.
    "spellCostReductionsThisTurn",
    "spellManaSubstitutionGrants",
    // CR 609.4b / 614.1a (issue #3811) — False Dawn's until-end-of-turn
    // permission and production replacement: plain per-player records that
    // must survive to a later stable point in the same turn.
    "manaSubstitutionGrantsThisTurn",
    "manaProductionColorThisTurn",
    "allCreaturesMustAttack",
    "abilityResolutionCounts",
    "destroyReplacementShields",
    "graveyardBoundRedirectThisTurn",
    "graveyardPlayPermissionThisTurn",
    "graveyardPlayPermissionUsesThisTurn",
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
export const TRANSIENT_KEYS = new Set<string>([
    // Search-only, never persisted (issue #3533). `deckColorKnowledge` is the
    // decklist colour evidence `determinize` stamps onto a determinized world
    // for the searching Bot (`gre/deckKnowledge.ts`, `gre/state.ts`). It is not
    // game state: the authoritative `game.ts` path never produces one, and a
    // saved row that somehow carried one would be re-teaching the opponent's
    // decklist to every later reader of that row. Listed here rather than in
    // `PERSISTED_OPTIONAL_KEYS` so `compactState` DROPS it.
    "deckColorKnowledge",
]);

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
    // ADR 0094 deserialize shim — a pending announcement persisted before the
    // move to `chosenModeIds` carries its one mode under the singular key.
    // These three shapes only ever hold the ANNOUNCEMENT domain, so the
    // promotion is unconditional.
    for (const pending of [
        result.pendingTarget,
        result.pendingCast,
        result.pendingActivation,
    ]) {
        const legacy = pending as
            | { chosenModeId?: unknown; chosenModeIds?: string[] }
            | undefined;
        if (legacy && typeof legacy.chosenModeId === "string") {
            legacy.chosenModeIds ??= [legacy.chosenModeId];
            delete legacy.chosenModeId;
        }
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
    backfillLegacyStaticSeq(result, data);
    migrateLegacyInstancePTLedgers(result, data);
    migrateLegacyInstanceKeywordLedgers(result, data);
    migrateLegacyLayer2to5Ledgers(result, data);
    migrateLegacyAbilityLossLedger(result, data);
    migrateLegacyBestowTypeLine(result);
    return result;
}

/** ONE-SHOT MIGRATION (ADR 0084, issue #2073) — a bestowed object whose layer-4
 *  BASE is the bestowed line rather than the printed one.
 *
 *  Bestow's type line used to be STAMPED onto the instance at cast commit
 *  (PR #2576), and the layer-4 base capture runs at the first derivation, i.e.
 *  AFTER the stamp — so a state persisted between that PR and this slice froze
 *  `Enchantment — Aura` into `baseTypes`/`baseSubtypes` as well. The type line
 *  is a derived layer-4 continuous effect now, so a base that already reads
 *  `Enchantment` would leave the object an enchantment forever once it ceased
 *  to be bestowed (CR 702.103f).
 *
 *  Re-seating the base to the PRINTED line and recomposing is exact rather than
 *  approximate: the derivation reapplies the very effect the stamp used to
 *  write, so a still-bestowed object comes back out of this identical, and one
 *  that later unattaches has a creature to go back to.
 *
 *  TWO things about WHERE this runs, both load-bearing:
 *
 *   - **Last, not in `expandCard`.** The recompose reads the instance's layer-4
 *     ledgers, and `backfillLegacyStaticSeq` / `migrateLegacyLayer2to5Ledgers`
 *     are what put a pre-S4 state's ledgers into readable shape. Recomposing
 *     ahead of them would silently drop an un-promoted `animation` or
 *     `indefiniteSubtypeSet` from the materialised line, and nothing recomposes
 *     again — `expandState` returns without a sync.
 *   - **Gated on the stamped SHAPE, not on `bestowed` alone.** This function
 *     runs on every load, so an unconditional overwrite would clobber a
 *     legitimate below-layer-4 base (a copy, CR 706; a transform, CR 701.28)
 *     at each one instead of migrating once. The stamp's signature is exact and
 *     unreachable after this slice: the printed card is a creature and the
 *     stored base is not. */
function migrateLegacyBestowTypeLine(state: GameState): void {
    const visit = (card: CardInstanceState, zone: "battlefield" | "stack") => {
        if (!card.bestowed) return;
        const cardId = (card.card as { id?: string } | undefined)?.id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        if (!def?.types.includes("Creature")) return;
        if (card.baseTypes?.includes("Creature")) return;
        card.baseTypes = [...def.types];
        card.baseSubtypes = [...(def.subtypes ?? [])];
        recomposeLayers2to5ForInstance(card, zone);
    };
    for (const player of state.players) {
        for (const card of player.battlefield) visit(card, "battlefield");
    }
    for (const item of state.stack) {
        visit(item as unknown as CardInstanceState, "stack");
    }
}

/** One-shot migration for a state persisted BEFORE PRD #2064 S6, when the
 *  layer-7 residue of a resolved spell lived on the affected permanent
 *  (`temporaryPTMods` for a CR 613.4c pump, `temporaryPTSet` for a CR 613.4b
 *  base-P/T set) and the phase-boundary cleanup ticked it there.
 *
 *  Both are Continuous Effects Registry entries now, so a state written by the
 *  old engine would otherwise come back with every Giant Growth and every
 *  "base power 0 until end of turn" silently gone — the fields no longer exist
 *  on `CardInstanceState`, so `expandCard` drops them and nothing reds.
 *
 *  Read off the COMPACT record rather than the expanded card for exactly that
 *  reason: the expanded card cannot hold them any more. Order is preserved and
 *  restamped, because array order WAS the CR 613.7 timestamp under the old
 *  model and the last entry per characteristic still has to win in 7b.
 *  A row with no `duration` was the INDEFINITE base-P/T set (CR 611.2a, Wall of
 *  Tombstones), and becomes an `indefinite` entry rather than a duration one. */
function migrateLegacyInstancePTLedgers(
    state: GameState,
    data: Record<string, unknown>
): void {
    type LegacyMod = { power: number; toughness: number; duration: Duration };
    type LegacySet = {
        power?: number;
        toughness?: number;
        duration?: Duration;
    };
    const compactPlayers = data.players as CompactPlayer[] | undefined;
    if (!compactPlayers?.length) return;
    for (let index = 0; index < compactPlayers.length; index++) {
        const live = state.players[index];
        if (!live) continue;
        for (const compact of compactPlayers[index].battlefield ?? []) {
            const legacy = compact as unknown as {
                id?: string;
                temporaryPTSet?: LegacySet[];
                temporaryPTMods?: LegacyMod[];
            };
            if (!legacy.id) continue;
            if (
                !legacy.temporaryPTSet?.length &&
                !legacy.temporaryPTMods?.length
            )
                continue;
            const card = live.battlefield.find((c) => c.id === legacy.id);
            if (!card) continue;
            // 7b before 7c, mirroring the order the old read path pushed them
            // in — within a sublayer the relative order is what decides the
            // winner, and across sublayers CR 613.4 decides it regardless.
            for (const entry of legacy.temporaryPTSet ?? []) {
                const payload: {
                    kind: "pt-set";
                    power?: number;
                    toughness?: number;
                } = { kind: "pt-set" };
                if (entry.power !== undefined) payload.power = entry.power;
                if (entry.toughness !== undefined)
                    payload.toughness = entry.toughness;
                appendMigratedEffect(state, {
                    layer: 7,
                    sublayer: "7b",
                    affected: { kind: "instances", instanceIds: [card.id] },
                    expiry: entry.duration
                        ? {
                              kind: "duration",
                              duration: entry.duration,
                              controllerId: card.controllerId,
                          }
                        : {
                              kind: "indefinite",
                              controllerId: card.controllerId,
                          },
                    payload,
                    characteristicDefining: false,
                });
            }
            for (const mod of legacy.temporaryPTMods ?? []) {
                appendMigratedEffect(state, {
                    layer: 7,
                    sublayer: "7c",
                    affected: { kind: "instances", instanceIds: [card.id] },
                    expiry: {
                        kind: "duration",
                        duration: mod.duration,
                        controllerId: card.controllerId,
                    },
                    payload: {
                        kind: "pt-modify",
                        power: mod.power,
                        toughness: mod.toughness,
                    },
                    characteristicDefining: false,
                });
            }
        }
    }
}

/** One-shot migration for a state persisted BEFORE PRD #2064 S6b, when layer
 *  6's residue of a resolved spell or ability lived on the affected permanent:
 *  `grantedStaticAbilities` rows keyed by `duration` (CR 611.2a, "gains flying
 *  until end of turn"), by `counterType` (CR 122.1b, a keyword counter's
 *  CR 613.7c stamp) or by NOTHING at all (CR 611.2c, Cocoon's indefinite
 *  grant), plus every `temporaryRemovedKeywords` row (CR 611.2a, Shelkin
 *  Brownie's until-end-of-turn strip).
 *
 *  All four are Continuous Effects Registry entries now, so a state written by
 *  the old engine would otherwise come back with every such grant and every
 *  such strip silently gone: the ledger shapes no longer exist on
 *  `CardInstanceState`, so `expandCard` drops them and nothing reds.
 *
 *  Read off the COMPACT record rather than the expanded card for exactly that
 *  reason, and in the same order the old `layer6EffectsFor` synthesised them —
 *  counter grants, then the resolved-ability grants, then the removals — so
 *  that a legacy board whose rows all shared a stamp (a pre-S3 state, where
 *  `seq` was absent and read as 0) is restamped in the order the old read path
 *  had composed them in.
 *
 *  `auraId`-keyed rows are deliberately NOT migrated: those are layer 6's own
 *  DERIVED OUTPUT, re-walked from the live board at the next `syncLayer6`, and
 *  migrating them would double every aura's grant. They are also all that
 *  survives on `grantedStaticAbilities` after this slice. */
function migrateLegacyInstanceKeywordLedgers(
    state: GameState,
    data: Record<string, unknown>
): void {
    type LegacyGrant = {
        ability: string;
        duration?: Duration;
        auraId?: string;
        counterType?: string;
    };
    type LegacyRemoval = { keyword: string; duration: Duration };
    const compactPlayers = data.players as CompactPlayer[] | undefined;
    if (!compactPlayers?.length) return;
    for (let index = 0; index < compactPlayers.length; index++) {
        const live = state.players[index];
        if (!live) continue;
        for (const compact of compactPlayers[index].battlefield ?? []) {
            const legacy = compact as unknown as {
                id?: string;
                grantedStaticAbilities?: LegacyGrant[];
                temporaryRemovedKeywords?: LegacyRemoval[];
                removedKeywords?: { keyword: string; sourceId: string }[];
            };
            if (!legacy.id) continue;
            const card = live.battlefield.find((c) => c.id === legacy.id);
            if (!card) continue;
            const grants = (legacy.grantedStaticAbilities ?? []).filter(
                (g) => !g.auraId
            );
            const removals = legacy.temporaryRemovedKeywords ?? [];
            // PRD #2064 S6b-part-2 — the CONTINUOUS strip's record. `removedKeywords`
            // held every occurrence a live `keyword-remove` static effect (Gravity
            // Sphere, Animate Wall) or an `ability-loss` (Titania's Song) had
            // spliced out of `staticAbilities`. It is DERIVED OUTPUT since S3 and
            // this slice deleted the field, so `expandCard` drops it and this is
            // the last moment it is readable at all.
            //
            // It is not promoted to an entry — the board re-derives every one of
            // those on the first sync — but it IS part of the base, and nothing
            // else can reconstruct it: `registryRemovedKeywordsFor` sees only
            // `instances`-affected entries, so a source-derived strip and every
            // ability-loss are invisible to it. Left out, a Wall of Swords loaded
            // under Animate Wall captures its base as `[]` and never has defender
            // again, however long after the aura dies.
            const derivedRemovals = legacy.removedKeywords ?? [];
            if (
                grants.length === 0 &&
                removals.length === 0 &&
                derivedRemovals.length === 0
            ) {
                continue;
            }
            // CR 613 layer-6 base = staticAbilities + removals - grants.
            //
            // Seeded HERE and not by `captureLayer6Base` (`gre/layer6.ts`),
            // because this is the one moment the formula's precondition holds:
            // the rows being migrated were written by the old engine at the
            // instant it spliced the keyword, so every one of them IS already
            // reflected in the `staticAbilities` this state was persisted with.
            // A registry entry carries no such guarantee — it can exist before
            // any composition has run — which is why the capture reads only the
            // instance-borne records and this runs before the entries exist.
            //
            // A state persisted after PRD #2064 S3 already carries
            // `baseStaticAbilities` and is left alone.
            if (card.baseStaticAbilities === undefined) {
                const base = [...card.staticAbilities];
                for (const removal of removals) base.push(removal.keyword);
                for (const removal of derivedRemovals) {
                    base.push(removal.keyword);
                }
                for (const grant of grants) {
                    const at = base.indexOf(grant.ability);
                    if (at !== -1) base.splice(at, 1);
                }
                card.baseStaticAbilities = base;
            }
            // IDEMPOTENCE is now structural: `grantedStaticAbilities` does not
            // exist on `CardInstanceState` since PRD #2064 S6b-part-2, so
            // `expandCard` drops every row it finds and `compactCard` can never
            // write one back out. Until that slice this function had to strike
            // the migrated rows by hand — the field survived as layer 6's
            // derived output, and `gameStates` is expanded and compacted on
            // EVERY mutation, so a row left behind minted one extra entry per
            // action.
            //
            // The `auraId` rows are dropped with the rest and re-derived from
            // the live board at the next `syncLayer6`, which is what they always
            // were.
            for (const grant of grants) {
                if (!grant.counterType) continue;
                appendMigratedEffect(state, {
                    layer: 6,
                    affected: { kind: "instances", instanceIds: [card.id] },
                    expiry: {
                        kind: "counter",
                        permanentId: card.id,
                        counterType: grant.counterType,
                    },
                    payload: { kind: "keyword-grant", keyword: grant.ability },
                    characteristicDefining: false,
                });
            }
            for (const grant of grants) {
                if (grant.counterType) continue;
                appendMigratedEffect(state, {
                    layer: 6,
                    affected: { kind: "instances", instanceIds: [card.id] },
                    expiry: grant.duration
                        ? {
                              kind: "duration",
                              duration: grant.duration,
                              controllerId: card.controllerId,
                          }
                        : {
                              kind: "indefinite",
                              controllerId: card.controllerId,
                          },
                    payload: { kind: "keyword-grant", keyword: grant.ability },
                    characteristicDefining: false,
                });
            }
            for (const removal of removals) {
                appendMigratedEffect(state, {
                    layer: 6,
                    affected: { kind: "instances", instanceIds: [card.id] },
                    expiry: {
                        kind: "duration",
                        duration: removal.duration,
                        controllerId: card.controllerId,
                    },
                    payload: {
                        kind: "keyword-remove",
                        keyword: removal.keyword,
                    },
                    characteristicDefining: false,
                });
            }
        }
    }
}

/** Appends one migrated entry, minting its id and its CR 613.7 stamp the same
 *  way the live producer does (`allocStaticTimestamp` — never a second
 *  counter), so a migrated effect and one created after the load are ordered
 *  against each other by the one authority. */
function appendMigratedEffect(
    state: GameState,
    entry: Omit<ContinuousEffect, "id" | "timestamp">
): void {
    const existing = state.continuousEffects ?? [];
    let max = 0;
    for (const e of existing) {
        const suffix = /^ce-(\d+)$/.exec(e.id);
        if (suffix) max = Math.max(max, Number(suffix[1]));
    }
    state.continuousEffects = [
        ...existing,
        {
            ...entry,
            id: `ce-${max + 1}`,
            timestamp: allocStaticTimestamp(state),
        } as ContinuousEffect,
    ];
}

/** One-shot migration for a state persisted BEFORE PRD #2064 S6b-part-2, when
 *  layers 2-5 kept their answer in thirteen materialised fields on the affected
 *  permanent rather than deriving it.
 *
 *  Three of those fields were also the only record of an effect: layer 3's
 *  `textChanges` WAS the ledger as well as the output, and a one-shot card-type
 *  SET, an indefinite supertype mutation and an indefinite subtype ADD were
 *  recorded as `"indefinite"`-keyed provenance rows. Without this a deploy
 *  landing mid-game would come back with every Magical Hack rewrite, every Oko
 *  `+1` type line and every Arcum's Weathervane snow toggle silently gone.
 *
 *  It also seeds the two layer-4 BASES. `ensureLayer4Base` (`gre/layers2to5.ts`)
 *  used to reconstruct them by unwinding the provenance rows; the rows are gone
 *  from `CardInstanceState`, so the unwind moved here, to the one moment they
 *  are readable. The PRINTED-type discipline it carried is preserved verbatim
 *  (issue #2086): a granted type the card also prints is not removed from the
 *  base, and a suppressed type the card never printed is not resurrected.
 *
 *  This is the migration path an issue-#3120 reviewer should follow for "a
 *  persisted state written before this slice loads correctly": the pre-slice
 *  document reaches `expandState`, its compact rows still carry every deleted
 *  field, and this promotes them into the ledgers and bases the derivation
 *  reads. Idempotent by construction — `compactCard` cannot write any of these
 *  fields back out, so a second load finds nothing to migrate.
 *
 *  What is deliberately NOT migrated: an aura-sourced row (`auraId` naming a
 *  live permanent). Those are re-derived from the board on the first sync, so
 *  promoting them to a ledger would apply them twice, permanently. Only the
 *  `"indefinite"` sentinel rows — the ones no board walk can reproduce — are
 *  promoted. */
function migrateLegacyLayer2to5Ledgers(
    state: GameState,
    data: Record<string, unknown>
): void {
    const compactById = compactBattlefieldRows(data);
    if (compactById.size === 0) return;
    // CR 613.7 — every promoted row takes a real stamp, strictly increasing,
    // and strictly BELOW every stamp the loaded board already carries.
    //
    // `LEGACY_LEDGER_TIMESTAMP_BASE` and its two siblings went with this slice
    // because a magic constant a mint could never reach is not a timestamp. The
    // ORDER they encoded is kept: a promoted row is the residue of an effect
    // that resolved before this document was written, and it lost to every live
    // source under the old engine. Flipping that silently would load the same
    // pre-S4 document to a different type line before and after the deploy —
    // a one-shot card-type set would start outranking a live Blood Moon.
    // Derived from the board rather than declared, so nothing has to stay clear
    // of it.
    let floor = 0;
    const sink = (seq: number | undefined) => {
        if (seq !== undefined && seq < floor) floor = seq;
    };
    for (const entry of state.continuousEffects ?? []) sink(entry.timestamp);
    for (const emblem of state.emblems ?? []) sink(emblem.staticSeq);
    for (const player of state.players) {
        for (const card of player.battlefield) {
            sink(card.staticSeq);
            for (const h of card.textChangeHolds ?? []) sink(h.seq);
            for (const h of card.typeLineHolds ?? []) sink(h.seq);
            for (const h of card.subtypeAddHolds ?? []) sink(h.seq);
            for (const h of card.supertypeHolds ?? []) sink(h.seq);
            for (const h of card.abilityLossHolds ?? []) sink(h.seq);
            for (const c of card.controlChanges ?? []) sink(c.seq);
        }
    }
    // One descending run below the lowest stamp on the board. Strictly
    // decreasing, so promoted rows keep their relative order among themselves —
    // which for the layer-3 ledger IS the CR 612.6 order (array order WAS the
    // timestamp before S4, the field's own doc said so).
    let next = floor - 1;
    const mint = () => next--;

    for (const player of state.players) {
        for (const card of player.battlefield) {
            const row = compactById.get(card.id);
            // A document written by PRD #2064 S4 or later carries BOTH layer-4
            // bases — `ensureLayer4Base` writes them at the first derivation and
            // `compactCard` persists them — so it has already been through this
            // promotion and there is nothing here for it. The gate matters
            // because two of the six fields read below (`grantedSupertypes` /
            // `removedSupertypes`) survived this slice and DO round-trip, so
            // "the field cannot be written back out" is not, on its own, the
            // idempotence argument the other four get for free.
            if (
                !row ||
                (row.baseTypes !== undefined && row.baseSubtypes !== undefined)
            ) {
                continue;
            }
            const legacy = {
                textChanges: asRows(row.textChanges),
                grantedTypes: asRows(row.grantedTypes),
                suppressedTypes: asRows(row.suppressedTypes),
                grantedSupertypes: asRows(row.grantedSupertypes),
                removedSupertypes: asRows(row.removedSupertypes),
                grantedSubtypesAdd: asRows(row.grantedSubtypesAdd),
                printedSubtypes: Array.isArray(row.printedSubtypes)
                    ? (row.printedSubtypes as string[])
                    : undefined,
            };
            const carriesRows =
                legacy.textChanges.length > 0 ||
                legacy.grantedTypes.length > 0 ||
                legacy.suppressedTypes.length > 0 ||
                legacy.grantedSupertypes.length > 0 ||
                legacy.removedSupertypes.length > 0 ||
                legacy.grantedSubtypesAdd.length > 0;
            if (!carriesRows && legacy.printedSubtypes === undefined) continue;

            // --- the two layer-4 BASES ------------------------------------
            //
            // Seeded before any promotion below reads them, and only when the
            // loaded row carried none of its own: a document written after
            // PRD #2064 S4 already has them and is left alone.
            const cardId = (card.card as { id?: string }).id;
            const printed = cardId ? tryGetDefinition(cardId) : null;
            if (card.baseTypes === undefined) {
                const printedTypes = (printed?.types ?? []).map(
                    (t) => t as CardType
                );
                const base = [...card.types];
                for (const g of legacy.grantedTypes) {
                    const type = g.type as CardType;
                    if (printedTypes.includes(type)) continue;
                    const at = base.indexOf(type);
                    if (at !== -1) base.splice(at, 1);
                }
                for (const suppressed of legacy.suppressedTypes) {
                    const type = suppressed.type as CardType;
                    if (!printedTypes.includes(type)) continue;
                    if (!base.includes(type)) base.push(type);
                }
                card.baseTypes = base;
            }
            if (card.baseSubtypes === undefined) {
                // #1715's guard, carried verbatim from the
                // `capturePrintedSubtypes` this replaces: a subtype that is only
                // present because a live `subtype-add` put it there is EXCLUDED,
                // or the add would survive its own source leaving play. One the
                // card actually PRINTS is kept even when an add duplicates it.
                const base = [...(legacy.printedSubtypes ?? card.subtypes)];
                const adds = [
                    ...legacy.grantedSubtypesAdd.map(
                        (a) => a.subtype as string
                    ),
                    ...(card.subtypeAddHolds ?? []).map((a) => a.subtype),
                ];
                card.baseSubtypes =
                    adds.length === 0
                        ? base
                        : base.filter(
                              (sub) =>
                                  (printed?.subtypes ?? []).includes(sub) ||
                                  !adds.includes(sub)
                          );
            }

            // --- CR 612 layer 3: `textChanges` was ledger AND output -------
            if (
                card.textChangeHolds === undefined &&
                legacy.textChanges.length
            ) {
                card.textChangeHolds = legacy.textChanges.map((change) => ({
                    change: change as unknown as TextChange,
                    // Array order WAS the CR 612.6 timestamp before S4 (the
                    // field's own doc said so), so it is preserved as one.
                    seq: mint(),
                }));
            }

            // --- CR 205.1a layer 4: a one-shot card-type SET ---------------
            //
            // The SET's value is recoverable: it is exactly the live `types`,
            // which is what it set.
            if (
                card.typeLineHolds === undefined &&
                (legacy.grantedTypes.some(
                    (g) => g.auraId === INDEFINITE_SOURCE_ID
                ) ||
                    legacy.suppressedTypes.some(
                        (s) => s.sourceId === INDEFINITE_SOURCE_ID
                    ))
            ) {
                card.typeLineHolds = [{ types: [...card.types], seq: mint() }];
            }

            // --- CR 205.4a layer 4: an indefinite supertype mutation -------
            if (card.supertypeHolds === undefined) {
                const added = legacy.grantedSupertypes.filter(
                    (g) => g.sourceId === INDEFINITE_SOURCE_ID
                );
                const removed = legacy.removedSupertypes.filter(
                    (r) => r.sourceId === INDEFINITE_SOURCE_ID
                );
                if (added.length > 0 || removed.length > 0) {
                    card.supertypeHolds = [
                        {
                            ...(added.length > 0
                                ? {
                                      add: added.map(
                                          (a) => a.supertype as CardSupertype
                                      ),
                                  }
                                : {}),
                            ...(removed.length > 0
                                ? {
                                      remove: removed.map(
                                          (r) => r.supertype as CardSupertype
                                      ),
                                  }
                                : {}),
                            seq: mint(),
                        },
                    ];
                }
            }

            // --- CR 305.7 layer 4: an indefinite subtype ADD ---------------
            //
            // These DID carry a real minted stamp (issue #1750), so the stamp
            // survives the promotion and only a row that never had one is
            // re-minted.
            if (card.subtypeAddHolds === undefined) {
                const adds = legacy.grantedSubtypesAdd.filter(
                    (a) => a.auraId === INDEFINITE_SOURCE_ID
                );
                if (adds.length > 0) {
                    card.subtypeAddHolds = adds.map((a) => ({
                        subtype: a.subtype as string,
                        seq: typeof a.seq === "number" ? a.seq : mint(),
                    }));
                }
            }
        }
    }

    // CR 613.7 — the instance-borne layer-2-to-5 records that survived this
    // slice but were written before their `seq` existed. The derivation skips a
    // row with no stamp (it has no position in its layer), so an undated one is
    // stamped here rather than silently dropped.
    for (const player of state.players) {
        for (const card of player.battlefield) {
            for (const change of card.controlChanges ?? []) {
                if (change.seq === undefined) change.seq = mint();
            }
            if (card.animation && card.animation.seq === undefined) {
                card.animation.seq = mint();
            }
            if (
                card.indefiniteSubtypeSet &&
                card.indefiniteSubtypeSet.seq === undefined
            ) {
                card.indefiniteSubtypeSet.seq = mint();
            }
            if (
                card.temporarySubtypeChange &&
                card.temporarySubtypeChange.seq === undefined
            ) {
                card.temporarySubtypeChange.seq = mint();
            }
        }
    }

    // CR 613.7d — an emblem receives a timestamp when it enters the command
    // zone. A document written before `createEmblem` minted one carries none,
    // and an unstamped source is skipped by both layer walks, so every
    // emblem-granted continuous effect would ship inert.
    for (const emblem of state.emblems ?? []) {
        if (emblem.staticSeq === undefined) emblem.staticSeq = mint();
    }
}

/** One-shot migration for a state persisted BEFORE PRD #2064 S3, when
 *  `abilitiesSuppressedBy` was the LEDGER of every "loses all abilities" hold
 *  rather than layer 6's derived output.
 *
 *  Ran inside `deriveLayer6Board`'s base-capture pass until PRD #2064
 *  S6b-part-2, gated on `baseStaticAbilities` being absent. That gate is a
 *  fact about the persisted DOCUMENT, so it belongs where the document is
 *  read: the pass now runs once, here, instead of asking the question on every
 *  board sync forever. The split of the two arms stays in `gre/layer6.ts`,
 *  which owns the board walk and the card registry that tells them apart. */
function migrateLegacyAbilityLossLedger(
    state: GameState,
    data: Record<string, unknown>
): void {
    const compactById = compactBattlefieldRows(data);
    if (compactById.size === 0) return;
    for (const player of state.players) {
        for (const card of player.battlefield) {
            const row = compactById.get(card.id);
            // A document written after PRD #2064 S3 carries the layer-6 base,
            // and from that moment `abilitiesSuppressedBy` is derived output —
            // re-seeding the ledger from it would make every continuous strip
            // indefinite.
            if (!row || row.baseStaticAbilities !== undefined) continue;
            migrateLegacyAbilityLossHolds(
                state,
                card,
                card.abilitiesSuppressedBy
            );
        }
    }
}

/** One record array off a loosely-typed compact row. */
function asRows(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** One (field, id-key) pair per CR 613.7-timestamped layer-4/6 record a
 *  continuous-effect SOURCE can own on some OTHER permanent's card state
 *  (`gre/state.ts`'s `beginApplyingStaticEffects`). `idKey` is whichever field
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
        | "abilityLossHolds"
        | "grantedSubtypes"
        | "grantedSubtypesAdd";
    idKey: "sourceId" | "auraId";
}[] = [
    { field: "grantedStaticAbilities", idKey: "auraId" },
    { field: "grantedActivatedAbilities", idKey: "auraId" },
    { field: "grantedTriggeredAbilities", idKey: "auraId" },
    { field: "removedKeywords", idKey: "sourceId" },
    { field: "abilitiesSuppressedBy", idKey: "sourceId" },
    // PRD #2064 S3 — the resolving arm's CR 611.2b hold names its source by
    // battlefield INSTANCE id (Tishana's Tidebinder), so it is remapped like
    // every other id-bearing record.
    { field: "abilityLossHolds", idKey: "sourceId" },
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
    /** The card's own compact row, where the five deleted record kinds live. */
    compact: Record<string, unknown> | undefined,
    field: (typeof LEGACY_SEQ_RECORD_SPECS)[number]["field"]
): Record<string, unknown>[] {
    const live = (card as unknown as Record<string, unknown>)[field];
    if (Array.isArray(live)) return live as Record<string, unknown>[];
    const persisted = compact?.[field];
    return Array.isArray(persisted)
        ? (persisted as Record<string, unknown>[])
        : [];
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
 *  next touched by `recomputeContinuousEffects` (any counter- or
 *  condition-gated static effect), `beginApplyingStaticEffects`'s
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
 *  actually read, and `beginApplyingStaticEffects`'s `already = grants.some(g
 *  => g.sourceId === source.id)` guard means a plain re-apply never revisits
 *  an existing record to fix its `seq` — only a full unapply+reapply
 *  (`recomputeContinuousEffects`) replaces the entry, and by then it copies
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
 *  condition `beginApplyingStaticEffects` itself early-returns on
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
function backfillLegacyStaticSeq(
    state: GameState,
    data: Record<string, unknown>
): void {
    // PRD #2064 S6b-part-2 — five of the eight record kinds below no longer
    // exist on `CardInstanceState`, so the evidence they carry is readable only
    // on the COMPACT rows. Both passes read there; the stamping pass writes
    // there too, because the migrations that consume those rows
    // (`migrateLegacyInstanceKeywordLedgers`,
    // `migrateLegacyLayer2to5Ledgers`) run after this one and need the stamp.
    const compactById = compactBattlefieldRows(data);
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
            const row = compactById.get(target.id);
            for (const spec of LEGACY_SEQ_RECORD_SPECS) {
                const ids = legacySeqRecords(target, row, spec.field)
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
            const row = compactById.get(target.id);
            for (const spec of LEGACY_SEQ_RECORD_SPECS) {
                for (const entry of legacySeqRecords(target, row, spec.field)) {
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

/** The compact battlefield rows of a persisted document, keyed by instance id.
 *
 *  The one place a pre-slice record can still be read: PRD #2064 S6b-part-2
 *  deleted thirteen derived-output fields from `CardInstanceState`, so
 *  `expandCard` drops every one of them and the expanded board carries no trace
 *  (that is also what makes each migration below idempotent by construction —
 *  `compactCard` can never write them back out). */
function compactBattlefieldRows(
    data: Record<string, unknown>
): Map<string, Record<string, unknown>> {
    const rows = new Map<string, Record<string, unknown>>();
    for (const player of (data.players as CompactPlayer[] | undefined) ?? []) {
        for (const compact of player.battlefield ?? []) {
            const row = compact as unknown as Record<string, unknown>;
            const id = row.id;
            if (typeof id === "string") rows.set(id, row);
        }
    }
    return rows;
}
