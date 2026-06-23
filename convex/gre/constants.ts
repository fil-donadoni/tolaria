import type {
    CardSupertype,
    Color,
    ManaCost,
    PermanentView,
} from "../cards/types";
import type { ManaRestriction } from "./types";
import { getCardById } from "../cards";
import type { CardInstanceState, GameState } from "./state";
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

/** Landwalk keywords keyed on a land *supertype* (CR 205.4 / 702.13) rather
 *  than a subtype. "Legendary landwalk" (Livonya Silone, LEG) is the only
 *  printed instance — the attacker can't be blocked while the defending player
 *  controls a land with the named supertype. Kept separate from
 *  `LANDWALK_KEYWORDS` because the match reads `supertypes`, which lives on the
 *  card definition (CR 205.4 — not a text-changeable, instance-mutable field),
 *  whereas subtype landwalk reads the instance's substitution-rewritten
 *  `subtypes`. */
export const LANDWALK_SUPERTYPE_KEYWORDS: Record<string, CardSupertype> = {
    "legendary landwalk": "Legendary",
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

/** Whether a card can be cast at **instant speed** (CR 601.3a / 702.8) — an
 *  Instant, or any card with the Flash keyword. Sorcery-speed-only cards
 *  (creatures, sorceries, and non-flash permanents) return false: they may be
 *  cast only when the player could cast a sorcery (CR 307.1, 601.3a). Canonical
 *  predicate reused by the auto-tap timing filter (issue #475) and the search
 *  heuristics (`evaluate`, `heldInteraction`). */
export function hasInstantSpeed(card: CardInstanceState): boolean {
    return (
        card.types.includes("Instant") || card.staticAbilities.includes("flash")
    );
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
 *  Song, Blood Moon). Its PRINTED activated mana abilities don't function while
 *  suppressed. Note this does NOT suppress intrinsic basic-land subtype mana
 *  (CR 305.6): that ability is granted by the land's type (set in layer 4),
 *  not a printed ability, so `getBasicLandMana` is intentionally not gated by
 *  this — a nonbasic land turned into a Mountain by Blood Moon still taps for
 *  {R}. */
export function abilitiesSuppressed(card: CardInstanceState): boolean {
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

/** Colors of mana a single permanent COULD produce when tapped (CR 106.4 —
 *  "could produce"). Unions every source of mana the card knows about:
 *  basic-land subtypes (CR 305.6), fixed `manaProduced` abilities, and
 *  `manaChoices` abilities (dual lands / Talisman-style choosers). Colorless
 *  ({C}) is excluded — "a land an opponent controls could produce" (Fellwar
 *  Stone) cares only about coloured mana, and {C} is not a colour (CR 202.2,
 *  106.1b). Abilities lost to a suppression effect (Titania's Song) don't
 *  function, so they contribute nothing. Used by Fellwar Stone's
 *  `getManaChoices` to read opponents' mana bases. */
export function getProducibleColors(card: CardInstanceState): Set<Color> {
    const colors = new Set<Color>();
    if (abilitiesSuppressed(card)) return colors;
    // CR 305.6 — intrinsic basic-land subtype abilities (text-change aware).
    const intrinsic = getBasicLandMana(card);
    if (intrinsic && intrinsic !== "C") colors.add(intrinsic);
    const cardDef = getCardById(card.card.id as string);
    for (const ability of cardDef.activatedAbilities ?? []) {
        if (ability.useStack) continue;
        if (ability.manaProduced) {
            for (const c of MANA_COLORS) {
                if (c !== "C" && (ability.manaProduced[c] ?? 0) > 0)
                    colors.add(c);
            }
        }
        if (ability.manaChoices) {
            for (const choice of ability.manaChoices) {
                for (const c of MANA_COLORS) {
                    if (c !== "C" && (choice[c] ?? 0) > 0) colors.add(c);
                }
            }
        }
    }
    return colors;
}

/** Board-conditional mana CHOICES for a card's tap mana ability (CR 106.1 /
 *  605.1a) — the choice analog of `getDynamicManaProduced`. Returns the list of
 *  mana options the activator may pick from, computed from every player's
 *  battlefield, or null when the ability has no `getManaChoices` hook. The
 *  raw `CardInstanceState`s are structurally valid `PermanentView`s. Used by
 *  Fellwar Stone (colours derived from opponents' lands). The same resolver is
 *  re-exported to the client (`src/lib/card-utils`) so the picker the player
 *  sees and the index the server validates reference one list. */
export function getDynamicManaChoices(
    card: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): ManaCost[] | null {
    if (abilitiesSuppressed(card)) return null;
    const cardDef = getCardById(card.card.id as string);
    const ability = cardDef.activatedAbilities?.find(
        (a) => !a.useStack && a.getManaChoices
    );
    if (!ability?.getManaChoices) return null;
    // Precompute each permanent's producible colours via the shared helper so
    // the card definition (Fellwar Stone) reads board mana without importing the
    // engine's mana machinery (CR 106.4).
    return ability.getManaChoices(
        card as unknown as PermanentView,
        controllerId,
        battlefields.map((b) => ({
            playerId: b.playerId,
            permanents: b.battlefield.map((p) => ({
                permanent: p as unknown as PermanentView,
                producibleColors: [...getProducibleColors(p)],
            })),
        }))
    );
}

/** Resolves the effective mana-choices list for a card's tap mana ability:
 *  the board-conditional `getManaChoices` result when present, else the static
 *  `manaChoices`, else null. Single source of truth for every server consumer
 *  (rules affordability, autoTap planner, the three tap mutations) so a
 *  dynamic chooser never desyncs the index across sites. */
export function getEffectiveManaChoices(
    card: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): ManaCost[] | null {
    const dynamic = getDynamicManaChoices(card, controllerId, battlefields);
    if (dynamic) return dynamic;
    const ability = getActivatedManaAbility(card);
    return ability?.manaChoices ?? null;
}

/** Total mana count across all colours in a `ManaCost` (ignoring `X`). */
export function totalManaCount(produced: ManaCost): number {
    let total = 0;
    for (const c of MANA_COLORS) total += produced[c] ?? 0;
    return total;
}

/** Applies the active per-turn land-mana replacement (CR 614 — Deep Water) to
 *  the mana a source is about to add to a pool. When the controller has an
 *  active "lands produce {U} instead" effect this turn AND `card` is a Land,
 *  the produced colours are rewritten to the same TOTAL quantity of {U}
 *  ("produces {U} instead of any other type" — Deep Water replaces the type,
 *  not the amount). Non-land sources (mana rocks, Birds) and players without
 *  the effect are returned unchanged. Pure — the single funnel every tap path
 *  routes its produced mana through so the rewrite can't desync across sites. */
export function applyLandManaReplacement(
    state: GameState,
    controllerId: string,
    card: CardInstanceState,
    produced: ManaCost
): ManaCost {
    let result = produced;
    if (
        state.landManaReplacedToBlueThisTurn?.includes(controllerId) &&
        isLand(card)
    ) {
        const total = totalManaCount(result);
        if (total > 0) result = { U: total };
    }
    // FEM High Tide (CR 614-style additive rider): "Until end of turn, whenever
    // a player taps an Island for mana, that player adds an additional {U}."
    // It benefits EVERY player who taps an Island this turn (not just the
    // caster), so the count is global. Folded into the single mana funnel so
    // every tap path adds the bonus consistently. The replacement above runs
    // first (Deep Water turns the Island's mana into {U}); High Tide then adds
    // one MORE {U} per active High Tide, keyed to the Island subtype (CR 305.6).
    if (card.subtypes.includes("Island")) {
        const highTides = state.highTideThisTurn?.length ?? 0;
        if (highTides > 0) {
            result = { ...result, U: (result.U ?? 0) + highTides };
        }
    }
    return result;
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
