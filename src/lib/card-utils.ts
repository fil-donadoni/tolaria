import type { CardInstance, ManaPool } from "~/types/game";
import type { CardType, Color, ManaCost } from "~/types/cards";
import type { Phase } from "@convex/gre/types";
import type {
    MayPayCost,
    PermanentView,
    TriggerStateView,
} from "@convex/cards/types";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_SUBTYPE_MANA,
    LANDWALK_KEYWORDS,
    LANDWALK_SUPERTYPE_KEYWORDS,
    getEffectiveManaChoices,
} from "@convex/gre/constants";
import type { CardInstanceState } from "@convex/gre/state";
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

/** Returns true if a card has a tap mana ability (basic land subtype or activated). */
export function hasManaAbility(card: CardInstance): boolean {
    if (getLandManaColor(card) !== null) return true;
    const cardDef = getDefinition(card.card.id);
    return !!cardDef.activatedAbilities?.some(
        (a) =>
            !a.useStack && (a.manaProduced || a.manaChoices || a.getManaChoices)
    );
}

/** Returns the native mana ability of a card as a menu entry (id + oracleText),
 *  or null if the card has no native activated mana ability. Used to surface
 *  the mana ability inside the ability context menu when a card has both a
 *  mana ability and a stack ability (e.g. Basalt Monolith, Mana Vault), so a
 *  left click doesn't silently choose tap-for-mana over the {3}: Untap. */
export function getActivatedManaMenuEntry(
    card: CardInstance
): { id: string; oracleText: string } | null {
    const cardDef = getDefinition(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) =>
            !a.useStack && (a.manaProduced || a.manaChoices || a.getManaChoices)
    );
    if (!ability) return null;
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

/** Returns the mana choices for a card with a choice-based mana ability, or null.
 *
 *  For board-conditional choosers (Fellwar Stone — `getManaChoices`), the
 *  options depend on every player's battlefield, so the caller passes the
 *  current players. The client runs the SAME `getManaChoices` resolver the
 *  server validates against (`game.ts` → `getEffectiveManaChoices`), so the
 *  index the picker submits references the list the server reads (CR 106.1). */
export function getManaChoices(
    card: CardInstance,
    players?: ReadonlyArray<{ id: string; battlefield: CardInstance[] }>
): ManaCost[] | null {
    const cardDef = getDefinition(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) => !a.useStack && (a.manaChoices || a.getManaChoices)
    );
    if (!ability) return null;
    // Delegate to the shared engine resolver so the client computes the SAME
    // (board-conditional) option list the server validates against (CR 106.1).
    // The slim `CardInstance` is a structurally valid `CardInstanceState` here.
    if (ability.getManaChoices && players) {
        return getEffectiveManaChoices(
            card as unknown as CardInstanceState,
            card.controllerId,
            players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield as unknown as CardInstanceState[],
            }))
        );
    }
    return ability.manaChoices ?? null;
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

/** Client-side mirror of the backend's matchesPermanentFilter. Returns true
 *  if the permanent matches every constraint in the filter (AND semantics).
 *  Used by the mid-resolution choice UI to highlight legal picks.
 *
 *  Must stay in sync with `matchesPermanentFilter` in convex/gre/state.ts. */
