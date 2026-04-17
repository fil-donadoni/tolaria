import type { CardInstance } from "~/types/game";
import type { Color } from "~/types/cards";
import { LAND_SUBTYPE_MANA } from "@convex/gre/constants";

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
