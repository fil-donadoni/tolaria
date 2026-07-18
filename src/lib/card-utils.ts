import type { CardInstance, ManaPool, PendingCast, Player } from "~/types/game";
import type { CardType, Color, ManaCost } from "~/types/cards";
import type { Phase } from "@convex/gre/types";
import type {
    AlternativeCost,
    CardDefinition,
    EffectCardFilter,
    MayPayCost,
    PermanentView,
    TargetRequirement,
    TriggerStateView,
} from "@convex/cards/types";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_SUBTYPE_MANA,
    LANDWALK_KEYWORDS,
    LANDWALK_SUPERTYPE_KEYWORDS,
    getEffectiveManaChoices,
    getManaTapOptions,
} from "@convex/gre/constants";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "@convex/gre/state";
import {
    affordableAlternativeCosts,
    handCardMatchesFilter,
} from "@convex/gre/alternativeCost";
import { getDefinition, tryGetDefinition } from "@convex/cards";
import { getColorsFromCost } from "@convex/cards/colors";
import {
    controlsLandWithSupertype,
    negatedLandwalkSubtypes,
} from "@convex/cards/landwalkNegation";

export function isLand(card: CardInstance): boolean {
    return card.types?.includes("Land") ?? false;
}

export function isCreature(card: CardInstance): boolean {
    return card.types?.includes("Creature") ?? false;
}

/** CR 306 — true iff this permanent is a planeswalker. Drives the on-card
 *  loyalty badge and mirrors the engine-side `isPlaneswalker`. */
export function isPlaneswalker(card: CardInstance): boolean {
    return card.types?.includes("Planeswalker") ?? false;
}

/** CR 702.126 — true iff `card` declares the Improvise keyword. Used both to
 *  identify the spell currently being cast (`pendingCastHasImprovise` below)
 *  and, symmetrically, to exclude an Improvise-eligible artifact's OWN cast
 *  from tapping itself (it isn't on the battlefield yet, so this never
 *  actually fires — kept general rather than cast-source-specific). */
export function hasImprovise(card: CardInstance): boolean {
    return (
        getDefinition(card.card.id).staticAbilities?.includes("improvise") ??
        false
    );
}

/** The `CardInstance` a `PendingCast` is paying for, searched across every
 *  zone a cast can originate from (CR 601.3e / 702.34 — hand, an exile
 *  permission like Ice Cauldron, or a graveyard cast like Flashback/Escape).
 *  Mirrors the server's `locateCastSource` zone order; `me` is the viewer's
 *  OWN player object, whose hand is never nulled on the wire. */
export function pendingCastSourceCard(
    pendingCast: PendingCast,
    me: Player | undefined
): CardInstance | undefined {
    if (!me) return undefined;
    const inHand = me.hand.find(
        (c): c is CardInstance =>
            c !== null && c.id === pendingCast.cardInstanceId
    );
    if (inHand) return inHand;
    const inExile = me.exile.find((c) => c.id === pendingCast.cardInstanceId);
    if (inExile) return inExile;
    return me.graveyard.find((c) => c.id === pendingCast.cardInstanceId);
}

/** CR 702.126 — true iff the spell `pendingCast` is currently paying for
 *  declares Improvise. Drives both the artifact-tap affordance
 *  (`useBattlefieldVisualState`/`useBattlefieldInteraction`) and the
 *  PaymentBanner subtitle. */
export function pendingCastHasImprovise(
    pendingCast: PendingCast,
    me: Player | undefined
): boolean {
    const source = pendingCastSourceCard(pendingCast, me);
    return !!source && hasImprovise(source);
}

/** CR 702.126a — generic mana still owed by `pendingCast` (0 once the whole
 *  generic portion has been paid off, by mana or by Improvise taps). An
 *  Improvise artifact tap is only ever legal while this is positive — mirrors
 *  the server's `tapArtifactForImprovise` guard so the client's affordance
 *  never offers a tap the mutation would reject. */
export function pendingCastRemainingGeneric(pendingCast: PendingCast): number {
    return pendingCast.manaCost.X ?? 0;
}

/** CR 302.1 — a creature with summoning sickness cannot pay the {T} or {Q}
 *  cost of an activated ability. Mirrors `isTapLockedBySummoningSickness`
 *  in convex/gre/constants.ts. */
export function isTapLockedBySummoningSickness(card: CardInstance): boolean {
    return !!card.isSummoningSick && isCreature(card);
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
    // CR 509.1b / 702.13 — a landwalk-negation static (Great Wall, Undertow)
    // on the defender's battlefield suppresses the matching landwalk so the
    // creature can be blocked normally. Mirrors the server rule in
    // `combatRegistry.ts` so the client's block view agrees with the engine.
    const negated = negatedLandwalkSubtypes(defenderBattlefield);
    for (const [keyword, subtype] of Object.entries(LANDWALK_KEYWORDS)) {
        if (!abilities.includes(keyword)) continue;
        if (negated.has(subtype)) continue;
        const hasLand = defenderBattlefield.some(
            (c) => isLand(c) && (c.subtypes?.includes(subtype) ?? false)
        );
        if (hasLand) return true;
    }
    // CR 702.13 — supertype-keyed landwalk ("legendary landwalk", Livonya
    // Silone): unblockable while the defender controls a land with the named
    // supertype. Mirrors the server's `LANDWALK_SUPERTYPE_RULES`.
    for (const [keyword, supertype] of Object.entries(
        LANDWALK_SUPERTYPE_KEYWORDS
    )) {
        if (!abilities.includes(keyword)) continue;
        if (controlsLandWithSupertype(defenderBattlefield, supertype)) {
            return true;
        }
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

/** Returns true if a card has a tap mana ability (basic land subtype or
 *  activated), consulting the activated ability's own `canActivate`
 *  precondition when present (CR 602.5b, issue #947) — an un-imprinted
 *  Chrome Mox has NO usable mana ability at all, not merely one with an empty
 *  choice list, so it must not read as tappable. `stateView` is the same
 *  viewer-visible board projection `getStackAbilities` uses; an omitted
 *  caller falls back to an empty view, matching the existing UI-hint
 *  convention (#436) — server validation stays authoritative. */
export function hasManaAbility(
    card: CardInstance,
    stateView?: TriggerStateView
): boolean {
    if (getLandManaColor(card) !== null) return true;
    const cardDef = getDefinition(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) =>
            !a.useStack && (a.manaProduced || a.manaChoices || a.getManaChoices)
    );
    if (!ability) return false;
    if (ability.canActivate) {
        const view: TriggerStateView = stateView ?? { players: [] };
        if (!ability.canActivate(card as unknown as PermanentView, view)) {
            return false;
        }
    }
    return true;
}

/** Returns the native mana ability of a card as a menu entry (id + oracleText),
 *  or null if the card has no native activated mana ability. Used to surface
 *  the mana ability inside the ability context menu when a card has both a
 *  mana ability and a stack ability (e.g. Basalt Monolith, Mana Vault), so a
 *  left click doesn't silently choose tap-for-mana over the {3}: Untap.
 *  Gated on `canActivate` like {@link hasManaAbility} (issue #947) — an
 *  un-imprinted Chrome Mox has no menu entry to offer. */
export function getActivatedManaMenuEntry(
    card: CardInstance,
    stateView?: TriggerStateView
): { id: string; oracleText: string } | null {
    const cardDef = getDefinition(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) =>
            !a.useStack && (a.manaProduced || a.manaChoices || a.getManaChoices)
    );
    if (!ability) return null;
    if (ability.canActivate) {
        const view: TriggerStateView = stateView ?? { players: [] };
        if (!ability.canActivate(card as unknown as PermanentView, view)) {
            return null;
        }
    }
    return { id: ability.id, oracleText: ability.oracleText };
}

/** True if the card was tapped for mana and the produced mana is still in the
 *  player's pool — so an "Untap and refund" action is legal. Server's tapUntap
 *  blocks refund when `manaCommitted` is set (mana already spent on a cost),
 *  but mana can also drain at phase boundaries (CR 106.4) leaving the source
 *  tapped while the pool is empty. In that case the refund would silently
 *  un-tap for free with no mana to give back — hide the option. Only supports
 *  fixed `manaProduced` sources (Basalt Monolith / Mana Vault style). Choice
 *  sources need `chosenMana` projected to the client to be precise here. */
export function canRefundManaTap(
    card: CardInstance,
    manaPool: ManaPool
): boolean {
    if (!card.isTapped || card.manaCommitted) return false;
    const cardDef = getDefinition(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) => !a.useStack && a.manaProduced
    );
    if (!ability?.manaProduced) return false;
    for (const [color, amount] of Object.entries(ability.manaProduced)) {
        if (color === "X" || typeof amount !== "number" || amount <= 0)
            continue;
        if ((manaPool[color] ?? 0) < amount) return false;
    }
    return true;
}

/** Returns the mana-tap options to prompt the player with, or null when the
 *  source taps for mana with no choice (a single fixed/basic option).
 *
 *  Reads the SAME unified `getManaTapOptions` list the server resolves the
 *  submitted index against (CR 605.1a / 305.6 — activated abilities + one
 *  intrinsic option per basic land subtype), so a land under Urborg shows its
 *  own colour AND {B}, and City of Traitors shows {C}{C} AND {B}. Board-
 *  conditional choosers (Fellwar Stone) need every player's battlefield, so the
 *  caller passes the current players (CR 106.1). Mirrors the server's
 *  `manaTapNeedsChoice` gate: prompt when 2+ options exist, or the source
 *  carries a choice-based ability. The slim `CardInstance` is a structurally
 *  valid `CardInstanceState` here. */
export function getManaChoices(
    card: CardInstance,
    players?: ReadonlyArray<{ id: string; battlefield: CardInstance[] }>
): ManaCost[] | null {
    const options = getManaTapOptions(
        card as unknown as CardInstanceState,
        card.controllerId,
        players?.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }))
    );
    const cardDef = getDefinition(card.card.id);
    const hasChoiceAbility = !!cardDef.activatedAbilities?.some(
        (a) => !a.useStack && (a.manaChoices || a.getManaChoices)
    );
    if (options.length >= 2 || hasChoiceAbility) {
        return options.length > 0 ? options : null;
    }
    return null;
}

