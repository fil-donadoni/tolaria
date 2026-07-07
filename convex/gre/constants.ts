import type {
    CardSupertype,
    Color,
    ManaCost,
    PermanentView,
} from "../cards/types";
import type { ManaRestriction } from "./types";
import { getDefinition, tryGetDefinition } from "../cards";
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

/** Snow landwalk keywords (CR 702.13 / 205.4a) keyed on the basic land
 *  *subtype* the snow land must also have — the attacker can't be blocked
 *  while the defending player controls a SNOW land of that subtype (Legions
 *  of Lim-Dûl's "snow swampwalk", Rime Dryad's "snow forestwalk"). Kept
 *  separate from `LANDWALK_KEYWORDS` because the match additionally requires
 *  the live Snow supertype (`hasSnowSupertype`), not just the subtype.
 *  Barbarian Guides grants a chosen-subtype snow landwalk at runtime via the
 *  same keyword strings. */
export const LANDWALK_SNOW_SUBTYPE_KEYWORDS: Record<string, string> = {
    "snow plainswalk": "Plains",
    "snow islandwalk": "Island",
    "snow swampwalk": "Swamp",
    "snow mountainwalk": "Mountain",
    "snow forestwalk": "Forest",
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
    for (const key of ["X", "W", "U", "B", "R", "G", "C", "generic"] as const) {
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
    const cardDef = getDefinition(card.card.id as string);
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
    const cardDef = getDefinition(card.card.id as string);
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
    const cardDef = getDefinition(card.card.id as string);
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
    const cardDef = getDefinition(card.card.id as string);
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
    const cardDef = getDefinition(card.card.id as string);
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

/** Provenance of a single mana-tap option (CR 605.1a): which mana ability it
 *  comes from. `"activated"` carries the source ability's id (and, for a
 *  `manaChoices` ability, the index into THAT ability's own choice list — the
 *  Mana Battery counter-removal count reads this local index, not the unified
 *  index); `"basic"` is an intrinsic basic-land-subtype ability (CR 305.6),
 *  which has no riders (self-damage, depletion, life/discard cost). */
export type ManaTapOptionSource =
    | { kind: "activated"; abilityId: string; choiceIndex?: number }
    | { kind: "basic"; subtype: string };

/** One selectable mana-tap option: the `ManaCost` produced by activating one of
 *  a permanent's mana abilities once, plus its provenance. */
export type ManaTapOption = { mana: ManaCost; source: ManaTapOptionSource };

/** Canonical dedup key for a `ManaCost` (sorted colour:amount pairs). */
function manaCostKey(mana: ManaCost): string {
    return MANA_COLORS.map((c) => `${c}:${mana[c] ?? 0}`).join("|");
}

/** CR 605.1a / 305.6 — the full set of mana-tap options a permanent exposes:
 *  every printed/granted activated tap mana ability (its fixed `manaProduced`,
 *  its static/board-conditional choices) AND one intrinsic option per DISTINCT
 *  basic land subtype it currently has. A single {T} activates exactly ONE of
 *  these, so the player chooses when 2+ survive. This is the single authority
 *  the tap mutations, the affordability planner and the client picker all read,
 *  so the index they submit references one list (CR 106.1).
 *
 *  Ordering is stable: activated-ability options first (preserving the indices
 *  existing `manaChoices` cards already use — including a storage land's
 *  "remove N counters" list where the index IS the counter count, so the
 *  zero-output "remove 0" entry is kept), then basic-subtype options in subtype
 *  order. Duplicate outputs (a dual land whose basic subtypes reproduce its own
 *  choice colours) are dropped, keeping the first occurrence's provenance — so
 *  `getManaTapOptions` for a plain dual land is byte-identical to its old
 *  `manaChoices`.
 *
 *  A SACRIFICE-cost mana ability (ADR 0039 — the FEM sac-land "Sacrifice this:
 *  Add {X}{X}", Basal Thrull, Lotus Petal) is a deliberate destructive
 *  activation, NOT folded into the routine tap-for-mana picker: it is offered
 *  only when the source has no non-destructive tap option, so a land with both
 *  a plain tap and a sacrifice ability taps plainly while a sacrifice-only
 *  source (Lotus Petal) still surfaces its colours.
 *
 *  Suppression (Blood Moon / Titania's Song, CR 613.1f) removes only PRINTED
 *  activated abilities; the intrinsic basic-subtype options survive (CR 305.6),
 *  matching `getBasicLandMana`. `battlefields` is required only to resolve
 *  board-conditional outputs (Fellwar Stone's `getManaChoices`, the Urza land
 *  trio's `manaAmount`); omit it (static resolution) where the board isn't
 *  available — the planner's one-source model, as before, does not resolve
 *  dynamic choosers. */
export function getManaTapOptionsDetailed(
    card: CardInstanceState,
    controllerId?: string,
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>,
    opts?: { requireTap?: boolean }
): ManaTapOption[] {
    const nonSacrifice: ManaTapOption[] = [];
    const sacrifice: ManaTapOption[] = [];
    const requireTap = opts?.requireTap ?? false;

    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    const controllerBattlefield =
        controllerId && battlefields
            ? battlefields.find((b) => b.playerId === controllerId)?.battlefield
            : undefined;

    if (def?.activatedAbilities && !abilitiesSuppressed(card)) {
        for (const ability of def.activatedAbilities) {
            if (ability.useStack) continue;
            // A one-shot mana ability activated by tapping AND/OR sacrificing the
            // source (ADR 0039 — Lion's Eye Diamond sacrifices without tapping).
            // A pure mana-COST ability (Farrelite Priest "{1}: Add {W}") is
            // repeatable and routed through `activateManaAbility`, not a tap
            // option. The affordability/auto-tap planner passes `requireTap` so
            // it never auto-commits a sacrifice-only source (discarding the hand
            // to LED is a strategic choice, never an auto-payment).
            if (requireTap) {
                if (!ability.cost.tap) continue;
            } else if (!ability.cost.tap && !ability.cost.sacrifice) {
                continue;
            }
            const target = ability.cost.sacrifice ? sacrifice : nonSacrifice;
            // A choice ability (dual land, Talisman, Fellwar Stone, storage
            // land): each option is one entry, tagged with its ability-local
            // choice index so the counter-removal rider (Mana Battery / storage
            // land) reads the right count.
            const choices =
                ability.getManaChoices && controllerId && battlefields
                    ? getDynamicManaChoices(card, controllerId, battlefields)
                    : (ability.manaChoices ?? null);
            if (choices) {
                choices.forEach((choice, index) => {
                    target.push({
                        mana: choice,
                        source: {
                            kind: "activated",
                            abilityId: ability.id,
                            choiceIndex: index,
                        },
                    });
                });
                continue;
            }
            if (ability.manaProduced) {
                // CR 106.1 — resolve a board-conditional amount (Urza trio) when
                // the board is available; else the static output is the snapshot.
                const dynamic = controllerBattlefield
                    ? getDynamicManaProduced(card, controllerBattlefield)
                    : null;
                target.push({
                    mana: dynamic ?? ability.manaProduced,
                    source: { kind: "activated", abilityId: ability.id },
                });
            }
        }
    }

    // CR 305.6 — one intrinsic {T}: Add {C} option per DISTINCT basic land
    // subtype (text-change aware, like `getBasicLandMana`). Always a
    // non-destructive alternative.
    const { subtypes } = applySubstitution(card);
    for (const subtype of subtypes) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) {
            nonSacrifice.push({
                mana: { [color]: 1 } as ManaCost,
                source: { kind: "basic", subtype },
            });
        }
    }

    // Prefer non-destructive options; fall back to sacrifice abilities only when
    // there is no other way to tap this source for mana (Lotus Petal).
    const combined = nonSacrifice.length > 0 ? nonSacrifice : sacrifice;

    // Dedup by produced `ManaCost`, keeping the first occurrence's provenance.
    const out: ManaTapOption[] = [];
    const seen = new Set<string>();
    for (const opt of combined) {
        const key = manaCostKey(opt.mana);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(opt);
    }
    return out;
}

