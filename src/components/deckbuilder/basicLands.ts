import { tryGetCardByName } from "@convex/cards/catalogue";
import { tryGetDefinition } from "@convex/cards";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { BASIC_LAND_SUBTYPES, type BasicLandSubtype } from "~/lib/basicLands";

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
