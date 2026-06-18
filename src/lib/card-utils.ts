import type { CardInstance, ManaPool } from "~/types/game";
import type { Color, ManaCost } from "~/types/cards";
import type { Phase } from "@convex/gre/types";
import type { PermanentView, TriggerStateView } from "@convex/cards/types";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_SUBTYPE_MANA,
    LANDWALK_KEYWORDS,
} from "@convex/gre/constants";
import { getCardById, tryGetCardById } from "@convex/cards";
import { getColorsFromCost } from "@convex/cards/colors";

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

/** Returns the native mana ability of a card as a menu entry (id + oracleText),
 *  or null if the card has no native activated mana ability. Used to surface
 *  the mana ability inside the ability context menu when a card has both a
 *  mana ability and a stack ability (e.g. Basalt Monolith, Mana Vault), so a
 *  left click doesn't silently choose tap-for-mana over the {3}: Untap. */
export function getActivatedManaMenuEntry(
    card: CardInstance
): { id: string; oracleText: string } | null {
    const cardDef = getCardById(card.card.id);
    const ability = cardDef.activatedAbilities?.find(
        (a) => !a.useStack && (a.manaProduced || a.manaChoices)
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
    const cardDef = getCardById(card.card.id);
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
            getColorsFromCost(tryGetCardById(card.card.id)?.manaCost);
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
    canDiscardLastDrawn: boolean = true
): { id: string; oracleText: string }[] {
    const cardDef = getCardById(card.card.id);
    const tapLocked = isTapLockedBySummoningSickness(card);
    const filterAbility = (a: {
        useStack: boolean;
        oracleText: string;
        cost: {
            tap?: boolean;
            removeCounter?: { type: string; count: number };
            discardLastDrawn?: boolean;
        };
        activationPhaseRestriction?: ReadonlyArray<Phase>;
        canActivate?: (
            source: PermanentView,
            state: TriggerStateView
        ) => boolean;
    }): boolean => {
        if (!a.useStack || !a.oracleText) return false;
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
        // CR 602.5b — ability-specific activation precondition. Read against
        // the source's current state; an empty state view is sufficient for
        // predicates that only inspect the source (e.g. Clockwork Beast's
        // counter cap), and acceptable as a UI hint for predicates that
        // would need more — server-side validation is authoritative.
        if (a.canActivate !== undefined) {
            const view = { players: [] };
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
        const sourceDef = getCardById(grant.sourceCardId);
        const tmpl = sourceDef.grantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (!tmpl) continue;
        if (!filterAbility(tmpl)) continue;
        granted.push({ id: tmpl.id, oracleText: tmpl.oracleText });
    }
    return [...native, ...granted];
}

/** Filters `getStackAbilities` to those flagged "any player may activate"
 *  (CR 113.3c, Ifh-Bíff Efreet). Used to surface activatable abilities on an
 *  OPPONENT's permanent for a viewer who holds priority — the only case where a
 *  non-controller may activate. Granted abilities are never any-player, so only
 *  the card's native definition is consulted. */
export function getAnyPlayerStackAbilities(
    card: CardInstance,
    phase?: Phase
): { id: string; oracleText: string }[] {
    const cardDef = getCardById(card.card.id);
    const anyPlayerIds = new Set(
        (cardDef.activatedAbilities ?? [])
            .filter((a) => a.activatableByAnyPlayer)
            .map((a) => a.id)
    );
    if (anyPlayerIds.size === 0) return [];
    return getStackAbilities(card, phase).filter((a) => anyPlayerIds.has(a.id));
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
    const cardDef = getCardById(cardId);
    const ability = cardDef.activatedAbilities?.find((a) => a.id === abilityId);
    if (ability?.oracleText) return ability.oracleText;
    for (const grant of grantedActivatedAbilities ?? []) {
        if (grant.abilityId !== abilityId) continue;
        const tmpl = getCardById(grant.sourceCardId).grantTemplates?.find(
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
    const cardDef = getCardById(cardId);
    const ability = cardDef.triggeredAbilities?.find(
        (a) => a.id === triggeredAbilityId
    );
    if (ability?.oracleText) return ability.oracleText;
    for (const grant of grantedTriggeredAbilities ?? []) {
        if (grant.abilityId !== triggeredAbilityId) continue;
        const tmpl = getCardById(
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
    const def = tryGetCardById(cardId);
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
        const sourceDef = tryGetCardById(grant.sourceCardId);
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
        const sourceDef = tryGetCardById(grant.sourceCardId);
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
    if (typeof x === "string") parts.push(`{${x}}`);
    else if (typeof x === "number" && x > 0) parts.push(`{${x}}`);
    for (const c of MANA_DISPLAY_COLORS) {
        const n = cost[c] ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${c}}`);
    }
    return parts.join("");
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
