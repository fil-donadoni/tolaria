import type { Color, TargetRequirement, TargetSelection } from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import type { CardAction } from "./types";
import { isSorceryTiming } from "./phases";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_DROPS_PER_TURN,
    LAND_SUBTYPE_MANA,
    MANA_COLORS,
    isTapLockedBySummoningSickness,
    manaValue,
} from "./constants";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";
import { isProtectedFromColors } from "./protection";
import { getInstanceManaCost, tryGetCardById } from "../cards";
import { normalizeManaCost } from "./state";

export {
    getProtectedColors,
    isProtectedFromColors,
    isProtectedFromSource,
    parseProtectionFromColor,
} from "./protection";

/** Reads extra land drops granted by permanents on the player's battlefield
 *  (CR 305.2 — Fastbond). Scans card definitions for `extraLandDrops`. */
function getExtraLandDrops(player: PlayerState): number {
    let extra = 0;
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetCardById(cardId);
        if (def?.extraLandDrops) extra += def.extraLandDrops;
    }
    return extra;
}

const ALL_HAND_ACTIONS: CardAction[] = [
    "play",
    "cast",
    "discard",
    "putToGraveyard",
    "putToExile",
    "putToLibrary",
];

function hasInstantTiming(card: CardInstanceState): boolean {
    const types = card.types;
    if (types.includes("Instant")) return true;
    // TODO: check for Flash keyword
    return false;
}

/** Returns the list of legal actions for a card in a player's hand. */
export function getLegalActions(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    debugAllActions = false
): CardAction[] {
    if (debugAllActions) {
        return [...ALL_HAND_ACTIONS];
    }

    const actions: CardAction[] = [];

    // CR 103.5 — no actions on hand cards during the pre-game mulligan phase.
    if (state.phase === "MULLIGAN") {
        return actions;
    }

    // CR 117.1: a player can only take actions while they have priority.
    if (state.priorityPlayerId !== player.id) {
        return actions;
    }

    const types = card.types;

    // "Play" is for lands only — requires sorcery timing (main phase, empty stack, active player)
    // and the player must not have already used their per-turn land drops (CR 305.2).
    if (types.includes("Land")) {
        const landsPlayed = player.landsPlayedThisTurn ?? 0;
        const extraDrops = getExtraLandDrops(player);
        const maxDrops = LAND_DROPS_PER_TURN + extraDrops;
        if (isSorceryTiming(state) && landsPlayed < maxDrops) {
            actions.push("play");
        }
    }

    // "Cast" is for all non-land cards
    if (!types.includes("Land")) {
        const baseLegal = hasInstantTiming(card)
            ? // Instants can be cast anytime a player has priority
              true
            : // Sorcery-speed: main phase, empty stack, active player has priority
              isSorceryTiming(state);
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            canPotentiallyPayCost(player, card) &&
            hasEnoughLegalTargets(state, player, card)
        ) {
            actions.push("cast");
        }
    }

    return actions;
}

/** CR 601.2c: a spell with required targets can only be cast if enough legal
 *  targets exist. Used by getLegalActions to suppress the Cast UI for spells
 *  that would fail target selection (e.g. Lightning Bolt with no creatures or
 *  players to target — only relevant if all candidates are protected, since
 *  players are normally targetable). For "X" target counts the player can
 *  still pick X = 0 and skip target selection (CR 107.3), so cast stays
 *  legal regardless of board state. */
function hasEnoughLegalTargets(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return true;
    const def = tryGetCardById(cardId);
    const requirement = def?.targetRequirement;
    if (!requirement) return true;
    // X = 0 path is always available; cast remains legal even with no targets.
    if (requirement.count === "X") return true;
    const required =
        typeof requirement.count === "number"
            ? requirement.count
            : requirement.count.min;
    if (required <= 0) return true;
    const sourceColors = STATIC_EFFECT_CTX.getColors(card);
    const legalTargets = getLegalTargets(
        state,
        requirement,
        sourceColors,
        player.id
    );
    return legalTargets.length >= required;
}

/** Returns the colors a permanent could potentially produce when tapped for
 *  mana. Considers basic land subtypes (CR 305.6), fixed mana abilities, and
 *  mana-choice abilities (e.g. dual lands, Talisman). Empty set means the
 *  card has no mana ability the engine knows about. */
