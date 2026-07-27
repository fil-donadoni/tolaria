import type {
    CardType,
    Color,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import type {
    CardInstanceState,
    GameState,
    PendingTarget,
    PlayerState,
    StackItem,
} from "./state";
import type { CardAction } from "./types";
import { findTriggeredAbility } from "./copy";
import { isSorceryTiming } from "./phases";
import {
    CASTABLE_PERMANENT_TYPES,
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_DROPS_PER_TURN,
    LAND_SUBTYPE_MANA,
    MANA_COLORS,
    PLACEHOLDER_CARD_ID,
    abilitiesSuppressed,
    getManaTapOptionsDetailed,
    hasInstantSpeed,
    isTapLockedBySummoningSickness,
    manaValue,
} from "./constants";
import { STATIC_EFFECT_CTX } from "./layers";
import { isProtectedFromColors } from "./protection";
import { isGuardedAgainst, playerHasShroud } from "./permanentGuard";
import {
    castProhibitionReason,
    isCastTimingSorcerySpeedLocked,
    hasCastTimingFlashGrant,
} from "../cards/castRestrictions";
import { tapManaBonusUnits } from "./tapManaBonus";
import { PHYREXIAN_LIFE_PER_PIP, phyrexianPipCount } from "./phyrexian";
import { matchesPermanentFilter } from "../cards/filters";
import { getInstanceManaCost, tryGetDefinition } from "../cards";
import { cardHasColor } from "../cards/colors";
import { affordableAlternativeCosts } from "./alternativeCost";
import {
    getFlashbackCost,
    getFlashbackAdditionalCost,
    hasFlashback,
    type FlashbackAdditionalCost,
} from "./flashback";
import { getMadnessCost, isMadnessCastable } from "./madness";
import {
    countDistinctCardTypes,
    getEscapeExileSpec,
    getEscapeManaCost,
    hasEscape,
} from "./escape";
import { delveEligibleCards, spellHasDelve } from "./payWith";
import type { ManaCost } from "../cards/types";
import {
    applyCostModifiers,
    getCostModifiers,
    landPlayLockActive,
    normalizeManaCost,
    restrictedUnitAllowsSpell,
    emitBecameTargetEvents,
} from "./state";
import {
    resolveMvFilter,
    matchesBattlefieldController,
    checkPermanentTargetFilters,
    lowerPermanentFilters,
    checkSpellTargetFilters,
    lowerSpellFilters,
    checkPlayerTargetFilters,
    lowerPlayerFilters,
    checkCardTargetFilters,
    lowerCardFilters,
    siblingControllerIdFor,
    type TargetFilterCtx,
    type PermanentFilterValues,
} from "./targetFilters";

export {
    getProtectedColors,
    isProtectedFromColors,
    isProtectedFromSource,
    parseProtectionFromColor,
} from "./protection";

// ADR 0068 (PRD #1407, issues #1408 / #1409 / #1410) — the low-level color/
// mv/controller/spell predicates the target-filter registry checks depend on
// now live in `targetFilters.ts` (no dependency on this module, keeping the
// import graph acyclic). Re-exported here so existing callers (`game.ts`,
// `combatRegistry.ts`, tests) keep importing them from `./rules` unchanged.
export {
    hasColor,
    matchesMvFilter,
    resolveMvFilter,
    matchesBattlefieldController,
    checkPermanentTargetFilters,
    checkSpellTargetFilters,
    checkPlayerTargetFilters,
    checkCardTargetFilters,
    spellMatchesExcludeTypeFilter,
    spellMatchesCreaturePtFilter,
    spellWouldDestroyLandControlledBy,
    siblingControllerIdFor,
    type TargetFilterCtx,
    type PermanentFilterValues,
    type SpellFilterValues,
    type PlayerFilterValues,
    type CardFilterValues,
} from "./targetFilters";

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

/** Whether `player` currently holds an unconditional, player-wide permission
 *  to play lands from their own graveyard (CR 305.1 special action / 601-
 *  analog permission), granted by ANY permanent declaring
 *  `playsLandsFromGraveyard` on their battlefield (Icetill Explorer, issue
 *  #1190). Read live from the battlefield (mirrors `getExtraLandDrops`), so
 *  the permission ends the instant the granting source leaves play — no
 *  stale flag. Distinct from a SCOPED once-per-turn permission granted to one
 *  specific graveyard card (Serra Paragon, issue #1149), which is tracked as
 *  a per-instance `CardInstanceState` grant instead. */
export function canPlayLandsFromGraveyard(
    state: GameState,
    player: PlayerState
): boolean {
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
        if (def?.playsLandsFromGraveyard) return true;
    }
    // CR 305.1-analog / 601 (issue #1149) — the BROAD, turn-scoped
    // graveyard-cast/land-play permission (Yawgmoth's Will) also covers
    // lands when its `zones` include "land" — unioned with the
    // battlefield-derived permission above.
    return (
        getGraveyardPlayPermission(state, player.id)?.zones.includes("land") ??
        false
    );
}

/** Reads the turn-scoped, player-wide graveyard play/cast permission granted
 *  to `playerId` by the `grantGraveyardPlay` Effect Script Op (Yawgmoth's
 *  Will, CR 305.1-analog / 601, issue #1149), or `undefined` if none is
 *  active. Distinct from the unconditional, indefinite,
 *  battlefield-derived `playsLandsFromGraveyard` land-only permission
 *  (#1190, Icetill Explorer) folded into `canPlayLandsFromGraveyard` above. */
export function getGraveyardPlayPermission(
    state: GameState,
    playerId: string
): { zones: Array<"land" | "spell">; maxManaValue?: number } | undefined {
    return state.graveyardPlayPermissionThisTurn?.find(
        (e) => e.playerId === playerId
    );
}

/** Whether `card` — a NON-LAND card sitting in `player`'s own graveyard — is
 *  currently castable purely under the BROAD, turn-scoped graveyard-cast
 *  permission (Yawgmoth's Will, issue #1149): the permission covers
 *  `"spell"` and, when capped, the card's printed mana value is within
 *  `maxManaValue`. Callers only reach this for a card with NEITHER Flashback
 *  nor Escape — those own keyword-cast mechanisms take precedence (their own
 *  branches in `getLegalActions` return before this is ever consulted). */
export function canCastFromGraveyardByPermission(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    if (card.types.includes("Land")) return false;
    const permission = getGraveyardPlayPermission(state, player.id);
    if (!permission || !permission.zones.includes("spell")) return false;
    if (permission.maxManaValue === undefined) return true;
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return manaValue(def?.manaCost) <= permission.maxManaValue;
}

/** CR 702.139 (issue #1392, Lurrus of the Dream-Den) — true iff `player`
 *  currently holds a STATIC, battlefield-derived permission to cast `card` —
 *  a PERMANENT card (never Land, never Instant/Sorcery, CR 110.1/300.1) —
 *  from their own graveyard: some permanent on `player`'s battlefield
 *  declares `CardDefinition.castsPermanentsFromGraveyard` with a
 *  `maxManaValue` at or above `card`'s printed mana value, AND `player`
 *  hasn't already used such a permission this turn
 *  (`state.graveyardPermanentCastUsedThisTurn`). Read live from the
 *  battlefield every call (mirrors `canPlayLandsFromGraveyard`), so the
 *  permission ends the instant the granting source leaves play — no stale
 *  flag. Distinct from `canCastFromGraveyardByPermission` above (the BROAD,
 *  turn-scoped, Op-granted, any-spell, uncapped Yawgmoth's Will permission).
 *
 *  CR 702.139a's Oracle text is "Once during each of YOUR TURNS" — the
 *  permission only exists while `player` is the active player
 *  (`state.activePlayerId === player.id`). Without this gate, a FLASH
 *  permanent (MV ≤ the grant's cap) in the graveyard would be castable on
 *  the OPPONENT's turn too, because the flash/sorcery-timing check in the
 *  cast branches (`gre/rules.ts`'s `isPermanentPermissionCast`,
 *  `gameProjections.ts`'s affordance) short-circuits to instant-speed
 *  legality and never itself asks whose turn it is. This function is the
 *  SINGLE shared source both call sites read, so gating it here fixes
 *  legality and the wire affordance together — no duplicated own-turn check
 *  at either call site. */
export function canCastPermanentFromGraveyardByPermission(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    if (state.activePlayerId !== player.id) {
        return false;
    }
    if (
        !(CASTABLE_PERMANENT_TYPES as readonly CardType[]).some((t) =>
            card.types.includes(t)
        )
    ) {
        return false;
    }
    if (state.graveyardPermanentCastUsedThisTurn?.includes(player.id)) {
        return false;
    }
    const mv = manaValue(getInstanceManaCost(card));
    for (const perm of player.battlefield) {
        const permCardId = (perm.card as { id?: string }).id;
        if (!permCardId) continue;
        const grant =
            tryGetDefinition(permCardId)?.castsPermanentsFromGraveyard;
        if (grant && mv <= grant.maxManaValue) return true;
    }
    return false;
}

