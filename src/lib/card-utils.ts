import type { CardInstance } from "~/types/game";
import type { Color, ManaCost } from "~/types/cards";
import { LAND_SUBTYPE_MANA } from "@convex/gre/constants";
import { getCardById } from "@convex/cards";

export function isLand(card: CardInstance): boolean {
    return (
        card.types?.includes("Land") ??
        card.card.types?.includes("Land") ??
        false
    );
}

export function isCreature(card: CardInstance): boolean {
    return (
        card.types?.includes("Creature") ??
        card.card.types?.includes("Creature") ??
        false
    );
}

export function getLandManaColor(card: CardInstance): Color | null {
    const subtypes = card.subtypes ?? card.card.subtypes ?? [];
    for (const subtype of subtypes) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
}

/** Returns true if a card has a tap mana ability (basic land subtype or activated). */
export function hasManaAbility(card: CardInstance): boolean {
    if (getLandManaColor(card) !== null) return true;
    const cardDef = getCardById(card.card.id);
    return !!cardDef.activatedAbilities?.some(
        (a) => !a.useStack && (a.manaProduced || a.manaChoices)
    );
}

/** Returns the mana choices for a card with a choice-based mana ability, or null. */
export function getManaChoices(card: CardInstance): ManaCost[] | null {
    const cardDef = getCardById(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) => !a.useStack && a.manaChoices
    );
    return ability?.manaChoices ?? null;
}

/** Returns the mana color produced by an activated tap ability, or null. */
export function getActivatedManaColor(card: CardInstance): Color | null {
    const cardDef = getCardById(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) => a.cost.tap && !a.useStack && a.manaProduced
    );
    if (!ability?.manaProduced) return null;
    const colors = Object.entries(ability.manaProduced)
        .filter(([k, v]) => k !== "X" && typeof v === "number" && v > 0)
        .map(([k]) => k as Color);
    return colors.length === 1 ? colors[0] : null;
}

export function isTargetableCreature(targetType: string | undefined): boolean {
    return targetType === "creature" || targetType === "any";
}

export function groupByName(cards: CardInstance[]): CardInstance[][] {
    const groups: Map<string, CardInstance[]> = new Map();
    for (const card of cards) {
        const name = card.card.name;
        const group = groups.get(name);
        if (group) {
            group.push(card);
        } else {
            groups.set(name, [card]);
        }
    }
    return [...groups.values()];
}