function getProducibleColors(card: CardInstanceState): Set<Color> {
    const colors = new Set<Color>();

    // CR 305.6: basic land subtypes grant intrinsic mana abilities.
    for (const subtype of card.subtypes) {
        const c = LAND_SUBTYPE_MANA[subtype];
        if (c) colors.add(c);
    }

    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return colors;
    const def = tryGetCardById(cardId);
    if (!def?.activatedAbilities) return colors;

    for (const ability of def.activatedAbilities) {
        if (ability.useStack) continue;
        if (!ability.cost.tap) continue;
        if (ability.manaProduced) {
            for (const c of MANA_COLORS) {
                if ((ability.manaProduced[c] ?? 0) > 0) colors.add(c);
            }
        }
        if (ability.manaChoices) {
            for (const choice of ability.manaChoices) {
                for (const c of MANA_COLORS) {
                    if ((choice[c] ?? 0) > 0) colors.add(c);
                }
            }
        }
    }
    return colors;
}

/** True if the player has enough mana — already in the pool plus what could
 *  be produced by tapping untapped permanents — to cover the spell's mana
 *  cost. Excludes creatures with summoning sickness (CR 302.1). Treats every
 *  mana choice as freely available, so it errs toward showing the Cast
 *  button when payment is theoretically possible.
 *
 *  Used by getLegalActions to suppress the Cast UI for spells the player
 *  cannot pay for (CR 601.2f — failure to pay aborts the cast, but we hide
 *  the action upstream so the user isn't trapped in pendingCast). */
function canPotentiallyPayCost(
    player: PlayerState,
    card: CardInstanceState
): boolean {
    const rawCost = getInstanceManaCost(card);
    if (!rawCost) return true;
    // Cost normalized without chosenX: string-X spells pay only their fixed
    // portion at the minimum (X = 0). User picks X at announcement.
    const cost = normalizeManaCost(rawCost);
    const totalRequired =
        (cost.X ?? 0) + MANA_COLORS.reduce((sum, c) => sum + (cost[c] ?? 0), 0);
    if (totalRequired === 0) return true;

    // Each source is the set of colors it can supply for this cost slot.
    const sources: Set<Color>[] = [];
    for (const c of MANA_COLORS) {
        const n = player.manaPool[c] ?? 0;
        for (let i = 0; i < n; i++) sources.push(new Set<Color>([c]));
    }
    for (const perm of player.battlefield) {
        if (perm.isTapped) continue;
        // CR 302.1 — creature with summoning sickness can't pay {T}.
        if (isTapLockedBySummoningSickness(perm)) continue;
        const colors = getProducibleColors(perm);
        if (colors.size === 0) continue;
        sources.push(colors);
    }

    if (sources.length < totalRequired) return false;

    // Greedy: assign colored requirements first, picking the
    // least-flexible source able to produce that color. Then count remaining
    // sources for the generic portion. Optimal for the common case where each
    // source produces a small color set (basic lands, duals, Mox).
    const remaining = sources.map((s) => new Set(s));
    for (const c of MANA_COLORS) {
        let need = cost[c] ?? 0;
        while (need > 0) {
            let bestIdx = -1;
            let bestSize = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const s = remaining[i];
                if (s.has(c) && s.size < bestSize) {
                    bestIdx = i;
                    bestSize = s.size;
                }
            }
            if (bestIdx === -1) return false;
            remaining.splice(bestIdx, 1);
            need--;
        }
    }
    return remaining.length >= (cost.X ?? 0);
}

/** CR 117.1b: some spells have phase-limited casting windows (e.g. Berserk
 *  "cast only before the combat damage step"). Returns true when the card
 *  either has no restriction or the current phase is in its allow-list. */
function passesCastPhaseRestriction(
    state: GameState,
    card: CardInstanceState
): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return true;
    const def = tryGetCardById(cardId);
    const restriction = def?.castPhaseRestriction;
    if (
        restriction &&
        restriction.length > 0 &&
        !restriction.includes(state.phase)
    ) {
        return false;
    }
    if (
        def?.castTurnRestriction === "opponent" &&
        state.activePlayerId === card.controllerId
    ) {
        return false;
    }
    return true;
}

/** True if the permanent/stack item has at least one of the given color in
 *  its mana cost (CR 202.2). Used by TargetRequirement.colorFilter. */