/** Marks `playerId` as having used a STATIC graveyard-permanent-cast
 *  permission (Lurrus, issue #1392) this turn — the once-per-turn
 *  consumption side of `canCastPermanentFromGraveyardByPermission`. Called
 *  ONCE, at cast commit, by every commit site that can push a graveyard cast
 *  onto the stack (`convex/game.ts`: `tryAutoCommitPendingCast`,
 *  `finalizeTargetSelection`, `announceCast`'s immediate-commit branch) —
 *  never at mere legality-check time (`getLegalActions`/`locateCastSource`
 *  are read-only). Idempotent (a player id is never pushed twice). */
export function markGraveyardPermanentCastUsed(
    state: GameState,
    playerId: string
): void {
    if (!state.graveyardPermanentCastUsedThisTurn) {
        state.graveyardPermanentCastUsedThisTurn = [];
    }
    if (!state.graveyardPermanentCastUsedThisTurn.includes(playerId)) {
        state.graveyardPermanentCastUsedThisTurn.push(playerId);
    }
}

const ALL_HAND_ACTIONS: CardAction[] = [
    "play",
    "cast",
    "discard",
    "putToGraveyard",
    "putToExile",
    "putToLibrary",
];

/** Returns the list of legal actions for a card in a player's hand. */
/** CR 601.3a / 307.1 + the per-player casting-timing modifiers (Teferi, Time
 *  Raveler). Base TIMING legality for `casterId` casting `card` — the
 *  player-aware replacement for the raw `hasInstantSpeed(card) ? true :
 *  isSorceryTiming(state)` split:
 *   - a sorcery-speed LOCK on the caster (Teferi's static: "Each opponent can
 *     cast spells only any time they could cast a sorcery") forces sorcery
 *     timing, beating the spell's own flash AND any granted flash — a "can cast
 *     only when" restriction overrides a permission (CR 101.2);
 *   - otherwise an instant-speed card, OR a card the caster holds a flash GRANT
 *     for (Teferi's +1: "cast sorcery spells as though they had flash"), is
 *     castable any time the caster has priority;
 *   - else sorcery timing is required. */
function castTimingBaseLegal(
    state: GameState,
    casterId: string,
    card: CardInstanceState
): boolean {
    if (isCastTimingSorcerySpeedLocked(casterId, state)) {
        return isSorceryTiming(state);
    }
    if (
        hasInstantSpeed(card) ||
        hasCastTimingFlashGrant(casterId, card, state)
    ) {
        return true;
    }
    return isSorceryTiming(state);
}

