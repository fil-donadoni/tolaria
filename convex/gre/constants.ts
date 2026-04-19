import type { Color, ManaCost } from "../cards/types";
import { getCardById } from "../cards";
import type { CardInstanceState } from "./state";

/** Intrinsic mana abilities for basic land subtypes (CR 305.6). */
export const LAND_SUBTYPE_MANA: Record<string, Color> = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
};

/** Landwalk keywords mapped to the land subtype they reference (CR 702.13c-g). */
export const LANDWALK_KEYWORDS: Record<string, string> = {
    plainswalk: "Plains",
    islandwalk: "Island",
    swampwalk: "Swamp",
    mountainwalk: "Mountain",
    forestwalk: "Forest",
};

/** Card types that represent permanents on the battlefield. */
export const PERMANENT_TYPES = [
    "Creature",
    "Artifact",
    "Enchantment",
    "Planeswalker",
    "Battle",
] as const;

/**
 * Permanent types that can be dealt damage (CR 120.3). Damage to any other
 * permanent (artifact, enchantment, land) is a no-op. This is also the set
 * of permanent types matched by a `"any target"` spell (CR 115.4).
 */
export const DAMAGEABLE_PERMANENT_TYPES = [
    "Creature",
    "Planeswalker",
    "Battle",
] as const;

export function isDamageablePermanent(card: CardInstanceState): boolean {
    return DAMAGEABLE_PERMANENT_TYPES.some((t) => card.types.includes(t));
}

/** All six mana colors in canonical order. */
export const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

/** Mana value of a cost (CR 202.3). Numeric `X` counts as its value; string `X` counts as 0 (unpaid). */
export function manaValue(cost?: ManaCost): number {
    if (!cost) return 0;
    let total = 0;
    for (const key of ["X", "W", "U", "B", "R", "G", "C"] as const) {
        const v = cost[key];
        if (typeof v === "number") total += v;
    }
    return total;
}

/** Returns the mana color a land produces via basic land subtype, or null. */
export function getBasicLandMana(card: CardInstanceState): Color | null {
    for (const subtype of card.subtypes) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
}

export function isCreature(card: CardInstanceState): boolean {
    return card.types.includes("Creature");
}

export function isLand(card: CardInstanceState): boolean {
    return card.types.includes("Land");
}

/** Returns the mana color produced by a tap mana ability (e.g. Mox), or null. */
export function getActivatedManaColor(card: CardInstanceState): Color | null {
    const cardDef = getCardById(card.card.id as string);
    const ability = cardDef.activatedAbilities?.find(
        (a) => a.cost.tap && !a.useStack && a.manaProduced
    );
    if (!ability?.manaProduced) return null;
    const colors = Object.entries(ability.manaProduced)
        .filter(([k, v]) => k !== "X" && typeof v === "number" && v > 0)
        .map(([k]) => k as Color);
    return colors.length === 1 ? colors[0] : null;
}

/** Returns the mana produced by a tap mana ability, or null. Supports multi-color (e.g. Signet). */
export function getActivatedManaProduced(
    card: CardInstanceState
): ManaCost | null {
    const cardDef = getCardById(card.card.id as string);
    const ability = cardDef.activatedAbilities?.find(
        (a) => a.cost.tap && !a.useStack && a.manaProduced
    );
    return ability?.manaProduced ?? null;
}

/** Amount of a single color produced by a card's fixed (non-choice) tap mana
 *  ability. Basic lands and abilities without an explicit count default to 1;
 *  abilities like Sol Ring ({T}: Add {C}{C}) return 2. */
export function getFixedManaAmount(
    card: CardInstanceState,
    color: Color
): number {
    const produced = getActivatedManaProduced(card);
    return produced?.[color] ?? 1;
}

/** Returns the activated mana ability definition for a card, or null. */
export function getActivatedManaAbility(card: CardInstanceState) {
    const cardDef = getCardById(card.card.id as string);
    return (
        cardDef.activatedAbilities?.find(
            (a) => !a.useStack && (a.manaProduced || a.manaChoices)
        ) ?? null
    );
}

/** Returns true if a card has a tap mana ability (basic land subtype or activated). */
export function hasManaAbility(card: CardInstanceState): boolean {
    return (
        getBasicLandMana(card) !== null ||
        getActivatedManaAbility(card) !== null
    );
}
