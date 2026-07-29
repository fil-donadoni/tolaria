import { tryGetCardByName, tryGetDefinition } from "@convex/cards";
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

/** Is this cardId a Basic land? Basics are exempt from Pool membership (ADR
 *  0054/0055) — freely addable/removable in the Maindeck, unlike every other
 *  Pool-sourced card, which can only move between Main and Side. */
export function isBasicLandCardId(cardId: string): boolean {
    return tryGetDefinition(cardId)?.supertypes?.includes("Basic") ?? false;
}
