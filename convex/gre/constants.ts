import type { Color, ManaCost, PermanentView } from "../cards/types";
import type { ManaRestriction } from "./types";
import { getCardById } from "../cards";
import type { CardInstanceState } from "./state";
import { applySubstitution } from "./textChanges";

/** Sentinel card id for opaque library placeholders the vs-AI Bot's search
 *  world is rehydrated with (issue #136). The wire projects a library as a
 *  count only; the adapter rebuilds it with placeholder instances carrying this
 *  id so simulated draws have cards to take without tripping the deck-out SBA.
 *  The id resolves to no `CardDefinition` and `getLegalActions` suppresses all
 *  actions on it, so a drawn placeholder never surfaces as a legal move. */
export const PLACEHOLDER_CARD_ID = "placeholder:hidden-library";

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
    desertwalk: "Desert",
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
 *
 * The canonical definition lives in the leaf `cards/types` module (so card
 * sets can import it without a registry import cycle); re-exported here for
 * the engine-side consumers that already import it from `gre/constants`.
 */
export { DAMAGEABLE_PERMANENT_TYPES } from "../cards/types";
import { DAMAGEABLE_PERMANENT_TYPES } from "../cards/types";

export function isDamageablePermanent(card: CardInstanceState): boolean {
    return DAMAGEABLE_PERMANENT_TYPES.some((t) => card.types.includes(t));
}

/** All six mana colors in canonical order. */
export const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

/** Default number of lands a player may play per turn (CR 305.2). Cards
 *  granting additional drops (Exploration, Azusa) would mutate the per-turn
 *  budget — out of scope for the current rule set. */
export const LAND_DROPS_PER_TURN = 1;

/** Default maximum hand size (CR 402.2). Enforced by the cleanup-step discard
 *  (CR 514.1) — the active player discards down to this number unless their
 *  `PlayerState.maxHandSizeOverride` says otherwise (Library of Leng sets it
 *  to "unlimited"). */
export const MAX_HAND_SIZE = 7;

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

/** Returns the mana color a land produces via basic land subtype, or null.
 *  Reads the text-change-rewritten subtypes (CR 612 / CR 305.6) so a land
 *  whose type was changed (Magical Hack) taps for the new color. */
export function getBasicLandMana(card: CardInstanceState): Color | null {
    const { subtypes } = applySubstitution(card);
    for (const subtype of subtypes) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
}

export function isCreature(card: CardInstanceState): boolean {
    return card.types.includes("Creature");
}

/** CR 302.1 — a creature's activated ability with the tap or untap symbol in
 *  its activation cost can't be activated unless the creature has been under
 *  its controller's control continuously since the start of that controller's
 *  most recent turn. Applies to mana abilities and stack abilities alike
 *  (Birds of Paradise, Llanowar Elves, Prodigal Sorcerer). Non-creature
 *  permanents (Mox, Sol Ring, lands) ignore summoning sickness. */
export function isTapLockedBySummoningSickness(
    card: CardInstanceState
): boolean {
    return !!card.isSummoningSick && isCreature(card);
}

export function isLand(card: CardInstanceState): boolean {
    return card.types.includes("Land");
}

/** True if the card has the "Aura" subtype (CR 303.4). Auras ETB attached
 *  to an object via `attachedTo` and are subject to SBA 704.5m. */
export function isAura(card: {
    types: readonly string[];
    subtypes: readonly string[];
}): boolean {
    return card.types.includes("Enchantment") && card.subtypes.includes("Aura");
}

/** CR 613.1f — true while the permanent has lost all abilities (Titania's
 *  Song). Its intrinsic mana abilities don't function while suppressed. */
function abilitiesSuppressed(card: CardInstanceState): boolean {
    return (card.abilitiesSuppressedBy?.length ?? 0) > 0;
}

/** Returns the mana color produced by a tap mana ability (e.g. Mox), or null. */
export function getActivatedManaColor(card: CardInstanceState): Color | null {
    if (abilitiesSuppressed(card)) return null;
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
    if (abilitiesSuppressed(card)) return null;
    const cardDef = getCardById(card.card.id as string);
    const ability = cardDef.activatedAbilities?.find(
        (a) => a.cost.tap && !a.useStack && a.manaProduced
    );
    return ability?.manaProduced ?? null;
}

/** Amount of a single color produced by a card's fixed (non-choice) tap mana
 *  ability. Basic lands and abilities without an explicit count default to 1;
 *  abilities like Sol Ring ({T}: Add {C}{C}) return 2.
 *
 *  CR 106.1 / 605.1a — when the ability declares a board-conditional
 *  `manaAmount` (the Urza land trio) and `controllerBattlefield` is supplied,
 *  the output is recomputed from the current board; otherwise the static
 *  `manaProduced` is used as the representative / fallback amount. */
export function getFixedManaAmount(
    card: CardInstanceState,
    color: Color,
    controllerBattlefield?: readonly CardInstanceState[]
): number {
    if (controllerBattlefield) {
        const dynamic = getDynamicManaProduced(card, controllerBattlefield);
        if (dynamic) return dynamic[color] ?? 0;
    }
    const produced = getActivatedManaProduced(card);
    return produced?.[color] ?? 1;
}

/** Board-conditional mana output for a card's fixed tap mana ability (CR 106.1),
 *  computed against the controller's battlefield, or null when the ability has
 *  no `manaAmount` hook. The Urza land trio uses this to scale colorless output
 *  with the assembled set. The raw `CardInstanceState`s are structurally valid
 *  `PermanentView`s (the engine passes instances as views everywhere). */
export function getDynamicManaProduced(
    card: CardInstanceState,
    controllerBattlefield: readonly CardInstanceState[]
): ManaCost | null {
    if (abilitiesSuppressed(card)) return null;
    const cardDef = getCardById(card.card.id as string);
    const ability = cardDef.activatedAbilities?.find(
        (a) => a.cost.tap && !a.useStack && a.manaAmount
    );
    if (!ability?.manaAmount) return null;
    return ability.manaAmount(
        card as unknown as PermanentView,
        controllerBattlefield as unknown as readonly PermanentView[]
    );
}

/** Spend restriction (CR 106.6) carried by a card's fixed tap mana ability, or
 *  null when the produced mana is unrestricted. Mishra's Workshop returns
 *  `"artifact-spell"`; basic lands and ordinary mana rocks return null. */
export function getActivatedManaRestriction(
    card: CardInstanceState
): ManaRestriction | null {
    if (abilitiesSuppressed(card)) return null;
    const cardDef = getCardById(card.card.id as string);
    const ability = cardDef.activatedAbilities?.find(
        (a) => a.cost.tap && !a.useStack && a.manaProduced
    );
    return ability?.manaRestriction ?? null;
}

/** Returns the activated mana ability definition for a card, or null. */
export function getActivatedManaAbility(card: CardInstanceState) {
    if (abilitiesSuppressed(card)) return null;
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
