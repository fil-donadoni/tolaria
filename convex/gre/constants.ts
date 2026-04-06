import type { Color } from "../cards/types";
import type { CardInstanceState } from "./state";

/** Intrinsic mana abilities for basic land subtypes (CR 305.6). */
export const LAND_SUBTYPE_MANA: Record<string, Color> = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
};

/** Card types that represent permanents on the battlefield. */
export const PERMANENT_TYPES = [
    "Creature",
    "Artifact",
    "Enchantment",
    "Planeswalker",
    "Battle",
] as const;

/** All six mana colors in canonical order. */
export const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

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
