import {
    getPrintingsForCard,
    tryGetCardByName,
    type CardPrinting,
} from "@convex/cards/catalogue";
import { tryGetDefinition } from "@convex/cards";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { BASIC_LAND_SUBTYPES, type BasicLandSubtype } from "~/lib/basicLands";
import {
    loadBasicLandPrintId,
    saveBasicLandPrintId,
} from "~/lib/deckViewPrefs";

/** Re-exported for this module's own consumers (`pool-basic-lands-bar.tsx`)
 *  — the canonical declaration lives in `src/lib/basicLands.ts` (CR 305.2,
 *  ADR 0054/0055: the only card names a Limited deck can add in unlimited
 *  quantity), shared with `src/lib/deckViewPrefs.ts`. */
export { BASIC_LAND_SUBTYPES, type BasicLandSubtype };

/**
 * The cardId to use for each Basic subtype, ALWAYS one per subtype (issue
 * #1576): a Limited deck always needs access to all five basics regardless
 * of what the drafted set happened to print into this particular Pool —
 * a Vintage Cube worklist prints no basics at all (PRD #1107's Cube capstone
 * cluster), yet the bar must still offer every one of them. Two-tier lookup:
 *
 * 1. **Pool-sourced printing preferred** — if the seat's own opened Pool
 *    contains a copy of this Basic subtype, its cardId is used so the added
 *    land matches the drafted set's own art/printing (mirrors
 *    `resolveBasicLandFor` in `convex/limitedEvents.ts`).
 * 2. **Catalogue fallback** — otherwise resolve the subtype's canonical
 *    `CardDefinition` by name (`tryGetCardByName`, basic land names ARE their
 *    subtype names, CR 305.6) from the card registry, independent of Pool
 *    contents. Every basic land name is a real, always-registered
 *    `CardDefinition` (LEA `colorless.ts`), so this only returns `null` in a
 *    pathological catalogue-missing case.
 */
export function resolveBasicLandCardIds(
    pool: readonly LimitedPoolCard[]
): Record<BasicLandSubtype, string | null> {
    const result: Record<BasicLandSubtype, string | null> = {
        Plains: null,
        Island: null,
        Swamp: null,
        Mountain: null,
        Forest: null,
    };
    for (const card of pool) {
        const def = tryGetDefinition(card.cardId);
        if (!def?.supertypes?.includes("Basic")) continue;
        for (const subtype of BASIC_LAND_SUBTYPES) {
            if (result[subtype] === null && def.subtypes?.includes(subtype)) {
                result[subtype] = card.cardId;
            }
        }
    }
    for (const subtype of BASIC_LAND_SUBTYPES) {
        if (result[subtype] === null) {
            result[subtype] = tryGetCardByName(subtype)?.id ?? null;
        }
    }
    return result;
}

/** The Constructed variant of the resolution above (issue #1627): Constructed
 *  has no Pool, so every subtype falls straight through to tier 2 — the
 *  catalogue's canonical printing. Expressed as `resolveBasicLandCardIds`
 *  called with an empty Pool, rather than a parallel lookup, so the two
 *  builders can never independently disagree on which `CardDefinition`
 *  "Mountain" resolves to; the art-preference layering promised for a later
 *  slice (issue #1617) is the only place that is meant to diverge. */
export function resolveCanonicalBasicLandCardIds(): Record<
    BasicLandSubtype,
    string | null
> {
    return resolveBasicLandCardIds([]);
}

/** The Basic subtype a cardId resolves to, or `null` if it isn't a Basic land
 *  at all — the ONE classifier every basics affordance keys off:
 *  `isBasicLandCardId`, the bar's counter (`countBasicLandCopies`) and the
 *  bar's remove path (`findBasicLandRemovalIndex`).
 *
 *  Sharing it is load-bearing, not tidiness (PR #2320 review B1). `cardId` is
 *  whatever id the entry was ADDED under, which is a PRINT id from the
 *  Constructed search grid's edition dropdown and a Pool printing in Limited;
 *  `tryGetDefinition` resolves all 30+ Mountain prints back to the one
 *  Mountain definition. A counter that classifies by subtype paired with a
 *  remover that matched by `cardId` therefore counted copies it could never
 *  remove, and offered an ENABLED `−` button that silently did nothing. */
export function basicLandSubtypeOf(cardId: string): BasicLandSubtype | null {
    const def = tryGetDefinition(cardId);
    if (!def?.supertypes?.includes("Basic")) return null;
    for (const subtype of BASIC_LAND_SUBTYPES) {
        if (def.subtypes?.includes(subtype)) return subtype;
    }
    return null;
}