/** The mana-cost list a player picks from when tapping a source for mana —
 *  `getManaTapOptionsDetailed` without provenance. The index into this list is
 *  the `manaChoiceIndex` the tap mutations expect. */
export function getManaTapOptions(
    card: CardInstanceState,
    controllerId?: string,
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): ManaCost[] {
    return getManaTapOptionsDetailed(card, controllerId, battlefields).map(
        (o) => o.mana
    );
}

/** Total mana count across all colours in a `ManaCost` (ignoring `X`). */
export function totalManaCount(produced: ManaCost): number {
    let total = 0;
    for (const c of MANA_COLORS) total += produced[c] ?? 0;
    return total;
}

/** Scans every battlefield for an active continuous land-mana substitution
 *  (CR 614 — Infernal Darkness / Naked Singularity) and returns the override
 *  colour for `card`, or null when no source applies. A `byBasicSubtype`
 *  source maps the FIRST of `card`'s basic land subtypes it covers; a `color`
 *  source overrides any land unconditionally. The substitution is global —
 *  every player's lands are affected — so all battlefields are scanned. First
 *  applicable source wins (the in-scope cards never overlap on a legal board,
 *  so battlefield order is sufficient — CR 614.1 fine-grained replacement
 *  layering is not needed here). */
function getContinuousLandManaOverride(
    state: GameState,
    card: CardInstanceState
): Color | null {
    if (!isLand(card)) return null;
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const def = getDefinition(source.card.id as string);
            const sub = def.landManaSubstitution;
            if (!sub) continue;
            if ("color" in sub) return sub.color;
            for (const subtype of card.subtypes) {
                const mapped = sub.byBasicSubtype[subtype];
                if (mapped) return mapped;
            }
        }
    }
    return null;
}

