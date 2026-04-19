import type { CardInstance, ManaPool } from "~/types/game";
import type { Color, ManaCost } from "~/types/cards";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_SUBTYPE_MANA,
    LANDWALK_KEYWORDS,
} from "@convex/gre/constants";
import { getCardById } from "@convex/cards";
import { isManaCostCovered, normalizeManaCost } from "@convex/gre/state";

export function isLand(card: CardInstance): boolean {
    return card.types?.includes("Land") ?? false;
}

export function isCreature(card: CardInstance): boolean {
    return card.types?.includes("Creature") ?? false;
}

/**
 * Returns true if `attacker` has a landwalk keyword (CR 702.13b) for a land
 * subtype present anywhere in `defenderBattlefield`. Such an attacker can't
 * be blocked at all and should be filtered out of blocker-eligibility checks.
 */
export function isLandwalkUnblockable(
    attacker: CardInstance,
    defenderBattlefield: CardInstance[]
): boolean {
    const abilities = attacker.staticAbilities ?? [];
    for (const [keyword, subtype] of Object.entries(LANDWALK_KEYWORDS)) {
        if (!abilities.includes(keyword)) continue;
        const hasLand = defenderBattlefield.some(
            (c) => isLand(c) && (c.subtypes?.includes(subtype) ?? false)
        );
        if (hasLand) return true;
    }
    return false;
}

export function getLandManaColor(card: CardInstance): Color | null {
    const subtypes = card.subtypes ?? [];
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

/** Returns true if the target requirement includes permanents (not player-only). */
export function wantsPermanentTarget(
    targetType: string | string[] | undefined
): boolean {
    if (!targetType) return false;
    const types = Array.isArray(targetType) ? targetType : [targetType];
    return types.some((t) => t !== "player");
}

/** Returns true if a card on the battlefield matches the pending target requirement. */
export function matchesTargetRequirement(
    card: CardInstance,
    targetType: string | string[]
): boolean {
    const types = Array.isArray(targetType) ? targetType : [targetType];
    const cardTypes = card.types ?? [];
    // CR 115.4 / 120.3: "any target" only matches damageable permanents
    // (creatures, planeswalkers, battles) — never lands, artifacts, enchantments.
    if (types.includes("any")) {
        return DAMAGEABLE_PERMANENT_TYPES.some((t) => cardTypes.includes(t));
    }
    return types.some((t) => cardTypes.includes(t as never));
}

/** Returns stack-using activated abilities that can currently be activated (costs payable). */
export function getStackAbilities(
    card: CardInstance,
    manaPool: ManaPool
): { id: string; oracleText: string }[] {
    const cardDef = getCardById(card.card.id);
    return (cardDef.activatedAbilities ?? [])
        .filter((a) => {
            if (!a.useStack || !a.oracleText) return false;
            if (a.cost.tap && card.isTapped) return false;
            if (a.cost.mana) {
                const cost = normalizeManaCost(a.cost.mana);
                if (!isManaCostCovered(manaPool, cost)) return false;
            }
            return true;
        })
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
}

/** Returns the oracle text for an activated ability by id, or null. */
export function getAbilityOracleText(
    cardId: string,
    abilityId: string
): string | null {
    const cardDef = getCardById(cardId);
    const ability = cardDef.activatedAbilities?.find((a) => a.id === abilityId);
    return ability?.oracleText ?? null;
}

/** Returns the oracle text for a triggered ability by id, or null. */
export function getTriggeredAbilityOracleText(
    cardId: string,
    triggeredAbilityId: string
): string | null {
    const cardDef = getCardById(cardId);
    const ability = cardDef.triggeredAbilities?.find(
        (a) => a.id === triggeredAbilityId
    );
    return ability?.oracleText ?? null;
}

export function groupByName(cards: CardInstance[]): CardInstance[][] {
    const groups: Map<string, CardInstance[]> = new Map();
    for (const card of cards) {
        const name = getCardById(card.card.id).name;
        const group = groups.get(name);
        if (group) {
            group.push(card);
        } else {
            groups.set(name, [card]);
        }
    }
    return [...groups.values()];
}
