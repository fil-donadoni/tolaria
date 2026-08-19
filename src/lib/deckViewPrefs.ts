// The canonical Basic land subtype vocabulary (CR 305.6) — declared once in
// `src/lib/basicLands.ts` and re-exported by `src/components/deckbuilder/basicLands.ts`
// for that component's consumers; this module only needs the type, to shape
// the per-subtype art-preference functions below.
import type { BasicLandSubtype } from "~/lib/basicLands";

/**
 * Deckbuilder view preferences (PRD #1617, ADR 0075 §4 "Persistence: layout on
 * the deck, view preferences on the user"). Per-Zone **Grouping** and
 * **Ordering**, plus the preferred basic-land printing per subtype, are the
 * user's own settings — they apply to every deck the user opens, unlike the
 * **Column Layout** (manual Columns + Card Pins), which is deck data
 * (`userDecks.layout` / `limitedEvents.poolArrangement`) and is handled
 * elsewhere.
 *
 * This module establishes the `tolaria:` key naming and the read/fallback
 * discipline for the new preferences, mirroring the existing per-zone
 * `localStorage` hooks (`useCardZoom.ts`, `useSplitRatio.ts`): one key per
 * (preference, zone-or-subtype) pair, degrading to a documented default on
 * any absent, corrupt, out-of-vocabulary or inaccessible (private mode,
 * quota) storage — never throwing.
 *
 * No UI reads/writes these yet — the Grouping/Ordering controls and the
 * basic-land art picker arrive in later PRD #1617 slices.
 */

/** The Zones a Column Layout applies to, as this storage seam names them.
 *
 *  `"main"` / `"side"` are the build view's two Zones (ADR 0075 §2), kept fully
 *  independent so "Maindeck by Mana Value, Sideboard by colour" is expressible.
 *  They mirror the zone suffixes already used by `useCardZoom`/`useSplitRatio`
 *  (`src/components/lobby/deck-builder/`).
 *
 *  `"draft"` is the draft-time Pool (issue #1632, ADR 0075 §6). It is a THIRD
 *  key, not a reuse of `"main"`, because the reduced draft bar and the build
 *  view's Maindeck bar are different workspaces on purpose: a Grouping picked
 *  under a 30-second pick timer ("show me my curve") is not the one a player
 *  wants when they sit down to build, and sharing the key would make each
 *  surface silently reconfigure the other. The draft Sideboard has no
 *  Grouping/Ordering control at all (see `LimitedDraftPool`), so it needs no
 *  key of its own.
 *
 *  Every consumer that BRANCHES on this union is in `deckZoneColumnView.ts`'s
 *  exhaustive `prefsZone` switch — the one bridge between the engine's Zone
 *  vocabulary (`maindeck`/`sideboard`, `convex/deckLayout.ts`) and this one. */
export type DeckZone = "main" | "side" | "draft";

/**
 * Column-generation axis (ADR 0075 §2: "a Grouping … that generates
 * predicate-carrying Columns"). Declared here, not in `convex/`, because
 * issue #1620's own scope was only this localStorage seam.
 *
 * `convex/deckLayout.ts` has since shipped (issue #1618) and now owns the
 * canonical `GroupingKind`/`OrderingKind` vocabulary this module mirrors —
 * so the ORIGINAL blocker ("no shared engine module exists yet") is gone,
 * but the migration itself (move `Grouping`/`GROUPINGS` there, re-export
 * from here) was never done: this is still a live, un-deduplicated alias.
 * No open issue currently tracks that migration specifically — #1618 and
 * #1620 are both closed/shipped — so this is left as an explicit,
 * untracked out-of-scope note (issue #2560 fixup, finding 2) rather than a
 * `tracked-by:` naming a closed issue, or an invented one.
 */
export const GROUPINGS = ["mv", "color", "type", "none"] as const;
export type Grouping = (typeof GROUPINGS)[number];
/** Mirrors the pre-unification default (Maindeck bucketed into Mana Value
 *  piles) so an unset preference reproduces today's behavior. */
export const DEFAULT_GROUPING: Grouping = "mv";

/** Intra-Column sort axis (ADR 0075 §2), orthogonal to `Grouping`. Same
 *  provisional-home note as `Grouping` above. */
export const ORDERINGS = ["name", "mv", "color", "rarity"] as const;
export type Ordering = (typeof ORDERINGS)[number];
export const DEFAULT_ORDERING: Ordering = "name";