/** Is this cardId a Basic land? Basics are exempt from Pool membership (ADR
 *  0054/0055) — freely addable/removable in the Maindeck, unlike every other
 *  Pool-sourced card, which can only move between Main and Side. */
export function isBasicLandCardId(cardId: string): boolean {
    return basicLandSubtypeOf(cardId) !== null;
}

/** The Maindeck's current copy count per Basic subtype (issue #1627) — what
 *  the bar's per-subtype counter reads, and what gates its remove affordance
 *  at the zero floor. Classifies by SUBTYPE rather than by matching each
 *  subtype's own `cardIdsBySubtype[subtype]` value, so a Maindeck holding two
 *  different Mountain printings (a Pool-opened one plus, in a later slice, an
 *  art-picker choice) still counts both toward "Mountain" — the counter reads
 *  the physical mana base, not one specific printing. Non-Basic entries are
 *  ignored; an unresolvable cardId counts toward nothing rather than
 *  throwing. */
export function countBasicLandCopies(
    cards: readonly { cardId: string }[]
): Record<BasicLandSubtype, number> {
    const counts: Record<BasicLandSubtype, number> = {
        Plains: 0,
        Island: 0,
        Swamp: 0,
        Mountain: 0,
        Forest: 0,
    };
    for (const card of cards) {
        const subtype = basicLandSubtypeOf(card.cardId);
        if (subtype !== null) counts[subtype]++;
    }
    return counts;
}

/**
 * Which Maindeck entry a "remove one <subtype>" gesture takes out, or `-1`
 * when the zone holds none (issue #1627, PR #2320 review B1/NB1). The
 * counter's exact inverse: it classifies through `basicLandSubtypeOf`, the
 * same function `countBasicLandCopies` counts with, so every copy the bar
 * displays is a copy the bar can remove — whatever printing it was added
 * under.
 *
 * Two selection rules on top of that, in order:
 *
 * 1. **An explicitly named copy wins** (`pinKey`, issue #1626). A tap on a
 *    Maindeck TILE identifies one physical copy; that copy is the one that
 *    leaves, exactly as for a non-Basic. The bar's own gesture names no copy
 *    (there is no tile to tap), so it falls through to rule 2.
 * 2. **Prefer an UNPINNED copy, scanning from the end.** Pool-seeded entries
 *    carry a `pinKey` and precede the bar-appended ones, so first-match
 *    removal took the Pool copy — leaving the working deck and stranding the
 *    Column Pin recorded against it, while the copy the user had just added
 *    stayed (NB1). Basics are Pool-exempt (ADR 0054/0055), so a bar-added
 *    copy is always the safer thing to give back; the last pinned copy is
 *    the fallback for a Maindeck that holds only Pool ones.
 */
export function findBasicLandRemovalIndex(
    cards: readonly { cardId: string; pinKey?: string }[],
    subtype: BasicLandSubtype,
    pinKey?: string
): number {
    if (pinKey !== undefined) {
        const named = cards.findIndex((c) => c.pinKey === pinKey);
        if (named >= 0) return named;
    }
    let pinnedFallback = -1;
    for (let i = cards.length - 1; i >= 0; i--) {
        if (basicLandSubtypeOf(cards[i].cardId) !== subtype) continue;
        if (cards[i].pinKey === undefined) return i;
        if (pinnedFallback < 0) pinnedFallback = i;
    }
    return pinnedFallback;
}

// --- Basic-land art picker (issue #1629, ADR 0075 § "Basic-land art") -----
//
// Every basic's fifteen printings differ ONLY by art (`lea×2, leb×3, ice,
// 2ed×3, 3ed×3, 4ed×3`), so the existing per-card edition dropdown
// (`src/lib/editions.ts`, `EditionDropdown`) is unusable here — a bare `LEB
// #3` tells the player nothing about what they're picking. The functions
// below are the pure half of the picker; the popover/grid UI lives in
// `basic-land-art-picker.tsx`, and the two builders own the React state that
// seeds from and writes through `recordBasicLandArtChoice`/
// `seededBasicLandArt` (mirrors `deckZoneColumnView.ts`'s
// `seededColumnView`/`recordGroupingChange` split for Grouping/Ordering).

