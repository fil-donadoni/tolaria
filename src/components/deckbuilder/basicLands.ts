import { tryGetDefinition } from "@convex/cards";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";

/** The five Basic land subtypes, in WUBRG order — the only card names a
 *  Limited deck can add in unlimited quantity (CR 305.2, ADR 0054/0055). */
export const BASIC_LAND_SUBTYPES = [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
] as const;

export type BasicLandSubtype = (typeof BASIC_LAND_SUBTYPES)[number];

/**
 * The cardId to use for each Basic subtype the drafted Pack Source actually
 * printed — sourced from the seat's own opened Pool, never a hardcoded id.
 * Real boosters carry basics on the common sheet (verified for LEA, PRD
 * #1107), so a Sealed Pool almost always includes at least one copy of every
 * subtype; a subtype genuinely absent from the Pool (no booster happened to
 * open one) is simply not offered — "unlimited basics" is bounded by "the
 * drafted set actually prints this land", never invented from an unrelated
 * set. `null` for a subtype not found in the Pool.
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
    return result;
}

/** Is this cardId a Basic land? Basics are exempt from Pool membership (ADR
 *  0054/0055) — freely addable/removable in the Maindeck, unlike every other
 *  Pool-sourced card, which can only move between Main and Side. */
export function isBasicLandCardId(cardId: string): boolean {
    return tryGetDefinition(cardId)?.supertypes?.includes("Basic") ?? false;
}