/** Applies the active land-mana colour substitutions (CR 614) to the mana a
 *  source is about to add to a pool. Three families compose, in order:
 *
 *  1. Continuous battlefield substitution (Infernal Darkness — all lands →
 *     {B}; Naked Singularity — per-basic-subtype permutation). Rewrites a
 *     LAND's whole output to the same TOTAL quantity of the override colour.
 *  2. Per-turn override (Deep Water — controller's lands → {U} until end of
 *     turn). Same all-or-nothing type rewrite, scoped to the controller.
 *  3. Per-turn riders (FEM High Tide — Island +{U}; Chaos Moon — Mountain +{R}
 *     additional, or Mountain → {C} override). Keyed to a land subtype, global.
 *
 *  Non-land sources (mana rocks, Birds) and lands with no active effect are
 *  returned unchanged. Pure — the single funnel every tap path routes its
 *  produced mana through so the rewrite can't desync across sites. */
export function applyLandManaReplacement(
    state: GameState,
    controllerId: string,
    card: CardInstanceState,
    produced: ManaCost
): ManaCost {
    let result = produced;
    // (1) Continuous battlefield substitution (Infernal Darkness / Naked
    // Singularity) — replaces the land's whole output with the override colour.
    const override = getContinuousLandManaOverride(state, card);
    if (override) {
        const total = totalManaCount(result);
        if (total > 0) result = { [override]: total };
    }
    // (2) Deep Water's per-turn "lands produce {U} instead" override.
    if (
        state.landManaReplacedToBlueThisTurn?.includes(controllerId) &&
        isLand(card)
    ) {
        const total = totalManaCount(result);
        if (total > 0) result = { U: total };
    }
    // (3a) Turn-scoped parametrized riders (Chaos Moon's Mountain rider). An
    // "override" rider rewrites the land's whole output to that colour; an
    // "additional" rider adds one more of that colour per matching arm. Keyed to
    // a land subtype, global. Overrides run before additionals so the override
    // colour is what the additional then increments.
    const riders = state.landManaRidersThisTurn ?? [];
    if (riders.length > 0 && isLand(card)) {
        for (const rider of riders) {
            if (!card.subtypes.includes(rider.subtype)) continue;
            if (rider.mode === "override") {
                const total = totalManaCount(result);
                if (total > 0) result = { [rider.color]: total };
            }
        }
        for (const rider of riders) {
            if (!card.subtypes.includes(rider.subtype)) continue;
            if (rider.mode === "additional") {
                result = {
                    ...result,
                    [rider.color]: (result[rider.color] ?? 0) + 1,
                };
            }
        }
    }
    // (3b) FEM High Tide (CR 614-style additive rider): "Until end of turn,
    // whenever a player taps an Island for mana, that player adds an additional
    // {U}." Global (every player who taps an Island benefits), so the count is
    // the number of active High Tides. Folded into the single mana funnel so
    // every tap path adds the bonus consistently, keyed to Island (CR 305.6).
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
    const cardDef = getDefinition(card.card.id as string);
    const ability = cardDef.activatedAbilities?.find(
        (a) => a.cost.tap && !a.useStack && a.manaProduced
    );
    return ability?.manaRestriction ?? null;
}

/** Returns the activated mana ability definition for a card, or null. */
export function getActivatedManaAbility(card: CardInstanceState) {
    if (abilitiesSuppressed(card)) return null;
    const cardDef = getDefinition(card.card.id as string);
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
