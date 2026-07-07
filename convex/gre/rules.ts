import type {
    CardType,
    Color,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import type { CardAction } from "./types";
import { isSorceryTiming } from "./phases";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_DROPS_PER_TURN,
    LAND_SUBTYPE_MANA,
    MANA_COLORS,
    PLACEHOLDER_CARD_ID,
    abilitiesSuppressed,
    getManaTapOptionsDetailed,
    isLand,
    isTapLockedBySummoningSickness,
    manaValue,
} from "./constants";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";
import { isProtectedFromColors } from "./protection";
import { hasSupertypeLive } from "./snow";
import { isGuardedAgainst } from "./permanentGuard";
import { castProhibitionReason } from "../cards/castRestrictions";
import { getInstanceManaCost, tryGetDefinition } from "../cards";
import {
    landPlayLockActive,
    normalizeManaCost,
    restrictedUnitAllowsSpell,
} from "./state";

export {
    getProtectedColors,
    isProtectedFromColors,
    isProtectedFromSource,
    parseProtectionFromColor,
} from "./protection";

/** Reads extra land drops granted by permanents on the player's battlefield
 *  (CR 305.2 — Fastbond). Scans card definitions for `extraLandDrops`. */
export function getExtraLandDrops(player: PlayerState): number {
    let extra = 0;
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
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

    // Opaque placeholders (hidden-library cards rehydrated for the vs-AI search,
    // issue #136) can never be played or cast — surfacing one as a legal move
    // would let ISMCTS act on a card it has no knowledge of. The sentinel id is
    // checked explicitly (not "unregistered id") so legacy test fixtures that
    // inline card metadata under an unregistered id keep their actions.
    if ((card.card as { id?: string }).id === PLACEHOLDER_CARD_ID) {
        return actions;
    }

    const types = card.types;

    // "Play" is for lands only — requires sorcery timing (main phase, empty stack, active player)
    // and the player must not have already used their per-turn land drops (CR 305.2).
    if (types.includes("Land")) {
        // Worms of the Earth (CR 614) — "Players can't play lands." While the
        // land-play lock is active, playing a land is illegal regardless of
        // timing or remaining land drops. Suppressing the "play" action here
        // also blocks the server path: `assertLegalAction` rejects the
        // `playCard` mutation when "play" is absent.
        const landsPlayed = player.landsPlayedThisTurn ?? 0;
        const extraDrops = getExtraLandDrops(player);
        const maxDrops = LAND_DROPS_PER_TURN + extraDrops;
        if (
            !landPlayLockActive(state) &&
            isSorceryTiming(state) &&
            landsPlayed < maxDrops
        ) {
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
            // CR 601.3a — a player-scoped cast-type restriction (Brand of Ill
            // Omen: "Enchanted creature's controller can't cast creature
            // spells") forbids the cast outright. Scanned across both
            // battlefields; suppressing "cast" here also blocks the server
            // path, since `assertLegalAction` rejects the cast mutation when
            // "cast" is absent.
            castProhibitionReason(player.id, card, state) === undefined &&
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
    const def = tryGetDefinition(cardId);
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
        player.id,
        undefined,
        card.types,
        card.subtypes,
        // hasEnoughLegalTargets gates the Cast UI — the source is a spell.
        true
    );
    return legalTargets.length >= required;
}

/** Maps each color a permanent can produce when tapped to the
 *  `manaChoiceIndex` the payment mutations expect, or `undefined` when the
 *  source produces that color with no choice (single-option source). Reads the
 *  unified `getManaTapOptionsDetailed` list (CR 605.1a / 305.6 — activated
 *  abilities + one intrinsic option per basic land subtype) so the index this
 *  planner emits references the exact list the tap mutations resolve against —
 *  a land under Urborg advertises BOTH its own colour and {B}, each with the
 *  index that produces it. Empty map means no mana ability the engine knows
 *  about (dynamic board choosers like Fellwar Stone resolve at tap time, not
 *  in the one-source planner). */
export function getProducibleManaOptions(
    card: CardInstanceState
): Map<Color, number | undefined> {
    const options = new Map<Color, number | undefined>();
    const detailed = getManaTapOptionsDetailed(card);
    if (detailed.length === 0) return options;

    // Mirror `manaTapNeedsChoice`: the tap mutations require a `manaChoiceIndex`
    // whenever 2+ options exist, or the source carries a choice-based ability
    // (Talisman / Fellwar Stone). A single fixed/basic option taps index-free.
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    const hasChoiceAbility =
        !abilitiesSuppressed(card) &&
        !!def?.activatedAbilities?.some(
            (a) => !a.useStack && (a.manaChoices || a.getManaChoices)
        );
    const needIndex = detailed.length >= 2 || hasChoiceAbility;

    detailed.forEach((opt, index) => {
        for (const c of MANA_COLORS) {
            if ((opt.mana[c] ?? 0) > 0 && !options.has(c)) {
                options.set(c, needIndex ? index : undefined);
            }
        }
    });

    return options;
}

/** Returns one entry per INDIVIDUAL mana a permanent could produce from a
 *  single tap, each entry being the set of colors that mana could be. A source
 *  that taps for multiple mana (Sol Ring → {C}{C}) yields multiple entries, so
 *  affordability counts the real quantity, not one-per-source.
 *
 *  A tap is a single shared cost, so only ONE mana ability can be used per
 *  activation — we take the ability producing the most mana (ties: first) and
 *  never sum across competing abilities. The intrinsic basic-land subtypes
 *  (CR 305.6) are additional single-mana ALTERNATIVES to that ability (a land
 *  under Urborg can tap for {B} instead of its own output), so their colours
 *  are folded in as extra options on each unit — this errs toward affordable,
 *  the documented bias of this planner. A choice ability (dual land / Talisman)
 *  is one mana whose color set is the union of its options. */
function getProducibleManaUnits(card: CardInstanceState): Set<Color>[] {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;

    // CR 613.1f — suppress PRINTED activated mana abilities while the source
    // has lost all abilities (Blood Moon / Titania's Song); fall through to the
    // intrinsic basic-land subtype path below.
    let best: Set<Color>[] = [];
    for (const ability of abilitiesSuppressed(card)
        ? []
        : (def?.activatedAbilities ?? [])) {
        if (ability.useStack) continue;
        if (!ability.cost.tap) continue;

        const units: Set<Color>[] = [];
        if (ability.manaProduced) {
            for (const c of MANA_COLORS) {
                const amount = ability.manaProduced[c] ?? 0;
                for (let i = 0; i < amount; i++)
                    units.push(new Set<Color>([c]));
            }
        }
        if (ability.manaChoices) {
            const colors = new Set<Color>();
            for (const choice of ability.manaChoices) {
                for (const c of MANA_COLORS) {
                    if ((choice[c] ?? 0) > 0) colors.add(c);
                }
            }
            if (colors.size > 0) units.push(colors);
        }
        if (units.length > best.length) best = units;
    }

    // CR 305.6: basic land subtypes grant an intrinsic one-mana ability, a tap
    // ALTERNATIVE to the source's own ability. Fold their colours into each
    // unit (or seed the units when the source has no activated ability).
    const subtypeColors = new Set<Color>();
    for (const subtype of card.subtypes) {
        const c = LAND_SUBTYPE_MANA[subtype];
        if (c) subtypeColors.add(c);
    }
    if (subtypeColors.size > 0) {
        if (best.length === 0) return [subtypeColors];
        return best.map((u) => new Set<Color>([...u, ...subtypeColors]));
    }
    return best;
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
    // CR 106.6 — restricted mana whose restriction permits THIS spell (Ice
    // Cauldron's instance-keyed noted mana, Metamorphosis' creature-only mana)
    // is spendable on the cast and must count toward affordability. Without it
    // a card castable only from its banked mana — e.g. Ice Cauldron's exiled
    // card paid by the noted mana — is judged unpayable here, so "cast" is
    // dropped from getLegalActions and `assertLegalAction` rejects the cast
    // before payment. Mirrors `spendablePoolForSpell` at the payment site;
    // `card.id` is the instance id that instance-keyed mana is gated on.
    for (const r of player.restrictedMana ?? []) {
        if (restrictedUnitAllowsSpell(r, card.types, card.id)) {
            for (let i = 0; i < r.amount; i++) {
                sources.push(new Set<Color>([r.color as Color]));
            }
        }
    }
    for (const perm of player.battlefield) {
        if (perm.isTapped) continue;
        // CR 302.1 — creature with summoning sickness can't pay {T}.
        if (isTapLockedBySummoningSickness(perm)) continue;
        // One entry per mana the source taps for: a {C}{C} source (Sol Ring)
        // contributes two, not one (issue #132).
        for (const unit of getProducibleManaUnits(perm)) sources.push(unit);
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
    const def = tryGetDefinition(cardId);
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
    // CR 117.1b — "during your turn" only (Camouflage). The controller must be
    // the active player.
    if (
        def?.castTurnRestriction === "self" &&
        state.activePlayerId !== card.controllerId
    ) {
        return false;
    }
    // CR 601.3e — "Cast this spell only if no permanent[s] named <this name>
    // are on the battlefield" (FEM Tidal Influence). The match uses the printed
    // card name (CR 201.2); any permanent on either battlefield sharing the
    // spell's name blocks the cast.
    if (def?.castUniqueByName && def.name) {
        const nameClash = state.players.some((p) =>
            p.battlefield.some(
                (perm) =>
                    tryGetDefinition((perm.card as { id?: string }).id ?? "")
                        ?.name === def.name
            )
        );
        if (nameClash) return false;
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
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return manaValue(def?.manaCost);
}

function mvOfStackItem(item: { card: unknown; chosenX?: number }): number {
    const cardId = (item.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
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

/** CR 109.3 / 102.1 — the single authority on a battlefield/permanent target's
 *  controller-relationship filter (`TargetRequirement.controller`). Both
 *  `getLegalTargets` (which permanents may be offered) and the `selectTarget`
 *  mutation's permanent branch (which permanents the server will accept —
 *  anti-spoof) route through this predicate so the two can never disagree.
 *
 *  - `"you"`      — the permanent's controller is the chooser (Simulacrum).
 *  - `"opponent"` — the controller is NOT the chooser (Nettling Imp). A missing
 *                   `chooserId` can never satisfy this.
 *  - `"active"`   — the controller is the active player regardless of who is
 *                   choosing (Arcum's Whistle).
 *  - `"any"` / undefined — no controller restriction. */
export function matchesBattlefieldController(
    controllerId: string,
    chooserId: string | undefined,
    activePlayerId: string,
    filter: TargetRequirement["controller"]
): boolean {
    switch (filter ?? "any") {
        case "you":
            return chooserId !== undefined && controllerId === chooserId;
        case "opponent":
            return chooserId !== undefined && controllerId !== chooserId;
        case "active":
            return controllerId === activePlayerId;
        case "any":
            return true;
    }
}

/** Returns all legal targets for a spell/ability with the given target
 *  requirement. `sourceColors` are the colors of the casting spell or the
 *  activating permanent (CR 202.2); when provided, protected permanents
 *  (CR 702.16b) are excluded. `casterId` is required when
 *  `requirement.controller` is "you" / "opponent" — the relationship is
 *  resolved relative to the chooser. `chosenX` is required when the
 *  requirement carries a `mvFilter` whose bounds use the `"X"` placeholder
 *  (CR 107.3 / 202.3, e.g. Spell Blast). */
/** CR 114.1 — Spell Pierce's "target noncreature spell": true when `item` is
 *  a legal spell target under `excludeTypes` (an ability never qualifies; an
 *  actual spell must match NONE of the given card types). An
 *  undefined/empty filter always passes. Shared by `getLegalTargets`'s spell
 *  loop and `selectTarget`'s server-side validation (game.ts) — one
 *  predicate, two call sites (issue #683). */
export function spellMatchesExcludeTypeFilter(
    item: GameState["stack"][number],
    excludeTypes: ReadonlyArray<CardType> | undefined
): boolean {
    if (!excludeTypes || excludeTypes.length === 0) return true;
    if (item.abilityId || item.triggeredAbilityId || item.delayedTriggerId) {
        return false;
    }
    return !excludeTypes.some((t) => item.types.includes(t));
}

/** CR 114.1 + 208.2 — Stern Scolding's "target creature spell with power or
 *  toughness N or less": true when `item` is a legal spell target under
 *  `filter` (an ability never qualifies; the spell must be a creature spell
 *  whose power OR toughness, as printed on the card, is at most the given
 *  number). An undefined filter always passes. Shared by `getLegalTargets`'s
 *  spell loop and `selectTarget`'s server-side validation (issue #683). */
export function spellMatchesCreaturePtFilter(
    item: GameState["stack"][number],
    filter: { maxPowerOrToughness: number } | undefined
): boolean {
    if (!filter) return true;
    if (item.abilityId || item.triggeredAbilityId || item.delayedTriggerId) {
        return false;
    }
    if (!item.types.includes("Creature")) return false;
    const max = filter.maxPowerOrToughness;
    const powerOk = item.power !== undefined && item.power <= max;
    const toughnessOk = item.toughness !== undefined && item.toughness <= max;
    return powerOk || toughnessOk;
}

/** CR 114.1 + 701.7 — would the spell `item` on the stack destroy a land that
 *  `playerId` controls? Inspects the spell DECLARATIVELY (never runs its
 *  imperative `resolve()`): a single-target `effect: "destroy-target"` whose
 *  chosen permanent target is a land controlled by `playerId`, or a mass
 *  land-destruction spell flagged `destroysAllLands` while `playerId` controls
 *  at least one land. Abilities on the stack are not spells and never qualify.
 *  Reusable predicate (not Equinox-specific) — drives the
 *  `spellWouldDestroyLandYouControl` spell-target filter. Per the Legends
 *  rulings, only DIRECT destruction counts (damage-to-animated-land,
 *  sacrifice, and random/indirect destruction are excluded by construction —
 *  they aren't `destroy-target`/`destroysAllLands`). */
export function spellWouldDestroyLandControlledBy(
    state: GameState,
    item: GameState["stack"][number],
    playerId: string
): boolean {
    // An activated/triggered/delayed ability on the stack is not a spell.
    if (item.abilityId || item.triggeredAbilityId || item.delayedTriggerId) {
        return false;
    }
    const cardId = (item.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return false;

    const controlsALand = state.players
        .find((p) => p.id === playerId)
        ?.battlefield.some((c) => isLand(c) && c.controllerId === playerId);

    // Mass land destruction (Armageddon): destroys every land in play, so it
    // destroys the activator's land iff they control any land at all.
    if (def.destroysAllLands) return !!controlsALand;

    // Single-target "Destroy target land" (Stone Rain / Sinkhole / Ice Storm):
    // qualifies iff one of the chosen targets is a land this player controls.
    // Both declarative authoring modes qualify: the `effect: "destroy-target"`
    // shorthand and an Effect Script carrying a `destroy` Op (ADR 0045).
    if (
        def.effect === "destroy-target" ||
        def.effects?.some((op) => op.op === "destroy")
    ) {
        for (const t of item.targets ?? []) {
            if (t.type !== "permanent") continue;
            for (const p of state.players) {
                const perm = p.battlefield.find((c) => c.id === t.id);
                if (perm && isLand(perm) && perm.controllerId === playerId) {
                    return true;
                }
            }
        }
    }
    return false;
}

export function getLegalTargets(
    state: GameState,
    requirement: TargetRequirement,
    sourceColors: readonly Color[] = [],
    casterId?: string,
    chosenX?: number,
    sourceTypes: readonly CardType[] = [],
    /** Source subtypes + spell-vs-ability, for `cantBeTargeted` guards that
     *  narrow by them ("Aura spells", "spells only" — CR 109.5 / 113.3). */
    sourceSubtypes: readonly string[] = [],
    sourceIsSpell?: boolean
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
            // CR 102.1 — "active" restricts to the active player (exhaustive
            // handling of the controller union; no current card uses
            // graveyard + active).
            if (
                controllerFilter === "active" &&
                player.id !== state.activePlayerId
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
    // CR 202.2 — OR-over-colors filter ("a black or red source"). A target is
    // legal iff it is at least one of these colors. Players (colorless) are
    // excluded when set, same as the single-color `colorFilter`.
    const colorFilterAny = requirement.colorFilterAny;
    const matchesColorFilterAny = (
        card: Parameters<typeof hasColor>[0]
    ): boolean =>
        colorFilterAny === undefined ||
        colorFilterAny.some((c) => hasColor(card, c));
    const tappedFilter = requirement.tappedFilter;
    const combatRoleFilter = requirement.combatRoleFilter;
    const powerFilter = requirement.powerFilter;
    const mvFilter = resolveMvFilter(requirement.mvFilter, chosenX);
    const subtypeFilter = requirement.subtypeFilter
        ? Array.isArray(requirement.subtypeFilter)
            ? requirement.subtypeFilter
            : [requirement.subtypeFilter]
        : undefined;
    const supertypeFilter = requirement.supertypeFilter
        ? Array.isArray(requirement.supertypeFilter)
            ? requirement.supertypeFilter
            : [requirement.supertypeFilter]
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
    const excludeSupertypes = requirement.excludeSupertypes
        ? Array.isArray(requirement.excludeSupertypes)
            ? requirement.excludeSupertypes
            : [requirement.excludeSupertypes]
        : undefined;
    const toughnessFilter = requirement.toughnessFilter;

    // CR 115.4: "any target" means any creature, planeswalker, player, or
    // battle — the four object types that can be damaged (CR 120.3).
    const battlefieldControllerFilter = requirement.controller ?? "any";
    if (wantsAny || wantsSpellOrPermanent || permanentTypes.length > 0) {
        for (const player of state.players) {
            // CR 109.3 / 102.1 — `controller` filter restricts legal
            // battlefield targets to the caster's / an opponent's / the active
            // player's permanents (Simulacrum "you", Nettling Imp "opponent",
            // Arcum's Whistle "active"). Shared with the selectTarget mutation
            // via matchesBattlefieldController so the offered and accepted sets
            // can't diverge. A permanent always lives on its controller's
            // battlefield, so `player.id` is the controllerId here.
            if (
                !matchesBattlefieldController(
                    player.id,
                    casterId,
                    state.activePlayerId,
                    battlefieldControllerFilter
                )
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
                // CR 205.4a: live supertype filter for "target snow lands"
                // (Avalanche). Honors Melting / Arcum's Weathervane mutations.
                if (
                    supertypeFilter &&
                    !supertypeFilter.every((s) => hasSupertypeLive(card, s))
                ) {
                    continue;
                }
                // CR 205.4a: negative supertype filter for "target nonbasic
                // land" (Wasteland) — the mirror of supertypeFilter above.
                if (
                    excludeSupertypes &&
                    excludeSupertypes.some((s) => hasSupertypeLive(card, s))
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
                // CR 202.2: OR-over-colors filter ("a black or red source").
                if (!matchesColorFilterAny(card)) continue;
                // CR 701.20: tap-state filter for "target tapped/untapped ~".
                if (tappedFilter === "tapped" && !card.isTapped) continue;
                if (tappedFilter === "untapped" && card.isTapped) continue;
                // CR 508.1 / 509.1: combat-role filter for "target attacking
                // creature", "target blocking creature", or an array form
                // matching either role ("attacking or blocking", D'Avenant
                // Archer).
                if (combatRoleFilter) {
                    const roles = Array.isArray(combatRoleFilter)
                        ? combatRoleFilter
                        : [combatRoleFilter];
                    const matchesRole = roles.some(
                        (r) =>
                            (r === "attacking" && card.isAttacking) ||
                            (r === "blocking" && card.isBlocking)
                    );
                    if (!matchesRole) continue;
                }
                // CR 702: keyword filter for "target creature with flying"
                // (Island of Wak-Wak).
                if (
                    requirement.requireAbility &&
                    !card.staticAbilities.includes(requirement.requireAbility)
                ) {
                    continue;
                }
                // CR 702: negative keyword filter for "target creature without
                // flying" (Flood). Mirror of requireAbility.
                if (
                    requirement.excludeAbility &&
                    card.staticAbilities.includes(requirement.excludeAbility)
                ) {
                    continue;
                }
                // "target creature other than ~" — exclude specific instances
                // (Sorceress Queen injects its own id via getTargetRequirement).
                if (requirement.excludeInstanceIds?.includes(card.id)) continue;
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
                // CR 611 — a continuous `permanent-guard` may bar targeting
                // entirely (Guardian Beast / shroud: "can't be the target of
                // spells or abilities"), or narrowed by source quality ("Aura
                // spells", "spells only" — CR 109.5 / 113.3). Read live.
                if (
                    isGuardedAgainst(state, card, "cantBeTargeted", {
                        types: sourceTypes,
                        subtypes: sourceSubtypes,
                        isSpell: sourceIsSpell,
                    })
                )
                    continue;
                targets.push({ type: "permanent", id: card.id });
            }
        }
    }

    // Players have no color, so colorFilter / colorFilterAny excludes them.
    if (
        (wantsAny || reqTypes.includes("player")) &&
        !colorFilter &&
        !colorFilterAny
    ) {
        const playerControllerFilter = requirement.controller ?? "any";
        for (const player of state.players) {
            // CR 506.2 — "target player who attacked this turn": a player
            // attacked iff they control a creature flagged as having attacked.
            if (
                requirement.playerAttackedThisTurn &&
                !player.battlefield.some((c) => c.hasAttackedThisTurn)
            ) {
                continue;
            }
            // CR 115 — "target opponent" / "target player you control":
            // restrict the eligible players by relationship to the caster.
            // "you" keeps only the caster; "opponent" excludes the caster (and
            // requires a known caster). Word of Command — "target opponent".
            if (playerControllerFilter === "you" && player.id !== casterId) {
                continue;
            }
            if (
                playerControllerFilter === "opponent" &&
                (casterId === undefined || player.id === casterId)
            ) {
                continue;
            }
            // CR 102.1 — "active" restricts to the active player (exhaustive
            // handling; no current card uses player + active).
            if (
                playerControllerFilter === "active" &&
                player.id !== state.activePlayerId
            ) {
                continue;
            }
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
        const stackKind = requirement.spellStackKind;
        const stackSourceTypes = requirement.stackSourceTypeFilter
            ? Array.isArray(requirement.stackSourceTypeFilter)
                ? requirement.stackSourceTypeFilter
                : [requirement.stackSourceTypeFilter]
            : undefined;
        const spellTargetsIds = requirement.spellTargetsInstanceIds;
        const spellExcludeTypes = requirement.spellExcludeTypeFilter
            ? Array.isArray(requirement.spellExcludeTypeFilter)
                ? requirement.spellExcludeTypeFilter
                : [requirement.spellExcludeTypeFilter]
            : undefined;
        const spellCreaturePtFilter = requirement.spellCreaturePtFilter;
        for (const item of state.stack) {
            const isAbilityItem =
                !!item.abilityId ||
                !!item.triggeredAbilityId ||
                !!item.delayedTriggerId;
            // CR 113 / 114.1 — restrict by stack-object kind. "spell" drops
            // abilities; "activated-ability" keeps only activated abilities
            // (Brown Ouphe — mana abilities never reach the stack, CR 605.3a).
            if (stackKind === "spell" && isAbilityItem) continue;
            if (stackKind === "activated-ability" && !item.abilityId) continue;
            // CR 113.7a — restrict by the object's source card types (Brown
            // Ouphe: "from an artifact source"). The ability stack item carries
            // the source permanent's live `types`.
            if (
                stackSourceTypes &&
                !stackSourceTypes.some((t) => item.types.includes(t))
            ) {
                continue;
            }
            // CR 114.1 — Mistfolk: the spell must target one of the given
            // permanent instance ids (its own source). Abilities never qualify.
            if (spellTargetsIds) {
                if (isAbilityItem) continue;
                const tgts = item.targets ?? [];
                if (
                    !tgts.some(
                        (t) =>
                            t.type === "permanent" &&
                            spellTargetsIds.includes(t.id)
                    )
                ) {
                    continue;
                }
            }
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
            // CR 114.1 + spellExcludeTypeFilter (Spell Pierce: "target
            // noncreature spell").
            if (!spellMatchesExcludeTypeFilter(item, spellExcludeTypes)) {
                continue;
            }
            // CR 114.1 + 208.2 — Stern Scolding ("target creature spell with
            // power or toughness 2 or less").
            if (!spellMatchesCreaturePtFilter(item, spellCreaturePtFilter)) {
                continue;
            }
            // CR 114.6 / 115.10 — Reflecting Mirror: only spells that have
            // EXACTLY ONE target whose single target IS the activating player
            // are legal. (An ability on the stack is never a legal target here:
            // the requirement is "target spell".)
            if (requirement.spellSingleTargetingController) {
                const isAbility =
                    !!item.abilityId ||
                    !!item.triggeredAbilityId ||
                    !!item.delayedTriggerId;
                if (isAbility) continue;
                const tgts = item.targets ?? [];
                if (tgts.length !== 1) continue;
                if (tgts[0].type !== "player" || tgts[0].id !== casterId) {
                    continue;
                }
            }
            // CR 114.1 + 701.7 — Equinox: only spells that would destroy a land
            // the activating player controls are legal.
            if (
                requirement.spellWouldDestroyLandYouControl &&
                (casterId === undefined ||
                    !spellWouldDestroyLandControlledBy(state, item, casterId))
            ) {
                continue;
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
    kind: "cast" | "ability" | "copy-retarget" | "retarget"
): Color[] {
    if (kind === "copy-retarget" || kind === "retarget") {
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

/** Card types of the source whose target-selection is in progress (CR 109.5).
 *  Used to enforce source-type-filtered targeting guards (Artifact Ward's
 *  "can't be the target of abilities from artifact sources"). Mirrors
 *  `getPendingTargetSourceColors`: for spells the source is the hand card; for
 *  activated abilities it's the battlefield permanent; for a copy-retarget the
 *  source is the spell COPY on the stack. Returns an empty array if the source
 *  card can't be located. */
export function getPendingTargetSourceTypes(
    state: GameState,
    cardInstanceId: string,
    kind: "cast" | "ability" | "copy-retarget" | "retarget"
): CardType[] {
    if (kind === "copy-retarget" || kind === "retarget") {
        const si = state.stack.find((x) => x.id === cardInstanceId);
        return si ? [...si.types] : [];
    }
    if (kind === "ability") {
        for (const p of state.players) {
            const c = p.battlefield.find((x) => x.id === cardInstanceId);
            if (c) return [...c.types];
        }
    } else {
        for (const p of state.players) {
            const c = p.hand.find((x) => x.id === cardInstanceId);
            if (c) return [...c.types];
        }
    }
    return [];
}

/** Subtypes of the source whose target-selection is in progress (CR 109.5).
 *  Counterpart of `getPendingTargetSourceTypes`, used to enforce
 *  subtype-filtered targeting guards ("can't be the target of Aura spells" —
 *  Bartel Runeaxe / Tetsuo Umezawa). Same source-location logic: copy-retarget
 *  → the spell copy on the stack; ability → the battlefield permanent; cast →
 *  the hand card. Returns an empty array if the source can't be located. */
export function getPendingTargetSourceSubtypes(
    state: GameState,
    cardInstanceId: string,
    kind: "cast" | "ability" | "copy-retarget" | "retarget"
): string[] {
    if (kind === "copy-retarget" || kind === "retarget") {
        const si = state.stack.find((x) => x.id === cardInstanceId);
        return si ? [...si.subtypes] : [];
    }
    if (kind === "ability") {
        for (const p of state.players) {
            const c = p.battlefield.find((x) => x.id === cardInstanceId);
            if (c) return [...c.subtypes];
        }
    } else {
        for (const p of state.players) {
            const c = p.hand.find((x) => x.id === cardInstanceId);
            if (c) return [...c.subtypes];
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
            (cardId ? (tryGetDefinition(cardId)?.name ?? card.id) : card.id);
        throw new Error(
            `Illegal action "${action}" on "${cardName}". Legal actions: ${legal.join(", ") || "none"}`
        );
    }
}