export function getLegalActions(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    debugAllActions = false,
    /** CR 601.3e (issue #1156) — the ACTUAL caster, when it differs from
     *  `player` (the zone `card` currently lives in). Every shipped
     *  cast-from-exile/graveyard grant before Dauthi Voidwalker was
     *  same-player (Ice Cauldron, Flashback, Escape, Yawgmoth's Will), so
     *  `player` doubled as both "whose zone" and "who is casting" with no
     *  seam needed. A CROSS-PLAYER grant (Robber of the Rich's opponent-
     *  library exile, Dauthi Voidwalker's opponent-exile free cast) breaks
     *  that assumption: `card` sits in `player`'s zone, but priority /
     *  affordability / target legality must be evaluated for the caster.
     *  Defaults to `player.id` (unchanged behaviour for every same-player
     *  call site). Zone-membership scans below (`player.exile.some(...)`
     *  etc.) intentionally keep reading `player` — that part IS about whose
     *  zone the card is in. */
    casterId: string = player.id
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
    if (state.priorityPlayerId !== casterId) {
        return actions;
    }
    // The caster's own PlayerState, for cost/target/prohibition checks below
    // (mana pool, targeting relation). Falls back to `player` when the caster
    // can't be resolved (should not happen — `casterId` is always a real
    // player id) or when it IS `player` (the overwhelmingly common
    // same-player case, skipping a redundant lookup).
    const caster =
        casterId === player.id
            ? player
            : (state.players.find((p) => p.id === casterId) ?? player);

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

    // CR 702.34 — a card in the player's OWN graveyard that currently has a
    // Flashback cost (printed or granted) is castable from there for that cost.
    // A graveyard card is never castable any other way, so this branch fully
    // owns the "cast" decision for it: same timing/phase gates as a hand cast,
    // but affordability is checked against the flashback cost.
    const isFlashbackCast =
        !types.includes("Land") &&
        player.graveyard.some((c) => c.id === card.id) &&
        hasFlashback(card);
    if (isFlashbackCast) {
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        // CR 702.34a — the mana portion may be absent (Lava Dart pays only a
        // sacrifice); an empty cost is always affordable.
        const flashbackMana = getFlashbackCost(card) ?? {};
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(player.id, card, state) === undefined &&
            canPotentiallyPayCost(player, card, flashbackMana) &&
            hasEnoughLegalTargets(state, player, card) &&
            // CR 702.34a / 118.5 — the flashback-only non-mana cost (sacrifice a
            // matching permanent / exile a matching card from hand) must itself
            // be payable, or the flashback cast can't be announced.
            hasPayableFlashbackAdditionalCost(
                player,
                getFlashbackAdditionalCost(card)
            )
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 702.138 — a card in the player's OWN graveyard that currently has an
    // ESCAPE cost (printed — Uro/Phlage/Nethergoyf — or granted by Underworld
    // Breach) is castable from there for that cost. Same timing/phase gates as a
    // hand cast; affordability is checked against the escape mana cost AND the
    // ability to pay the "exile N other cards from your graveyard" additional
    // cost (CR 702.138a).
    const isEscapeCast =
        player.graveyard.some((c) => c.id === card.id) &&
        hasEscape(state, card);
    if (isEscapeCast) {
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(player.id, card, state) === undefined &&
            canPotentiallyPayCost(
                player,
                card,
                getEscapeManaCost(state, card) ?? {}
            ) &&
            hasEnoughLegalTargets(state, player, card) &&
            hasPayableEscapeExileCost(state, player, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 305.1-analog / 601 (issue #1149) — a NON-LAND card in the player's
    // OWN graveyard, while the player holds the BROAD, turn-scoped
    // graveyard-cast permission (Yawgmoth's Will) covering it, is castable
    // from there for its normal printed mana cost. Only reached when the
    // card has NEITHER Flashback nor Escape (those branches above return
    // first); a LAND is handled by the "play" branch instead.
    const isPermissionCast =
        player.graveyard.some((c) => c.id === card.id) &&
        canCastFromGraveyardByPermission(state, player, card);
    if (isPermissionCast) {
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(player.id, card, state) === undefined &&
            canPotentiallyPayCost(
                player,
                card,
                getInstanceManaCost(card) ?? {}
            ) &&
            hasEnoughLegalTargets(state, player, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 601.3e / 117.6-analog (issue #1344) — a NON-LAND card in the
    // player's OWN graveyard tagged with a per-card cast grant (Malcolm,
    // Alluring Scoundrel: "you may cast the discarded card without paying
    // its mana cost") is castable from there — for FREE when
    // `castFromGraveyardWithoutPayingManaCost` rides the grant, else for its
    // normal printed cost (no shipped card uses the permission-only shape
    // yet, but the branch mirrors `grantCastFromExile`'s dual usage for
    // free). Distinct from the BROAD `isPermissionCast` branch above — this
    // is a SPECIFIC-CARD grant (`grantCastFromGraveyard`), only reached when
    // neither Flashback, Escape, nor the broad permission already claimed
    // this card (those branches return first). Always same-player — a
    // graveyard grant has no cross-player shape (`castZoneOwner`'s doc,
    // `convex/game.ts`), so `casterId` (defaulting to `player.id`) is
    // checked directly against the grant. This branch fully owns the "cast"
    // decision for the granted card, exactly like the exile equivalent
    // (`isFreeExileCast`) below.
    const isGraveyardGrantCast =
        !types.includes("Land") &&
        player.graveyard.some((c) => c.id === card.id) &&
        card.castableFromGraveyardBy === casterId;
    if (isGraveyardGrantCast) {
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        const costOverride = card.castFromGraveyardWithoutPayingManaCost
            ? {}
            : (getInstanceManaCost(card) ?? {});
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(caster.id, card, state) === undefined &&
            canPotentiallyPayCost(caster, card, costOverride) &&
            hasEnoughLegalTargets(state, caster, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 702.139 (issue #1392, Lurrus of the Dream-Den) — a PERMANENT card in
    // the player's OWN graveyard, while the player holds a STATIC,
    // battlefield-derived, once-per-turn permission covering it
    // (`canCastPermanentFromGraveyardByPermission`), is castable from there
    // for its normal printed mana cost. Only reached when the card has none
    // of Flashback, Escape, the BROAD permission, or a per-card grant (those
    // branches above return first) — a card that qualifies for more than one
    // mechanism prefers the higher-precedence one, sparing Lurrus's scarce
    // once-per-turn use. Distinct from `isPermissionCast` above: source-bound
    // (ends when the granting permanent leaves play), permanent-cards-only,
    // and capped at one use per turn. `canCastPermanentFromGraveyardByPermission`
    // itself gates on `state.activePlayerId === player.id` (CR 702.139a "Once
    // during each of YOUR TURNS") — the `baseLegal` check below is ONLY the
    // within-your-turn flash-vs-sorcery-timing split (CR 702.139a's "using its
    // normal timing permissions"), never a substitute for the own-turn gate.
    const isPermanentPermissionCast =
        player.graveyard.some((c) => c.id === card.id) &&
        canCastPermanentFromGraveyardByPermission(state, player, card);
    if (isPermanentPermissionCast) {
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(player.id, card, state) === undefined &&
            canPotentiallyPayCost(
                player,
                card,
                getInstanceManaCost(card) ?? {}
            ) &&
            hasEnoughLegalTargets(state, player, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 702.35d — a card in the player's OWN exile that was discarded via
    // Madness is castable from there for its madness cost. The madness cast
    // window is instant-speed (the reflexive trigger can resolve on any player's
    // turn), so no sorcery-timing/phase gate applies; affordability is checked
    // against the madness cost (`Madness {0}` is the empty, always-affordable
    // cost). This branch fully owns the "cast" decision for the exiled card.
    const isMadnessCast =
        !types.includes("Land") &&
        player.exile.some((c) => c.id === card.id) &&
        isMadnessCastable(card, player.id);
    if (isMadnessCast) {
        const madnessMana = getMadnessCost(card) ?? {};
        if (
            castProhibitionReason(player.id, card, state) === undefined &&
            canPotentiallyPayCost(player, card, madnessMana) &&
            hasEnoughLegalTargets(state, player, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 601.3e (issue #1156) — a card in an exile zone (this player's OWN, or
    // — for a cross-player grant like Dauthi Voidwalker — the CASTER's
    // opponent's, `casterId` disambiguating) tagged with the free-cast waiver
    // (`SpellContext.grantCastFromExile`'s `withoutPayingManaCost` option) is
    // castable from there for FREE: its printed mana cost is waived entirely,
    // mirroring `castRawManaCost`'s matching branch (`convex/game.ts`) that
    // actually deducts (or rather doesn't) the cost at commit. Same timing /
    // phase / target / prohibition gates as an ordinary cast — only
    // affordability is short-circuited (`costOverride: {}`, always payable).
    // This branch fully owns the "cast" decision for the exiled card, exactly
    // like the Madness branch above.
    const isFreeExileCast =
        !types.includes("Land") &&
        card.castFromExileWithoutPayingManaCost === true;
    if (isFreeExileCast) {
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(caster.id, card, state) === undefined &&
            canPotentiallyPayCost(caster, card, {}) &&
            hasEnoughLegalTargets(state, caster, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // "Cast" is for all non-land cards
    if (!types.includes("Land")) {
        // Per-player timing (CR 601.3a/e): instant-speed / flash-granted →
        // anytime with priority; sorcery-speed → main phase, empty stack,
        // active player has priority; a sorcery-speed LOCK (Teferi's static)
        // forces the latter even for instants. See `castTimingBaseLegal`.
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            // CR 601.3a — a player-scoped cast-type restriction (Brand of Ill
            // Omen: "Enchanted creature's controller can't cast creature
            // spells") forbids the cast outright. Scanned across both
            // battlefields; suppressing "cast" here also blocks the server
            // path, since `assertLegalAction` rejects the cast mutation when
            // "cast" is absent.
            castProhibitionReason(caster.id, card, state) === undefined &&
            // CR 118.9 — the mana cost is payable, OR the caster can afford an
            // ALTERNATIVE cost that replaces the mana cost entirely: a pure
            // non-mana give-up (Gush/Thwart return Islands, Fireblast
            // sacrifices Mountains — `alt.mana` absent, `?? {}` is always
            // affordable) OR a DIFFERENT mana amount (CR 702.109 Dash — `.some`
            // re-checks each offered variant's `mana` leg through the SAME
            // solver the printed cost uses, so a dash-cost creature is castable
            // even when its printed cost is not). CR 601.2f (ADR 0063) — the
            // plain branch also folds in cost modifiers/self-host reductions
            // (Emry) via the optional `state` arg.
            (canPotentiallyPayCost(caster, card, undefined, state) ||
                affordableAlternativeCosts(state, caster, card).some((alt) =>
                    canPotentiallyPayCost(caster, card, alt.mana ?? {})
                )) &&
            hasEnoughLegalTargets(state, caster, card) &&
            hasPayableAdditionalCost(caster, card)
        ) {
            actions.push("cast");
        }
    }

    return actions;
}

/** CR 117.9 / 601.2f: a spell whose additional cost is "sacrifice/exile a
 *  permanent matching a filter" (Natural Order, Soul Exchange) can only be
 *  cast if the caster controls at least one legal permanent to pay that
 *  cost — you can't announce a spell whose additional cost is unpayable.
 *  Suppressing "cast" here also blocks the server path, since
 *  `assertLegalAction` rejects the cast mutation when "cast" is absent,
 *  which keeps `buildAdditionalCostPicker` (convex/game.ts) — which throws
 *  on zero candidates — unreachable from announceCast. Cards without a
 *  sacrifice/exile additional cost are unaffected. Effective colours are
 *  derived per-candidate via the layer system (mirrors `tapOtherCandidates`
 *  in game.ts) so a `colors` filter (Natural Order's "a green creature")
 *  reads the same colour the rest of the engine sees, not the raw instance
 *  which carries no `colors` field of its own. */
function hasPayableAdditionalCost(
    player: PlayerState,
    card: CardInstanceState
): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return true;
    const def = tryGetDefinition(cardId);
    const filter =
        def?.additionalCosts?.sacrificeFilter ??
        def?.additionalCosts?.exileFilter;
    if (!filter) return true;
    return player.battlefield.some((c) => {
        const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
        return matchesPermanentFilter(view, filter, {
            selfControllerId: player.id,
        });
    });
}

/** CR 702.138a — affordability gate for the ESCAPE additional cost "exile N
 *  other cards from your graveyard". A fixed-count escape (Uro/Phlage/Underworld
 *  Breach) needs at least N OTHER cards in the caster's graveyard; the Nethergoyf
 *  variable cost needs enough OTHER cards to muster its card-type threshold. An
 *  escape with no reachable cost is unannounceable. */
function hasPayableEscapeExileCost(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    const spec = getEscapeExileSpec(state, card);
    if (!spec) return true;
    const others = player.graveyard.filter((c) => c.id !== card.id);
    if ("minCardTypes" in spec) {
        return countDistinctCardTypes(others) >= spec.minCardTypes;
    }
    return others.length >= spec.count;
}

/** CR 702.34a / 118.5 — affordability gate for the flashback-only non-mana
 *  additional cost (Lava Dart "Sacrifice a Mountain"). A flashback cast can only
 *  be announced if the caster controls at least one permanent matching the
 *  `sacrifice` filter AND holds at least one card matching the `exileFromHand`
 *  filter (each additional cost demands exactly one). Suppressing "cast" here
 *  also blocks the server path (`assertLegalAction` rejects an unpayable
 *  flashback). Effective colours are derived per-candidate via the layer system
 *  (mirrors `hasPayableAdditionalCost`). Undefined cost → always payable. */
function hasPayableFlashbackAdditionalCost(
    player: PlayerState,
    add: FlashbackAdditionalCost | undefined
): boolean {
    if (!add) return true;
    if (add.sacrifice) {
        const sacFilter = add.sacrifice;
        const hasVictim = player.battlefield.some((c) => {
            const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
            return matchesPermanentFilter(view, sacFilter, {
                selfControllerId: player.id,
            });
        });
        if (!hasVictim) return false;
    }
    if (add.exileFromHand) {
        const wantColor = add.exileFromHand.color;
        const hasCard = player.hand.some((c) => {
            const cardId = (c.card as { id?: string }).id;
            if (!cardId) return false;
            const def = tryGetDefinition(cardId);
            if (!def) return false;
            // CR 105.2 / 202.2 — a card's COLOUR, not its colour identity: a
            // colourless card (Island, artifact) never pays "exile a <colour>
            // card from your hand".
            return wantColor === undefined || cardHasColor(def, wantColor);
        });
        if (!hasCard) return false;
    }
    return true;
}

/** CR 601.2c: a spell with required targets can only be cast if enough legal
 *  targets exist. Used by getLegalActions to suppress the Cast UI for spells
 *  that would fail target selection (e.g. Lightning Bolt with no creatures or
 *  players to target — only relevant if all candidates are protected, since
 *  players are normally targetable). For "X" target counts the player can
 *  still pick X = 0 and skip target selection (CR 107.3), so cast stays
 *  legal regardless of board state. */
/** CR 107.3 — true when a requirement's mana-value bound is X-dependent
 *  (`mvFilter` uses the `"X"` placeholder). Its legal-target set then shifts
 *  with the announced X, so the castability gate must probe reachable X values
 *  rather than assume X = 0. */
export function mvFilterUsesX(req: TargetRequirement): boolean {
    const f = req.mvFilter;
    return !!f && (f.min === "X" || f.max === "X" || f.equals === "X");
}

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
    const sourceColors = STATIC_EFFECT_CTX.getColors(card);
    // Does a single target requirement have enough legal targets on the board?
    // Preserves every prior early-return semantic: an "X" count (X = 0 path,
    // CR 107.3) or a required count ≤ 0 leaves the cast legal regardless of
    // board state.
    const checkRequirement = (req: TargetRequirement): boolean => {
        if (req.count === "X") return true;
        const required =
            typeof req.count === "number" ? req.count : req.count.min;
        if (required <= 0) return true;
        // CR 107.3 / 202.3 — an X-dependent mv ceiling (Dominate, Spell Blast:
        // `mvFilter { max: "X" }`) exposes a wider legal-target set as X rises.
        // Probing only X = 0 (the historical `undefined` → 0 resolution) judged
        // the spell uncastable whenever no target sat under the X = 0 ceiling,
        // even though a larger — and affordable — X would reach one. Probe every
        // announceable X (0..maxAffordableX) and accept if ANY yields enough
        // legal targets, mirroring the move enumerator's X loop. Non-X
        // requirements keep the single X-agnostic pass.
        const xValues = mvFilterUsesX(req)
            ? Array.from(
                  { length: maxAffordableX(player, card) + 1 },
                  (_, i) => i
              )
            : [undefined];
        return xValues.some((chosenX) => {
            const legalTargets = getLegalTargets(
                state,
                req,
                sourceColors,
                player.id,
                chosenX,
                card.types,
                card.subtypes,
                // hasEnoughLegalTargets gates the Cast UI — the source is a
                // spell.
                true
            );
            return legalTargets.length >= required;
        });
    };
    // CR 702.33 — the kicker is chosen at announcement, AFTER this castability
    // gate. A spell whose KICKED target requirement widens the legal-target set
    // (Bloodchief's Thirst: MV ≤ 2 → any; Tear Asunder: artifact/enchantment →
    // any nonland permanent) stays castable if EITHER the base OR the kicked
    // requirement has enough legal targets — paying the kicker reaches the
    // wider set. Gating on only the base requirement wrongly judged such a
    // spell uncastable whenever only the widened set had a legal target.
    if (checkRequirement(requirement)) return true;
    const kicked = def?.kickedTargetRequirement;
    if (kicked && checkRequirement(kicked)) return true;
    return false;
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
    // requireTap: the auto-tap planner only ever taps for mana — it must never
    // auto-commit a sacrifice-only source (Lion's Eye Diamond discards the hand).
    const detailed = getManaTapOptionsDetailed(card, undefined, undefined, {
        requireTap: true,
    });
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
/** Builds the mana-source color sets `player` could tap toward casting `card`
 *  (pool + restricted mana permitted for this spell + untapped mana permanents)
 *  and greedily pays the colored portion of a normalized `cost`. Returns the
 *  number of sources left over once every colored requirement is met, or `null`
 *  when the colored portion itself can't be covered. That leftover is what the
 *  generic portion ({cost.X}) — and any additional {X} the player might still
 *  announce — draws from. Shared by {@link canPotentiallyPayCost} and
 *  {@link maxAffordableX} so the "can I cast it" and "how big can X be" gates
 *  never diverge. */
/** CR 702.126 — true iff the spell being cast declares Improvise. Reads the
 *  printed keyword off the card definition (mirrors the client `hasImprovise`
 *  in `src/lib/card-utils.ts`); Improvise is never layer-granted in the current
 *  pool, so the definition is authoritative. */
function spellHasImprovise(card: CardInstanceState): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return false;
    return (
        tryGetDefinition(cardId)?.staticAbilities?.includes("improvise") ??
        false
    );
}

function coloredCostLeftover(
    player: PlayerState,
    card: CardInstanceState,
    cost: Record<string, number>,
    /** CR 601.2g (`payWith`, ADR 0063) — include the chosen-resource pseudo
     *  sources (delve's graveyard cards) in the probe. Default true: the
     *  castability gate must see them or a delve-only-payable spell is hidden.
     *  `genericManaShortfall` passes false — it asks the complementary question
     *  ("how much can MANA alone NOT cover", i.e. how many resources the caster
     *  is forced to spend), which must exclude them. */
    opts: { payWith?: boolean } = {}
): number | null {
    const includePayWith = opts.payWith ?? true;
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
        const base = getProducibleManaUnits(perm);
        for (const unit of base) sources.push(unit);
        // CR 605.4 — a Wild-Growth-style triggered mana ability on ANOTHER
        // permanent adds extra mana when THIS land is tapped for mana. It only
        // fires on a for-mana tap, so gate on the land actually producing base
        // mana; then fold in the declared bonus units (Wild Growth {G},
        // Gauntlet {R}, Mana Flare produced colour, Fertile Ground any colour).
        if (base.length > 0) {
            for (const unit of tapManaBonusUnits(player.battlefield, perm)) {
                sources.push(unit);
            }
        }
    }

    // CR 702.126 — Improvise: while casting a spell with Improvise, each
    // untapped artifact you control may be tapped to pay {1} of the generic
    // cost. Model each as a generic-ONLY source (empty colour set: it never
    // satisfies a coloured pip in the greedy pass below, so it always survives
    // into the leftover the generic portion draws from). Unlike a {T} mana
    // ability, an Improvise tap carries no tap symbol, so summoning sickness
    // does NOT gate it (CR 302.1 is irrelevant here — an artifact creature
    // freshly cast can still be tapped for Improvise). Skip an artifact already
    // counted above as a mana source: it can be tapped only once and its
    // produced mana already yields ≥1 leftover unit, so adding an Improvise
    // source too would double-count it. Without this the castability gate
    // ignored Improvise entirely and hid the Cast action for a spell payable
    // only by tapping artifacts (e.g. Metallic Rebuke with too few lands).
    if (spellHasImprovise(card)) {
        for (const perm of player.battlefield) {
            if (perm.isTapped) continue;
            if (!perm.types.includes("Artifact")) continue;
            const producesMana =
                !isTapLockedBySummoningSickness(perm) &&
                getProducibleManaUnits(perm).length > 0;
            if (producesMana) continue;
            sources.push(new Set<Color>());
        }
    }

    // CR 702.66 / 601.2g — Delve (`payWith`, ADR 0063): while casting a spell
    // with delve, each card in the caster's graveyard may be exiled to pay for
    // {1} of the GENERIC cost. Model each as a generic-ONLY pseudo-source
    // (empty colour set — it never satisfies a coloured pip in the greedy pass
    // below, so it always survives into the leftover the generic portion draws
    // from), exactly as Improvise does above. This is a PROBE only: the real
    // payment is the caster's explicit picker choice
    // (`PendingCast.exileFromGraveyardChoice.offsetGeneric`), never auto-picked
    // by the solver. Without it `getLegalActions` would drop "cast" for a spell
    // payable only by delving (Treasure Cruise off two lands) and the client
    // would gray it out.
    if (includePayWith && spellHasDelve(card)) {
        const fuel = delveEligibleCards(player, card.id).length;
        for (let i = 0; i < fuel; i++) sources.push(new Set<Color>());
    }

    // Greedy: assign colored requirements first, picking the least-flexible
    // source able to produce that color. Optimal for the common case where each
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
            if (bestIdx === -1) return null;
            remaining.splice(bestIdx, 1);
            need--;
        }
    }
    return remaining.length;
}

/** Whether the player can pay a fully-normalized mana cost (colored pips + the
 *  generic `X` slot) with their current pool + producible mana. Wraps the
 *  `coloredCostLeftover` greedy assignment so callers that build a bespoke
 *  normalized cost (the Phyrexian solver) share the one affordability model. */
function canPayNormalizedCost(
    player: PlayerState,
    card: CardInstanceState,
    cost: Record<string, number>
): boolean {
    const leftover = coloredCostLeftover(player, card, cost);
    return leftover !== null && leftover >= (cost.X ?? 0);
}

/** CR 107.4f — resolve the mana-vs-life split for a cost's Phyrexian pips. Each
 *  `{C/P}` pip is paid with either one `{C}` mana or 2 life; this returns the
 *  AFFORDABLE split that pays the MOST pips with life (hence the fewest with
 *  mana — the split with the smallest mana demand, so it is the one most likely
 *  to be castable, and it surfaces the signature "pay 2 life" line). Returns
 *  `null` when NO split is affordable (life can't cover the pips it must pay and
 *  mana can't cover the rest) — i.e. the spell is not castable. `chosenX` folds
 *  a variable `{X}` into the base cost before the pips are added. The pip counts
 *  are tiny (≤ a handful), so the split space is enumerated exhaustively. */
export function solvePhyrexianSplit(
    player: PlayerState,
    card: CardInstanceState,
    rawCost: ManaCost,
    chosenX?: number
): { lifePips: number; manaAdditions: Partial<Record<Color, number>> } | null {
    const totalPips = phyrexianPipCount(rawCost);
    if (totalPips === 0) return { lifePips: 0, manaAdditions: {} };
    // Base fixed mana — `normalizeManaCost` deliberately excludes the Phyrexian
    // pips, so this is the cost BEFORE any pip is folded into a colored pip.
    const baseCost = normalizeManaCost(rawCost, { chosenX: chosenX ?? 0 });
    const maxLifePips = Math.floor(player.life / PHYREXIAN_LIFE_PER_PIP);
    const phy = rawCost.phyrexian ?? {};
    const colorsPresent = MANA_COLORS.filter((c) => (phy[c] ?? 0) > 0);
    let best: {
        lifePips: number;
        manaAdditions: Partial<Record<Color, number>>;
    } | null = null;
    // Enumerate every choice of "how many pips of each colour are paid with
    // mana"; the rest are paid with life. Keep the affordable split with the
    // most life pips (fewest mana pips).
    const rec = (
        idx: number,
        manaAdditions: Partial<Record<Color, number>>,
        manaPips: number
    ): void => {
        if (idx === colorsPresent.length) {
            const lifePips = totalPips - manaPips;
            // CR 119.4 — a life payment is legal only if life covers it.
            if (lifePips < 0 || lifePips > maxLifePips) return;
            const cost: Record<string, number> = { ...baseCost };
            for (const [c, n] of Object.entries(manaAdditions)) {
                if (n && n > 0) cost[c] = (cost[c] ?? 0) + n;
            }
            if (!canPayNormalizedCost(player, card, cost)) return;
            if (!best || lifePips > best.lifePips) {
                best = { lifePips, manaAdditions: { ...manaAdditions } };
            }
            return;
        }
        const c = colorsPresent[idx];
        const cnt = phy[c] ?? 0;
        for (let m = 0; m <= cnt; m++) {
            // Keep the accumulator clean of zero-count keys so the returned
            // split's `manaAdditions` only lists colours actually paid by mana.
            if (m > 0) manaAdditions[c] = m;
            else delete manaAdditions[c];
            rec(idx + 1, manaAdditions, manaPips + m);
        }
        delete manaAdditions[c];
    };
    rec(0, {}, 0);
    return best;
}

/** CR 107.4f — the DISTINCT life-payment amounts (as a pip count) the caster can
 *  currently afford for this Phyrexian cost: every `lifePips` value in
 *  `[0, totalPips]` for which SOME colour-assignment of the remaining
 *  mana-paid pips is payable AND life covers the `2 × lifePips` (CR 119.4).
 *  Sorted ascending. `[]` for a non-Phyrexian cost or an uncastable one; a
 *  SINGLE value = a degenerate zero-branch choice (only mana, or only life, is
 *  viable) → no prompt; TWO OR MORE = a real mana-vs-life choice the human must
 *  make. Used by the projection to surface the split picker only when the branch
 *  is real (mirrors `solvePhyrexianSplit`, which returns the single best split
 *  the engine auto-resolves to when the caster does not choose). */
export function phyrexianLifePipOptions(
    player: PlayerState,
    card: CardInstanceState,
    rawCost: ManaCost,
    chosenX?: number
): number[] {
    const totalPips = phyrexianPipCount(rawCost);
    if (totalPips === 0) return [];
    const baseCost = normalizeManaCost(rawCost, { chosenX: chosenX ?? 0 });
    const maxLifePips = Math.floor(player.life / PHYREXIAN_LIFE_PER_PIP);
    const phy = rawCost.phyrexian ?? {};
    const colorsPresent = MANA_COLORS.filter((c) => (phy[c] ?? 0) > 0);
    const affordable = new Set<number>();
    const rec = (
        idx: number,
        manaAdditions: Partial<Record<Color, number>>,
        manaPips: number
    ): void => {
        if (idx === colorsPresent.length) {
            const lifePips = totalPips - manaPips;
            if (lifePips < 0 || lifePips > maxLifePips) return;
            const cost: Record<string, number> = { ...baseCost };
            for (const [c, n] of Object.entries(manaAdditions)) {
                if (n && n > 0) cost[c] = (cost[c] ?? 0) + n;
            }
            if (canPayNormalizedCost(player, card, cost)) {
                affordable.add(lifePips);
            }
            return;
        }
        const c = colorsPresent[idx];
        const cnt = phy[c] ?? 0;
        for (let m = 0; m <= cnt; m++) {
            if (m > 0) manaAdditions[c] = m;
            else delete manaAdditions[c];
            rec(idx + 1, manaAdditions, manaPips + m);
        }
        delete manaAdditions[c];
    };
    rec(0, {}, 0);
    return [...affordable].sort((a, b) => a - b);
}

function canPotentiallyPayCost(
    player: PlayerState,
    card: CardInstanceState,
    /** CR 702.34 — when set, affordability is checked against this cost instead
     *  of the card's printed mana cost (a Flashback cast from the graveyard). */
    costOverride?: ManaCost,
    /** CR 601.2f (ADR 0063, issue #1337) — when passed, the printed/override
     *  cost is folded through the SAME `getCostModifiers` +
     *  `applyCostModifiers` the real payment path (`game.ts`) uses before the
     *  affordability check, so a spell's cast-cost REDUCTION (Mana Matrix,
     *  Planar Gate, Emry's self-host `selfCostReduction`) is reflected in the
     *  "cast" legal action instead of gating on the unreduced printed cost.
     *  Optional and only wired at the plain hand-cast branch below — every
     *  other `canPotentiallyPayCost` call site (flashback/escape/madness/
     *  graveyard-permission/alternative-cost) keeps the pre-existing
     *  unreduced-cost gate, unchanged. */
    state?: GameState
): boolean {
    const rawCost = costOverride ?? getInstanceManaCost(card);
    if (!rawCost) return true;
    // CR 107.4f — a cost with Phyrexian pips is castable whenever SOME mana-vs-
    // life split is affordable (each pip: its colour OR 2 life). Delegated to
    // the shared solver so the gate and the payment agree on the split space.
    // Cost modifiers are not folded into the Phyrexian solver (no shipped card
    // combines the two — mirrors game.ts's cast-cost ordering comment).
    if (phyrexianPipCount(rawCost) > 0) {
        return solvePhyrexianSplit(player, card, rawCost) !== null;
    }
    // Cost normalized without chosenX: string-X spells pay only their fixed
    // portion at the minimum (X = 0). User picks X at announcement.
    const cost = normalizeManaCost(rawCost);
    if (state) {
        applyCostModifiers(cost, getCostModifiers(state, card, "spell"));
    }
    const totalRequired =
        (cost.X ?? 0) + MANA_COLORS.reduce((sum, c) => sum + (cost[c] ?? 0), 0);
    if (totalRequired === 0) return true;
    const leftover = coloredCostLeftover(player, card, cost);
    // Remaining sources after the colored portion must cover the generic
    // ({cost.X}) portion.
    return leftover !== null && leftover >= (cost.X ?? 0);
}

/** CR 107.3 — the largest X the player could announce when casting `card` from
 *  hand: the mana left over once the fixed (X = 0) portion of the printed cost
 *  is covered. Returns 0 when the card has no variable {X} in its cost or the
 *  fixed portion is itself unaffordable. Used to widen the X-dependent
 *  target-legality gate ({@link hasEnoughLegalTargets}) so a spell like Dominate
 *  ({X}{1}{U}{U}, "target creature with mana value X or less") is judged
 *  castable whenever ANY reachable X exposes a legal target — not only X = 0.
 *  Cost reductions are not modeled here (mirroring `canPotentiallyPayCost`),
 *  which only ever under-estimates X, never over-offers a cast.
 *
 *  Single source of truth for the X ceiling: the Bot's move enumerator
 *  (`enumerateCastMoves` in moves.ts) consumes THIS function for its `X = 0..N`
 *  range so the human castability gate and the Bot can never disagree on which
 *  X are reachable. `coloredCostLeftover` and `planManaPayment` (moves.ts) are
 *  documented mirrors — the same one-source-one-mana greedy model — so the
 *  per-X `planManaPayment` guard the enumerator still runs only ever filters,
 *  never widens, the range this returns. */
export function maxAffordableX(
    player: PlayerState,
    card: CardInstanceState
): number {
    const rawCost = getInstanceManaCost(card);
    if (!rawCost || typeof rawCost.X !== "string") return 0;
    const cost = normalizeManaCost(rawCost);
    const leftover = coloredCostLeftover(player, card, cost);
    if (leftover === null) return 0;
    return Math.max(0, leftover - (cost.X ?? 0));
}

/** CR 601.2g (`payWith`, ADR 0063) — how many GENERIC pips of `cost` the
 *  caster's MANA alone cannot cover, i.e. the minimum number of chosen
 *  resources (delve exiles) they are FORCED to spend on this cast. Uses the
 *  same greedy one-source-one-mana model as the castability gate, with the
 *  payWith pseudo-sources deliberately EXCLUDED — including them would answer
 *  its own question and always return 0.
 *
 *  Returns `Infinity` when the COLOURED portion itself is uncoverable: delve
 *  never pays a coloured pip (CR 702.66a), so no number of exiles rescues that
 *  cast. `cost` must already carry the CR 601.2f reductions
 *  (`applyCostModifiers`), matching what the announce path parks. */
export function genericManaShortfall(
    player: PlayerState,
    card: CardInstanceState,
    cost: Record<string, number>
): number {
    const leftover = coloredCostLeftover(player, card, cost, {
        payWith: false,
    });
    if (leftover === null) return Infinity;
    return Math.max(0, (cost.X ?? 0) - leftover);
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

// `hasColor`, `resolveMvFilter`, `matchesMvFilter`, `matchesBattlefieldController`
// (ADR 0068 / issue #1408, T1) and `mvOfStackItem`,
// `spellMatchesExcludeTypeFilter`, `spellMatchesCreaturePtFilter`,
// `spellWouldDestroyLandControlledBy` (ADR 0068 / issue #1409, T2) moved to
// `./targetFilters` — imported above and re-exported for backward
// compatibility with existing callers.

/** Returns all legal targets for a spell/ability with the given target
 *  requirement. `sourceColors` are the colors of the casting spell or the
 *  activating permanent (CR 202.2); when provided, protected permanents
 *  (CR 702.16b) are excluded. `casterId` is required when
 *  `requirement.controller` is "you" / "opponent" — the relationship is
 *  resolved relative to the chooser. `chosenX` is required when the
 *  requirement carries a `mvFilter` whose bounds use the `"X"` placeholder
 *  (CR 107.3 / 202.3, e.g. Spell Blast). */

/** Filter fields shared by TargetRequirement and PendingTarget that constrain a
 *  PERMANENT target by its OWN (source-independent) characteristics. Source-
 *  dependent gates — controller relationship (matchesBattlefieldController),
 *  protection-from-color (isProtectedFromColors) and continuous permanent-guard
 *  / hexproof / shroud (isGuardedAgainst) — are NOT here: they need the source's
 *  colors / card-kind / controller and are enforced separately at both sites.
 *  `mvFilter` is assumed already X-resolved by the caller (resolveMvFilter). */
export interface IntrinsicPermanentTargetFilters {
    subtypeFilter?: string | string[];
    supertypeFilter?: string | string[];
    excludeSubtypes?: string | string[];
    excludeSupertypes?: string | string[];
    excludeTypes?: CardType | CardType[];
    excludeColors?: Color | Color[];
    colorFilter?: Color;
    colorFilterAny?: ReadonlyArray<Color>;
    tappedFilter?: "tapped" | "untapped";
    combatRoleFilter?: "attacking" | "blocking" | ("attacking" | "blocking")[];
    requireAbility?: string;
    requireAbilityAny?: ReadonlyArray<string>;
    excludeAbility?: string;
    excludeInstanceIds?: ReadonlyArray<string>;
    powerFilter?: { min?: number; max?: number };
    toughnessFilter?: { min?: number; max?: number };
    mvFilter?: { min?: number; max?: number; equals?: number };
}

/** THE single authority on whether a permanent passes a target requirement's
 *  intrinsic filters (CR 109.1 / 115 / 202 / 205 / 613 / 701.20). Returns
 *  `null` when the permanent is a legal target, else a short human-readable
 *  reason. BOTH `getLegalTargets` (the offered set) and the `selectTarget`
 *  mutation (the accepted set — the authoritative anti-spoof gate) route every
 *  permanent candidate through this, so the two sets can never diverge. This
 *  closes the Phelia bug class: a filter honored by one site but silently
 *  dropped by the other (letting the client offer — and the server accept — a
 *  permanent the offered set excluded).
 *
 *  ADR 0068 / issue #1408 (T1) — a thin wrapper over the target-filter
 *  registry (`targetFilters.ts`): builds the `IntrinsicPermanentTargetFilters`
 *  input into the registry's `PermanentFilterValues` shape (normalizing the
 *  `string | string[]` shorthand fields the same way `pendingTargetFiltersFromRequirement`
 *  does) and runs `checkPermanentTargetFilters`. `controller` is intentionally
 *  absent from `f` (this predicate never took it) and from the values passed
 *  through, so its registry entry is always skipped here — unchanged behavior
 *  from before this refactor. The registry is now the ONE implementation;
 *  adding a new intrinsic filter means adding a registry entry, which wires
 *  both `getLegalTargets` and `selectTarget` at once (still has to be carried
 *  across the async choice by `pendingTargetFiltersFromRequirement`). */
export function intrinsicPermanentTargetViolation(
    state: GameState,
    card: CardInstanceState,
    f: IntrinsicPermanentTargetFilters
): string | null {
    const arr = <T>(v: T | T[] | undefined): T[] | undefined =>
        v === undefined ? undefined : Array.isArray(v) ? v : [v];
    const ctx: TargetFilterCtx = {
        state,
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        activePlayerId: state.activePlayerId,
    };
    const values: PermanentFilterValues = {
        subtypeFilter: arr(f.subtypeFilter),
        supertypeFilter: arr(f.supertypeFilter),
        excludeSubtypes: arr(f.excludeSubtypes),
        excludeSupertypes: arr(f.excludeSupertypes),
        excludeTypes: arr(f.excludeTypes),
        excludeColors: arr(f.excludeColors),
        colorFilter: f.colorFilter,
        colorFilterAny: f.colorFilterAny,
        tappedFilter: f.tappedFilter,
        combatRoleFilter: f.combatRoleFilter,
        requireAbility: f.requireAbility,
        requireAbilityAny:
            f.requireAbilityAny && f.requireAbilityAny.length > 0
                ? f.requireAbilityAny
                : undefined,
        excludeAbility: f.excludeAbility,
        excludeInstanceIds:
            f.excludeInstanceIds && f.excludeInstanceIds.length > 0
                ? f.excludeInstanceIds
                : undefined,
        powerFilter: f.powerFilter,
        toughnessFilter: f.toughnessFilter,
        mvFilter: f.mvFilter,
    };
    return checkPermanentTargetFilters(ctx, card, values);
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
    sourceIsSpell?: boolean,
    /** CR 601.2c (issue #1104) — targets already chosen under THIS SAME
     *  requirement, for a `sameController`-constrained multi-count pick
     *  (Barrin's Spite). Every existing call site scans for the WHOLE legal
     *  set up front (nothing chosen yet), so this defaults to empty — a
     *  `sameController` constraint then imposes no restriction on the
     *  offered set (correct: the FIRST pick of the pair is unconstrained by
     *  itself). Threaded through so a future incremental-pick caller (or a
     *  bot enumerator) CAN narrow the offered set to the sibling's
     *  controller once one half is chosen. */
    alreadySelected: readonly TargetSelection[] = []
): TargetSelection[] {
    const targets: TargetSelection[] = [];

    // CR 601.2c same-controller cross-slot constraint (issue #1104) — the
    // sibling's live controllerId, if one applies (see `siblingControllerIdFor`
    // doc). Computed ONCE, not per-candidate.
    const siblingControllerId = siblingControllerIdFor(
        state,
        requirement.sameController,
        alreadySelected
    );

    const reqTypes = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];

    // CR 400.7 / 109.2: graveyard-zone target (Regrowth, etc.). Handled in a
    // dedicated branch — graveyard cards aren't permanents, so battlefield
    // filters (color/protection/tap-state) don't apply. CR 109.3 / 102.1 /
    // 202.3 — the CARD-kind filters (`controller` — the graveyard's OWNER,
    // not `card.controllerId` — and `mvFilter`), routed through the SINGLE
    // shared authority — the target-filter registry (ADR 0068 / issue
    // #1410, T3). The `selectTarget` mutation runs the SAME
    // `checkCardTargetFilters` against the submitted target, so the offered
    // set and the accepted set can't diverge — the card-flavored half of the
    // Phelia bug class (this also fixes a real latent gap: the pre-T3
    // `selectTarget` graveyard-card branch never implemented
    // `controller: "active"` at all). The CardType filter itself (`type` /
    // `cardTypes` below) is STRUCTURAL (ADR 0068's `StructuralKey`), not a
    // registry filter.
    if (requirement.zone === "graveyard") {
        const wantsAnyCard = reqTypes.includes("card");
        const cardTypes = reqTypes.filter(
            (t) =>
                t !== "player" && t !== "any" && t !== "spell" && t !== "card"
        );
        const cardValues = lowerCardFilters(requirement, chosenX);
        const cardFilterCtx: TargetFilterCtx = {
            state,
            sourceColors,
            sourceTypes,
            sourceSubtypes,
            chooserId: casterId,
            activePlayerId: state.activePlayerId,
            sourceIsSpell,
        };
        for (const player of state.players) {
            for (const card of player.graveyard) {
                if (
                    !wantsAnyCard &&
                    !cardTypes.some((t) => card.types.includes(t as never))
                ) {
                    continue;
                }
                if (checkCardTargetFilters(cardFilterCtx, card, cardValues)) {
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
                // CR 109.1 / 115 / 202 / 205 / 613 / 701.20 / 109.3 / 102.1 —
                // every permanent-kind filter (including `controller`),
                // routed through the SINGLE shared authority — the
                // target-filter registry (ADR 0068 / issue #1408). The
                // selectTarget mutation runs the SAME `checkPermanentTargetFilters`
                // against the submitted target, so the offered set and the
                // accepted set can't diverge (the Phelia bug class).
                // `controller` is ALSO re-checked here per-candidate (redundant
                // with the per-player `matchesBattlefieldController` gate
                // above, kept for its early-continue efficiency) — both run
                // the exact same predicate, so this can never disagree.
                // Source-DEPENDENT gates (protection / guard) stay below —
                // they need the source's colors/kind, not a requirement field.
                const filterCtx: TargetFilterCtx = {
                    state,
                    sourceColors,
                    sourceTypes,
                    sourceSubtypes,
                    chooserId: casterId,
                    activePlayerId: state.activePlayerId,
                    sourceIsSpell,
                    siblingControllerId,
                };
                if (
                    checkPermanentTargetFilters(filterCtx, card, {
                        controller: requirement.controller,
                        subtypeFilter,
                        supertypeFilter,
                        excludeSupertypes,
                        excludeTypes,
                        excludeColors,
                        excludeSubtypes,
                        colorFilter,
                        colorFilterAny,
                        tappedFilter,
                        combatRoleFilter,
                        requireAbility: requirement.requireAbility,
                        requireAbilityAny: requirement.requireAbilityAny,
                        excludeAbility: requirement.excludeAbility,
                        excludeInstanceIds: requirement.excludeInstanceIds,
                        powerFilter,
                        toughnessFilter,
                        mvFilter,
                        sameController: requirement.sameController,
                    })
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
                // CR 702.11b — a hexproof permanent is barred on the same path
                // for opponent-controlled sources only (own caster still legal).
                if (
                    isGuardedAgainst(state, card, "cantBeTargeted", {
                        types: sourceTypes,
                        subtypes: sourceSubtypes,
                        isSpell: sourceIsSpell,
                        // CR 702.11b — the source's controller, so hexproof bars
                        // only an opponent-controlled source (the caster).
                        controllerId: casterId,
                    })
                )
                    continue;
                targets.push({ type: "permanent", id: card.id });
            }
        }
    }

    // Players have no color, so colorFilter / colorFilterAny excludes them.
    // CR 109.3 / 102.1 / 506.2 — every PLAYER-kind filter (`controller` —
    // Word of Command's "target opponent" — and `playerAttackedThisTurn` —
    // Fire and Brimstone), routed through the SINGLE shared authority — the
    // target-filter registry (ADR 0068 / issue #1410, T3). The `selectTarget`
    // mutation runs the SAME `checkPlayerTargetFilters` against the
    // submitted target, so the offered set and the accepted set can't
    // diverge — the player-flavored half of the Phelia bug class.
    if (
        (wantsAny || reqTypes.includes("player")) &&
        !colorFilter &&
        !colorFilterAny
    ) {
        const playerValues = lowerPlayerFilters(requirement, chosenX);
        const playerFilterCtx: TargetFilterCtx = {
            state,
            sourceColors,
            sourceTypes,
            sourceSubtypes,
            chooserId: casterId,
            activePlayerId: state.activePlayerId,
            sourceIsSpell,
        };
        for (const player of state.players) {
            if (
                checkPlayerTargetFilters(playerFilterCtx, player, playerValues)
            ) {
                continue;
            }
            // CR 702.18 (applied to a player via CR 115.4) — a shrouded
            // player "can't be the target of spells or abilities". Unlike
            // hexproof/Guardian-Beast-style permanent guards, shroud has no
            // source-controller exception, so no `actionSource` is threaded.
            // Always-on gate (ADR 0068) — stays outside the registry.
            if (playerHasShroud(state, player.id)) continue;
            targets.push({ type: "player", id: player.id });
        }
    }

    // CR 114.1: any spell or ability currently on the stack is a legal target
    // (The casting spell itself isn't on the stack yet during target selection.)
    // CR 113 / 114.1 / 202.2 / 202.3 / 208.2 / 601.2c / 701.7 / 702 — every
    // spell-kind filter (spellStackKind, controller, stackSourceTypeFilter,
    // spellTargetsInstanceIds, colorFilter, mvFilter, spellTypeFilter,
    // spellExcludeTypeFilter, spellCreaturePtFilter,
    // spellSingleTargetingController, spellWouldDestroyLandYouControl),
    // routed through the SINGLE shared authority — the target-filter registry
    // (ADR 0068 / issue #1409, T2). The selectTarget mutation runs the SAME
    // `checkSpellTargetFilters` against the submitted target, so the offered
    // set and the accepted set can't diverge (the spell-flavored half of the
    // Phelia bug class).
    if (wantsSpell) {
        const spellValues = lowerSpellFilters(requirement, chosenX);
        const spellFilterCtx: TargetFilterCtx = {
            state,
            sourceColors,
            sourceTypes,
            sourceSubtypes,
            chooserId: casterId,
            activePlayerId: state.activePlayerId,
            sourceIsSpell,
        };
        for (const item of state.stack) {
            if (checkSpellTargetFilters(spellFilterCtx, item, spellValues)) {
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
    kind: "cast" | "ability" | "copy-retarget" | "retarget" | "trigger"
): Color[] {
    if (kind === "copy-retarget" || kind === "retarget" || kind === "trigger") {
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
    kind: "cast" | "ability" | "copy-retarget" | "retarget" | "trigger"
): CardType[] {
    if (kind === "copy-retarget" || kind === "retarget" || kind === "trigger") {
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
    kind: "cast" | "ability" | "copy-retarget" | "retarget" | "trigger"
): string[] {
    if (kind === "copy-retarget" || kind === "retarget" || kind === "trigger") {
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

// ─── Targeted triggered abilities (CR 603.3d, issue #1193) ──────────────────

/** The requirement-derived target FILTER fields, as a partial `PendingTarget`
 *  carrying ONLY the fields the requirement sets. Single source of truth for
 *  BOTH the cast/ability target builders in `game.ts` AND the trigger-target
 *  path below — kept here (gre) so the two can never drift and the gre layer
 *  can build a `PendingTarget` without importing `game.ts`.
 *
 *  Only requirement-derived filters live here; count/target-type/selected and
 *  the divide-as-you-choose bookkeeping are owned by each caller. */
export function pendingTargetFiltersFromRequirement(
    req: TargetRequirement,
    chosenX: number | undefined
): Partial<PendingTarget> {
    // ADR 0068 — every PERMANENT-kind filter (plus `controller`, issue
    // #1408 T1), every SPELL-kind filter (issue #1409 T2), and every
    // PLAYER/CARD-kind filter (issue #1410 T3) is now lowered through the
    // registry's `lower()`, the SAME resolution `getLegalTargets` and
    // `selectTarget` run against. This is the "lower once" half of "lower
    // once, check everywhere": a filter's carry can no longer drift from its
    // offered/accepted semantics because there is only one implementation of
    // `lower` to call. `lowerSpellFilters` / `lowerPlayerFilters` /
    // `lowerCardFilters` also lower the cross-kind fields (`controller` /
    // `colorFilter` / `colorFilterAny` / `mvFilter`, already produced by
    // `lowerPermanentFilters`) — spread again, same values, no conflict.
    const out: Partial<PendingTarget> = {
        ...(lowerPermanentFilters(req, chosenX) as Partial<PendingTarget>),
    };
    // Fixup (T2 review, issue #1409): `lowerSpellFilters` always resolves
    // `spellStackKind` to its explicit default `"spell"` (never
    // `undefined` — see the descriptor's doc comment), so spreading it
    // unconditionally used to stamp `spellStackKind: "spell"` onto EVERY
    // `PendingTarget`, including permanent/player-only requirements that
    // never target a spell. Only carry the spell-lowered fields when the
    // requirement actually admits a spell target.
    const reqTypes = Array.isArray(req.type) ? req.type : [req.type];
    if (reqTypes.includes("spell") || reqTypes.includes("spell-or-permanent")) {
        Object.assign(
            out,
            lowerSpellFilters(req, chosenX) as Partial<PendingTarget>
        );
    }
    // T3 (issue #1410): analogous guard for the PLAYER-only lowered field
    // (`playerAttackedThisTurn`) — only carried when the requirement
    // actually admits a player target ("player" or "any", CR 115.4).
    if (reqTypes.includes("player") || reqTypes.includes("any")) {
        Object.assign(
            out,
            lowerPlayerFilters(req, chosenX) as Partial<PendingTarget>
        );
    }
    // T3 (issue #1410): the CARD-kind lowered fields (`controller` /
    // `mvFilter` — both already carried above; kept for the registry's
    // "single lower call per kind" shape) only apply to a graveyard-zone
    // requirement (CR 400.7 — the only zone a `TargetRequirement` currently
    // supports besides the battlefield default).
    if (req.zone === "graveyard") {
        Object.assign(
            out,
            lowerCardFilters(req, chosenX) as Partial<PendingTarget>
        );
    }
    if (req.zone) out.zone = req.zone;
    return out;
}

/** Resolve a trigger requirement's `count` to a concrete {min, max}. Triggers
 *  do not carry X, so `"X"` collapses to none (0). An "up to" requirement
 *  without an explicit `max` is treated as unbounded. */
function triggerTargetMinMax(count: TargetRequirement["count"]): {
    min: number;
    max: number;
} {
    if (typeof count === "number") return { min: count, max: count };
    if (count === "X") return { min: 0, max: 0 };
    return { min: count.min, max: count.max ?? Number.MAX_SAFE_INTEGER };
}

/** CR 603.3d / 603.3c (issue #1193) — lock announcement-time targets for any
 *  TARGETED triggered ability now on the stack. Scans the stack top-down; for
 *  the first not-yet-targeted targeted trigger it either:
 *   - drops a REQUIRED-target trigger with no legal target (CR 603.3c — it is
 *     removed from the stack and does nothing), then keeps scanning;
 *   - locks an empty target set on an "up to" (min 0) trigger with no legal
 *     target (it stays on the stack, resolves as a no-op);
 *   - auto-selects the lone target of a mandatory single-target trigger (no
 *     real choice, no divide);
 *   - otherwise raises a `kind:"trigger"` `PendingTarget` for the controller —
 *     the SAME machinery a spell/activated ability uses — and returns `true`
 *     (suspended; priority parked on the chooser).
 *  Returns `false` when no further target choice is owed (callers resume the
 *  normal priority flow). Divide-as-you-choose (Fury) rides on `divideTotal`;
 *  the per-target amounts are assigned through the existing divide UI and
 *  written onto the trigger's `targetAmounts` at `finalizeTargetSelection`. */
export function raiseTriggerTargetSelection(state: GameState): boolean {
    for (let i = state.stack.length - 1; i >= 0; i--) {
        const item: StackItem = state.stack[i];
        // Already-targeted (or engine-locked to []) and non-targeted triggers
        // are skipped; only a trigger with an un-set target slot is a candidate.
        if (item.targets !== undefined) continue;
        // CR 603.3c/603.3d — a REFLEXIVE triggered ability has no card-def
        // ability row to read a `targetRequirement` from; its requirement
        // rides on the stack item itself (`reflexiveTrigger` Op). Everything
        // downstream — legality, auto-select, the `kind:"trigger"`
        // PendingTarget — is the same path a card-def trigger takes.
        const req: TargetRequirement | undefined = item.inlineTargetRequirement
            ? item.inlineTargetRequirement
            : item.triggeredAbilityId
              ? findTriggeredAbility(item, item.triggeredAbilityId)
                    ?.targetRequirement
              : undefined;
        if (!req) continue;

        // CR 702.21a (Ward) — a reflexive requirement resolves its own
        // instance filter dynamically instead of from static card data:
        // `spellTargetsSelfSource` pins `spellTargetsInstanceIds` to THIS
        // trigger's own source permanent (`triggerSourceId`, set by
        // `buildTriggerItem` to the permanent carrying the ability), so
        // "counter that spell or ability" resolves to whatever is CURRENTLY
        // on the stack targeting this permanent — reusing the Mistfolk
        // instance filter rather than a parallel event→stack-item mechanism.
        let effectiveReq: TargetRequirement =
            req.spellTargetsSelfSource && item.triggerSourceId
                ? { ...req, spellTargetsInstanceIds: [item.triggerSourceId] }
                : req;
        // Reflexive self-EXCLUDE (inverse of `spellTargetsSelfSource`) — an
        // "exile ANOTHER target permanent" / "up to one OTHER target ~" trigger
        // cannot pick its own source permanent. Merge the source id into any
        // author-time `excludeInstanceIds` (CR 603.3d).
        if (effectiveReq.excludeSource && item.triggerSourceId) {
            effectiveReq = {
                ...effectiveReq,
                excludeInstanceIds: [
                    ...(effectiveReq.excludeInstanceIds ?? []),
                    item.triggerSourceId,
                ],
            };
        }

        // A triggered ability's source characteristics come from the on-stack
        // trigger item (a `...self` snapshot of the source), read the same way
        // a retargeted spell reads its stack item (CR 109.5).
        const sourceColors = getPendingTargetSourceColors(
            state,
            item.id,
            "retarget"
        );
        const sourceTypes = getPendingTargetSourceTypes(
            state,
            item.id,
            "retarget"
        );
        const sourceSubtypes = getPendingTargetSourceSubtypes(
            state,
            item.id,
            "retarget"
        );
        // CR 113.3 — a triggered ability is not a spell.
        const legal = getLegalTargets(
            state,
            effectiveReq,
            sourceColors,
            item.controllerId,
            undefined,
            sourceTypes,
            sourceSubtypes,
            false
        );

        // CR 702.21e (issue #1361) — when TWO+ spells/abilities simultaneously
        // target the same warded permanent, `legal` above (filtered only by
        // "targets THIS permanent") holds every one of them: ambiguous, no
        // single-legal-target auto-select. But THIS trigger instance already
        // knows exactly which one caused it — `item.triggerEvent` is the
        // BECAME_TARGET event that fired it (`buildTriggerItem`), and that
        // event now carries `sourceInstanceId`, the causing stack item's OWN
        // id (issue #1361, `emitBecameTargetEvents`). Narrow `legal` down to
        // that exact object when it's present among the candidates — it always
        // is, since it is what caused this very trigger — so ward forces the
        // precise triggering object instead of falling back to a player
        // choice. Left broad (defensive fallback, never expected to trigger)
        // when the causing event is absent or the pin misses.
        let effectiveLegal = legal;
        if (req.spellTargetsSelfSource) {
            const causingEvent = item.triggerEvent;
            const pinnedInstanceId =
                causingEvent?.type === "BECAME_TARGET"
                    ? causingEvent.sourceInstanceId
                    : undefined;
            if (pinnedInstanceId) {
                const pinned = legal.filter(
                    (t) => t.type === "spell" && t.id === pinnedInstanceId
                );
                if (pinned.length > 0) effectiveLegal = pinned;
            }
        }

        const { min, max } = triggerTargetMinMax(req.count);

        if (effectiveLegal.length < min) {
            // CR 603.3c — required target(s), none legal: remove from the stack.
            if (min > 0) {
                state.stack.splice(i, 1);
                continue;
            }
        }
        if (min === 0 && effectiveLegal.length === 0) {
            // "Up to" with nothing legal — stays on the stack, no target.
            item.targets = [];
            continue;
        }
        if (
            min === 1 &&
            max === 1 &&
            effectiveLegal.length === 1 &&
            !req.divideAsChosen
        ) {
            // Sole mandatory target auto-selects (no real choice). CR 603.3d.
            item.targets = [effectiveLegal[0]];
            // CR 603.2b (issue #1265) — even an auto-selected targeted trigger
            // locks a target, so it fires "becomes the target of an ability"
            // triggers (Leovold). Queued for the next event drain.
            emitBecameTargetEvents(
                state,
                item.targets,
                item.controllerId,
                item.id
            );
            continue;
        }

        // A real choice is owed — raise the same PendingTarget the spell path
        // uses, pointed at this on-stack trigger item (kind: "trigger").
        const divideTotal =
            req.divideAsChosen && typeof req.divideAsChosen.total === "number"
                ? req.divideAsChosen.total
                : undefined;
        const count: PendingTarget["count"] =
            typeof req.count === "number"
                ? req.count
                : req.count === "X"
                  ? { min: 0, max: 0 }
                  : { min: req.count.min, max: req.count.max ?? max };
        state.pendingTarget = {
            playerId: item.controllerId,
            cardInstanceId: item.id,
            kind: "trigger",
            targetType: req.type,
            count,
            selected: [],
            // `effectiveReq` (not the static `req`) so a real-choice fallback
            // for a `spellTargetsSelfSource` requirement (Ward) still carries
            // the resolved instance filter, not an empty static list.
            ...pendingTargetFiltersFromRequirement(effectiveReq, undefined),
            ...(divideTotal !== undefined ? { divideTotal } : {}),
        };
        state.priorityPlayerId = item.controllerId;
        state.passCount = 0;
        return true;
    }
    return false;
}