export function hasColor(card: CardInstanceState, color: Color): boolean {
    return STATIC_EFFECT_CTX.getColors(card).includes(color);
}

/** Resolves a TargetRequirement.mvFilter's `"X"` placeholders against the
 *  announced chosenX so downstream code only sees numeric bounds.
 *  Used by getLegalTargets and selectTarget validation. */
export function resolveMvFilter(
    filter: TargetRequirement["mvFilter"] | undefined,
    chosenX: number | undefined
): { min?: number; max?: number; equals?: number } | undefined {
    if (!filter) return undefined;
    const resolveOne = (v: number | "X" | undefined): number | undefined => {
        if (v === undefined) return undefined;
        if (v === "X") return chosenX ?? 0;
        return v;
    };
    return {
        ...(filter.min !== undefined ? { min: resolveOne(filter.min)! } : {}),
        ...(filter.max !== undefined ? { max: resolveOne(filter.max)! } : {}),
        ...(filter.equals !== undefined
            ? { equals: resolveOne(filter.equals)! }
            : {}),
    };
}

/** Computes mana value for a target lookup. For permanents on the
 *  battlefield, X-cost permanents currently report 0 for X (the chosen X
 *  is not persisted on the resulting permanent). For stack spells, X folds
 *  in the chosen value carried by the stack item. */
function mvOfPermanent(card: CardInstanceState): number {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : undefined;
    return manaValue(def?.manaCost);
}