/** Every printing of a Basic subtype's canonical `CardDefinition` — the art
 *  grid's full candidate list, before the Format filter. `[]` only in the
 *  pathological case where the catalogue has no definition for the subtype's
 *  name at all (mirrors `resolveBasicLandCardIds`'s own fallback). */
export function basicLandPrintings(subtype: BasicLandSubtype): CardPrinting[] {
    const def = tryGetCardByName(subtype);
    if (!def) return [];
    return getPrintingsForCard(def.id);
}

/** `basicLandPrintings` narrowed to what the deck's Format allows (issue
 *  #1629 AC3) — `allowedSets: null` (Freeform, Limited: Pool-scoped legality
 *  never restricts by set) offers every printing unfiltered. Keys on the
 *  printing's OWN `setCode`, never the subtype's canonical definition's set,
 *  so an LEB-printed Mountain is offered under an `["leb"]`-restricted
 *  Format even though the canonical Mountain definition is an LEA card. */
export function legalBasicLandPrintings(
    subtype: BasicLandSubtype,
    allowedSets: string[] | null
): CardPrinting[] {
    const printings = basicLandPrintings(subtype);
    if (allowedSets === null) return printings;
    const allowed = new Set(allowedSets);
    return printings.filter((p) => allowed.has(p.setCode));
}

/** Is `printId` a printing of `subtype`'s definition, AND legal under
 *  `allowedSets`? The single predicate a stored preference must pass before
 *  it is allowed to override the default resolution (issue #1629 AC8) — a
 *  stale id (the printing was retired from the catalogue) or a now-illegal
 *  one (the deck's Format changed, or was always narrower than when the
 *  preference was set) both read `false` here and fall through silently. */
function isLegalBasicLandPrinting(
    subtype: BasicLandSubtype,
    printId: string,
    allowedSets: string[] | null
): boolean {
    return legalBasicLandPrintings(subtype, allowedSets).some(
        (p) => p.printId === printId
    );
}

/** The subtype→printId preference to SEED a builder's held state from on
 *  mount (issue #1629) — the user's stored choice per subtype, or omitted
 *  entirely for a subtype never chosen. Pure read; callers own the state
 *  (mirrors `seededColumnView`). */
export function seededBasicLandArt(
    storage: Storage = window.localStorage
): Partial<Record<BasicLandSubtype, string>> {
    const seed: Partial<Record<BasicLandSubtype, string>> = {};
    for (const subtype of BASIC_LAND_SUBTYPES) {
        const stored = loadBasicLandPrintId(subtype, storage);
        if (stored !== null) seed[subtype] = stored;
    }
    return seed;
}

/** Persists a picked printing for `subtype` (issue #1629). Callers still
 *  apply the choice to their own held preference state AND rewrite the open
 *  deck's copies separately (`rewriteBasicLandArtInDeck`) — this only writes
 *  the per-user preference (mirrors `recordGroupingChange`). */
export function recordBasicLandArtChoice(
    subtype: BasicLandSubtype,
    printId: string,
    storage: Storage = window.localStorage
): void {
    saveBasicLandPrintId(subtype, printId, storage);
}

/**
 * Layers a held basic-land art preference on top of the existing
 * Pool/catalogue resolution (`resolveBasicLandCardIds` /
 * `resolveCanonicalBasicLandCardIds`) — the precedence issue #1629 AC7/AC8
 * calls for: **stored preference (if legal) → Pool printing → catalogue
 * default**. `baseIds` already encodes the last two tiers; this only ever
 * overrides a subtype whose preference is both present and
 * `isLegalBasicLandPrinting` — an absent, stale, or now-illegal preference
 * leaves `baseIds[subtype]` untouched, which IS the silent fallback AC8
 * requires (no error, no prompt, just the default resolution).
 */
export function applyBasicLandArtPreference(
    baseIds: Record<BasicLandSubtype, string | null>,
    preference: Partial<Record<BasicLandSubtype, string>>,
    allowedSets: string[] | null
): Record<BasicLandSubtype, string | null> {
    const result = { ...baseIds };
    for (const subtype of BASIC_LAND_SUBTYPES) {
        const preferred = preference[subtype];
        if (preferred === undefined) continue;
        if (!isLegalBasicLandPrinting(subtype, preferred, allowedSets))
            continue;
        result[subtype] = preferred;
    }
    return result;
}