export function matchesPermanentFilter(
    card: CardInstance,
    filter: {
        types?: string | string[];
        subtypes?: string | string[];
        requireAbility?: string;
        excludeAbility?: string;
        colors?: string | string[];
        tapped?: boolean;
    }
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
    }>,
    activePlayerId?: string
): TriggerStateView {
    return {
        players: players.map((p) => ({
            id: p.id,
            life: p.life,
            hand: { length: p.hand.length },
            battlefield: p.battlefield.map((c) => ({
                id: c.id,
                controllerId: c.controllerId,
                ownerId: c.ownerId,
                types: c.types ?? [],
                subtypes: c.subtypes ?? [],
                staticAbilities: c.staticAbilities ?? [],
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
    };
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
    stateView?: TriggerStateView
): { id: string; oracleText: string }[] {
    const cardDef = getDefinition(card.card.id);
    const tapLocked = isTapLockedBySummoningSickness(card);
    const filterAbility = (a: {
        useStack: boolean;
        oracleText: string;
        cost: {
            tap?: boolean;
            removeCounter?: { type: string; count: number };
            discardLastDrawn?: boolean;
            exileFromGraveyard?: { count: number; cardType?: CardType };
        };
        activationPhaseRestriction?: ReadonlyArray<Phase>;
        activatableByOpponentsOnly?: boolean;
        canActivate?: (
            source: PermanentView,
            state: TriggerStateView
        ) => boolean;
    }): boolean => {
        if (!a.useStack || !a.oracleText) return false;
        // CR 602.1 — "only your opponents may activate" abilities are never
        // surfaced on the controller's OWN permanent (this function is called
        // only for `isMe` cards); the opponent's view uses
        // `getAnyPlayerStackAbilities`.
        if (a.activatableByOpponentsOnly) return false;
        if (a.cost.tap && card.isTapped) return false;
        // CR 302.1 — creature with summoning sickness can't pay {T}.
        if (a.cost.tap && tapLocked) return false;
        if (
            a.activationPhaseRestriction &&
            phase !== undefined &&
            !a.activationPhaseRestriction.includes(phase)
        ) {
            return false;
        }
        // CR 122.6 — counter-removal cost is only legal if the source has
        // enough counters of the declared type.
        if (a.cost.removeCounter) {
            const have = card.counters?.[a.cost.removeCounter.type] ?? 0;
            if (have < a.cost.removeCounter.count) return false;
        }
        // CR 118.3 — "discard the last card you drew this turn" cost
        // (Jandor's Ring) is unpayable when no such card is in hand.
        if (a.cost.discardLastDrawn && !canDiscardLastDrawn) return false;
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard" cost
        // (Night Soil) is unpayable unless one graveyard holds enough matching
        // cards (the whole cost must come from ONE graveyard). UI hint against
        // the viewer-visible graveyards; server validation is authoritative.
        if (a.cost.exileFromGraveyard) {
            const { count, cardType } = a.cost.exileFromGraveyard;
            const players = stateView?.players ?? [];
            const payable = players.some(
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
    stateView?: TriggerStateView
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
    const fromStack = getStackAbilities(card, phase, true, stateView).filter(
        (a) => nonControllerIds.has(a.id)
    );
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
    } else if (typeof x === "number" && x > 0) parts.push(`{${x}}`);
    for (const c of MANA_DISPLAY_COLORS) {
        const n = cost[c] ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${c}}`);
    }
    return parts.join("");
}

/** Normalized `may-pay` cost shape (CR 117.3a / 118.4 / 702.24). Mirrors the
 *  backend `normalizeMayPayCost` so the UI affordability gate and the cost
 *  label read the same shape whether the cost arrived as a bare `ManaCost`
 *  (mana-only) or the `{ mana?, life?, sacrifice? }` union (ADR 0042). */
export interface NormalizedMayPayCost {
    mana?: ManaCost;
    life?: number;
    sacrifice?: { count: number };
}

function isMayPayUnion(
    cost: MayPayCost
): cost is Exclude<MayPayCost, ManaCost> {
    return "mana" in cost || "life" in cost || "sacrifice" in cost;
}

/** Widens either `may-pay` cost shape to `{ mana?, life?, sacrifice? }`. */
export function normalizeMayPayCost(cost: MayPayCost): NormalizedMayPayCost {
    if (isMayPayUnion(cost)) {
        return {
            ...(cost.mana ? { mana: cost.mana } : {}),
            ...(cost.life !== undefined ? { life: cost.life } : {}),
            ...(cost.sacrifice
                ? { sacrifice: { count: cost.sacrifice.count } }
                : {}),
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
    extraMana?: ManaPool
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
    if (norm.sacrifice && sacrificeCandidateCount < norm.sacrifice.count) {
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
        parts.push(n === 1 ? "sacrifice" : `sacrifice ${n}`);
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