function mvOfStackItem(item: { card: unknown; chosenX?: number }): number {
    const cardId = (item.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : undefined;
    return manaValue(def?.manaCost) + (item.chosenX ?? 0);
}

/** Tests a resolved mvFilter against a target's mana value. Empty filter
 *  always matches; otherwise all declared bounds (min/max/equals) must hold. */
export function matchesMvFilter(
    filter: { min?: number; max?: number; equals?: number } | undefined,
    mv: number
): boolean {
    if (!filter) return true;
    if (filter.equals !== undefined && mv !== filter.equals) return false;
    if (filter.min !== undefined && mv < filter.min) return false;
    if (filter.max !== undefined && mv > filter.max) return false;
    return true;
}

/** Returns all legal targets for a spell/ability with the given target
 *  requirement. `sourceColors` are the colors of the casting spell or the
 *  activating permanent (CR 202.2); when provided, protected permanents
 *  (CR 702.16b) are excluded. `casterId` is required when
 *  `requirement.controller` is "you" / "opponent" — the relationship is
 *  resolved relative to the chooser. `chosenX` is required when the
 *  requirement carries a `mvFilter` whose bounds use the `"X"` placeholder
 *  (CR 107.3 / 202.3, e.g. Spell Blast). */
export function getLegalTargets(
    state: GameState,
    requirement: TargetRequirement,
    sourceColors: readonly Color[] = [],
    casterId?: string,
    chosenX?: number
): TargetSelection[] {
    const targets: TargetSelection[] = [];

    const reqTypes = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];

    // CR 400.7 / 109.2: graveyard-zone target (Regrowth, etc.). Handled in a
    // dedicated branch — graveyard cards aren't permanents, so battlefield
    // filters (color/protection/tap-state) don't apply.
    if (requirement.zone === "graveyard") {
        const controllerFilter = requirement.controller ?? "any";
        const wantsAnyCard = reqTypes.includes("card");
        const cardTypes = reqTypes.filter(
            (t) =>
                t !== "player" && t !== "any" && t !== "spell" && t !== "card"
        );
        for (const player of state.players) {
            if (controllerFilter === "you" && player.id !== casterId) continue;
            if (
                controllerFilter === "opponent" &&
                (casterId === undefined || player.id === casterId)
            ) {
                continue;
            }
            for (const card of player.graveyard) {
                if (
                    !wantsAnyCard &&
                    !cardTypes.some((t) => card.types.includes(t as never))
                ) {
                    continue;
                }
                targets.push({
                    type: "graveyard-card",
                    id: card.id,
                    playerId: player.id,
                });
            }
        }
        return targets;
    }

    // CR 114: "spell-or-permanent" targets any permanent (not just
    // damageable) + any spell on the stack.
    const wantsSpellOrPermanent = reqTypes.includes("spell-or-permanent");
    // Check for permanent-targeting types (CardType values)
    const wantsAny = reqTypes.includes("any");
    const wantsSpell = reqTypes.includes("spell") || wantsSpellOrPermanent;
    const permanentTypes = reqTypes.filter(
        (t) =>
            t !== "player" &&
            t !== "any" &&
            t !== "spell" &&
            t !== "spell-or-permanent" &&
            t !== "card"
    );
    const colorFilter = requirement.colorFilter;
    const tappedFilter = requirement.tappedFilter;
    const combatRoleFilter = requirement.combatRoleFilter;
    const powerFilter = requirement.powerFilter;
    const mvFilter = resolveMvFilter(requirement.mvFilter, chosenX);
    const subtypeFilter = requirement.subtypeFilter
        ? Array.isArray(requirement.subtypeFilter)
            ? requirement.subtypeFilter
            : [requirement.subtypeFilter]
        : undefined;
    const excludeTypes = requirement.excludeTypes
        ? Array.isArray(requirement.excludeTypes)
            ? requirement.excludeTypes
            : [requirement.excludeTypes]
        : undefined;
    const excludeColors = requirement.excludeColors
        ? Array.isArray(requirement.excludeColors)
            ? requirement.excludeColors
            : [requirement.excludeColors]
        : undefined;
    const excludeSubtypes = requirement.excludeSubtypes
        ? Array.isArray(requirement.excludeSubtypes)
            ? requirement.excludeSubtypes
            : [requirement.excludeSubtypes]
        : undefined;
    const toughnessFilter = requirement.toughnessFilter;

    // CR 115.4: "any target" means any creature, planeswalker, player, or
    // battle — the four object types that can be damaged (CR 120.3).
    const battlefieldControllerFilter = requirement.controller ?? "any";
    if (wantsAny || wantsSpellOrPermanent || permanentTypes.length > 0) {
        for (const player of state.players) {
            // CR 109.3 — `controller: "you" | "opponent"` filter restricts
            // legal battlefield targets to (the caster's) or (an opponent's)
            // permanents. Used by Simulacrum's "target creature you control".
            if (
                battlefieldControllerFilter === "you" &&
                player.id !== casterId
            ) {
                continue;
            }
            if (
                battlefieldControllerFilter === "opponent" &&
                (casterId === undefined || player.id === casterId)
            ) {
                continue;
            }
            for (const card of player.battlefield) {
                const matchesAny =
                    wantsAny &&
                    DAMAGEABLE_PERMANENT_TYPES.some((t) =>
                        card.types.includes(t)
                    );
                const matchesExplicit = permanentTypes.some((t) =>
                    card.types.includes(t as never)
                );
                if (!matchesAny && !wantsSpellOrPermanent && !matchesExplicit)
                    continue;
                // CR 205.3: subtype filter for "target Mountains"-style
                // spells. At least one declared subtype must be present on
                // the permanent (basic Mountain, dual lands like Plateau, ...).
                if (
                    subtypeFilter &&
                    !subtypeFilter.some((s) => card.subtypes.includes(s))
                ) {
                    continue;
                }
                // CR 205 / 202.2: exclude types and colors (Terror's
                // "nonartifact, nonblack" filter).
                if (
                    excludeTypes &&
                    excludeTypes.some((t) => card.types.includes(t as never))
                ) {
                    continue;
                }
                if (
                    excludeColors &&
                    excludeColors.some((c) => hasColor(card, c))
                ) {
                    continue;
                }
                // CR 205.3: exclude subtypes (Nettling Imp's "non-Wall").
                if (
                    excludeSubtypes &&
                    excludeSubtypes.some((s) => card.subtypes.includes(s))
                ) {
                    continue;
                }
                // CR 202.2: filter by color for "source of color X" choices.
                if (colorFilter && !hasColor(card, colorFilter)) continue;
                // CR 701.20: tap-state filter for "target tapped/untapped ~".
                if (tappedFilter === "tapped" && !card.isTapped) continue;
                if (tappedFilter === "untapped" && card.isTapped) continue;
                // CR 508.1 / 509.1: combat-role filter for "target attacking
                // creature" or "target blocking creature".
                if (combatRoleFilter === "attacking" && !card.isAttacking)
                    continue;
                if (combatRoleFilter === "blocking" && !card.isBlocking)
                    continue;
                // CR 613 layer 7c: power filter reads effective power so
                // current buffs/debuffs are honored at target selection.
                if (powerFilter) {
                    const power = getEffectivePower(state, card);
                    if (
                        powerFilter.min !== undefined &&
                        power < powerFilter.min
                    )
                        continue;
                    if (
                        powerFilter.max !== undefined &&
                        power > powerFilter.max
                    )
                        continue;
                }
                // CR 613 layer 7c: toughness filter reads effective toughness.
                if (toughnessFilter) {
                    const toughness = getEffectiveToughness(state, card);
                    if (
                        toughnessFilter.min !== undefined &&
                        toughness < toughnessFilter.min
                    )
                        continue;
                    if (
                        toughnessFilter.max !== undefined &&
                        toughness > toughnessFilter.max
                    )
                        continue;
                }
                // CR 202.3: mvFilter narrows by printed mana value (X = 0
                // for permanents — see resolveMvFilter / mvOfPermanent).
                if (
                    mvFilter &&
                    !matchesMvFilter(mvFilter, mvOfPermanent(card))
                ) {
                    continue;
                }
                // CR 702.16b: protected permanents can't be targeted by
                // spells/abilities of the stated quality.
                if (isProtectedFromColors(card, sourceColors)) continue;
                targets.push({ type: "permanent", id: card.id });
            }
        }
    }

    // Players have no color, so colorFilter excludes them.
    if ((wantsAny || reqTypes.includes("player")) && !colorFilter) {
        for (const player of state.players) {
            targets.push({ type: "player", id: player.id });
        }
    }

    // CR 114.1: any spell or ability currently on the stack is a legal target.
    // (The casting spell itself isn't on the stack yet during target selection.)
    if (wantsSpell) {
        const spellTypes = requirement.spellTypeFilter
            ? Array.isArray(requirement.spellTypeFilter)
                ? requirement.spellTypeFilter
                : [requirement.spellTypeFilter]
            : undefined;
        for (const item of state.stack) {
            if (colorFilter && !hasColor(item, colorFilter)) continue;
            if (mvFilter && !matchesMvFilter(mvFilter, mvOfStackItem(item))) {
                continue;
            }
            // CR 114.1 + spellTypeFilter (Fork: "instant or sorcery spell"):
            // an ability on the stack isn't a spell, and a spell must match
            // the requested card type(s).
            if (spellTypes) {
                const isAbility =
                    !!item.abilityId ||
                    !!item.triggeredAbilityId ||
                    !!item.delayedTriggerId;
                if (isAbility) continue;
                if (!spellTypes.some((t) => item.types.includes(t))) continue;
            }
            targets.push({ type: "spell", id: item.id });
        }
    }

    return targets;
}

