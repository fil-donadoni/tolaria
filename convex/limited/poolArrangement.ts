// Pool Arrangement (ADR 0060, issue #1247): pure logic for the per-seat,
// server-persisted layout of the continuous draft→build surface — which
// Mana-Value column each opened Pool card sits in (with a manual override)
// and whether it's parked in the Maindeck or the Sideboard. Kept out of
// `eventTypes.ts` (types only) and `eventProjection.ts` (the privacy
// boundary) the same way `eventLogic.ts`/`draftEngine.ts` keep the actual
// seat-mutation logic out of those two — this module is the thin, pure,
// unit-testable seam the `setPoolArrangementEntry` mutation shell
// (`convex/limitedEvents.ts`) calls into and the frontend derives its
// Maindeck/Sideboard split from (mirrors "one entry per physical card
// opened, not grouped" already established for `LimitedPoolCard`/`pool`
// itself).
//
// Storage shape (issue #1621, ADR 0075 §5): an entry's placement is the
// namespaced **Card Pin** map. The pre-#1621 single `column` override is
// DEPRECATED and read-only — `readEntryPins` below tolerates it on read, and
// `upsertPoolArrangementEntry` emits only `pins`, so an in-flight draft keeps
// working with no coordinated migration.
// Column ids and the legacy→pin normalisation come from the shared Column
// Layout engine (`convex/deckLayout.ts`, ADR 0075, issue #1618) — this module
// never mints or parses a column id of its own, so the id vocabulary has
// exactly one author (issue #1621 AC).
import {
    normalizeLegacyColumn,
    parseColumnId,
    type CardPins,
    type ColumnId,
} from "../deckLayout";
import type { LimitedPoolCard, PoolArrangementEntry } from "./eventTypes";

/** A `{ cardId, cardName }` shape — mirrors `DeckCard` (`~/types/game`)
 *  without importing it, the same dependency-free convention
 *  `eventProjection.ts`'s `ReviewDeckCard` already follows (convex/limited
 *  stays decoupled from `src/types`). */
export interface PlainPoolCard {
    cardId: string;
    cardName: string;
}

/** A patch to fold into one seat's Pool Arrangement, keyed by `poolIndex`.
 *  `sideboard`/`column` each independently default to "don't touch" when
 *  omitted; `column: null` explicitly clears a manual override back to auto
 *  (distinct from `column: undefined`, which leaves any existing override
 *  alone). */