/**
 * Rewrites every copy of `subtype` in `cards` to `printId` — the retroactive
 * half of the picker (issue #1629 AC5: "changing the art rewrites the copies
 * already in the open deck"). Preserves ARRAY POSITION and every other field
 * on the entry (`pinKey` included) — only `cardId` changes. A copy of a
 * DIFFERENT subtype, or a non-Basic card, passes through untouched. Returns
 * the SAME array reference when nothing changed, so a caller's `updateDeck`
 * doesn't schedule a save for a subtype the zone doesn't hold.
 *
 * This does NOT, by itself, keep a Column Pin recorded against one of these
 * copies intact (review of PR #2325, findings F1/F2). Preserving the
 * OPTIONAL `pinKey` FIELD preserves nothing for a Constructed entry, which
 * never carries one — `deck-zone-surface.tsx` falls back to `card.pinKey ??
 * card.cardId`, so for a Basic land the Pin's KEY *is* the `cardId` this
 * function just changed. A caller that pins by `cardId` (Constructed) MUST
 * separately re-key its persisted Pins — see `basicLandArtCardIdsToRemap`
 * below and `remapPinKeys` (`convex/deckLayout.ts`) — in the SAME edit, or
 * the Pin is orphaned under an id nothing resolves to anymore (the exact
 * failure mode `findBasicLandRemovalIndex`'s own doc comment above warns
 * about for the remove gesture). A Limited entry is unaffected in-session
 * (its Pin key is `poolIndex`-based, untouched by a `cardId` change) but has
 * its own re-attachment gap on reload — see `assignPoolCopies`
 * (`convex/limited/poolArrangement.ts`).
 *
 * A copy that ALREADY carries `printId` is left alone rather than replaced
 * with an equal-valued clone (review of PR #2325, note N1) — this is what
 * makes "re-picking the art already in effect" a genuine no-op: without it,
 * `changed` was set on every subtype match regardless of whether the id was
 * already the target, so re-selecting the current art still returned a fresh
 * array and the caller scheduled a save of byte-identical content. It also
 * keeps this function's own exclusion consistent with
 * `basicLandArtCardIdsToRemap`'s below, which already excludes `printId` from
 * the ids to remap.
 */
export function rewriteBasicLandArt<
    T extends { cardId: string; cardName: string },
>(cards: readonly T[], subtype: BasicLandSubtype, printId: string): T[] {
    let changed = false;
    const next = cards.map((card) => {
        if (card.cardId === printId) return card;
        if (basicLandSubtypeOf(card.cardId) !== subtype) return card;
        changed = true;
        return { ...card, cardId: printId };
    });
    return changed ? next : (cards as T[]);
}

/** `rewriteBasicLandArt` applied to BOTH zones of an open deck (issue #1629
 *  AC5: "rewrites every copy … in the currently open deck" names no zone,
 *  and a Basic moves freely between Maindeck and Sideboard) — never any
 *  OTHER saved deck (AC6), since this is a pure map over the caller's own
 *  in-memory `WorkingDeck`, not a query. */
export function rewriteBasicLandArtInDeck<
    T extends { cardId: string; cardName: string },
>(
    deck: { cards: readonly T[]; sideboard: readonly T[] },
    subtype: BasicLandSubtype,
    printId: string
): { cards: T[]; sideboard: T[] } {
    return {
        cards: rewriteBasicLandArt(deck.cards, subtype, printId),
        sideboard: rewriteBasicLandArt(deck.sideboard, subtype, printId),
    };
}

/** The distinct OLD `cardId`s a `rewriteBasicLandArt*` call against `cards`
 *  would replace with `printId` (issue #1629 fixup, finding F1) — every
 *  identity a Constructed Card Pin might currently be recorded under for this
 *  subtype, and therefore every key a caller must fold onto `printId` (e.g.
 *  via `remapPinKeys`, `convex/deckLayout.ts`) in the SAME edit as the
 *  rewrite, so the persisted layout never accumulates an orphaned key. Pure
 *  read — computed alongside the rewrite, never in place of it. `printId`
 *  itself is excluded: it is the destination, never something to remap FROM.
 *  `[]` when the zone holds no copy of `subtype` at all, or already holds
 *  only `printId` (nothing to remap). */
export function basicLandArtCardIdsToRemap(
    cards: readonly { cardId: string }[],
    subtype: BasicLandSubtype,
    printId: string
): string[] {
    const ids = new Set<string>();
    for (const card of cards) {
        if (
            card.cardId !== printId &&
            basicLandSubtypeOf(card.cardId) === subtype
        ) {
            ids.add(card.cardId);
        }
    }
    return [...ids];
}