/** Colors of the source whose target-selection is in progress (CR 202.2).
 *  Used to enforce CR 702.16b at cast-time target validation. For spells the
 *  source is the hand card; for activated abilities it's the battlefield
 *  permanent; for a "copy-retarget" the source is the spell COPY on the stack
 *  (CR 707.10 — its colorOverride, e.g. Fork's red, governs protection).
 *  Returns an empty array if the source card can't be located. */
export function getPendingTargetSourceColors(
    state: GameState,
    cardInstanceId: string,
    kind: "cast" | "ability" | "copy-retarget"
): Color[] {
    if (kind === "copy-retarget") {
        const si = state.stack.find((x) => x.id === cardInstanceId);
        if (si) return STATIC_EFFECT_CTX.getColors(si);
        return [];
    }
    if (kind === "ability") {
        for (const p of state.players) {
            const c = p.battlefield.find((x) => x.id === cardInstanceId);
            if (c) return STATIC_EFFECT_CTX.getColors(c);
        }
    } else {
        for (const p of state.players) {
            const c = p.hand.find((x) => x.id === cardInstanceId);
            if (c) return STATIC_EFFECT_CTX.getColors(c);
        }
    }
    return [];
}

/** Validates that a specific action is legal for a card. Throws if not. */
export function assertLegalAction(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    action: CardAction
): void {
    const legal = getLegalActions(state, player, card);
    if (!legal.includes(action)) {
        const cardId = (card.card as { id?: string }).id;
        const cardName =
            (card.card as { name?: string }).name ??
            (cardId ? (tryGetCardById(cardId)?.name ?? card.id) : card.id);
        throw new Error(
            `Illegal action "${action}" on "${cardName}". Legal actions: ${legal.join(", ") || "none"}`
        );
    }
}