/** Returns the mana CHOICES for a NON-tap mana ability (Vivi Ornitier's
 *  {U}/{R} split), or null when the card has no non-tap, non-sacrifice
 *  choice-based mana ability. Issue #1179's client analog of
 *  {@link getManaChoices}: that helper reads the unified TAP options list
 *  (`getManaTapOptions`), which deliberately EXCLUDES a mana ability with no
 *  {T}/sacrifice component (CR 605.1a — it's reached through the
 *  activated-ability menu, not a direct tap), so a non-tap chooser needs its
 *  own resolver. Reads the SAME `getEffectiveManaChoices` helper the server
 *  (`activateManaAbility`) validates the submitted `manaChoiceIndex`
 *  against, so the picker's index always matches what the server expects.
 *  Board-conditional choosers need every player's battlefield (CR 106.1 /
 *  613.4 — Vivi's list is derived from her CURRENT effective power). */
export function getNonTapManaChoices(
    card: CardInstance,
    players?: ReadonlyArray<{ id: string; battlefield: CardInstance[] }>
): ManaCost[] | null {
    const cardDef = getDefinition(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) =>
            !a.useStack &&
            !a.cost.tap &&
            !a.cost.sacrifice &&
            (a.manaChoices || a.getManaChoices)
    );
    if (!ability) return null;
    return getEffectiveManaChoices(
        card as unknown as CardInstanceState,
        card.controllerId,
        (players ?? []).map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }))
    );
}