const KEY_PREFIX = "tolaria:deckViewPrefs:";
const GROUPING_KEY_PREFIX = KEY_PREFIX + "grouping:";
const ORDERING_KEY_PREFIX = KEY_PREFIX + "ordering:";
const BASIC_LAND_ART_KEY_PREFIX = KEY_PREFIX + "basicLandArt:";

function isGrouping(value: unknown): value is Grouping {
    return (
        typeof value === "string" &&
        (GROUPINGS as readonly string[]).includes(value)
    );
}

function isOrdering(value: unknown): value is Ordering {
    return (
        typeof value === "string" &&
        (ORDERINGS as readonly string[]).includes(value)
    );
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/**
 * Reads a JSON-encoded value at `key`, applying `guard` to validate its
 * shape/vocabulary. Degrades to `fallback` — never throws — when: the key is
 * absent, the stored content is not valid JSON, the parsed value is JSON but
 * of the wrong type, the parsed value fails the vocabulary guard, or
 * `storage` itself throws (private browsing, quota exceeded).
 */
function readPref<T>(
    storage: Storage,
    key: string,
    guard: (value: unknown) => value is T,
    fallback: T
): T {
    try {
        const raw = storage.getItem(key);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw) as unknown;
        return guard(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

/** Best-effort write — a throwing `storage` (quota exceeded, private
 *  browsing) is swallowed silently rather than surfaced. */
function writePref(storage: Storage, key: string, value: unknown): void {
    try {
        storage.setItem(key, JSON.stringify(value));
    } catch {
        // best-effort persistence — quota/serialization errors are ignored
    }
}

/** Best-effort removal — mirrors `writePref`'s swallow-on-throw discipline. */
function removePref(storage: Storage, key: string): void {
    try {
        storage.removeItem(key);
    } catch {
        // best-effort — nothing to clean up if storage is unavailable
    }
}

/** The Zone's current Grouping, or `DEFAULT_GROUPING` when unset, corrupt, or
 *  out of vocabulary. */
export function loadGrouping(
    zone: DeckZone,
    storage: Storage = window.localStorage
): Grouping {
    return readPref(
        storage,
        GROUPING_KEY_PREFIX + zone,
        isGrouping,
        DEFAULT_GROUPING
    );
}

export function saveGrouping(
    zone: DeckZone,
    grouping: Grouping,
    storage: Storage = window.localStorage
): void {
    writePref(storage, GROUPING_KEY_PREFIX + zone, grouping);
}

/** The Zone's current Ordering, or `DEFAULT_ORDERING` when unset, corrupt, or
 *  out of vocabulary. */
export function loadOrdering(
    zone: DeckZone,
    storage: Storage = window.localStorage
): Ordering {
    return readPref(
        storage,
        ORDERING_KEY_PREFIX + zone,
        isOrdering,
        DEFAULT_ORDERING
    );
}

export function saveOrdering(
    zone: DeckZone,
    ordering: Ordering,
    storage: Storage = window.localStorage
): void {
    writePref(storage, ORDERING_KEY_PREFIX + zone, ordering);
}

/**
 * The user's preferred printing id for a Basic land subtype (ADR 0075
 * "Basic-land art"), or `null` when no override is stored — including on
 * corrupt/wrong-type content or a throwing `storage`. `null` means "no
 * override": callers fall back to the existing heuristic (Pool printing,
 * then catalogue — `resolveBasicLandCardIds` in
 * `src/components/deckbuilder/basicLands.ts`), which is unchanged by this
 * module.
 */
export function loadBasicLandPrintId(
    subtype: BasicLandSubtype,
    storage: Storage = window.localStorage
): string | null {
    return readPref(
        storage,
        BASIC_LAND_ART_KEY_PREFIX + subtype,
        isNonEmptyString,
        null
    );
}

export function saveBasicLandPrintId(
    subtype: BasicLandSubtype,
    printId: string,
    storage: Storage = window.localStorage
): void {
    writePref(storage, BASIC_LAND_ART_KEY_PREFIX + subtype, printId);
}

/** Clears a stored basic-land art preference, reverting the subtype to the
 *  no-override heuristic. */
export function clearBasicLandPrintId(
    subtype: BasicLandSubtype,
    storage: Storage = window.localStorage
): void {
    removePref(storage, BASIC_LAND_ART_KEY_PREFIX + subtype);
}