export interface ArrangementPatch {
    poolIndex: number;
    sideboard?: boolean;
    /** The Column this card is pinned to, in EITHER vocabulary (issue #1624):
     *
     *  - a **namespaced {@link ColumnId}** — `mv:6`, `color:R`,
     *    `type:creature`, `custom:combo` — records that namespace's Card Pin
     *    and leaves every other namespace alone (ADR 0075 §3). This is the
     *    full vocabulary the Column Layout engine speaks, and the reason a
     *    colour/type column drag in the Limited deckbuilder can persist at
     *    all: the pre-#1624 arg could only express `mv`, so a drop onto a
     *    `color:` column was silently discarded at the call site;
     *  - a legacy **`number`** Mana-Value column, or the literal
     *    **`"lands"`** — normalises into the `mv` namespace exactly as
     *    before (every draft-time Pool caller still speaks this shape);
     *  - **`null`** — clears the `mv` Pin back to auto.
     *
     *  An UNNAMESPACED string (the Catch-All `catch-all`, the ungrouped
     *  `all`) is not a pin target, so it leaves the Pins untouched rather
     *  than being coerced into `mv` — the same rule `pinCardToColumn`
     *  applies in the engine. */
    column?: number | "lands" | ColumnId | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Tolerant read (ADR 0075 §5, issue #1621)
// ────────────────────────────────────────────────────────────────────────────

/** THE normaliser: one Arrangement entry, in whichever shape it happens to be
 *  stored, read as the namespaced Card Pin map (ADR 0075 §5, "schema evolution
 *  by tolerant read"). Pure — no side effects, no async, no I/O.
 *
 *  - **New shape** (`pins`) passes through unchanged.
 *  - **Legacy shape** (`column`) normalises through the Column Layout engine's
 *    own `normalizeLegacyColumn`: `5 → { mv: "mv:5" }`,
 *    `"lands" → { mv: "mv:lands" }`. The legacy override was ALWAYS a
 *    Mana-Value placement, so it can only ever produce an `mv` Pin.
 *  - **Both shapes** — a row written before this slice and hand-edited since,
 *    or one a future writer left half-migrated — resolves per NAMESPACE, and
 *    **`pins` is the winner**: the deprecated `column` fills the `mv` slot ONLY
 *    when `pins.mv` is absent. `pins` wins because it is the only shape any
 *    write emits after issue #1621, so it is by construction the more recent
 *    of the two; and the rule is applied per namespace rather than
 *    whole-entry so a `color`/`type`/`custom` Pin isn't silently discarded by
 *    the presence of a stale `column` (nor vice versa).
 *
 *  Never mutates `entry`, and never returns the entry's own `pins` object —
 *  callers may keep the result. */
export function readEntryPins(entry: PoolArrangementEntry): CardPins {
    // `normalizeLegacyColumn` returns `{}` for an absent/null column, so the
    // no-legacy case is the same expression.
    return { ...normalizeLegacyColumn(entry.column), ...entry.pins };
}

/** The `mv`-namespace Pin read back as the legacy `number | "lands"` column
 *  the Limited Pool surface still speaks (`limitedPoolColumns.ts`). The
 *  INVERSE of `normalizeLegacyColumn`, and the reason nothing user-visible
 *  changes in issue #1621: the storage shape moved, the resolved placement
 *  did not. `undefined` for no `mv` Pin — and for a Pin naming a column this
 *  read can't express (a `mv` id whose key is neither `"lands"` nor a number),
 *  which reads as "no override" exactly as an unrecognised column always has.
 *
 *  Deliberately narrow: a `color`/`type`/`custom` Pin has no legacy
 *  counterpart, so it is invisible here. Those namespaces reach the UI when
 *  the surface adopts the Column Layout engine, not through this shim. */
export function mvColumnFromPins(pins: CardPins): number | "lands" | undefined {
    if (pins.mv === undefined) return undefined;
    const parsed = parseColumnId(pins.mv);
    if (!parsed || parsed.namespace !== "mv") return undefined;
    if (parsed.key === "lands") return "lands";
    const n = Number(parsed.key);
    return Number.isInteger(n) ? n : undefined;
}

/** Folds `patch` into `arrangement`, returning a NEW array (arrangement
 *  itself is never mutated). An entry that lands back at the fully-default
 *  state (no Pin at all, not sideboarded) is dropped rather than kept as a
 *  no-op row — keeps the persisted array from silently growing forever as a
 *  player toggles a card back and forth. Result is sorted by `poolIndex` for
 *  a deterministic, diff-friendly persisted shape.
 *
 *  WRITES ONLY THE NEW SHAPE (issue #1621): whatever shape the existing entry
 *  was stored in, the merged entry that comes out carries `pins` and NEVER
 *  `column` — so every entry an active seat touches migrates itself, and the
 *  deprecated field can eventually be dropped without a coordinated
 *  migration. The patch's INPUT vocabulary is unchanged (`column`) because
 *  the mutation's wire args and every caller still speak it; only the
 *  persisted shape moves. */
export function upsertPoolArrangementEntry(
    arrangement: readonly PoolArrangementEntry[],
    patch: ArrangementPatch
): PoolArrangementEntry[] {
    const existing = arrangement.find((e) => e.poolIndex === patch.poolIndex);
    const nextSideboard = patch.sideboard ?? existing?.sideboard ?? false;
    const existingPins = existing ? readEntryPins(existing) : {};
    const nextPins = applyColumnPatch(existingPins, patch.column);

    const rest = arrangement.filter((e) => e.poolIndex !== patch.poolIndex);
    const isDefault = !nextSideboard && Object.keys(nextPins).length === 0;
    if (isDefault) return rest;

    const merged: PoolArrangementEntry = { poolIndex: patch.poolIndex };
    if (nextSideboard) merged.sideboard = true;
    if (Object.keys(nextPins).length > 0) merged.pins = nextPins;
    return [...rest, merged].sort((a, b) => a.poolIndex - b.poolIndex);
}

/** The patch's `column` field applied to an already-normalised Pin map — the
 *  ONE place the two column vocabularies meet (see {@link ArrangementPatch}):
 *
 *  - `undefined` leaves every Pin alone;
 *  - `null` clears the `mv` Pin back to auto (and ONLY that one — a Pin is
 *    never erased across namespaces, ADR 0075 §3);
 *  - a namespaced `ColumnId` overwrites THAT namespace's Pin and nothing else,
 *    so pinning into a colour column never disturbs the `mv` arrangement built
 *    during the draft (and vice versa);
 *  - a legacy `number`/`"lands"` normalises into the `mv` namespace.
 *
 *  Fail-closed on an unnamespaced id (`catch-all`, `all`): it is not a pin
 *  target, so it records nothing rather than being coerced into `mv`. */
function applyColumnPatch(
    pins: CardPins,
    column: ArrangementPatch["column"]
): CardPins {
    if (column === undefined) return pins;
    if (column === null) {
        const cleared = { ...pins };
        delete cleared.mv;
        return cleared;
    }
    if (typeof column === "string") {
        if (column === "lands") {
            return { ...pins, ...normalizeLegacyColumn("lands") };
        }
        const parsed = parseColumnId(column);
        if (!parsed) return pins;
        return { ...pins, [parsed.namespace]: column };
    }
    return { ...pins, ...normalizeLegacyColumn(column) };
}

/** One resolved Pool card placement — the Arrangement's default (Maindeck,
 *  auto column) folded with any recorded override for that `poolIndex`. */
export interface ResolvedPlacement {
    poolIndex: number;
    card: LimitedPoolCard;
    sideboard: boolean;
    /** This card's Card Pins (ADR 0075 §3), normalised out of whichever shape
     *  the Arrangement entry is stored in — the input the Column Layout
     *  engine's `resolveColumnLayout` takes. `{}` for an unpinned card. */
    pins: CardPins;
    /** The `mv` Pin read back as the legacy column vocabulary the Limited Pool
     *  surface still speaks — a numeric Mana-Value column, or `"lands"`.
     *  Absent = auto (a Land card's own type, else the card's own mana value).
     *  Derived from {@link ResolvedPlacement.pins} via `mvColumnFromPins`, so
     *  a legacy `column` row and a `pins` row resolve identically (issue
     *  #1621: nothing user-visible changes). */
    columnOverride?: number | "lands";
}

/** Resolves every card in `pool` against `arrangement` (`undefined` = an
 *  untouched seat — every card defaults to Maindeck). Continuous
 *  draft→build (ADR 0060): unlike the pre-#1247 Sealed convention ("every
 *  Pool card starts in the Sideboard"), a card with no recorded Arrangement
 *  entry is ALREADY in the working deck — the whole point of "the draft-time
 *  Pool IS the working deck." */
export function resolvePoolPlacements(
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[] | undefined
): ResolvedPlacement[] {
    const byIndex = new Map((arrangement ?? []).map((e) => [e.poolIndex, e]));
    return pool.map((card, poolIndex) => {
        const entry = byIndex.get(poolIndex);
        // The ONE place a stored entry is read: legacy `column`, new `pins`,
        // or both all normalise here (ADR 0075 §5), so no downstream consumer
        // ever sees the deprecated field.
        const pins = entry ? readEntryPins(entry) : {};
        return {
            poolIndex,
            card,
            sideboard: entry?.sideboard ?? false,
            pins,
            columnOverride: mvColumnFromPins(pins),
        };
    });
}

/** `resolvePoolPlacements` reshaped into the Maindeck/Sideboard `DeckCard[]`
 *  split the pool deckbuilder surface renders (`PoolDeckbuilderSurface`) —
 *  the seed a freshly-opened draft-time Pool view or a just-completed
 *  Draft's build view starts from, so the Arrangement built during the draft
 *  "carries unchanged into deckbuild" (ADR 0060). */
export function splitPoolByArrangement(
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[] | undefined
): { cards: PlainPoolCard[]; sideboard: PlainPoolCard[] } {
    const cards: PlainPoolCard[] = [];
    const sideboard: PlainPoolCard[] = [];
    for (const placement of resolvePoolPlacements(pool, arrangement)) {
        const target = placement.sideboard ? sideboard : cards;
        target.push({
            cardId: placement.card.cardId,
            cardName: placement.card.cardName,
        });
    }
    return { cards, sideboard };
}

/** Finds the `poolIndex` of the first card matching `cardId` currently on
 *  the `fromSideboard` side — what a Maindeck⇄Sideboard move (click or drag
 *  on the shared surface) needs to resolve a `cardId`-keyed UI action back to
 *  the `poolIndex` the persistence mutation is keyed on. Mirrors the
 *  existing "first match by cardId" convention `src/lib/deckSideboard.ts`
 *  already uses for the post-draft build view — duplicate copies of the same
 *  card are interchangeable for this purpose. `null` when no such card is
 *  found (stale UI state — e.g. a concurrent update already moved it). */
export function findMovablePoolIndex(
    placements: readonly ResolvedPlacement[],
    cardId: string,
    fromSideboard: boolean
): number | null {
    const hit = placements.find(
        (p) => p.card.cardId === cardId && p.sideboard === fromSideboard
    );
    return hit ? hit.poolIndex : null;
}

/** The Card Pins recorded for each `cardId` present in `pool`, keyed by Card
 *  ID (issue #1575, re-expressed in the namespaced Pin vocabulary for the
 *  shared zone surface, issue #1622). The Limited deckbuilder renders its
 *  zones from `cardId`-keyed `DeckCard`s — it lost the per-copy `poolIndex`
 *  identity the draft Pool keeps — so it looks a card's Pins up by id,
 *  treating duplicate copies as interchangeable (the same convention
 *  `findMovablePoolIndex` above and `deckSideboard.ts` already use). When two
 *  copies carry divergent Pins the higher `poolIndex` wins (last write); a
 *  card with no Pin at all is absent from the map (auto column).
 *
 *  This is exactly the `ColumnLayout.pins` shape, so the surface hands the
 *  result straight to `resolveColumnLayout` with no per-surface translation. */
export function pinsByCardId(
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[] | undefined
): Record<string, CardPins> {
    const byCardId: Record<string, CardPins> = {};
    for (const placement of resolvePoolPlacements(pool, arrangement)) {
        if (Object.keys(placement.pins).length > 0) {
            byCardId[placement.card.cardId] = placement.pins;
        }
    }
    return byCardId;
}

/** Resolves a `cardId`-keyed deckbuilder column drag back to the `poolIndex`
 *  `setPoolArrangementEntry` keys its column override on (issue #1575). Prefers
 *  a copy currently in the Maindeck (`sideboard: false`) — the copy the player
 *  is looking at when they drag between columns — then falls back to ANY copy
 *  of that card, so a column drag still records even for a card the Arrangement
 *  happens to have parked in the Sideboard (duplicate copies are
 *  interchangeable). `null` for a card that isn't in the Pool at all (a Basic
 *  land added from the bar — it has no `poolIndex`, so its column can't be
 *  overridden and the drag is a no-op). */
export function findColumnOverrideablePoolIndex(
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[] | undefined,
    cardId: string
): number | null {
    const placements = resolvePoolPlacements(pool, arrangement);
    const inMain = placements.find(
        (p) => p.card.cardId === cardId && !p.sideboard
    );
    if (inMain) return inMain.poolIndex;
    const any = placements.find((p) => p.card.cardId === cardId);
    return any ? any.poolIndex : null;
}