/** Returns the mana color produced by an activated tap ability, or null. */
export function getActivatedManaColor(card: CardInstance): Color | null {
    const cardDef = getDefinition(card.card.id);
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

/** True if the target requirement can target a player (CR 115.1a). Mirrors
 *  {@link wantsPermanentTarget}: handles both the scalar `"player"` and the
 *  array form (e.g. Lava Spike's `["player", "Planeswalker"]`), plus `"any"`
 *  (CR 115.4 "any target"). Used to mark a player face as clickable during
 *  targeting — a raw `targetType === "player"` misses the array form. */
export function wantsPlayerTarget(
    targetType: string | string[] | undefined
): boolean {
    if (!targetType) return false;
    const types = Array.isArray(targetType) ? targetType : [targetType];
    return types.includes("player") || types.includes("any");
}

/** Client-side mirror of the backend's matchesPermanentFilter. Returns true
 *  if the permanent matches every constraint in the filter (AND semantics).
 *  Used by the mid-resolution choice UI to highlight legal picks.
 *
 *  Must stay in sync with `matchesPermanentFilter` in convex/gre/state.ts. */
export interface ClientPermanentFilter {
    types?: string | string[];
    subtypes?: string | string[];
    requireAbility?: string;
    excludeAbility?: string;
    colors?: string | string[];
    tapped?: boolean;
    /** OR ACROSS filter dimensions (issue #897) — mirrors
     *  `PermanentFilter.any` (`convex/cards/filters.ts`). A non-empty array
     *  of full clauses of this same shape; the permanent matches if it
     *  matches AT LEAST ONE clause, ANDed with every other top-level field
     *  present alongside `any`. Without this branch a filter carrying ONLY
     *  `any` collapses to all-fields-undefined and fails OPEN (highlights
     *  every permanent as a legal pick). */
    any?: ClientPermanentFilter[];
}

export function matchesPermanentFilter(
    card: CardInstance,
    filter: ClientPermanentFilter
): boolean {
    if (filter.types !== undefined) {
        const types = Array.isArray(filter.types)
            ? filter.types
            : [filter.types];
        const cardTypes = card.types ?? [];
        if (!types.some((t) => cardTypes.includes(t))) return false;
    }
    if (filter.subtypes !== undefined) {
        const subs = Array.isArray(filter.subtypes)
            ? filter.subtypes
            : [filter.subtypes];
        const cardSubs = card.subtypes ?? [];
        if (!subs.some((s) => cardSubs.includes(s))) return false;
    }
    const abilities = card.staticAbilities ?? [];
    if (
        filter.requireAbility !== undefined &&
        !abilities.includes(filter.requireAbility)
    ) {
        return false;
    }
    if (
        filter.excludeAbility !== undefined &&
        abilities.includes(filter.excludeAbility)
    ) {
        return false;
    }
    if (
        filter.tapped !== undefined &&
        (card.isTapped === true) !== filter.tapped
    ) {
        return false;
    }
    if (filter.colors !== undefined) {
        // CR 202.2 / 613.1d — mirror the server's effective-color derivation:
        // layer-5 colorOverride wins, else the printed cost's colors. NOTE:
        // grantedColors aren't carried on the client CardInstance, so a color
        // GRANTED by another permanent isn't reflected here — the controller's
        // own printed/overridden colors suffice for the shipped color filters.
        const cardColors =
            card.colorOverride ??
            getColorsFromCost(tryGetDefinition(card.card.id)?.manaCost);
        const wanted = Array.isArray(filter.colors)
            ? filter.colors
            : [filter.colors];
        if (!wanted.some((c) => cardColors.includes(c as Color))) {
            return false;
        }
    }
    // issue #897 — OR ACROSS filter dimensions. Every other field above is
    // ANDed; `any` is the one disjunctive clause list this filter supports.
    // Recurses through this same matcher (each clause is a full AND-of-fields
    // filter). A filter carrying ONLY `any` must NOT fail open (match
    // everything) — this check is what enforces that.
    if (
        filter.any !== undefined &&
        !filter.any.some((clause) => matchesPermanentFilter(card, clause))
    ) {
        return false;
    }
    return true;
}

/** Returns true if a card on the battlefield matches the pending target requirement. */
export function matchesTargetRequirement(
    card: CardInstance,
    targetType: string | string[]
): boolean {
    const types = Array.isArray(targetType) ? targetType : [targetType];
    const cardTypes = card.types ?? [];
    // "spell-or-permanent" matches ANY permanent on the battlefield
    if (types.includes("spell-or-permanent")) return true;
    // CR 115.4 / 120.3: "any target" only matches damageable permanents
    // (creatures, planeswalkers, battles) — never lands, artifacts, enchantments.
    if (types.includes("any")) {
        return DAMAGEABLE_PERMANENT_TYPES.some((t) => cardTypes.includes(t));
    }
    return types.some((t) => cardTypes.includes(t as never));
}

/** CR 109.3 / 102.1 — client mirror of the server's permanent-controller gate
 *  (`matchesBattlefieldController` in convex/gre/rules.ts, #904). Keeps an
 *  illegal-controller permanent from reading as clickable; the server remains
 *  the authority and rejects it regardless. `chooserId` is the player choosing
 *  targets (`pendingTarget.playerId`), NOT necessarily the viewer. */
export function matchesTargetController(
    controllerId: string,
    chooserId: string,
    activePlayerId: string,
    filter: TargetRequirement["controller"]
): boolean {
    switch (filter ?? "any") {
        case "you":
            return controllerId === chooserId;
        case "opponent":
            return controllerId !== chooserId;
        case "active":
            return controllerId === activePlayerId;
        case "any":
            return true;
    }
}

/** True if the target requirement can target a spell on the stack (CR 114.1):
 *  the `"spell"` or `"spell-or-permanent"` types. */
export function wantsSpellTarget(
    targetType: string | string[] | undefined
): boolean {
    if (!targetType) return false;
    const types = Array.isArray(targetType) ? targetType : [targetType];
    return types.includes("spell") || types.includes("spell-or-permanent");
}

/** True if a stack item is a legal spell target under an optional
 *  `spellTypeFilter` (CR 114.1, Fork's "instant or sorcery spell"): an
 *  activated/triggered ability isn't a spell, and a spell must match one of
 *  the requested card types. With no filter, any stack item qualifies. */
export function matchesSpellTypeFilter(
    item: {
        types?: string[];
        abilityId?: string;
        triggeredAbilityId?: string;
    },
    spellTypeFilter: string[] | undefined
): boolean {
    if (!spellTypeFilter || spellTypeFilter.length === 0) return true;
    if (item.abilityId || item.triggeredAbilityId) return false;
    const types = item.types ?? [];
    return spellTypeFilter.some((t) => types.includes(t));
}

/** True if a stack item is a legal spell target under an optional
 *  `spellExcludeTypeFilter` (CR 114.1, Spell Pierce's "target noncreature
 *  spell"): an activated/triggered ability isn't a spell, and a spell must
 *  match NONE of the excluded card types. With no filter, any stack item
 *  qualifies. */
export function matchesSpellExcludeTypeFilter(
    item: {
        types?: string[];
        abilityId?: string;
        triggeredAbilityId?: string;
    },
    spellExcludeTypeFilter: string[] | undefined
): boolean {
    if (!spellExcludeTypeFilter || spellExcludeTypeFilter.length === 0) {
        return true;
    }
    if (item.abilityId || item.triggeredAbilityId) return false;
    const types = item.types ?? [];
    return !spellExcludeTypeFilter.some((t) => types.includes(t));
}

/** True if a stack item is a legal spell target under an optional
 *  `spellCreaturePtFilter` (CR 114.1 + 208.2, Stern Scolding's "target
 *  creature spell with power or toughness 2 or less"): an
 *  activated/triggered ability isn't a spell, the item must be a creature
 *  spell, and its power OR toughness must be at most the given number. With
 *  no filter, any stack item qualifies. */
export function matchesSpellCreaturePtFilter(
    item: {
        types?: string[];
        abilityId?: string;
        triggeredAbilityId?: string;
        power?: number;
        toughness?: number;
    },
    spellCreaturePtFilter: { maxPowerOrToughness: number } | undefined
): boolean {
    if (!spellCreaturePtFilter) return true;
    if (item.abilityId || item.triggeredAbilityId) return false;
    const types = item.types ?? [];
    if (!types.includes("Creature")) return false;
    const max = spellCreaturePtFilter.maxPowerOrToughness;
    const powerOk = item.power !== undefined && item.power <= max;
    const toughnessOk = item.toughness !== undefined && item.toughness <= max;
    return powerOk || toughnessOk;
}

/** True if a stack item is a legal target for Reflecting Mirror's
 *  `spellSingleTargetingController` requirement (CR 114.6 / 115.10): an
 *  actual spell (not an ability) that has EXACTLY ONE target whose single
 *  target is the activating player. When the flag is off, any spell qualifies. */
export function matchesSpellSingleTargetingController(
    item: {
        abilityId?: string;
        triggeredAbilityId?: string;
        targets?: { type: string; id: string }[];
    },
    spellSingleTargetingController: boolean | undefined,
    activatingPlayerId: string
): boolean {
    if (!spellSingleTargetingController) return true;
    if (item.abilityId || item.triggeredAbilityId) return false;
    const targets = item.targets ?? [];
    if (targets.length !== 1) return false;
    return targets[0].type === "player" && targets[0].id === activatingPlayerId;
}

/** True if a stack item is a legal target under the `controller` filter
 *  extended to spell/ability stack objects (CR 109.3 / 114.1 — Lutri, the
 *  Spellchaser's "target instant or sorcery spell YOU CONTROL"). A stack
 *  item's "controller" is its caster (`castById`). Mirrors the server's
 *  `matchesBattlefieldController` (`gre/rules.ts`), reimplemented here
 *  because the frontend never imports GRE engine modules. With no filter (or
 *  `"any"`), any stack item qualifies. */
export function matchesSpellController(
    item: { castById?: string },
    controller: "you" | "opponent" | "any" | "active" | undefined,
    activatingPlayerId: string,
    activePlayerId: string
): boolean {
    switch (controller ?? "any") {
        case "you":
            return item.castById === activatingPlayerId;
        case "opponent":
            return (
                item.castById !== undefined &&
                item.castById !== activatingPlayerId
            );
        case "active":
            return item.castById === activePlayerId;
        case "any":
            return true;
    }
}

/** True if a stack item is a legal target for Equinox's
 *  `spellWouldDestroyLandYouControl` requirement (CR 114.1 + 701.7): a spell
 *  (not an ability) that would destroy a land `playerId` controls — either a
 *  single-target `effect: "destroy-target"` whose chosen permanent is a land
 *  they control, or a `destroysAllLands` spell while they control any land.
 *  Mirrors `spellWouldDestroyLandControlledBy` in `gre/rules.ts`. When the flag
 *  is off, any spell qualifies. */
export function matchesSpellWouldDestroyLand(
    item: {
        card: { id: string };
        targets?: { type: string; id: string }[];
        abilityId?: string;
        triggeredAbilityId?: string;
    },
    spellWouldDestroyLandYouControl: boolean | undefined,
    players: { id: string; battlefield: CardInstance[] }[],
    playerId: string
): boolean {
    if (!spellWouldDestroyLandYouControl) return true;
    if (item.abilityId || item.triggeredAbilityId) return false;
    const def = tryGetDefinition(item.card.id);
    if (!def) return false;
    const controlsALand = players
        .find((p) => p.id === playerId)
        ?.battlefield.some((c) => isLand(c) && c.controllerId === playerId);
    if (def.destroysAllLands) return !!controlsALand;
    if (def.effect === "destroy-target") {
        for (const t of item.targets ?? []) {
            if (t.type !== "permanent") continue;
            for (const p of players) {
                const perm = p.battlefield.find((c) => c.id === t.id);
                if (perm && isLand(perm) && perm.controllerId === playerId) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** True if a stack item is a legal target under the stack-object filters
 *  introduced for filtered counter abilities (CR 113 / 114.1):
 *   - `spellStackKind`: omitted (or `"spell"`) drops abilities — a "target
 *     spell" targets a spell, never an ability (CR 701.5a); `"activated-ability"`
 *     keeps only activated abilities (Brown Ouphe — mana abilities never reach
 *     the stack, CR 605.3a); `"ability"` keeps any ability, activated or
 *     triggered (Stifle); `"any"` keeps BOTH spells and abilities (Ward,
 *     CR 702.21a — "counter that spell or ability" needs no kind narrowing);
 *   - `stackSourceTypeFilter`: the object's source card `types` must include at
 *     least one listed type (Brown Ouphe: "from an artifact source");
 *   - `spellTargetsInstanceIds`: the object must target one of these permanent
 *     instance ids (Mistfolk: "spell that targets this creature"; also reached
 *     by an ability when `spellStackKind` admits abilities — Ward's reflexive
 *     "counter that [spell or ability]").
 *  With every filter absent, any stack item qualifies. */
export function matchesStackObjectFilter(
    item: {
        types?: string[];
        abilityId?: string;
        triggeredAbilityId?: string;
        delayedTriggerId?: string;
        targets?: { type: string; id: string }[];
    },
    spellStackKind:
        | "spell"
        | "activated-ability"
        | "ability"
        | "any"
        | undefined,
    stackSourceTypeFilter: string[] | undefined,
    spellTargetsInstanceIds: string[] | undefined
): boolean {
    const isAbility =
        !!item.abilityId ||
        !!item.triggeredAbilityId ||
        !!item.delayedTriggerId;
    // A "target spell" targets a SPELL, never an ability (CR 701.5a). Abilities
    // on the stack are legal only when the requirement explicitly opts into an
    // ability kind: the default (omitted) AND "spell" both drop abilities;
    // "activated-ability" keeps only activated abilities; "ability" keeps any
    // ability — activated OR triggered (Stifle); "any" keeps both (Ward).
    const acceptsSpell =
        spellStackKind === undefined ||
        spellStackKind === "spell" ||
        spellStackKind === "any";
    const acceptsAbility =
        spellStackKind === "activated-ability" ||
        spellStackKind === "ability" ||
        spellStackKind === "any";
    if (isAbility) {
        if (!acceptsAbility) return false;
        // "activated-ability" narrows further to activated abilities.
        if (spellStackKind === "activated-ability" && !item.abilityId) {
            return false;
        }
    } else if (!acceptsSpell) {
        return false; // an ability-only kind never accepts a spell
    }
    if (stackSourceTypeFilter && stackSourceTypeFilter.length > 0) {
        const types = item.types ?? [];
        if (!stackSourceTypeFilter.some((t) => types.includes(t))) return false;
    }
    if (spellTargetsInstanceIds && spellTargetsInstanceIds.length > 0) {
        const targets = item.targets ?? [];
        if (
            !targets.some(
                (t) =>
                    t.type === "permanent" &&
                    spellTargetsInstanceIds.includes(t.id)
            )
        ) {
            return false;
        }
    }
    return true;
}

/** Builds a `TriggerStateView` (the shape `canActivate` predicates read,
 *  CR 602.5b) from the viewer-visible players and turn state. Predicates
 *  legitimately inspect `state.players` (a controller's hand size — Library of
 *  Alexandria; any creature on the battlefield — Pestilence) and
 *  `state.activePlayerId` (Nettling Imp's "only during an opponent's turn"),
 *  so feeding them an empty player list made every such ability misjudged as a
 *  UI hint (#436). This re-projects the client `Player[]` into the minimal view
 *  the contract requires; the server's full `GameState` evaluation stays
 *  authoritative. Only fields cards may rely on are surfaced — `hand.length`,
 *  battlefield `types`/`subtypes`/`staticAbilities`, life, ids. */
export function buildTriggerStateView(
    players: ReadonlyArray<{
        id: string;
        life: number;
        hand: ReadonlyArray<unknown>;
        battlefield: ReadonlyArray<CardInstance>;
        graveyard?: ReadonlyArray<CardInstance>;
    }>,
    activePlayerId?: string,
    /** Player ids under Abeyance's "can't activate abilities that aren't mana
     *  abilities" lock (CR 602.1, issue #1124) — forwarded from the wire
     *  `GameState.cannotActivateAbilitiesThisTurn` so `getStackAbilities` can
     *  hide the affected controller's non-mana abilities as a UI hint. */
    cannotActivateAbilitiesThisTurn?: ReadonlyArray<string>
): TriggerStateView {
    return {
        players: players.map((p) => ({
            id: p.id,
            life: p.life,
            hand: { length: p.hand.length },
            // CR 118.5 — graveyard contents feed the exile-from-graveyard
            // activation-cost affordability hint (Grim Lavamancer, Night Soil)
            // in `getStackAbilities`; without it the ability is wrongly hidden.
            graveyard: (p.graveyard ?? []).map((c) => ({
                id: c.id,
                ownerId: c.ownerId,
                types: c.types ?? [],
            })),
            battlefield: p.battlefield.map((c) => ({
                id: c.id,
                controllerId: c.controllerId,
                ownerId: c.ownerId,
                types: c.types ?? [],
                subtypes: c.subtypes ?? [],
                staticAbilities: c.staticAbilities ?? [],
                power: c.power,
                toughness: c.toughness,
                isTapped: c.isTapped === true,
                // CR 202.2 / 613.1d — effective colours for a tapOtherFilter
                // colour clause (Hand of Justice): layer-5 override wins, else
                // the printed cost's colours.
                colors:
                    (c.colorOverride as Color[] | undefined) ??
                    getColorsFromCost(tryGetDefinition(c.card.id)?.manaCost),
            })),
        })),
        activePlayerId,
        cannotActivateAbilitiesThisTurn,
    };
}

/** The alternative casting costs (CR 118.9) the caster can currently AFFORD for
 *  a hand card — the cast-availability CONDITION holds ("not your turn", "you
 *  control a Swamp") AND the cost is payable from the viewer-visible
 *  board/hand/life. The cast-option picker offers ONLY these: an unaffordable or
 *  condition-failing alternative (Force of Negation / Force of Vigor pitched on
 *  your own turn, Mine Collapse pitched on the opponent's turn, Snuff Out's "Pay
 *  4 life" without a Swamp) is filtered out so clicking it never throws a hard
 *  `announceCast` rejection ("Can't pay the alternative cost"). Delegates to the
 *  server predicate `affordableAlternativeCosts` — the same authority the
 *  mutation enforces — so the UI and the GRE can never disagree (no duplicated
 *  condition logic client-side). The projected `Player`/`CardInstance` shapes
 *  carry every field the predicate reads (`activePlayerId`, battlefield
 *  `types`/`subtypes`/`colorOverride`, own-hand `card.id`, `life`), so it
 *  evaluates correctly against the wire projection. */
export function affordableAltCostsForCard(
    card: CardInstance,
    casterId: string,
    players: ReadonlyArray<Player>,
    activePlayerId: string
): AlternativeCost[] {
    const caster = players.find((p) => p.id === casterId);
    if (!caster) return [];
    const state = {
        activePlayerId,
        players,
    } as unknown as GameState;
    return affordableAlternativeCosts(
        state,
        caster as unknown as PlayerState,
        card as unknown as CardInstanceState
    );
}

/** Does a HAND card (wire-projected `CardInstance`) match an
 *  `EffectCardFilter`? Thin wrapper around the server's
 *  `handCardMatchesFilter` (`convex/gre/alternativeCost.ts`) — delegates to
 *  the SAME predicate the mutation enforces (mirrors `affordableAltCostsForCard`
 *  above) so the UI and the GRE can never disagree on hand-card eligibility.
 *  Shared (issue #901) by every client-side hand-card-matching picker/gate:
 *  the alternative-cost hand leg (`CastAlternativeHandCostDialog`) and the
 *  `discardFilter` activation-cost leg (`DiscardCostDialog`, and the
 *  `getStackAbilities` affordability gate below). */
export function matchesHandCardFilter(
    card: CardInstance,
    filter: EffectCardFilter
): boolean {
    return handCardMatchesFilter(card as unknown as CardInstanceState, filter);
}

/** Returns stack-using activated abilities the player can currently announce.
 *  Only the non-mana availability is checked (source not already tapped when
 *  the ability has {T}); mana is deferred to a `pendingActivation` payment
 *  phase on the server, mirroring the spell cast flow. `phase` narrows to
 *  abilities whose `activationPhaseRestriction` (CR 602.5) allows the
 *  current phase — pass the current game phase to hide abilities like
 *  Jade Statue's animate outside of combat. */
export function getStackAbilities(
    card: CardInstance,
    phase?: Phase,
    /** True iff the controller has a "last card drawn this turn" still in
     *  hand. Gates the Jandor's Ring discard cost as a UI hint; the server
     *  validation is authoritative. Defaults to true so callers that don't
     *  pass it (and abilities without the cost) are unaffected. */
    canDiscardLastDrawn: boolean = true,
    /** Viewer-visible game state for `canActivate` predicates (CR 602.5b).
     *  When omitted, an empty player list is used — sufficient for predicates
     *  that only inspect the source permanent (e.g. Clockwork Beast's counter
     *  cap), but a predicate that scans players/battlefields will see nothing.
     *  Callers with access to player/turn state MUST pass a real view (built
     *  via `buildTriggerStateView`) so player-state-reading abilities — Library
     *  of Alexandria, Pestilence, Nettling Imp — are surfaced correctly (#436). */
    stateView?: TriggerStateView,
    /** Life available to the player who would pay the ability's cost. Gates the
     *  CR 118.4 life-payment cost as a UI hint: an ability whose `cost.life`
     *  exceeds it is unpayable and hidden, mirroring the server throw ("Not
     *  enough life"). Omit to skip the gate (callers/tests without life data). */
    payerLife?: number,
    /** The activating player's OWN real hand cards (never the opponent's —
     *  those are stripped to `null` on the wire and never reach this gate).
     *  Gates the CR 602.1 / 118.3 `discardFilter` activation cost (Survival
     *  of the Fittest "Discard a creature card") as a UI hint: an ability
     *  whose `cost.discardFilter` has fewer than `count` matching cards in
     *  this hand is unpayable and hidden, mirroring the server throw ("Not
     *  enough matching cards in hand to pay the discard cost"). Omit to skip
     *  the gate (callers without hand data, or the non-controller
     *  `getAnyPlayerStackAbilities` path — a `discardFilter` cost is always
     *  paid from the CONTROLLER's own hand, never the activator's). */
    discardFilterHand?: ReadonlyArray<CardInstance>
): { id: string; oracleText: string }[] {
    const cardDef = getDefinition(card.card.id);
    const tapLocked = isTapLockedBySummoningSickness(card);
    const filterAbility = (a: {
        useStack: boolean;
        oracleText: string;
        cost: {
            tap?: boolean;
            life?: number;
            loyalty?: number;
            removeCounter?: { type: string; count: number };
            discardLastDrawn?: boolean;
            discardFilter?: { filter: EffectCardFilter; count: number };
            exileFromGraveyard?: {
                count: number;
                cardType?: CardType;
                owner?: "you";
            };
        };
        activationPhaseRestriction?: ReadonlyArray<Phase>;
        sorcerySpeedOnly?: boolean;
        activatableByOpponentsOnly?: boolean;
        activateFromHand?: boolean;
        activateFromGraveyard?: boolean;
        canActivate?: (
            source: PermanentView,
            state: TriggerStateView
        ) => boolean;
    }): boolean => {
        if (!a.useStack || !a.oracleText) return false;
        // CR 602.1 / 605.1a (issue #1124) — Abeyance's "can't activate abilities
        // that aren't mana abilities" lock hides every non-mana ability on the
        // controller's permanents as a UI hint; the `activateAbility` mutation
        // is the authoritative gate. SCOPE: gates on the card's CONTROLLER,
        // which is correct for every normal (`isMe`-only) call site, but
        // `getAnyPlayerStackAbilities` re-filters this same list for a
        // non-controller ACTIVATOR (an "any player may activate" / "opponents
        // only" ability) — that narrower activator-vs-controller distinction
        // isn't threaded through here, so a locked non-controller activator on
        // an unlocked controller's permanent is not hidden client-side. The
        // server gate is unaffected and remains correct either way.
        if (
            stateView?.cannotActivateAbilitiesThisTurn?.includes(
                card.controllerId
            )
        ) {
            return false;
        }
        // CR 113.6 / 702.29a — a zone-restricted ability functions ONLY from the
        // zone it opts into: Cycling (`activateFromHand`) from the hand, Ashen
        // Ghoul (`activateFromGraveyard`) from the graveyard. Neither is a
        // battlefield ability, so a permanent whose definition carries one (a
        // Marauding Mako that resolved onto the battlefield) must NOT surface it
        // in its battlefield menu — the server rejects it there regardless.
        if (a.activateFromHand || a.activateFromGraveyard) return false;
        // CR 602.1 — "only your opponents may activate" abilities are never
        // surfaced on the controller's OWN permanent (this function is called
        // only for `isMe` cards); the opponent's view uses
        // `getAnyPlayerStackAbilities`.
        if (a.activatableByOpponentsOnly) return false;
        if (a.cost.tap && card.isTapped) return false;
        // CR 302.1 — creature with summoning sickness can't pay {T}.
        if (a.cost.tap && tapLocked) return false;
        // CR 118.4 — a "pay N life" cost is illegal unless the payer has at
        // least N life. Hidden as a UI hint so the ability is never offered
        // when unpayable; the server throw ("Not enough life") is
        // authoritative. Skipped when `payerLife` is unknown (undefined).
        if (
            a.cost.life !== undefined &&
            payerLife !== undefined &&
            payerLife < a.cost.life
        ) {
            return false;
        }
        if (
            a.activationPhaseRestriction &&
            phase !== undefined &&
            !a.activationPhaseRestriction.includes(phase)
        ) {
            return false;
        }
        // CR 602.3b (issue #1156) — "activate only as a sorcery" (Dauthi
        // Voidwalker's second ability). A cheap client hint mirroring the
        // loyalty gate's own admitted looseness above ("the full 'stack
        // empty + priority' refinement is the server's job"): this view has
        // no stack-length/priority-holder field to check, so it narrows to
        // the main-phase half of `isSorceryTiming` only. The
        // `activateAbility` mutation (`assertActivationTimingLegal`) is
        // authoritative regardless. Skipped when `phase` is unknown
        // (undefined) — same fail-open discipline as `activationPhaseRestriction`.
        if (
            a.sorcerySpeedOnly &&
            phase !== undefined &&
            phase !== "PRECOMBAT_MAIN" &&
            phase !== "POSTCOMBAT_MAIN"
        ) {
            return false;
        }
        // CR 122.6 — counter-removal cost is only legal if the source has
        // enough counters of the declared type.
        if (a.cost.removeCounter) {
            const have = card.counters?.[a.cost.removeCounter.type] ?? 0;
            if (have < a.cost.removeCounter.count) return false;
        }
        // CR 606 — a LOYALTY ABILITY (signed `cost.loyalty`) is offered only as
        // a UI hint when its three restrictions can be met; the `activateAbility`
        // mutation is the authoritative gate.
        if (a.cost.loyalty !== undefined) {
            // CR 606.3 — at most one loyalty ability of this permanent per turn.
            if (card.loyaltyActivatedThisTurn) return false;
            // CR 606.3 — sorcery-speed: only on the controller's own turn. The
            // full "stack empty + priority" refinement is the server's job; the
            // active-turn check is the cheap client hint the view can make.
            if (
                stateView?.activePlayerId !== undefined &&
                stateView.activePlayerId !== card.controllerId
            ) {
                return false;
            }
            // CR 606.5 — a `-N` cost may not take loyalty below 0.
            if (a.cost.loyalty < 0) {
                const loyalty = card.counters?.loyalty ?? 0;
                if (loyalty + a.cost.loyalty < 0) return false;
            }
        }
        // CR 118.3 — "discard the last card you drew this turn" cost
        // (Jandor's Ring) is unpayable when no such card is in hand.
        if (a.cost.discardLastDrawn && !canDiscardLastDrawn) return false;
        // CR 602.1 / 118.3 — "discard a card matching <filter>" cost
        // (Survival of the Fittest) is unpayable unless at least `count`
        // cards in the controller's OWN hand match the filter. UI hint
        // against the viewer-visible hand; server validation is
        // authoritative. Skipped when `discardFilterHand` is unknown
        // (undefined) — same fail-open discipline as `payerLife`.
        if (a.cost.discardFilter && discardFilterHand !== undefined) {
            const { filter, count } = a.cost.discardFilter;
            const matching = discardFilterHand.filter((c) =>
                matchesHandCardFilter(c, filter)
            ).length;
            if (matching < count) return false;
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard" cost
        // (Night Soil) is unpayable unless one graveyard holds enough matching
        // cards (the whole cost must come from ONE graveyard). UI hint against
        // the viewer-visible graveyards; server validation is authoritative.
        if (a.cost.exileFromGraveyard) {
            const { count, cardType, owner } = a.cost.exileFromGraveyard;
            // CR 118.5 — `owner: "you"` restricts the source to the activating
            // (viewer's own) graveyard; default = any player's (Night Soil).
            const sources =
                owner === "you"
                    ? (stateView?.players ?? []).filter(
                          (p) => p.id === card.controllerId
                      )
                    : (stateView?.players ?? []);
            const payable = sources.some(
                (p) =>
                    (p.graveyard ?? []).filter(
                        (c) =>
                            cardType === undefined || c.types.includes(cardType)
                    ).length >= count
            );
            if (!payable) return false;
        }
        // CR 602.5b — ability-specific activation precondition. Evaluated as a
        // UI hint against the viewer-visible `stateView` (real player/turn data
        // when the caller supplies it; an empty player list otherwise). A
        // predicate that reads the controller's hand or scans battlefields
        // (Library of Alexandria, Pestilence) needs the populated view to judge
        // correctly (#436); server-side validation against the full GameState
        // is authoritative regardless.
        if (a.canActivate !== undefined) {
            const view: TriggerStateView = stateView ?? { players: [] };
            if (!a.canActivate(card as PermanentView, view)) return false;
        }
        return true;
    };
    const native = (cardDef.activatedAbilities ?? [])
        .filter(filterAbility)
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
    // CR 113.1 — abilities granted to this permanent by another card (e.g.
    // Zombie Master's "{B}: Regenerate ~"). Resolve template via the
    // granting card's def.
    const granted: { id: string; oracleText: string }[] = [];
    for (const grant of card.grantedActivatedAbilities ?? []) {
        const sourceDef = getDefinition(grant.sourceCardId);
        const tmpl = sourceDef.grantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (!tmpl) continue;
        if (!filterAbility(tmpl)) continue;
        granted.push({ id: tmpl.id, oracleText: tmpl.oracleText });
    }
    return [...native, ...granted];
}

/** CR 113.6 / 602.5b — activated abilities the viewer may announce on a card in
 *  their OWN graveyard (Ashen Ghoul's "{B}: Return this card from your graveyard
 *  to the battlefield. Activate only during your upkeep and only if three or
 *  more creature cards are above this card"). The board never sees the GRE, so
 *  this mirrors {@link getStackAbilities} for the graveyard zone: only abilities
 *  that opt in via `activateFromGraveyard` are eligible, gated as UI hints on
 *  the same predicates the server enforces (`activateAbility` in game.ts is
 *  authoritative regardless):
 *   - `activationPhaseRestriction` (CR 602.5) narrows to the current `phase`;
 *   - `controllerTurnOnly` ("only during your upkeep/turn") requires the
 *     graveyard owner to be the active player (CR 602.5 — "your" = the card's
 *     owner while it sits in the graveyard);
 *   - `canActivate` (CR 602.5b) evaluates the ability precondition against the
 *     viewer-visible `stateView` — for Ashen Ghoul, the
 *     `creatureCardsAboveInGraveyard` count, which reads the projected graveyard
 *     order carried by `buildTriggerStateView`.
 *  Mana is deferred to the `pendingActivation` payment phase (the server opens
 *  it), exactly like the battlefield activated-ability flow. */
export function getGraveyardStackAbilities(
    card: CardInstance,
    phase: Phase | undefined,
    stateView: TriggerStateView
): { id: string; oracleText: string }[] {
    // A card whose id resolves to no definition (synthetic tokens, test
    // fixtures) has no graveyard-activatable ability — never throw here, since
    // this runs while merely rendering the graveyard reveal for every card.
    const cardDef = tryGetDefinition(card.card.id);
    return (cardDef?.activatedAbilities ?? [])
        .filter((a) => {
            if (!a.activateFromGraveyard || !a.useStack || !a.oracleText) {
                return false;
            }
            // CR 602.1 / 605.1a (issue #1124) — Abeyance's "can't activate
            // abilities that aren't mana abilities" lock also hides a
            // graveyard-activated ability (Ashen Ghoul); the `activateAbility`
            // mutation is the authoritative gate regardless of source zone.
            if (
                stateView.cannotActivateAbilitiesThisTurn?.includes(
                    card.ownerId
                )
            ) {
                return false;
            }
            if (
                a.activationPhaseRestriction &&
                phase !== undefined &&
                !a.activationPhaseRestriction.includes(phase)
            ) {
                return false;
            }
            // CR 602.5 — "Activate only during your upkeep/turn": while the card
            // is in the graveyard its controller is its owner, so the owner must
            // be the active player.
            if (
                a.controllerTurnOnly &&
                stateView.activePlayerId !== undefined &&
                stateView.activePlayerId !== card.ownerId
            ) {
                return false;
            }
            if (a.canActivate) {
                if (!a.canActivate(card as unknown as PermanentView, stateView))
                    return false;
            }
            return true;
        })
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
}

/** CR 113.6 / 702.29a — activated abilities the viewer may announce on a card in
 *  their OWN hand (Cycling's "{cost}, Discard this card: Draw a card"). The board
 *  never sees the GRE, so this mirrors {@link getGraveyardStackAbilities} for the
 *  hand zone: only abilities that opt in via `activateFromHand` are eligible,
 *  gated as UI hints on the same predicates the server enforces (`activateAbility`
 *  in game.ts is authoritative regardless). Cycling's discard-this cost is always
 *  payable (the source is in hand) and its mana is deferred to the
 *  `pendingActivation` payment phase, so the only client-side gates are the
 *  standard phase / turn / precondition ones:
 *   - `activationPhaseRestriction` (CR 602.5) narrows to the current `phase`
 *     (Cycling is instant-speed and declares none, so this never hides it);
 *   - `controllerTurnOnly` — none of the Cycling cards use it, but honored for
 *     any future hand-activated ability that does;
 *   - `canActivate` (CR 602.5b) evaluates the ability precondition against the
 *     viewer-visible `stateView`. */
export function getHandStackAbilities(
    card: CardInstance,
    phase: Phase | undefined,
    stateView: TriggerStateView
): { id: string; oracleText: string }[] {
    // A card whose id resolves to no definition (synthetic tokens, test
    // fixtures) has no hand-activatable ability — never throw here, since this
    // runs while merely rendering the hand for every card.
    const cardDef = tryGetDefinition(card.card.id);
    return (cardDef?.activatedAbilities ?? [])
        .filter((a) => {
            if (!a.activateFromHand || !a.useStack || !a.oracleText) {
                return false;
            }
            // CR 602.1 / 605.1a (issue #1124) — Abeyance's "can't activate
            // abilities that aren't mana abilities" lock also hides a
            // hand-activated ability (Cycling); the `activateAbility` mutation
            // is the authoritative gate regardless of source zone.
            if (
                stateView.cannotActivateAbilitiesThisTurn?.includes(
                    card.ownerId
                )
            ) {
                return false;
            }
            if (
                a.activationPhaseRestriction &&
                phase !== undefined &&
                !a.activationPhaseRestriction.includes(phase)
            ) {
                return false;
            }
            // CR 602.5 — "Activate only during your turn": while the card is in
            // hand its controller is its owner, so the owner must be active.
            if (
                a.controllerTurnOnly &&
                stateView.activePlayerId !== undefined &&
                stateView.activePlayerId !== card.ownerId
            ) {
                return false;
            }
            if (a.canActivate) {
                if (!a.canActivate(card as unknown as PermanentView, stateView))
                    return false;
            }
            return true;
        })
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
}

/** Filters `getStackAbilities` to those a NON-controller may activate on an
 *  OPPONENT's permanent while holding priority — the only case where a
 *  non-controller may activate. Two flags qualify: "any player may activate"
 *  (CR 113.3c, Ifh-Bíff Efreet) and "only your opponents may activate"
 *  (CR 602.1, Clergy of the Holy Nimbus). Granted abilities carry neither flag,
 *  so only the card's native definition is consulted. */
export function getAnyPlayerStackAbilities(
    card: CardInstance,
    phase?: Phase,
    /** Viewer-visible game state for `canActivate` predicates (#436). Forwarded
     *  to `getStackAbilities` so an any-player ability gated on player/board
     *  state is judged against real data. */
    stateView?: TriggerStateView,
    /** Life of the activating (non-controller) player — the viewer paying the
     *  cost, NOT the permanent's controller. Forwarded to `getStackAbilities`
     *  to gate the CR 118.4 life cost (see there). */
    payerLife?: number
): { id: string; oracleText: string }[] {
    const cardDef = getDefinition(card.card.id);
    const nonControllerIds = new Set(
        (cardDef.activatedAbilities ?? [])
            .filter(
                (a) => a.activatableByAnyPlayer || a.activatableByOpponentsOnly
            )
            .map((a) => a.id)
    );
    if (nonControllerIds.size === 0) return [];
    // Opponent-only abilities are filtered OUT by `getStackAbilities`, so query
    // the card definition directly for those, then merge with any "any player"
    // abilities surfaced through the normal filter (which applies tap/phase/
    // canActivate gating).
    const fromStack = getStackAbilities(
        card,
        phase,
        true,
        stateView,
        payerLife
    ).filter((a) => nonControllerIds.has(a.id));
    const seen = new Set(fromStack.map((a) => a.id));
    const opponentOnly = (cardDef.activatedAbilities ?? [])
        .filter((a) => a.activatableByOpponentsOnly && !seen.has(a.id))
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
    return [...fromStack, ...opponentOnly];
}

/** Returns the oracle text for an activated ability by id, or null. Checks
 *  the card's own definition first, then any granted-activated entries on the
 *  passed instance (resolved via the granting card's def). */
export function getAbilityOracleText(
    cardId: string,
    abilityId: string,
    grantedActivatedAbilities?: ReadonlyArray<{
        sourceCardId: string;
        abilityId: string;
    }>
): string | null {
    const cardDef = getDefinition(cardId);
    const ability = cardDef.activatedAbilities?.find((a) => a.id === abilityId);
    if (ability?.oracleText) return ability.oracleText;
    for (const grant of grantedActivatedAbilities ?? []) {
        if (grant.abilityId !== abilityId) continue;
        const tmpl = getDefinition(grant.sourceCardId).grantTemplates?.find(
            (a) => a.id === abilityId
        );
        if (tmpl?.oracleText) return tmpl.oracleText;
    }
    return null;
}

/** Storm's cast trigger (CR 702.40, ADR 0052) is engine-synthesized — no card
 *  declares it in `triggeredAbilities` (it is not a per-card DSL/`resolve()`
 *  ability, see `collectCastTriggers` / `resolveStormTrigger` in
 *  `convex/gre/state.ts`) — so its label can't come from a card-def lookup.
 *  Matches the Mechanics Registry row id (`storm`, `mechanicsRegistry.ts`). */
const STORM_TRIGGER_ORACLE_TEXT =
    "Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)";

/** Returns the oracle text for a triggered ability by id, or null. Checks
 *  the card's own definition first, then any granted-triggered entries on the
 *  passed instance (resolved via the granting card's `triggeredGrantTemplates`)
 *  so an anthem-granted trigger (Energy Flux) shows its text on the stack. */
export function getTriggeredAbilityOracleText(
    cardId: string,
    triggeredAbilityId: string,
    grantedTriggeredAbilities?: ReadonlyArray<{
        sourceCardId: string;
        abilityId: string;
    }>
): string | null {
    if (triggeredAbilityId === "storm") return STORM_TRIGGER_ORACLE_TEXT;
    const cardDef = getDefinition(cardId);
    const ability = cardDef.triggeredAbilities?.find(
        (a) => a.id === triggeredAbilityId
    );
    if (ability?.oracleText) return ability.oracleText;
    for (const grant of grantedTriggeredAbilities ?? []) {
        if (grant.abilityId !== triggeredAbilityId) continue;
        const tmpl = getDefinition(
            grant.sourceCardId
        ).triggeredGrantTemplates?.find((a) => a.id === triggeredAbilityId);
        if (tmpl?.oracleText) return tmpl.oracleText;
    }
    return null;
}

/** Returns the oracle text for a delayed triggered ability (CR 603.7a) by
 *  source card id + delayed trigger id, or null when unknown. Mirrors
 *  `getAbilityOracleText` / `getTriggeredAbilityOracleText` but looks up
 *  `cardDef.delayedTriggers` — a delayed trigger has no granted-ability path
 *  (it is always scheduled by its own source's resolve, never granted
 *  cross-card), so there is no grant-template fallback to check. */
export function getDelayedTriggerOracleText(
    cardId: string,
    delayedTriggerId: string
): string | null {
    const cardDef = getDefinition(cardId);
    const trigger = cardDef.delayedTriggers?.find(
        (t) => t.id === delayedTriggerId
    );
    return trigger?.oracleText ?? null;
}

/** One line of a modal spell's oracle text as shown on the stack (CR 700.2c). */
export type StackModeLine = {
    modeId: string;
    /** The bullet clause for this mode (`SpellMode.oracleText`). */
    oracleText: string;
    /** Short mode label (`SpellMode.label`) — a fallback if oracleText is thin. */
    label: string;
    /** True for the mode the caster locked in at cast. */
    chosen: boolean;
};

/** CR 700.2c (issue #1274) — for a modal spell on the stack that has locked in
 *  a mode, returns each declared mode's oracle line flagged with whether it is
 *  the chosen one, so the stack UI can highlight the chosen mode and
 *  de-emphasize the rest — visible to BOTH players (the mode is public once the
 *  spell is on the stack). Reads `chosenModeId`, which survives the wire
 *  projection (`SlimStackItem` keeps every StackItem field but `card`).
 *
 *  Returns null for a stack item that is NOT a modal spell showing a chosen
 *  mode: an ability (activated / triggered / delayed carries no spell mode), a
 *  non-modal spell, a spell with no locked mode, or a `chosenModeId` that
 *  doesn't match any declared mode (defensive against a stale id). */
export function getStackModeLines(item: {
    card: Record<string, unknown>;
    chosenModeId?: string;
    abilityId?: string;
    triggeredAbilityId?: string;
    delayedTriggerId?: string;
}): StackModeLine[] | null {
    if (!item.chosenModeId) return null;
    // Only a spell carries a spell-level chosen mode — never an ability item.
    if (item.abilityId || item.triggeredAbilityId || item.delayedTriggerId) {
        return null;
    }
    // `card.id` is `unknown` on the fat engine `StackItem` (Record-typed card)
    // and `string` on the wire `SlimStackItem` — accept both.
    const cardId = item.card.id;
    if (typeof cardId !== "string") return null;
    const def = tryGetDefinition(cardId);
    if (!def?.modes || def.modes.length === 0) return null;
    if (!def.modes.some((m) => m.id === item.chosenModeId)) return null;
    return def.modes.map((m) => ({
        modeId: m.id,
        oracleText: m.oracleText,
        label: m.label,
        chosen: m.id === item.chosenModeId,
    }));
}

/** Display state for a card ability in the zoom panel.
 *  - "native": present on the CardDefinition and still effective.
 *  - "granted": added at runtime by an aura/effect (not on the def).
 *  - "lost": present on the CardDefinition but removed at runtime
 *    (e.g. a Wall losing Defender). Computed by diffing native vs
 *    instance.staticAbilities — backend has no explicit field for this. */
export type AbilityDisplayState = "native" | "granted" | "lost";

export type DisplayKeyword = {
    name: string;
    state: AbilityDisplayState;
};

export type DisplayActivated = {
    id: string;
    oracleText: string;
    state: "native" | "granted";
};

export type DisplayTriggered = {
    id: string;
    oracleText: string;
    state: "native" | "granted";
};

export type DisplayAbilities = {
    keywords: DisplayKeyword[];
    activated: DisplayActivated[];
    triggered: DisplayTriggered[];
};

/** Decides whether the card preview should print the card's `oracleText`
 *  instead of (or alongside) the structured ability rows. The structured
 *  abilities view (`getDisplayAbilities`) only renders keywords, activated and
 *  triggered abilities — it has NO row for effects whose rules text lives ONLY
 *  in `oracleText`:
 *    - `staticEffects[]` (P/T CDA, anthems, keyword grants — CR 611/613)
 *    - `replacementEffects[]` (CR 614 — e.g. Sulfuric Vortex's lifegain lock)
 *    - enter-tapped mechanics (CR 614.12 shocklands, conditional-tapped lands,
 *      plain `entersTapped`)
 *  For those, and for spells/auras/cards with no structured abilities at all,
 *  the Oracle text is the only place the behavior is described, so it must be
 *  shown. When it is shown, the structured render is suppressed by the caller
 *  to avoid double-printing keywords already covered by the Oracle text. */
export function shouldShowOracleText(
    def: CardDefinition | null | undefined,
    types: readonly string[],
    subtypes: readonly string[]
): boolean {
    if (!def?.oracleText) return false;
    const isSpellCard = types.includes("Instant") || types.includes("Sorcery");
    // CR 303.4 — an aura's granted clauses live on `staticEffects`, never on
    // its own `staticAbilities`, so the structured view would hide them.
    const isAura = subtypes.includes("Aura");
    const hasStructuredAbilities =
        (def.staticAbilities?.length ?? 0) > 0 ||
        (def.activatedAbilities?.length ?? 0) > 0 ||
        (def.triggeredAbilities?.length ?? 0) > 0;
    // Effects the structured view cannot render — their text is oracle-only.
    const hasOracleOnlyText =
        (def.staticEffects?.length ?? 0) > 0 ||
        (def.replacementEffects?.length ?? 0) > 0 ||
        def.entersTappedUnlessPay !== undefined ||
        def.entersTappedUnless !== undefined ||
        def.entersTapped === true;
    return (
        isSpellCard || isAura || !hasStructuredAbilities || hasOracleOnlyText
    );
}

/** Resolves the abilities to display in the zoom panel for a card. When
 *  `instance` is provided, runtime overrides are reflected:
 *  - keywords on the def but not on the instance are tagged "lost"
 *  - keywords on the instance but not on the def are tagged "granted"
 *  - granted activated abilities (CR 113.1) are appended via grantTemplates
 *  Without an instance, returns the static def view (used by deck builder, etc.). */
export function getDisplayAbilities(
    cardId: string,
    instance?: CardInstance
): DisplayAbilities {
    const def = tryGetDefinition(cardId);
    if (!def) return { keywords: [], activated: [], triggered: [] };
    const nativeKw = def.staticAbilities ?? [];
    const effectiveKw = instance?.staticAbilities ?? nativeKw;
    const nativeSet = new Set(nativeKw);
    const effectiveSet = new Set(effectiveKw);

    const keywords: DisplayKeyword[] = [];
    for (const k of nativeKw) {
        keywords.push({
            name: k,
            state: effectiveSet.has(k) ? "native" : "lost",
        });
    }
    for (const k of effectiveKw) {
        if (!nativeSet.has(k)) keywords.push({ name: k, state: "granted" });
    }

    const activated: DisplayActivated[] = (def.activatedAbilities ?? [])
        .filter((a) => a.oracleText)
        .map((a) => ({
            id: a.id,
            oracleText: a.oracleText,
            state: "native" as const,
        }));
    for (const grant of instance?.grantedActivatedAbilities ?? []) {
        const sourceDef = tryGetDefinition(grant.sourceCardId);
        const tmpl = sourceDef?.grantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (!tmpl?.oracleText) continue;
        activated.push({
            id: tmpl.id,
            oracleText: tmpl.oracleText,
            state: "granted",
        });
    }

    const triggered: DisplayTriggered[] = (def.triggeredAbilities ?? [])
        .filter((a) => a.oracleText)
        .map((a) => ({
            id: a.id,
            oracleText: a.oracleText,
            state: "native" as const,
        }));
    // CR 113.1 — anthem-granted triggers (Energy Flux) live on the granting
    // card's `triggeredGrantTemplates`, not on this card's def.
    for (const grant of instance?.grantedTriggeredAbilities ?? []) {
        const sourceDef = tryGetDefinition(grant.sourceCardId);
        const tmpl = sourceDef?.triggeredGrantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (!tmpl?.oracleText) continue;
        triggered.push({
            id: tmpl.id,
            oracleText: tmpl.oracleText,
            state: "granted",
        });
    }

    return { keywords, activated, triggered };
}

/** The abilities the card preview should render below the type line.
 *
 *  When printed Oracle text is shown, it already covers the card's NATIVE
 *  abilities, so re-printing the structured view would duplicate them. But
 *  printed text is fixed — it can't reflect runtime grants that live on the
 *  instance: a granted keyword (e.g. landwalk), a granted activated ability,
 *  or a keyword LOST at runtime. Those deltas are surfaced even alongside
 *  Oracle text so they appear while the effect is active and disappear when it
 *  ends (#156). When Oracle text is not shown, the full structured set
 *  renders. */
export function resolvePreviewAbilities(
    abilities: DisplayAbilities,
    showOracleText: boolean
): DisplayAbilities {
    if (!showOracleText) return abilities;
    return {
        keywords: abilities.keywords.filter((k) => k.state !== "native"),
        activated: abilities.activated.filter((a) => a.state === "granted"),
        triggered: abilities.triggered.filter((t) => t.state === "granted"),
    };
}

/** Display strings for internal `staticAbilities` markers — keywords whose
 *  identifier is a slug rather than the printed Oracle keyword. Real MTG
 *  evergreen keywords (flying, trample, first strike, …) are not listed
 *  here; they round-trip through `capitalizeKeyword` and render as
 *  "Flying" / "Trample" / "First strike" / etc. unchanged. */
const KEYWORD_DISPLAY: Record<string, string> = {
    "does-not-untap":
        "This permanent doesn't untap during its controller's untap step.",
    "skip-untap-step": "Players skip their untap steps.",
};

/** Renders a `staticAbilities` keyword for display. Internal slug keywords
 *  (the ones whose name reveals an implementation detail rather than the
 *  printed Oracle phrasing — e.g. `skip-untap-step`) are mapped to their
 *  Oracle line via `KEYWORD_DISPLAY`. Everything else falls back to a
 *  simple first-letter capitalization, matching the user preference of
 *  "name only, no reminder text" for real MTG keywords. */
export function capitalizeKeyword(k: string): string {
    if (!k) return k;
    const mapped = KEYWORD_DISPLAY[k];
    if (mapped) return mapped;
    return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Builds an MTG-style type line: "[Supertypes] [Types] — [Subtypes]".
 *  The em-dash separator is omitted when there are no subtypes. */
export function formatTypeLine(
    types: string[] | undefined,
    subtypes: string[] | undefined,
    supertypes: string[] | undefined
): string {
    const left = [...(supertypes ?? []), ...(types ?? [])].join(" ");
    const right = (subtypes ?? []).join(" ");
    return right ? `${left} — ${right}` : left;
}

const MANA_DISPLAY_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

/** Returns true if `pool` fully covers a numeric `cost` (CR 117.6). Mirrors
 *  the server-side `isManaCostCovered` for UI affordances such as enabling
 *  the "Pay" button on a may-pay prompt only when the player's mana pool
 *  can actually pay the cost. Treats `cost.X` as additional generic mana
 *  payable from any color. Does NOT handle `X: "X"` (variable cost) — by
 *  the time the cost reaches the UI it has been normalized to a number. */
export function isManaCostCovered(pool: ManaPool, cost: ManaCost): boolean {
    let coloredRemaining = 0;
    for (const c of MANA_DISPLAY_COLORS) {
        const need = cost[c] ?? 0;
        if (need > 0 && (pool[c] ?? 0) < need) return false;
        coloredRemaining += (pool[c] ?? 0) - need;
    }
    const generic = typeof cost.X === "number" ? cost.X : 0;
    return coloredRemaining >= generic;
}

/** Serializes a ManaCost into the symbol-token form used by formatOracleText
 *  (e.g. `{ X: 2, R: 1 }` → "{2}{R}"). String X (variable cost) renders as
 *  "{X}". Returns "" when undefined or empty. */
export function manaCostToString(cost?: ManaCost): string {
    if (!cost) return "";
    const parts: string[] = [];
    const x = cost.X;
    if (typeof x === "string") {
        // `{X}{X}` costs (Recall) repeat the variable symbol `xFactor` times.
        const factor =
            typeof cost.xFactor === "number" && cost.xFactor > 0
                ? cost.xFactor
                : 1;
        for (let i = 0; i < factor; i++) parts.push(`{${x}}`);
    }
    // Fixed generic mana renders as ONE numeral symbol, ordered after {X} and
    // before the colored pips (CR 107.4 / 202.1). Two encodings feed it: numeric
    // `X` (the fixed-generic convention when there is no variable X — Grizzly
    // Bears `{ X: 1, G: 1 }`) and the explicit `generic` key (used when a
    // variable {X} coexists with fixed generic — Dominate
    // `{ X: "X", generic: 1, U: 2 }` → {X}{1}{U}{U}). Summing them collapses
    // both — and the rare both-at-once — into a single {N}; the `generic` key
    // was previously dropped entirely, so any card using it lost its generic
    // pip (Dominate showed {X}{U}{U}, Soul Burn `{ generic: 2, ... }` lost {2}).
    const genericFromX = typeof x === "number" && x > 0 ? x : 0;
    const generic = genericFromX + (cost.generic ?? 0);
    if (generic > 0) parts.push(`{${generic}}`);
    for (const c of MANA_DISPLAY_COLORS) {
        const n = cost[c] ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${c}}`);
    }
    // CR 107.4f — Phyrexian pips render as `{<color>/P}` tokens (Dismember
    // `{1}{B/P}{B/P}`), after the colored pips. The oracle-text tokenizer maps
    // `{B/P}` → the `B_P.svg` symbol asset (slash → underscore).
    if (cost.phyrexian) {
        for (const c of MANA_DISPLAY_COLORS) {
            const n = cost.phyrexian[c] ?? 0;
            for (let i = 0; i < n; i++) parts.push(`{${c}/P}`);
        }
    }
    return parts.join("");
}

/** CR 107.4f — one mana-vs-life split option for a Phyrexian cast. `lifePips` is
 *  the number of `{C/P}` pips paid with 2 life each (the rest with the pip's
 *  colour of mana); `label` is the oracle-text-token string the picker renders
 *  (e.g. `"{B} + 2 life"`). */
export type PhyrexianSplitChoice = { lifePips: number; label: string };

/** CR 107.4f — the split options a caster chooses between for a Phyrexian-mana
 *  card in hand, derived from the server-authoritative `phyrexianOptions` the
 *  projection attaches (the affordable `lifePips` values) and the card's printed
 *  `{C/P}` pips. Life is assigned to the FIRST `lifePips` pips in WUBRG order
 *  (matching the engine's `phyrexianManaAdditions`), so each option's mana part
 *  is the remaining pips. Empty (no picker) unless there are ≥ 2 real options —
 *  the projection already gates that, this re-checks for safety. */
export function phyrexianSplitChoices(
    card: CardInstance
): PhyrexianSplitChoice[] {
    const options = card.phyrexianOptions;
    if (!options || options.length < 2) return [];
    const phy = getDefinition(card.card.id).manaCost?.phyrexian;
    if (!phy) return [];
    const pipColors: Color[] = [];
    for (const c of MANA_DISPLAY_COLORS) {
        const n = phy[c] ?? 0;
        for (let i = 0; i < n; i++) pipColors.push(c);
    }
    return options.map((lifePips) => {
        // Life pays the first `lifePips` pips; the rest are paid with mana.
        const manaPips = pipColors.slice(lifePips);
        const manaPart = manaPips.map((c) => `{${c}}`).join("");
        // CR 107.4f — 2 life per pip.
        const lifePart = lifePips > 0 ? `${lifePips * 2} life` : "";
        const label =
            manaPart && lifePart
                ? `${manaPart} + ${lifePart}`
                : manaPart || lifePart;
        return { lifePips, label };
    });
}

/** Normalized `may-pay` cost shape (CR 117.3a / 118.4 / 702.24). Mirrors the
 *  backend `normalizeMayPayCost` so the UI affordability gate and the cost
 *  label read the same shape whether the cost arrived as a bare `ManaCost`
 *  (mana-only) or the `{ mana?, life?, sacrifice? }` union (ADR 0042). */
export interface NormalizedMayPayCost {
    mana?: ManaCost;
    life?: number;
    /** `count` is either a fixed cardinal ("sacrifice N") or a summed-power
     *  threshold `{ minTotalPower }` (CR 118, Phyrexian Dreadnought —
     *  "sacrifice any number of matching permanents with total power ≥ N"). */
    sacrifice?: { count: number | { minTotalPower: number } };
    /** Discard leg (CR 701.9 / 118.3, issue #899). Fixed cardinal only — the
     *  payer picks exactly `count` distinct cards from hand. */
    discard?: { count: number };
    /** Energy leg (CR 122.1, issue #1194). Fixed count only — "pay
     *  {E}{E}{E}" (Guide of Souls). Mirrors the backend `MayPayCost.energy`
     *  leg 1:1. */
    energy?: number;
}

function isMayPayUnion(
    cost: MayPayCost
): cost is Exclude<MayPayCost, ManaCost> {
    return (
        "mana" in cost ||
        "life" in cost ||
        "sacrifice" in cost ||
        "discard" in cost ||
        "energy" in cost
    );
}

/** Widens either `may-pay` cost shape to `{ mana?, life?, sacrifice?,
 *  discard?, energy? }`. */
export function normalizeMayPayCost(cost: MayPayCost): NormalizedMayPayCost {
    if (isMayPayUnion(cost)) {
        return {
            ...(cost.mana ? { mana: cost.mana } : {}),
            ...(cost.life !== undefined ? { life: cost.life } : {}),
            ...(cost.sacrifice
                ? { sacrifice: { count: cost.sacrifice.count } }
                : {}),
            ...(cost.discard ? { discard: { count: cost.discard.count } } : {}),
            ...(cost.energy !== undefined ? { energy: cost.energy } : {}),
        };
    }
    return { mana: cost as ManaCost };
}

/** UI affordability gate for a `may-pay` cost union (CR 117.6). The mana leg
 *  must be coverable by `pool`; `life` must be ≤ the chooser's life; the
 *  sacrifice leg needs at least `count` candidate permanents. Life / sacrifice
 *  candidate counts come from the caller (the UI knows the chooser's life and a
 *  precomputed candidate count). A cost with no constraining leg is affordable. */
export function mayPayCanAfford(
    cost: MayPayCost | undefined,
    pool: ManaPool,
    chooserLife: number,
    sacrificeCandidateCount: number,
    /** Extra mana the mana leg may draw on beyond `pool` (CR 106.6, ADR 0042) —
     *  restricted mana whose restriction the choice permits (e.g.
     *  cumulative-upkeep mana from Adarkar Unicorn / Snowfall). Already filtered
     *  to the eligible restriction by the caller and merged here so the Pay
     *  button enables when restricted + fungible mana together cover the cost. */
    extraMana?: ManaPool,
    /** Summed PRINTED power of the chooser's matching sacrifice candidates
     *  (CR 118). Required only for a threshold-mode sacrifice leg
     *  (`{ minTotalPower }`, Phyrexian Dreadnought); ignored for a fixed-count
     *  leg, which gates on `sacrificeCandidateCount` instead. */
    sacrificeCandidatePower?: number,
    /** The chooser's hand size (CR 701.9 / 118.3, issue #899). Required for a
     *  discard leg — affordable iff the hand holds at least `count` cards.
     *  Ignored for a cost with no discard leg. */
    handCount?: number,
    /** The chooser's current energy counters (CR 122.1, issue #1194). Required
     *  for an energy leg — affordable iff the chooser holds at least `energy`
     *  counters. Ignored for a cost with no energy leg. Survives the wire
     *  projection as `PlayerState.energyCounters`. */
    chooserEnergy?: number
): boolean {
    if (!cost) return true;
    const norm = normalizeMayPayCost(cost);
    const effectivePool: ManaPool = extraMana ? { ...pool } : pool;
    if (extraMana) {
        for (const [c, n] of Object.entries(extraMana)) {
            effectivePool[c] = (effectivePool[c] ?? 0) + (n ?? 0);
        }
    }
    if (norm.mana && !isManaCostCovered(effectivePool, norm.mana)) return false;
    if (norm.life !== undefined && chooserLife < norm.life) return false;
    if (norm.sacrifice) {
        if (typeof norm.sacrifice.count === "object") {
            // CR 118 threshold mode — affordable iff the matching candidates'
            // summed printed power reaches the required total.
            if (
                (sacrificeCandidatePower ?? 0) <
                norm.sacrifice.count.minTotalPower
            ) {
                return false;
            }
        } else if (sacrificeCandidateCount < norm.sacrifice.count) {
            return false;
        }
    }
    if (norm.discard && (handCount ?? 0) < norm.discard.count) {
        return false;
    }
    if (norm.energy !== undefined && (chooserEnergy ?? 0) < norm.energy) {
        return false;
    }
    return true;
}

/** Count of a chooser's battlefield permanents that satisfy a `may-pay` cost's
 *  sacrifice leg (CR 701.16). Returns 0 when the cost has no sacrifice leg.
 *  Used by the UI affordability gate to know whether the Pay button is legal. */
export function mayPaySacrificeCount(
    cost: MayPayCost | undefined,
    battlefield: CardInstance[]
): number {
    if (!cost || !("sacrifice" in cost) || !cost.sacrifice) return 0;
    // The backend `PermanentFilter` is wider than the UI matcher's shape; the
    // matcher reads only the fields it knows (types/subtypes/…), which is all
    // the Ice Age sacrifice legs use ("Sacrifice a land" → { types: "Land" }).
    const filter = cost.sacrifice.filter as Parameters<
        typeof matchesPermanentFilter
    >[1];
    return battlefield.filter((c) => matchesPermanentFilter(c, filter)).length;
}

/** Number of permanents a FIXED-count `may-pay` sacrifice leg makes the payer
 *  sacrifice (CR 701.16b). Returns 0 when the cost has no sacrifice leg OR uses
 *  a summed-power threshold (`{ minTotalPower }`, which has no fixed cardinal —
 *  gate that shape with {@link mayPaySacrificePickSatisfied} instead). */
export function mayPayRequiredSacrifices(cost: MayPayCost | undefined): number {
    if (!cost || !("sacrifice" in cost) || !cost.sacrifice) return 0;
    return typeof cost.sacrifice.count === "number" ? cost.sacrifice.count : 0;
}

/** The summed-power threshold of a `may-pay` sacrifice leg (`{ minTotalPower }`
 *  mode, CR 118, Phyrexian Dreadnought), or `undefined` for a fixed-count leg
 *  or a cost with no sacrifice leg. */
export function mayPaySacrificeThreshold(
    cost: MayPayCost | undefined
): number | undefined {
    if (!cost || !("sacrifice" in cost) || !cost.sacrifice) return undefined;
    const count = cost.sacrifice.count;
    return typeof count === "object" ? count.minTotalPower : undefined;
}

/** Summed PRINTED power (CR 208.2) of a `may-pay` cost's matching sacrifice
 *  candidates on `battlefield`. Feeds the threshold-mode affordability gate
 *  (CR 118). Returns 0 when the cost has no sacrifice leg. */
export function mayPaySacrificePower(
    cost: MayPayCost | undefined,
    battlefield: CardInstance[]
): number {
    if (!cost || !("sacrifice" in cost) || !cost.sacrifice) return 0;
    const filter = cost.sacrifice.filter as Parameters<
        typeof matchesPermanentFilter
    >[1];
    return battlefield
        .filter((c) => matchesPermanentFilter(c, filter))
        .reduce((sum, c) => sum + (tryGetDefinition(c.card.id)?.power ?? 0), 0);
}

/** Summed PRINTED power (CR 208.2) of the chooser's currently-selected
 *  sacrifice victims. Drives the threshold-mode pick-progress display
 *  ("N / minTotalPower power selected"). */
export function mayPaySacrificeSelectionPower(
    selectedIds: string[],
    battlefield: CardInstance[]
): number {
    const selected = new Set(selectedIds);
    return battlefield
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => sum + (tryGetDefinition(c.card.id)?.power ?? 0), 0);
}

/** Whether the chooser's current sacrifice pick satisfies a battlefield
 *  `may-pay` sacrifice leg (CR 701.16b / 118). Fixed-count legs require exactly
 *  `count` picks; threshold legs (`{ minTotalPower }`, Phyrexian Dreadnought)
 *  require the selected permanents' summed PRINTED power to reach the threshold
 *  (over-payment allowed). A cost with no sacrifice leg is trivially satisfied. */
export function mayPaySacrificePickSatisfied(
    cost: MayPayCost | undefined,
    selectedIds: string[],
    battlefield: CardInstance[]
): boolean {
    const threshold = mayPaySacrificeThreshold(cost);
    if (threshold !== undefined) {
        const selected = new Set(selectedIds);
        const power = battlefield
            .filter((c) => selected.has(c.id))
            .reduce(
                (sum, c) => sum + (tryGetDefinition(c.card.id)?.power ?? 0),
                0
            );
        return selectedIds.length > 0 && power >= threshold;
    }
    return selectedIds.length === mayPayRequiredSacrifices(cost);
}

/** Number of hand cards a `may-pay` discard leg makes the payer discard (CR
 *  701.9 / 118.3, issue #899). Returns 0 when the cost has no discard leg.
 *  Mirrors {@link mayPayRequiredSacrifices} — the discard leg has no
 *  summed-power threshold shape. */
export function mayPayRequiredDiscards(cost: MayPayCost | undefined): number {
    if (!cost || !("discard" in cost) || !cost.discard) return 0;
    return cost.discard.count;
}

/** Whether the chooser's current discard pick satisfies a hand `may-pay`
 *  discard leg (CR 701.9 / 118.3, issue #899): the selection must name exactly
 *  `count` distinct hand cards. A cost with no discard leg is trivially
 *  satisfied. Mirrors {@link mayPaySacrificePickSatisfied}'s fixed-count
 *  branch. */
export function mayPayDiscardPickSatisfied(
    cost: MayPayCost | undefined,
    selectedIds: string[]
): boolean {
    return selectedIds.length === mayPayRequiredDiscards(cost);
}

/** Human-readable label for a `may-pay` cost union, rendered after "Pay" on the
 *  prompt button. Mana renders as symbol tokens (formatOracleText-ready); life
 *  and sacrifice render as words, joined with " and " (Infernal Darkness:
 *  "{B} and 1 life"). Returns "" for a cost-less choice. */
export function mayPayCostLabel(cost?: MayPayCost): string {
    if (!cost) return "";
    const norm = normalizeMayPayCost(cost);
    const parts: string[] = [];
    if (norm.mana) {
        const s = manaCostToString(norm.mana);
        if (s) parts.push(s);
    }
    if (norm.life !== undefined && norm.life > 0) {
        parts.push(`${norm.life} life`);
    }
    if (norm.sacrifice) {
        const n = norm.sacrifice.count;
        if (typeof n === "object") {
            // CR 118 threshold mode (Phyrexian Dreadnought).
            parts.push(
                `sacrifice creatures with total power ${n.minTotalPower}`
            );
        } else {
            parts.push(n === 1 ? "sacrifice" : `sacrifice ${n}`);
        }
    }
    if (norm.discard) {
        const n = norm.discard.count;
        parts.push(n === 1 ? "discard a card" : `discard ${n} cards`);
    }
    if (norm.energy !== undefined && norm.energy > 0) {
        // CR 122.1 / issue #1194 — energy costs print as repeated {E} symbol
        // tokens ("{E}{E}{E}"), the same convention `manaCostToString` uses
        // for mana above; `formatOracleText` (the label's only consumer)
        // already renders any `{X}` token generically, so no new glyph
        // plumbing is needed here.
        parts.push("{E}".repeat(norm.energy));
    }
    return parts.join(" and ");
}

export function groupByName(cards: CardInstance[]): CardInstance[][] {
    const groups: Map<string, CardInstance[]> = new Map();
    for (const card of cards) {
        const name = getDefinition(card.card.id).name;
        const group = groups.get(name);
        if (group) {
            group.push(card);
        } else {
            groups.set(name, [card]);
        }
    }
    return [...groups.values()];
}
