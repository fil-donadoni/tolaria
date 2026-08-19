import type {
    AbilityMode,
    CardDefinition,
    CardSupertype,
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
import { computeExpectedInput } from "./expectedInput";
import { isSorceryTiming, isSorceryTimingFor } from "./phases";
import {
    CASTABLE_PERMANENT_TYPES,
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_DROPS_PER_TURN,
    MANA_COLORS,
    PLACEHOLDER_CARD_ID,
    abilitiesSuppressed,
    getManaTapOptionsDetailed,
    hasInstantSpeed,
    isTapLockedBySummoningSickness,
    manaGateBattlefields,
    manaValue,
    pendingSourceIsSpell,
    resolvePendingTargetKind,
} from "./constants";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { STATIC_EFFECT_CTX, getEffectivePower } from "./layers";
import {
    isProtectedFrom,
    playerHasProtectionFromEverything,
    protectionSourceCharacteristics,
    type ProtectionSourceView,
} from "./protection";
import { isGuardedAgainst, playerHasShroud } from "./permanentGuard";
import {
    castProhibitionReason,
    isCastTimingSorcerySpeedLocked,
    hasCastTimingFlashGrant,
    hasCardSelfFlashPermission,
} from "../cards/castRestrictions";
import { tapManaBonusUnits } from "./tapManaBonus";
import { PHYREXIAN_LIFE_PER_PIP, phyrexianPipCount } from "./phyrexian";
import { matchesPermanentFilter } from "../cards/filters";
import { getInstanceManaCost, tryGetDefinition } from "../cards";
import { isExileCostEligible } from "../cards/exileCostEligibility";
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
import {
    convokeEligibleCreatures,
    coverColoredAndHybridPips,
    creatureConvokeColors,
    delveEligibleCards,
    spellHasConvoke,
    spellHasDelve,
} from "./payWith";
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
    isAlreadySelectedTarget,
    requirementAdmitsSpellTarget,
    type TargetFilterCtx,
    type PermanentFilterValues,
} from "./targetFilters";

export {
    getProtectedColors,
    getProtectionQualities,
    isProtectedFrom,
    isProtectedFromSource,
    isProtectionAbility,
    parseProtectionFromColor,
    parseProtectionQuality,
    playerHasProtectionFromEverything,
    protectionSourceCharacteristics,
    protectionSourceView,
    type ProtectionSourceView,
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
    pickCardFilterValues,
    spellMatchesExcludeTypeFilter,
    spellMatchesCreaturePtFilter,
    spellWouldDestroyLandControlledBy,
    siblingControllerIdFor,
    isAlreadySelectedTarget,
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

/** Whether `player` currently holds an unconditional, player-wide permission
 *  to play lands from the TOP of their own library (CR 305.1 special action /
 *  601.3e-analog), granted by ANY permanent declaring
 *  `playsLandsFromTopOfLibrary` on their battlefield (Courser of Kruphix).
 *  Read live from the battlefield (mirrors `canPlayLandsFromGraveyard`), so
 *  the permission ends the instant the granting source leaves play — no stale
 *  flag.
 *
 *  Independent of the CR 401.5 top-card REVEAL (`revealsLibraryTop`): the
 *  permission is about legality, the reveal about information. See
 *  `CardDefinition.playsLandsFromTopOfLibrary`. */
export function canPlayLandsFromTopOfLibrary(
    _state: GameState,
    player: PlayerState
): boolean {
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
        if (def?.playsLandsFromTopOfLibrary) return true;
    }
    return false;
}

/** Whether `cardInstanceId` is the LAND on top of `player`'s own library while
 *  `player` holds the play-from-top permission (CR 305.1-analog). The position
 *  check is strict — index 0 only — because the permission names the TOP card,
 *  and the library is otherwise a hidden zone (CR 400.2): a land two deep is
 *  never a legal play source, even under the permission. Recomputed from the
 *  live library on every call, so a draw / shuffle / mill / put-on-top moves
 *  the affordance with the position and never leaves it pointing at a card
 *  that is no longer on top. */
export function isPlayableLibraryTopLand(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): boolean {
    if (!canPlayLandsFromTopOfLibrary(state, player)) return false;
    const top = player.library[0];
    return (
        top !== undefined &&
        top.id === cardInstanceId &&
        top.types.includes("Land")
    );
}

/** CR 601.3e-analog — the SPELL twin of {@link canPlayLandsFromTopOfLibrary}:
 *  the unconditional, player-wide permission to CAST nonland spells from the
 *  top of `player`'s own library, granted by ANY permanent declaring
 *  `castsSpellsFromTopOfLibrary` on their battlefield (Bolas's Citadel).
 *  Returns the GRANT (so its `manaCostReplacement` reaches the cost sites),
 *  or `undefined` when no source grants it.
 *
 *  Read live from the battlefield every call, so the permission ends the
 *  instant the granting source leaves play — no stale flag. When two sources
 *  grant it, the FIRST scanned wins; no printed card pairs two different
 *  replacements, and CR 601.2f would make the caster choose among them, which
 *  is a choice no shipped board can present. */
export function canCastSpellsFromTopOfLibrary(
    _state: GameState,
    player: PlayerState
): NonNullable<CardDefinition["castsSpellsFromTopOfLibrary"]> | undefined {
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const grant = tryGetDefinition(cardId)?.castsSpellsFromTopOfLibrary;
        if (grant) return grant;
    }
    return undefined;
}

/** Whether `cardInstanceId` is the NONLAND card on top of `player`'s own
 *  library while `player` holds the cast-from-top permission (CR 601.3e-analog
 *  — Bolas's Citadel). The mirror of {@link isPlayableLibraryTopLand} for the
 *  cast half, and position-strict for the same reason: the permission names
 *  the TOP card, and the library is otherwise a hidden zone (CR 400.2), so a
 *  card two deep is never a legal cast source. Lands are excluded — a land is
 *  PLAYED, never cast (CR 305.9), and the land half of the same Oracle
 *  sentence rides `playsLandsFromTopOfLibrary` instead. Recomputed from the
 *  live library on every call, so a draw / shuffle / mill / put-on-top moves
 *  the affordance with the position. */
export function isCastableLibraryTopSpell(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): boolean {
    if (!canCastSpellsFromTopOfLibrary(state, player)) return false;
    const top = player.library[0];
    return (
        top !== undefined &&
        top.id === cardInstanceId &&
        !top.types.includes("Land")
    );
}

/** CR 118.9-analog / 119.4 / 107.3b — the LIFE a cast from the top of the
 *  library pays INSTEAD of its mana cost, under a permission whose
 *  `manaCostReplacement` is `"life-equal-to-mana-value"` (Bolas's Citadel).
 *  `0` when the permission carries no replacement (the spell then pays its
 *  normal printed cost) or when there is no permission at all.
 *
 *  The amount is the card's mana value as computed OFF the stack, so an `{X}`
 *  counts as 0 (CR 107.3b — the only legal choice for X is 0 when an effect
 *  lets a player cast a spell paying neither its mana cost nor an alternative
 *  cost containing X). The SINGLE authority for this number: the legality
 *  gate, the wire affordance, the bot's enumerator and the three commit sites
 *  in `convex/game.ts` all read it here, so none of them can charge a
 *  different amount than another. */
export function libraryTopCastLifeCost(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): number {
    const grant = canCastSpellsFromTopOfLibrary(state, player);
    if (grant?.manaCostReplacement !== "life-equal-to-mana-value") return 0;
    return manaValue(getInstanceManaCost(card));
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
 *   - else `casterId`'s OWN sorcery window is required (CR 307.1).
 *
 *  The SHARED cast-timing authority (issue #1690): the GRE (`getLegalActions`,
 *  every cast branch below), the cast mutation (`announceCast` →
 *  `assertLegalAction` → `getLegalActions`) and the client cast gate (the
 *  projected `legalActions` a hand card renders from) all resolve a spell's
 *  timing through this one function, so the three can never disagree.
 *
 *  Both sorcery legs ask `isSorceryTimingFor(state, casterId)` — the
 *  CASTER-AWARE window — never the player-agnostic `isSorceryTiming(state)`.
 *  The latter answers "is the turn in ITS ACTIVE player's sorcery window",
 *  which for any other caster is an answer about a different player: it reports
 *  a window to the NON-ACTIVE player throughout the opponent's main phases, so
 *  a plain Sorcery read as castable during the opponent's turn with no flash
 *  grant in the state at all (issue #1690 — the "Teferi grants flash timing
 *  without the +1" symptom, which is really "the timing predicate lost the
 *  caster").
 *
 *  No production path ever reached that: `isSorceryTiming` itself requires
 *  `priorityPlayerId === activePlayerId`, and `getLegalActions` separately
 *  returns early unless `priorityPlayerId === casterId` (~300 lines up). The
 *  two guards COMPOSE to force `casterId === activePlayerId` — i.e. exactly
 *  what `isSorceryTimingFor` now states directly — so the old code was
 *  accidentally correct at every reachable call. It was only wrong when the
 *  helper was called with a caster who is not the priority-holder. The fix is
 *  therefore hardening, not a behaviour change: a helper documented as the
 *  shared timing authority must not depend on two unrelated caller-side
 *  guards to be correct. */
export function castTimingBaseLegal(
    state: GameState,
    casterId: string,
    card: CardInstanceState
): boolean {
    if (isCastTimingSorcerySpeedLocked(casterId, state)) {
        return isSorceryTimingFor(state, casterId);
    }
    if (
        hasInstantSpeed(card) ||
        hasCastTimingFlashGrant(casterId, card, state) ||
        // CR 601.3 / 601.3c — a card-level self-permission, in either of its
        // two declared shapes: the CONDITIONAL surcharge rider ("You may cast
        // this spell as though it had flash if you pay {2} more to cast it",
        // issue #2146) and the UNCONDITIONAL grant ("You may cast this spell as
        // though it had flash", Necromancy, issue #2392). ONE leg for both: CR
        // 601.3c is explicit that the player may BEGIN the surcharged cast
        // before the payment is known, so announcement is legal either way, and
        // the surcharge becomes owed (mandatorily) only once the cast is
        // committed outside the caster's sorcery-speed window — see
        // `flashSurchargeRequired` below, which keys on the DECLARED surcharge
        // and so charges the unconditional grant nothing.
        hasCardSelfFlashPermission(card)
    ) {
        return true;
    }
    return isSorceryTimingFor(state, casterId);
}

/** CR 601.3c — the conditional-flash SURCHARGE `card` declares, or `undefined`.
 *  The single reader of `CardDefinition.flashSurcharge` on the timing side, so
 *  the "is it owed" predicate and the affordability probe can never disagree
 *  about which cost is at stake. */
export function flashSurchargeOf(
    card: CardInstanceState
): ManaCost | undefined {
    const cardId = (card.card as { id?: string }).id;
    return cardId ? tryGetDefinition(cardId)?.flashSurcharge : undefined;
}

/** CR 601.3c / 601.2f — fold the conditional-flash SURCHARGE into a normalized
 *  mana-cost record, mutating it in place, when the cast owes it (`owed`).
 *  No-op when it doesn't, or when the card declares no surcharge
 *  (`surcharge === undefined`). Applied to the total mana cost BEFORE cost
 *  modifiers (CR 601.2f — an additional cost joins the total, then
 *  increases/reductions apply), exactly like `foldKickerCosts` /
 *  `foldBuybackCost` in `convex/game.ts`; a fixed cost with no `*times`
 *  multiplier, since the permission is bought once per cast.
 *
 *  Lives HERE, beside the two predicates, because it has two callers that must
 *  never disagree about the price of a cast (issue #2146 review, finding 1):
 *  `announceCast`/`finalizeTargetSelection` (`convex/game.ts`), which CHARGES
 *  it, and `enumerateSpellMoves` (`moves.ts`), which builds the Bot's tap plan
 *  for the same cast. When only the mutation folded it, the Bot enumerated a
 *  `cast-spell` whose `tapPlan` covered the PRINTED cost, announced it (the
 *  executor announces first and taps afterwards), and then could never cover
 *  the surcharged total — the cast parked in `pendingCast`, `enumerateMoves`
 *  returns `[]` while one is open, and the only exit was the
 *  `abort-announcement` rung: tap N lands for nothing, cancel, re-enumerate
 *  the identical move. */
export function foldFlashSurchargeCost(
    cost: Record<string, number>,
    surcharge: ManaCost | undefined,
    owed: boolean
): void {
    if (!owed || !surcharge) return;
    const per = normalizeManaCost(surcharge);
    for (const [sym, amt] of Object.entries(per)) {
        cost[sym] = (cost[sym] ?? 0) + amt;
    }
}

/** CR 601.3c / 601.2f — does THIS cast owe the card's conditional-flash
 *  surcharge? True exactly when the caster is relying on the CR 601.3c
 *  permission to cast at all, i.e. the cast would be illegal at this moment
 *  without it. Four ways to owe nothing, in the order they are checked:
 *
 *   1. the card declares no surcharge (`CardDefinition.flashSurcharge`);
 *   2. a sorcery-speed LOCK is on the caster (CR 101.2 — a restriction beats
 *      the permission, so the surcharge buys nothing and must not be charged;
 *      `castTimingBaseLegal` has already refused the off-window cast);
 *   3. the spell is castable at instant speed anyway — intrinsically
 *      (CR 304.1 — a player who has priority may cast an instant card from
 *      their hand; CR 702.8 Flash) or under a live player-scoped flash grant
 *      (Teferi's +1) — so the permission is redundant;
 *   4. the caster IS in their own sorcery-speed window (CR 307.1), where the
 *      spell was already castable for its printed cost. This is the
 *      "don't offer a pointless {2}" clause: the surcharge is never payable
 *      for nothing.
 *
 *  Otherwise the surcharge is MANDATORY — CR 601.3c prices the permission, it
 *  does not make it optional once the off-window cast is committed.
 *
 *  WHEN to call it: at ANNOUNCEMENT (CR 601.2a), exactly once, alongside
 *  `wasCastOffSorceryTiming` — never at commit. The value is threaded on
 *  `PendingTarget.flashSurchargePaid` and locked in there (CR 601.2f), which
 *  is also what makes CR 601.6a hold: "once a player has begun casting a
 *  spell that ... could be cast as though it had flash because certain
 *  conditions were met, they may continue to cast that spell as though it had
 *  flash even if those conditions stop being met". A commit-time
 *  re-derivation would both re-price the cast and, per issue #2473, read a
 *  suspended triggered mana ability (CR 605.4a) as "off sorcery timing" and
 *  invent a surcharge on a textbook main-phase cast.
 *
 *  KNOWN BOUNDARY — this predicate is zone-agnostic, but the surcharge is only
 *  PRICED on the caster's own hand: the `extraMana` affordability probe rides
 *  the plain cast branch of `getLegalActions` alone, and the projection
 *  attaches `flashSurchargeRequired` to hand cards alone. A flashback / escape
 *  / madness / graveyard-permission cast of a rider card would therefore be
 *  offered at the unsurcharged price and then charged. Clause 3 is also
 *  incomplete for those zones: a MADNESS cast (CR 702.35a) already happens at
 *  instant speed on its own, so the CR 601.3c permission buys nothing there and
 *  clause 4's "never payable for nothing" reasoning should extend to it. No
 *  shipped card combines the rider with any of those mechanisms, and none can
 *  be tested without a synthetic definition — deliberately left, not missed.
 *  tracked-by: #2505 */
export function flashSurchargeRequired(
    state: GameState,
    casterId: string,
    card: CardInstanceState
): boolean {
    // Keyed on the DECLARED surcharge, not on the broader
    // `hasCardSelfFlashPermission` seam: that predicate answers "may this be
    // announced" and now covers TWO self-permission shapes — the surcharge
    // rider (#2146) and `CardDefinition.castAsThoughFlash`, the UNCONDITIONAL
    // grant (Necromancy, #2392), which owes nothing.
    if (!flashSurchargeOf(card)) return false;
    if (isCastTimingSorcerySpeedLocked(casterId, state)) return false;
    if (
        hasInstantSpeed(card) ||
        hasCastTimingFlashGrant(casterId, card, state)
    ) {
        return false;
    }
    return !isSorceryTimingFor(state, casterId);
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

    // ADR 0047 — holding priority is NOT enough. While the engine is parked on
    // an in-progress cast/activation payment (`pendingCast` /
    // `pendingActivation`, where the payer keeps priority), on target
    // selection, on a mid-resolution choice, or on a combat turn-based action,
    // every hand action is illegal: `announceCast` rejects with "Another spell
    // is already being cast" and `assertExpectedInput` with "the game is
    // waiting for target input". `legalActions` is what every client
    // affordance gates on (`SlimHandCard.legalActions` → the hand card's
    // cast/play buttons AND the mobile swipe-to-cast), so leaving them on
    // through that window kept the gesture armed over an action the server was
    // guaranteed to refuse — a second swipe on mobile surfaced only as a raw
    // "Server Error" (production hides the message of a plain `Error`).
    // Mirrors the same gate the battlefield menu applies client-side
    // (`getActivatable` in `useBattlefieldInteraction`).
    if (state.pendingCast || state.pendingActivation) {
        return actions;
    }
    if (computeExpectedInput(state)?.kind !== "priority") {
        // One exception, and it is the reason this can't be a blanket check:
        // a reflexive Madness / Rebound cast window (CR 702.35a / 702.88a) IS
        // a pending choice, and CASTING the window's own card is how its owner
        // accepts it — `announceCast` consumes that choice before its own
        // Expected-Input gate (`consumeMadnessCastChoice` /
        // `consumeReboundCastChoice`). That single card stays castable for
        // that single player; every other card, and every other pending
        // interaction, is blocked.
        const head = state.pendingChoices?.[0];
        const isOwnCastWindow =
            (head?.kind === "madness-cast" || head?.kind === "rebound-cast") &&
            head.playerId === casterId &&
            head.cardInstanceId === card.id;
        if (!isOwnCastWindow) {
            return actions;
        }
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
        // CR 305.9 (issue #1689) — a land can be played ONLY from hand,
        // unless an effect explicitly says otherwise. This branch must scope
        // itself to a zone plus a permission exactly like every
        // cast-from-elsewhere branch below (flashback/escape/exile-cast
        // scan `player.graveyard`/`player.exile` before granting anything),
        // rather than firing for a bare `types.includes("Land")` regardless
        // of where the card actually lives (the bug: an opponent's-hand
        // land, an unpermissioned graveyard land, or — the reported case —
        // an exiled land under a CAST-ONLY grant like Ragavan's "you may
        // cast that card" all used to render a "play" affordance).
        //   - hand: the normal, unconditional land drop.
        //   - graveyard: only while the player holds the unconditional,
        //     player-wide play-lands-from-graveyard permission (Icetill
        //     Explorer, `canPlayLandsFromGraveyard`).
        //   - exile: only when `casterId` holds the exile-cast grant AND
        //     that grant is explicitly land-inclusive
        //     (`castableFromExileIncludesLand`, set only by a grant whose
        //     Oracle text says "play" — Headliner Scarlett, Expressive
        //     Iteration, Elkin Bottle, Inti, Laelia, Dauthi Voidwalker). A
        //     CAST-only grant (Ice Cauldron, Robber of the Rich, Ragavan)
        //     never sets this flag, so a land under one is correctly
        //     excluded — CR 116.2a, a land can't be cast either. Scanned
        //     across EVERY player's exile (not just `player`'s own): a
        //     CROSS-PLAYER grant (Dauthi Voidwalker's opponent-exile land,
        //     issue #1156's shape) means the card can sit in a DIFFERENT
        //     player's exile than `player`, and `assertLegalAction`'s
        //     mutation-boundary call (`convex/game.ts`) invokes this with
        //     `player` = the CASTER, not necessarily the zone owner, with no
        //     separate `casterId` — mirrors `findCastableExileCard`'s own
        //     all-players scan (`convex/game.ts`).
        //   - library TOP (index 0 only): while the player holds the
        //     unconditional, player-wide play-lands-from-top-of-library
        //     permission (Courser of Kruphix, `isPlayableLibraryTopLand`).
        //     Position-checked, not merely zone-checked — the permission names
        //     the top card, and the rest of the library stays hidden (CR
        //     400.2).
        const isPlayableLandSource =
            player.hand.some((c) => c.id === card.id) ||
            (player.graveyard.some((c) => c.id === card.id) &&
                canPlayLandsFromGraveyard(state, player)) ||
            isPlayableLibraryTopLand(state, player, card.id) ||
            (card.castableFromExileBy === casterId &&
                card.castableFromExileIncludesLand === true &&
                state.players.some((p) =>
                    p.exile.some((c) => c.id === card.id)
                ));
        if (isPlayableLandSource) {
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
            canPotentiallyPayCost(player, card, flashbackMana, state) &&
            hasEnoughLegalTargets(state, player, card) &&
            // CR 702.34a / 118.5 — the flashback-only non-mana cost (sacrifice a
            // matching permanent / exile a matching card from hand) must itself
            // be payable, or the flashback cast can't be announced.
            hasPayableFlashbackAdditionalCost(
                player,
                getFlashbackAdditionalCost(card),
                card.id
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
                getEscapeManaCost(state, card) ?? {},
                state
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
                getInstanceManaCost(card) ?? {},
                state
            ) &&
            hasEnoughLegalTargets(state, player, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 702.51 / 601.3e (issue #1338, Hogaak) — a NON-LAND card in the player's
    // OWN graveyard whose definition declares `castableFromOwnGraveyard` ("You
    // may cast this card from your graveyard") is castable from there for its
    // normal printed cost (paid, for Hogaak, entirely via convoke + delve — the
    // `canPotentiallyPayCost` probe already folds those pseudo-sources in).
    // Reached only when the card has neither Flashback nor Escape (those return
    // above). Mirrors the broad-permission branch above.
    const isIntrinsicGraveyardCast =
        player.graveyard.some((c) => c.id === card.id) &&
        !types.includes("Land") &&
        (tryGetDefinition((card.card as { id?: string }).id ?? "")
            ?.castableFromOwnGraveyard ??
            false);
    if (isIntrinsicGraveyardCast) {
        const baseLegal = castTimingBaseLegal(state, caster.id, card);
        if (
            baseLegal &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(player.id, card, state) === undefined &&
            canPotentiallyPayCost(
                player,
                card,
                getInstanceManaCost(card) ?? {},
                state
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
            canPotentiallyPayCost(caster, card, costOverride, state) &&
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
                getInstanceManaCost(card) ?? {},
                state
            ) &&
            hasEnoughLegalTargets(state, player, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 702.35a — a card in the player's OWN exile that was discarded via
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
            canPotentiallyPayCost(player, card, madnessMana, state) &&
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
            canPotentiallyPayCost(caster, card, {}, state) &&
            hasEnoughLegalTargets(state, caster, card)
        ) {
            actions.push("cast");
        }
        return actions;
    }

    // CR 601.3e-analog / 118.9-analog / 119.4 (issue #2398, Bolas's Citadel) —
    // the NONLAND card on TOP of the player's own library, while the player
    // holds the player-wide cast-from-top permission
    // (`isCastableLibraryTopSpell`, position-strict at index 0: the rest of
    // the library stays hidden, CR 400.2). The land half of the same Oracle
    // sentence is handled by the land branch above
    // (`isPlayableLibraryTopLand`) — CR 305.9, a land is played, never cast.
    // This branch fully owns the "cast" decision for the top card, exactly
    // like the graveyard/exile branches above: same timing / phase / target /
    // prohibition gates, with affordability judged against whatever the
    // permission says the cast pays — life equal to the card's mana value
    // (CR 119.4, `libraryTopCastLifeCost`) when the grant replaces the mana
    // cost, else the printed mana cost.
    const isLibraryTopCast = isCastableLibraryTopSpell(state, player, card.id);
    if (isLibraryTopCast) {
        const lifeCost = libraryTopCastLifeCost(state, player, card);
        const grant = canCastSpellsFromTopOfLibrary(state, player);
        const affordable =
            grant?.manaCostReplacement === "life-equal-to-mana-value"
                ? // CR 119.4 — a player may pay life only while their life
                  // total is at least the amount. Paying down to exactly 0 is
                  // legal (SBAs then end the game); paying below it is not.
                  player.life >= lifeCost
                : canPotentiallyPayCost(
                      player,
                      card,
                      getInstanceManaCost(card) ?? {},
                      state
                  );
        if (
            castTimingBaseLegal(state, player.id, card) &&
            passesCastPhaseRestriction(state, card) &&
            castProhibitionReason(player.id, card, state) === undefined &&
            affordable &&
            hasEnoughLegalTargets(state, player, card)
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
            // even when its printed cost is not). CR 601.2f (ADR 0063) — ONLY
            // the plain branch also folds in cost modifiers/self-host
            // reductions (Emry) via `foldCostModifiers: true`; the alternative-
            // cost branch below passes `state` for the board view alone
            // (issue #1695 fourth-pass fix) and deliberately does NOT set the
            // flag, so an alt-cost cast's affordability is judged against the
            // real board without also picking up a cost reduction it never
            // folded in before this fix.
            (canPotentiallyPayCost(caster, card, undefined, state, {
                foldCostModifiers: true,
                // CR 601.3c (issue #2146) — when this cast can only happen
                // under the conditional-flash permission, its surcharge is
                // MANDATORY, so affordability must be judged against the
                // surcharged total. Undefined (a no-op) for every other card
                // and for the same card inside its caster's sorcery window.
                ...(flashSurchargeRequired(state, caster.id, card)
                    ? { extraMana: flashSurchargeOf(card) }
                    : {}),
            }) ||
                affordableAlternativeCosts(state, caster, card).some((alt) =>
                    canPotentiallyPayCost(caster, card, alt.mana ?? {}, state)
                )) &&
            hasEnoughLegalTargets(state, caster, card) &&
            hasPayableAdditionalCost(caster, card)
        ) {
            actions.push("cast");
        }
    }

    return actions;
}

/** CR 118.8 / 601.2f: a spell whose additional cost is "sacrifice/exile a
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
 *  (mirrors `hasPayableAdditionalCost`). Undefined cost → always payable.
 *  `flashbackCardId` excludes the flashback card itself from its own
 *  `exileFromHand` pool — a no-op today (the flashback card is being cast FROM
 *  the graveyard, so it can never also be the hand card paying the cost) but
 *  kept for parity with `flashbackExileEligibleCount`'s graveyard-exile call,
 *  which passes the same exclusion for the analogous reason.
 *
 *  Issue #1688 — the `exileFromHand` colour leg now delegates to the shared
 *  `isExileCostEligible` (`convex/cards/exileCostEligibility.ts`, issue #1659)
 *  instead of re-deriving it, closing the fifth surviving copy of the
 *  cast-exile-cost colour predicate. One divergence was flagged and verified:
 *  `isExileCostEligible` short-circuits `color === undefined` to `true` BEFORE
 *  resolving the candidate's `CardDefinition`, whereas the old inline check
 *  here required the definition to resolve even in the no-colour-filter case.
 *  Confirmed unreachable for real cards: every card in a player's hand comes
 *  from a deck validated against the card registry at deck-build time, and
 *  tokens never occupy the hand zone (CR 111.7), so `card.card.id` on a hand
 *  instance always resolves to a registered `CardDefinition` — there is no
 *  live hand card whose definition fails to resolve for this branch to catch.
 *  (Belt-and-braces: no shipped card declares `exileFromHand` at all yet —
 *  grep `convex/cards/sets/**` — so today this whole cost shape is exercised
 *  only via `CardInstanceState.grantedFlashback`, e.g. tests / a future
 *  Snapcaster-style effect.) Delegating fully is therefore safe. */
function hasPayableFlashbackAdditionalCost(
    player: PlayerState,
    add: FlashbackAdditionalCost | undefined,
    flashbackCardId: string
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
        const hasCard = player.hand.some((c) =>
            isExileCostEligible(c, flashbackCardId, wantColor)
        );
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
        // requirements keep the single X-agnostic pass. `state` is forwarded
        // into `maxAffordableX` (issue #1751 finding 5) — it is already in
        // scope as this function's own param — so the X ceiling itself is
        // board-aware: an {X} spell funded by a board-dependent mana source
        // no longer gets an under-estimated ceiling here.
        const xValues = mvFilterUsesX(req)
            ? Array.from(
                  { length: maxAffordableX(player, card, state) + 1 },
                  (_, i) => i
              )
            : [undefined];
        return xValues.some((chosenX) => {
            const legalTargets = getLegalTargets(
                state,
                req,
                // hasEnoughLegalTargets gates the Cast UI — the source is a
                // spell (CR 113.3).
                targetingSourceFromCard(card, true),
                player.id,
                chosenX
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
 *  about — see the `battlefields` paragraph below for what board-dependent
 *  choosers (Fellwar Stone) need to be resolved here instead of falling into
 *  this empty case.
 *
 *  `controllerId` / `battlefields`, when passed, flow straight into
 *  `getManaTapOptionsDetailed` (issue #1751 finding 4, closed fully by issue
 *  #1754) so a board-dependent `canActivate` (Mox Opal's Metalcraft, Fanatic
 *  of Rhonas's Ferocious) is evaluated against a real board instead of the
 *  always-false `minimalManaGateView(undefined)`. `planManaPayment`
 *  (moves.ts) now builds and passes a FULL, both-players view
 *  (`manaGateBattlefields(state)`, `constants.ts`) — the same shared helper
 *  `coloredCostLeftover` calls from `opts.state` — so a self-referential
 *  ability like Metalcraft or Ferocious AND an
 *  opponent-scanning chooser like Fellwar Stone are both visible here. */
export function getProducibleManaOptions(
    card: CardInstanceState,
    controllerId?: string,
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): Map<Color, number | undefined> {
    const options = new Map<Color, number | undefined>();
    // requireTap: the auto-tap planner only ever taps for mana — it must never
    // auto-commit a sacrifice-only source (Lion's Eye Diamond discards the hand).
    const detailed = getManaTapOptionsDetailed(
        card,
        controllerId,
        battlefields,
        {
            requireTap: true,
        }
    );
    if (detailed.length === 0) return options;

    // Mirror `manaTapNeedsChoice`: the tap mutations require a `manaChoiceIndex`
    // whenever 2+ options exist, or the source carries a choice-based ability
    // (Talisman / Fellwar Stone). A single fixed/basic option taps index-free.
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    // POST-LAYER set (issue #1880) — a GRANTED choice-based mana ability needs
    // an index exactly like a printed one, or the planner and the tap mutation
    // disagree about whether `manaChoiceIndex` is required.
    const hasChoiceAbility =
        !!def &&
        !abilitiesSuppressed(card) &&
        getEffectiveActivatedAbilities(card).some(
            ({ ability: a }) =>
                !a.useStack &&
                (a.manaChoices || a.getManaChoices || a.manaColorSource)
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
 *  activation (CR 605.1a) — but when a permanent declares MULTIPLE tap
 *  abilities (Starting Town: "{T}: Add {C}" and "{T}, Pay 1 life: Add one mana
 *  of any color", issue #1695) they are ALTERNATIVES for that same tap, not
 *  competitors where only the "best" one counts.
 *
 *  Single-authority form (issue #1695 finding 1, review-blocking): the unit
 *  list is derived from `getManaTapOptionsDetailed(…, { requireTap: true })`
 *  — the SAME list `getProducibleManaOptions` (the real auto-tap payment
 *  planner) and the tap mutations read — instead of re-deriving a parallel
 *  ability filter here. A prior version of this fix unioned every
 *  `activatedAbilities` entry with `!ability.cost.tap` as the only exclusion,
 *  which missed that `getManaTapOptionsDetailed` ALSO drops every
 *  sacrifice-cost option whenever a non-sacrifice tap option exists on the
 *  same source (`combined = nonSacrifice.length > 0 ? nonSacrifice :
 *  sacrifice` — "prefer non-destructive options; fall back to sacrifice only
 *  when there is no other way to tap this source for mana", constants.ts).
 *  Archaeological Dig ("{T}: Add {C}" / "{T}, Sacrifice: Add one mana of any
 *  color") is the case: only {C} is ever payable, but the old per-ability
 *  union offered the gate all five colors — a false-positive Cast button the
 *  payment step then refused. Routing through the shared helper makes the
 *  gate and the payment planner agree by construction; a life-cost ability
 *  (Starting Town) is NOT bucketed as a sacrifice option (only `cost
 *  .sacrifice` is), so the already-verified "errs toward affordable" bias for
 *  life costs is unchanged.
 *
 *  Every entry in the shared list (`ManaTapOption`) is one whole tap
 *  alternative — one ability's output, or one basic-land-subtype's intrinsic
 *  `{T}: Add C` (CR 305.6, folded in by `getManaTapOptionsDetailed` itself) —
 *  and only ONE alternative is ever used per tap. Each alternative is expanded
 *  into its own ordered per-mana colour-set list (one entry per unit of mana
 *  it produces), then every alternative is unioned position-by-position: the
 *  unit COUNT is the largest quantity any single alternative can produce
 *  (matches the existing "real quantity, not one-per-source" rule — only one
 *  alternative fires per tap, so quantity can't be summed across them), and
 *  each position's COLOR SET is the union of every alternative's colour at
 *  that position. An alternative shorter than the max simply has nothing to
 *  contribute past its own length, so it never inflates the quantity another
 *  alternative alone wouldn't already claim. This keeps the result
 *  declaration-order-independent (issue #1695 AC) and preserves the Sol
 *  Ring-style two-mana case (only one ability, no regression). A choice
 *  ability (dual land / Talisman) contributes one option per choice, so its
 *  colours land in the union exactly like the old "one unit, colors = union
 *  of choices" special case did.
 *
 *  NOTE — `manaRestriction` is NOT consulted here, same as before this
 *  rewrite: this list only tracks which raw colours a source could ever
 *  produce, not whether the resulting mana is legally spendable on a given
 *  spell. Restricted mana is honoured only once it reaches the pool, at
 *  `coloredCostLeftover` below (CR 106.6). Delighted Halfling (issue #1559)
 *  IS now exactly the previously-hypothetical shape: an UNRESTRICTED `{C}`
 *  tap ability combined with a SEPARATE, RESTRICTED-any-colour tap ability
 *  ("Spend this mana only to cast a legendary spell..."). The leak is real
 *  and live: this gate unions both abilities' colours with no restriction
 *  awareness, so the castability check (whatever consumes
 *  `getProducibleManaUnits`, e.g. offering "Cast" on a spell) treats the
 *  restricted any-colour mana as freely spendable, and will offer "cast" for
 *  a NON-legendary spell the restricted mana can't legally pay for (CR 106.6
 *  is still enforced correctly at actual payment time —
 *  `payManaCostForSpell` / `spendablePoolForSpell` — so no illegal cast can
 *  ever actually commit; this is a castability-AFFORDANCE overcount, not a
 *  legality hole). tracked-by: #1733 */
function getProducibleManaUnits(
    card: CardInstanceState,
    /** CR 602.5b / 605.1a (issue #1695 re-review, regression fix) — the
     *  controller's id + a REAL, BOTH-PLAYERS `battlefields` view (built by
     *  `coloredCostLeftover` from `opts.state` when a caller has one).
     *  Board-dependent `canActivate` (Mox Opal's Metalcraft, Fanatic of
     *  Rhonas's Ferocious — both scan only the controller's own battlefield,
     *  `hasMetalcraft` in `types.ts` / the Ferocious closure in `mh3/green.ts`)
     *  AND board-dependent `getManaChoices` (Fellwar Stone scans every OTHER
     *  player's battlefield) both need it. Omitting these args (as this
     *  function did before this fix) makes `minimalManaGateView` fall back to
     *  `{ players: [] }`, so `canActivate` is permanently false and the mana
     *  ability is dropped from the gate even though the real board — the one
     *  `convex/game.ts`'s payment planner passes — satisfies it. A view
     *  containing only the controller's OWN entry is NOT a safe substitute:
     *  Fellwar Stone's chooser explicitly skips any entry matching
     *  `controllerId`, so an own-only view makes it see zero opponents and
     *  return `[]` — which the caller treats as "no options" rather than
     *  falling back to the static list, trading the current safe
     *  over-approximation for an under-approximating hidden-cast bug of this
     *  same shape. See `coloredCostLeftover`'s `opts.state` doc for why this
     *  is only ever populated from a full `GameState`, never from `player`
     *  alone. */
    controllerId?: string,
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): Set<Color>[] {
    // requireTap: only a genuine {T} ability counts as an auto-payable "unit"
    // — the SAME `requireTap: true` invariant `getProducibleManaOptions` (the
    // real auto-tap planner) uses. Board view is identical between the two
    // WHEN THE CALLER HAS PASSED A `state` (issue #1751 finding 4, closed
    // fully by issue #1754): this function is fed the FULL, both-players
    // `battlefields` view built from `opts.state` (via `coloredCostLeftover`,
    // only when a caller has one — see that param's own doc), and
    // `getProducibleManaOptions`'s one caller (`planManaPayment`, moves.ts)
    // always builds and passes the same FULL, both-players view from its own
    // (mandatory) `state` param — so a self-referential ability (Mox Opal's
    // Metalcraft, Fanatic of Rhonas's Ferocious) AND an opponent-scanning
    // chooser (Fellwar Stone) are both visible to the two callers identically
    // ON THAT PATH. Issue #1757 closed the last board-blind `coloredCostLeftover`
    // callers that used to pass no `state` at all: `maxAffordableX`'s
    // bot-enumeration call site in moves.ts, every `genericManaShortfall`
    // caller, AND — a fifth holdout the reviewer's escalation surfaced in the
    // same round — the Phyrexian split solver's two remaining state-less call
    // sites (`solvePhyrexianSplit` in `enumerateCastMoves`, moves.ts, and
    // `resolvePhyrexianCastPayment` on the real server cast path, game.ts,
    // finding 1 / finding 2), plus `phyrexianLifePipOptions`'s
    // `projectPublicState` call site (gameProjections.ts, found while
    // verifying this very comment). Every caller now has a `state` in scope
    // and passes it, so this function only falls back to `undefined,
    // undefined` (board-blind) for a caller that genuinely has no `GameState`
    // on hand (there is none today); the "identical" guarantee is no longer
    // scoped to a subset of callers.
    const detailed = getManaTapOptionsDetailed(
        card,
        controllerId,
        battlefields,
        {
            requireTap: true,
        }
    );

    const perOptionUnits: Set<Color>[][] = detailed.map((opt) => {
        const units: Set<Color>[] = [];
        for (const c of MANA_COLORS) {
            const amount = opt.mana[c] ?? 0;
            for (let i = 0; i < amount; i++) units.push(new Set<Color>([c]));
        }
        return units;
    });

    const maxLen = perOptionUnits.reduce((m, u) => Math.max(m, u.length), 0);
    const best: Set<Color>[] = [];
    for (let i = 0; i < maxLen; i++) {
        const colors = new Set<Color>();
        for (const units of perOptionUnits) {
            for (const c of units[i] ?? []) colors.add(c);
        }
        best.push(colors);
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
    opts: {
        /** CR 601.2g (`payWith`, ADR 0063) — include the chosen-resource pseudo
         *  sources (delve's graveyard cards) in the probe. Default true: the
         *  castability gate must see them or a delve-only-payable spell is
         *  hidden. `genericManaShortfall` passes false — it asks the
         *  complementary question ("how much can MANA alone NOT cover", i.e.
         *  how many resources the caster is forced to spend), which must
         *  exclude them. */
        payWith?: boolean;
        /** CR 602.5b / 605.1a (issue #1695 re-review, regression fix) — the
         *  full game state, threaded down from `canPotentiallyPayCost`'s own
         *  optional `state` param. Commit 10b27d7a made every one of
         *  `canPotentiallyPayCost`'s ten call sites (hand-cast, flashback,
         *  escape, madness, graveyard-permission, permanent-permission,
         *  graveyard-grant, free-exile, alternative-cost, intrinsic-graveyard)
         *  pass `state`; issue #1751 finding 1 closed the one remaining gap,
         *  the Phyrexian branch (`solvePhyrexianSplit`), which now forwards
         *  `state` here too. Used to build a REAL, BOTH-PLAYERS `battlefields`
         *  view for `getProducibleManaUnits`, so a mana ability's
         *  board-dependent `canActivate` (Mox Opal's Metalcraft, Fanatic of
         *  Rhonas's Ferocious) or board-dependent `getManaChoices` (Fellwar
         *  Stone reads OPPONENT lands) sees the same board the real payment
         *  planner (`convex/game.ts`) does. Deliberately NOT synthesized from
         *  `player` alone: a battlefields view containing only the
         *  controller's OWN entry makes Fellwar Stone's opponent-scanning
         *  `getManaChoices` — which skips any entry matching `controllerId`
         *  — see zero opponents and return `[]`, which `getManaTapOptionsDetailed`
         *  treats as "no options" rather than falling back to the static
         *  `manaChoices` list (an empty array is truthy). That would swap
         *  Fellwar Stone's current safe "assume all 5 colours" over-approximation
         *  for an under-approximating "assume none" — a NEW hidden-cast bug of
         *  the exact shape this fix closes for Mox Opal/Fanatic of Rhonas.
         *  A caller that omits `state` still makes `getProducibleManaUnits`
         *  fall back to its pre-fix `undefined, undefined` call — issue #1757
         *  closed the last callers that used to omit it: `maxAffordableX`'s
         *  bot-enumeration call site in moves.ts, every `genericManaShortfall`
         *  caller, the Phyrexian split solver's two remaining state-less call
         *  sites (`solvePhyrexianSplit` in moves.ts's `enumerateCastMoves` and
         *  `resolvePhyrexianCastPayment` on the real server cast path in
         *  game.ts — findings 1 and 2), and `phyrexianLifePipOptions`'s
         *  `projectPublicState` call site in gameProjections.ts. So today
         *  every caller passes `state` and this fallback is dead code kept
         *  only for a hypothetical future caller with no `GameState` on
         *  hand. */
        state?: GameState;
    } = {}
): number | null {
    const includePayWith = opts.payWith ?? true;
    // CR 601.2f (issue #1338) — "You can't spend mana to cast this spell"
    // (Hogaak). When set, NO real mana source counts toward affordability: every
    // pip must be covered by a non-mana `payWith` resource (convoke / delve),
    // so the pool, restricted mana, land/rock taps and Wild-Growth bonuses are
    // all excluded below. The card is castable iff convoke + delve alone cover
    // the full cost (coloured/hybrid via convoke, generic via convoke/delve).
    const cantSpendMana =
        tryGetDefinition((card.card as { id?: string }).id ?? "")
            ?.cantSpendManaToCast ?? false;
    // CR 106.6 / 205.4a (issue #1559) — the printed supertypes of the card
    // being cast, for the `legendary-spell` restriction's eligibility check
    // below (Delighted Halfling). This reads the DEFINITION's printed
    // supertypes rather than the live overlay (`liveSupertypesOf`,
    // `cards/snowReads.ts` — `CardInstanceState` DOES carry a mutable overlay
    // via `grantedSupertypes`/`removedSupertypes`, contrary to an earlier,
    // inaccurate version of this comment). That's a deliberate match to how
    // `sba.ts`'s legend rule (CR 704.5j, `isLegendary`) reads supertypes
    // today — also printed-only, via `permanentDefinition(card)?.supertypes`
    // — not a gap: no card in the catalogue currently grants/removes
    // "Legendary" on a card sitting in hand (only on a permanent), so the
    // live overlay and the printed value coincide for every real spell this
    // restriction can apply to. Same source `restrictedUnitAllowsSpell`
    // expects.
    const spellSupertypes =
        tryGetDefinition((card.card as { id?: string }).id ?? "")?.supertypes ??
        [];
    // CR 202.1a — guild-hybrid pips are read off the printed cost and matched by
    // the shared greedy below (a real source or a convoke creature of either
    // colour pays each). Orthogonal to Phyrexian pips — no card carries both.
    const hybridPips = getInstanceManaCost(card)?.hybrid ?? [];
    // See `opts.state` doc above: only built when the caller passed a full
    // `GameState`, and always spans EVERY player, never just `player`. Shared
    // with moves.ts / game.ts via `manaGateBattlefields` (issue #1754 finding
    // 6) so the three sites can't independently drift.
    const boardBattlefields = opts.state
        ? manaGateBattlefields(opts.state)
        : undefined;
    const boardControllerId = boardBattlefields ? player.id : undefined;
    // Each source is the set of colors it can supply for this cost slot.
    const sources: Set<Color>[] = [];
    if (!cantSpendMana) {
        for (const c of MANA_COLORS) {
            const n = player.manaPool[c] ?? 0;
            for (let i = 0; i < n; i++) sources.push(new Set<Color>([c]));
        }
    }
    if (!cantSpendMana) {
        // CR 106.6 — restricted mana whose restriction permits THIS spell (Ice
        // Cauldron's instance-keyed noted mana, Metamorphosis' creature-only mana)
        // is spendable on the cast and must count toward affordability. Without it
        // a card castable only from its banked mana — e.g. Ice Cauldron's exiled
        // card paid by the noted mana — is judged unpayable here, so "cast" is
        // dropped from getLegalActions and `assertLegalAction` rejects the cast
        // before payment. Mirrors `spendablePoolForSpell` at the payment site;
        // `card.id` is the instance id that instance-keyed mana is gated on.
        for (const r of player.restrictedMana ?? []) {
            if (
                restrictedUnitAllowsSpell(
                    r,
                    card.types,
                    card.id,
                    spellSupertypes
                )
            ) {
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
            const base = getProducibleManaUnits(
                perm,
                boardControllerId,
                boardBattlefields
            );
            for (const unit of base) sources.push(unit);
            // CR 605.4 — a Wild-Growth-style triggered mana ability on ANOTHER
            // permanent adds extra mana when THIS land is tapped for mana. It only
            // fires on a for-mana tap, so gate on the land actually producing base
            // mana; then fold in the declared bonus units (Wild Growth {G},
            // Gauntlet {R}, Mana Flare produced colour, Fertile Ground any colour).
            if (base.length > 0) {
                for (const unit of tapManaBonusUnits(
                    player.battlefield,
                    perm
                )) {
                    sources.push(unit);
                }
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
                getProducibleManaUnits(
                    perm,
                    boardControllerId,
                    boardBattlefields
                ).length > 0;
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

    // CR 702.51 / 601.2g — Convoke (`payWith`, ADR 0063 / issue #1338): each
    // untapped creature the caster controls may be tapped to pay for {1} OR one
    // mana of that creature's colour (CR 702.51a). Model each as a COLOURED
    // pseudo-source (its live colours; empty set for a colourless creature —
    // generic only), so the shared greedy below can satisfy a coloured / hybrid
    // pip from it for free. PROBE only: the real payment is the caster's
    // explicit creature-picker choice (`PendingCast.convokeCreatureChoice`),
    // never auto-picked. Summoning-sick creatures count (convoke is not a `{T}`
    // ability, CR 602.5a). Without this a convoke-only-payable spell (Hogaak
    // off can't-spend-mana) is judged unpayable and "cast" is hidden.
    if (includePayWith && spellHasConvoke(card)) {
        for (const creature of convokeEligibleCreatures(player)) {
            sources.push(creatureConvokeColors(creature));
        }
    }

    // Greedy: assign single-colour then guild-hybrid pips, each to the
    // least-flexible source able to pay it, and return the leftover sources the
    // generic portion ({cost.X}) draws from — or null when a coloured/hybrid pip
    // can't be covered. The one shared primitive (`gre/payWith.ts`) the convoke
    // coverage computation reuses (primitive-reuse rule).
    return coverColoredAndHybridPips(sources, cost, hybridPips);
}

/** Whether the player can pay a fully-normalized mana cost (colored pips + the
 *  generic `X` slot) with their current pool + producible mana. Wraps the
 *  `coloredCostLeftover` greedy assignment so callers that build a bespoke
 *  normalized cost (the Phyrexian solver) share the one affordability model.
 *  `state`, when passed, is forwarded unchanged into `coloredCostLeftover`'s
 *  `opts.state` (issue #1751 finding 1) so a board-dependent mana ability
 *  (Mox Opal's Metalcraft) is visible to the Phyrexian solver exactly like it
 *  already is to the plain-cost path. */
function canPayNormalizedCost(
    player: PlayerState,
    card: CardInstanceState,
    cost: Record<string, number>,
    state?: GameState
): boolean {
    const leftover = coloredCostLeftover(player, card, cost, { state });
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
 *  are tiny (≤ a handful), so the split space is enumerated exhaustively.
 *  `state`, when passed, is forwarded into `canPayNormalizedCost` /
 *  `coloredCostLeftover` (issue #1751 finding 1) so a mana-vs-life split that
 *  can only be afforded via a board-dependent mana ability (Mox Opal's
 *  Metalcraft, Fanatic of Rhonas's Ferocious) is found instead of the solver
 *  silently evaluating every split against an empty board. */
export function solvePhyrexianSplit(
    player: PlayerState,
    card: CardInstanceState,
    rawCost: ManaCost,
    chosenX?: number,
    state?: GameState
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
            if (!canPayNormalizedCost(player, card, cost, state)) return;
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
 *  the engine auto-resolves to when the caster does not choose). `state`, when
 *  passed, is forwarded into `canPayNormalizedCost` / `coloredCostLeftover`
 *  (issue #1751 finding 1) so a board-dependent mana ability is visible to
 *  this affordability probe exactly like `solvePhyrexianSplit`'s. */
export function phyrexianLifePipOptions(
    player: PlayerState,
    card: CardInstanceState,
    rawCost: ManaCost,
    chosenX?: number,
    state?: GameState
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
            if (canPayNormalizedCost(player, card, cost, state)) {
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
    /** Issue #1695 (fourth-pass fix) — the full game state, used ONLY to build
     *  the REAL, BOTH-PLAYERS `battlefields` view that `coloredCostLeftover` /
     *  `getProducibleManaUnits` need to evaluate a board-dependent mana
     *  ability (Mox Opal's Metalcraft, Fanatic of Rhonas's Ferocious,
     *  Fellwar Stone's opponent-land scan — see `coloredCostLeftover`'s own
     *  `opts.state` doc for why it must span every player). **Passed at EVERY
     *  call site below** — `state` is already in lexical scope at each one
     *  (`getLegalActions`'s own param), and a mana ability must always be
     *  judged against the real board, never an empty synthesized one.
     *  Board-threading is INDEPENDENT of `opts.foldCostModifiers` below —
     *  passing `state` here does not, by itself, fold cost-modifier static
     *  effects into the cost. */
    state?: GameState,
    opts: {
        /** CR 601.2f (ADR 0063, issue #1337) — when true, the printed/override
         *  cost is folded through the SAME `getCostModifiers` +
         *  `applyCostModifiers` the real payment path (`game.ts`) uses before
         *  the affordability check, so a spell's cast-cost REDUCTION (Mana
         *  Matrix, Planar Gate, Emry's self-host `selfCostReduction`) is
         *  reflected in the "cast" legal action instead of gating on the
         *  unreduced printed cost. Requires `state` to also be passed (a
         *  no-op otherwise). Deliberately opt-in and set `true` ONLY at the
         *  plain hand-cast branch below: folding a cost reduction into
         *  flashback/escape/madness/graveyard-permission/alternative-cost
         *  affordability would be an unrelated semantic change smuggled into
         *  this fix's board-only scope (issue #1695 re-review). Every other
         *  call site either omits `opts` or passes it without this flag, so
         *  `coloredCostLeftover` still gets a real board but the cost stays
         *  the pre-existing unreduced one, byte-identical to before this
         *  fix. */
        foldCostModifiers?: boolean;
        /** CR 601.3c / 601.2f (issue #2146) — a MANDATORY additional mana cost
         *  this particular cast owes on top of the printed/override cost. Set
         *  only for the conditional-flash surcharge at the plain hand-cast
         *  branch below, and only when `flashSurchargeRequired` says the cast
         *  is actually relying on the CR 601.3c permission. Kicker and Buyback
         *  are deliberately NOT folded here — those are OPTIONAL additional
         *  costs (CR 702.33/702.27), so a caster who cannot afford them can
         *  still cast the spell without them; the surcharge has no such
         *  unkicked variant off-window, and without it the affordance offers a
         *  cast that would park unpayable at the mana step. */
        extraMana?: ManaCost;
    } = {}
): boolean {
    const rawCost = costOverride ?? getInstanceManaCost(card);
    if (!rawCost) return true;
    // CR 107.4f — a cost with Phyrexian pips is castable whenever SOME mana-vs-
    // life split is affordable (each pip: its colour OR 2 life). Delegated to
    // the shared solver so the gate and the payment agree on the split space.
    // Cost modifiers are not folded into the Phyrexian solver (no shipped card
    // combines the two — mirrors game.ts's cast-cost ordering comment).
    // `state` is forwarded through (issue #1751 finding 1, live-probed
    // regression: Phyrexian Metamorph {3}{U/P} at 1 life with Mox Opal +
    // Metalcraft satisfied) so a board-dependent mana ability is visible to
    // the Phyrexian split solver exactly like it is to the plain-cost path
    // below — before this fix `solvePhyrexianSplit` never received `state` at
    // all, so `coloredCostLeftover` always saw an empty board here and Mox
    // Opal's Metalcraft-gated ability could never pay a Phyrexian pip.
    if (phyrexianPipCount(rawCost) > 0) {
        return (
            solvePhyrexianSplit(player, card, rawCost, undefined, state) !==
            null
        );
    }
    // Cost normalized without chosenX: string-X spells pay only their fixed
    // portion at the minimum (X = 0). User picks X at announcement.
    const cost = normalizeManaCost(rawCost);
    // CR 601.2f — an additional cost joins the total BEFORE increases and
    // reductions apply, exactly as `game.ts` folds it at the real payment step.
    if (opts.extraMana) {
        for (const [sym, amt] of Object.entries(
            normalizeManaCost(opts.extraMana)
        )) {
            cost[sym] = (cost[sym] ?? 0) + amt;
        }
    }
    if (state && opts.foldCostModifiers) {
        applyCostModifiers(cost, getCostModifiers(state, card, "spell"));
    }
    const totalRequired =
        (cost.X ?? 0) + MANA_COLORS.reduce((sum, c) => sum + (cost[c] ?? 0), 0);
    if (totalRequired === 0) return true;
    // Issue #1695 (fourth-pass fix) — forward `state` down into
    // `coloredCostLeftover` purely for the board view; every one of THIS
    // function's ten call sites now passes it (see the param doc above), so
    // for the colored+generic portion checked right here, a board-dependent
    // mana ability is judged against the real board regardless of which cast
    // branch (hand/flashback/escape/madness/graveyard-permission/permanent-
    // permission/graveyard-grant/free-exile/alternative-cost) is asking, and
    // — since issue #1751 finding 1 — the Phyrexian branch above forwards
    // `state` too. `maxAffordableX`'s two call sites in moves.ts (the Bot's
    // X-ceiling enumeration) and every `genericManaShortfall` caller build
    // their own `coloredCostLeftover` probe the same way, forwarding their own
    // `state` (issue #1757 closed the last board-blind holdouts among them;
    // each documented at its own definition).
    const leftover = coloredCostLeftover(player, card, cost, { state });
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
 *  `state`, when passed, is forwarded into `coloredCostLeftover` (issue #1751
 *  finding 5) so a board-dependent mana ability contributes to the X ceiling.
 *  `hasEnoughLegalTargets` passes its own `state` param; the Bot's move
 *  enumerator (`enumerateCastMoves` in moves.ts), which also consumes this
 *  function for its `X = 0..N` range, now passes its own `state` param too
 *  (issue #1757 — previously omitted, so a board-dependent mana source
 *  reached a higher ceiling at the gate than the Bot ever enumerated; the
 *  Bot under-used X spells even though the eventual `planManaPayment` tap
 *  plan could have covered a larger X). Every current caller of this function
 *  passes `state`, so the ceiling this returns matches the castability gate's
 *  everywhere. Each candidate X is still re-checked by `planManaPayment`
 *  before a move is emitted, so a future board-blind caller (or a genuine
 *  divergence between this greedy model and `planManaPayment`'s) would still
 *  only ever be filtered, never over-offered — but that safety net is not why
 *  the ceiling agrees today; the ceiling agrees because both callers now pass
 *  the same board. */
export function maxAffordableX(
    player: PlayerState,
    card: CardInstanceState,
    state?: GameState
): number {
    const rawCost = getInstanceManaCost(card);
    if (!rawCost || typeof rawCost.X !== "string") return 0;
    const cost = normalizeManaCost(rawCost);
    const leftover = coloredCostLeftover(player, card, cost, { state });
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
 *  (`applyCostModifiers`), matching what the announce path parks.
 *
 *  `state`, when passed, is forwarded into `coloredCostLeftover` (issue
 *  #1757) so a board-dependent mana source contributes to the leftover this
 *  shortfall is computed from — closing the same gap `maxAffordableX` closed
 *  for the X ceiling. Without it, a self-referential source (Mox Opal's
 *  Metalcraft, Fanatic of Rhonas's Ferocious) is invisible to
 *  `getProducibleManaUnits`'s board-blind fallback and contributes NO mana at
 *  all, understating the leftover and OVER-stating the forced minimum —
 *  `buildDelveExileChoice`'s `min` (and, when `min === max ===
 *  eligible.length`, `collapseForcedDelvePick`'s silent auto-exile of the
 *  WHOLE graveyard) would force more delve than the real board requires. Every
 *  current caller — `moves.ts`'s `enumerateCastMoves` (the Bot's cast-move
 *  enumeration), `applyMove.ts`'s `applyDelveExileForSearch` (the search
 *  leaf's delve replay, shared by `search.ts`'s `applyMoveInSearch`), and
 *  every `game.ts` `buildDelveExileChoice` call site (hand-cast, targeted
 *  cast, post-convoke) — has a `state` in scope and now passes it, so this
 *  gap is closed catalogue-wide, not merely documented. */
export function genericManaShortfall(
    player: PlayerState,
    card: CardInstanceState,
    cost: Record<string, number>,
    state?: GameState
): number {
    const leftover = coloredCostLeftover(player, card, cost, {
        payWith: false,
        state,
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
    isToken?: boolean;
}

/** THE single authority on whether a permanent passes a target requirement's
 *  intrinsic filters (CR 109.1 / 115 / 202 / 205 / 613 / 701.26). Returns
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
        isToken: f.isToken,
    };
    return checkPermanentTargetFilters(ctx, card, values);
}

/** Every characteristic of the SOURCE whose targets are being enumerated —
 *  the one bundle `getLegalTargets` takes, replacing what used to be four
 *  independent positional parameters (`sourceColors`, `sourceTypes`,
 *  `sourceSubtypes`, `sourceIsSpell`, plus a trailing `sourceSupertypes`).
 *
 *  **Every field is REQUIRED, and that is the point.** Source-quality gates
 *  (CR 702.16 protection, CR 611 `cantBeTargeted` guards) read several
 *  independent dimensions, and the offered set (`getLegalTargets`) and the
 *  accepted set (`selectTarget`) must agree on all of them. While they were
 *  separate defaulted positionals, a call site could supply three and silently
 *  omit the fourth — which is exactly what happened to
 *  `raiseTriggerTargetSelection`: it passed colours/types/subtypes and took
 *  the `[]` default for supertypes, so a supertype-bearing protection quality
 *  was invisible on the entire triggered-ability path (issue #1120 review). As
 *  ONE object with no optional members, omitting a dimension is a compile
 *  error, and adding a future dimension makes the compiler enumerate every
 *  construction site.
 *
 *  Do NOT hand-assemble one in engine code — use `targetingSourceFromCard`,
 *  `pendingTargetingSource`, or the explicit `NO_TARGETING_SOURCE`. A guard
 *  test (`gre/__tests__/protectionQuality.test.ts`) fails if production code
 *  spreads over `NO_TARGETING_SOURCE` to build a partial bundle. */
export interface TargetingSource {
    /** CR 202.2 — the source's live colours (empty = colourless, CR 105.2c). */
    colors: readonly Color[];
    /** CR 109.5 / 205.2 — the source's live card types. */
    types: readonly CardType[];
    /** CR 109.5 / 205.3 — the source's live subtypes ("Aura spells"). */
    subtypes: readonly string[];
    /** CR 205.4a / 702.16a — the source's live supertypes. */
    supertypes: readonly CardSupertype[];
    /** CR 113.3 — a spell, vs an activated/triggered ability. `undefined` when
     *  the caller genuinely doesn't know (kept distinct from `false`, which
     *  asserts "not a spell", because `spells only` guards read the three-way
     *  distinction). */
    isSpell: boolean | undefined;
}

/** The explicit "no source characteristics are known or relevant" bundle.
 *  Every source-quality gate is inert against it — no protection quality
 *  matches, no source-narrowed guard fires. Named (rather than an implicit
 *  `[]` default) so a call site that genuinely has no source SAYS so, and is
 *  greppable. */
export const NO_TARGETING_SOURCE: TargetingSource = Object.freeze({
    colors: Object.freeze([]) as readonly Color[],
    types: Object.freeze([]) as readonly CardType[],
    subtypes: Object.freeze([]) as readonly string[],
    supertypes: Object.freeze([]) as readonly CardSupertype[],
    isSpell: undefined,
});

/** The TOTAL projection of a card object (hand card being cast, battlefield
 *  permanent whose ability is activating, stack item retargeting) into its
 *  targeting characteristics. Reads colours through the layer-aware authority
 *  and types/supertypes LIVE (CR 205.2 / 205.4a), so an animated artifact or a
 *  supertype-stripped legend is judged by what it currently is. */
export function targetingSourceFromCard(
    card: CardInstanceState,
    isSpell: boolean | undefined
): TargetingSource {
    const characteristics = protectionSourceCharacteristics(card);
    return {
        colors: characteristics.colors,
        types: characteristics.types,
        subtypes: card.subtypes,
        supertypes: characteristics.supertypes,
        isSpell,
    };
}

/** CR 702.16 — the ONE projection from a `TargetingSource` into the protection
 *  predicate's own source view. Both CR 702.16b consult sites read it: the
 *  OFFERED set (`getLegalTargets`, just below) and the ACCEPTED set
 *  (`game.ts::selectTarget`). Neither may hand-assemble the bundle — that is
 *  how the two sides diverge on a quality family, and a guard test
 *  (`gre/__tests__/protectionQuality.test.ts`) fails on any production file
 *  that writes one out.
 *
 *  `TargetingSource.isSpell` is three-way (`undefined` = "the caller genuinely
 *  doesn't know", which in practice means `NO_TARGETING_SOURCE` — no source at
 *  all). `ProtectionSourceView.isSpell` is a plain boolean, so the projection
 *  narrows: no located source ⇒ not a spell ⇒ the CR 702.16a spell-restricted
 *  quality is inert, exactly like every other quality family against
 *  `NO_TARGETING_SOURCE` (whose `colors`/`types`/`supertypes` are empty too).
 *  This is a narrowing of "there is no source", NOT a default standing in for
 *  a site that failed to say (issue #2296). */
export function protectionSourceFromTargeting(
    source: TargetingSource,
    controllerId: string | undefined
): ProtectionSourceView {
    return {
        colors: source.colors,
        types: source.types,
        supertypes: source.supertypes,
        controllerId,
        isSpell: source.isSpell === true,
    };
}

/** The targeting characteristics of the source whose target-selection is in
 *  progress. Locates it the way every `getPendingTargetSource*` helper does —
 *  copy-retarget / retarget / trigger → the stack item; ability → the
 *  battlefield permanent; cast → the hand card — then delegates to
 *  `targetingSourceFromCard`, so all five dimensions are derived together and
 *  none can be forgotten. `NO_TARGETING_SOURCE` when the source can't be
 *  located. */
export function pendingTargetingSource(
    state: GameState,
    cardInstanceId: string,
    /** Accepts the RAW `PendingTarget["kind"]`, absent included: the cast
     *  builder omits it, and resolving the default here (rather than at each
     *  caller's `?? "cast"`) is what keeps the offered set, the accepted set
     *  and the client's gate on one derivation — issue #2296 review. */
    rawKind: PendingTarget["kind"]
): TargetingSource {
    const kind = resolvePendingTargetKind(rawKind);
    // CR 113.3 — only a cast / (copy-)retargeted spell is a spell; an
    // activated or triggered ability is not. Same shared derivation the client
    // gate reads (`src/lib/targeting.ts`).
    const isSpell = pendingSourceIsSpell(rawKind);
    const source: CardInstanceState | undefined =
        kind === "copy-retarget" || kind === "retarget" || kind === "trigger"
            ? state.stack.find((x) => x.id === cardInstanceId)
            : state.players
                  .flatMap((p) => (kind === "ability" ? p.battlefield : p.hand))
                  .find((x) => x.id === cardInstanceId);
    return source
        ? targetingSourceFromCard(source, isSpell)
        : NO_TARGETING_SOURCE;
}

export function getLegalTargets(
    state: GameState,
    requirement: TargetRequirement,
    source: TargetingSource,
    casterId?: string,
    chosenX?: number,
    /** CR 601.2c (issue #1104) — targets already chosen under THIS SAME
     *  requirement, for a `sameController`-constrained multi-count pick
     *  (Barrin's Spite). Every existing call site scans for the WHOLE legal
     *  set up front (nothing chosen yet), so this defaults to empty — a
     *  `sameController` constraint then imposes no restriction on the
     *  offered set (correct: the FIRST pick of the pair is unconstrained by
     *  itself). Threaded through so a future incremental-pick caller (or a
     *  bot enumerator) CAN narrow the offered set to the sibling's
     *  controller once one half is chosen. */
    alreadySelected: readonly TargetSelection[] = [],
    /** Issue #1378 — the announcing trigger/ability source's LIVE effective
     *  power (CR 613 layer 7c), for a `mvFilter` bound of `"sourcePower"`
     *  (Guardian Scalelord). See `TargetRequirement.mvFilter`'s doc comment
     *  (`cards/types.ts`) for the CR 603.3d snapshot-timing rationale.
     *  Undefined for every caller that doesn't need it — `resolveMvFilter`
     *  falls back to 0, matching every other left-play convention. */
    sourcePower?: number
): TargetSelection[] {
    const targets: TargetSelection[] = [];
    const {
        colors: sourceColors,
        types: sourceTypes,
        subtypes: sourceSubtypes,
        isSpell: sourceIsSpell,
    } = source;
    // CR 702.16 — the source's characteristics, bundled ONCE for the single
    // protection predicate every consult site shares (`isProtectedFrom`), and
    // through the SAME projection the accepted set (`selectTarget`) uses.
    const protectionSource: ProtectionSourceView =
        protectionSourceFromTargeting(source, casterId);

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
        const cardValues = lowerCardFilters(requirement, chosenX, sourcePower);
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
        // CR 601.2c — exclude objects already chosen under THIS SAME
        // requirement (see `isAlreadySelectedTarget`'s doc).
        return targets.filter(
            (t) => !isAlreadySelectedTarget(t, alreadySelected)
        );
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
    // ADR 0068 (issue #1408 T1, tightened by issue #1824) — the PERMANENT-kind
    // filter values, lowered ONCE through the registry's own `lower()` loop.
    // This used to be a hand-written literal at the `checkPermanentTargetFilters`
    // call below, spelling out one line per filter; `PermanentFilterValues` is a
    // `Partial<>`, so a forgotten line was not a type error and the OFFERED set
    // silently drifted open one filter at a time (proven live: adding
    // `controlledSinceTurnStart` to `TargetRequirement` left this map's omission
    // at `tsc` exit 0). `lowerPermanentFilters` iterates `PERMANENT_FILTER_KEYS`
    // — the very list `checkPermanentTargetFilters` loops — so the offered set
    // is derived from the same key list the check runs, by construction. Same
    // shape as the card branch (`lowerCardFilters`) and the spell branch
    // (`lowerSpellFilters`) below, and the same call the carry step
    // (`pendingTargetFiltersFromRequirement`) makes.
    const permanentValues = lowerPermanentFilters(
        requirement,
        chosenX,
        sourcePower
    );

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
                // CR 109.1 / 115 / 202 / 205 / 613 / 701.26 / 109.3 / 102.1 /
                // 302.6 / 400.7 — every permanent-kind filter (including
                // `controller` and `controlledSinceTurnStart`), routed through
                // the SINGLE shared authority — the target-filter registry
                // (ADR 0068 / issue #1408). The values come from
                // `lowerPermanentFilters` (see `permanentValues` above), and
                // the selectTarget mutation runs the SAME
                // `checkPermanentTargetFilters` over the SAME lowered values
                // (read back off the `PendingTarget` by
                // `permanentFilterValuesFromCarrier`), so the offered set and
                // the accepted set can't diverge (the Phelia bug class) — both
                // halves derived from `PERMANENT_FILTER_KEYS`, neither
                // hand-written.
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
                    checkPermanentTargetFilters(
                        filterCtx,
                        card,
                        permanentValues
                    )
                ) {
                    continue;
                }
                // CR 702.16b: protected permanents can't be targeted by
                // spells/abilities of the stated quality — a colour
                // (CR 702.16a), the PLAYER quality (issue #1748, "protection
                // from each of your opponents") for which `casterId` is the
                // source's controller, or a CHARACTERISTIC quality (issue
                // #1120, "protection from legendary creatures") read off the
                // source's live types/supertypes.
                if (isProtectedFrom(card, protectionSource)) continue;
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
            // CR 702.16b/i (applied to a player via CR 115.4) — a player with
            // protection from everything "can't be the target of spells or
            // abilities" from ANY source, their own included (The One Ring,
            // issue #674). Like shroud, an always-on gate with no
            // source-controller exception, so no `actionSource` is threaded.
            // `selectTarget` runs the SAME predicate against the submitted
            // target, so the offered set and the accepted set can't diverge.
            if (playerHasProtectionFromEverything(state, player.id)) continue;
            targets.push({ type: "player", id: player.id });
        }
    }

    // CR 114.1: any spell or ability currently on the stack is a legal target
    // (The casting spell itself isn't on the stack yet during target selection.)
    // CR 113 / 114.1 / 202.2 / 202.3 / 208.2 / 601.2c / 701.8 / 702 — every
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

    // CR 601.2c — exclude objects already chosen under THIS SAME requirement
    // (see `isAlreadySelectedTarget`'s doc) — the offered-set half of the
    // distinct-targets invariant (Magma Burst's kicked "another target" is
    // the first catalogue card whose `count: 2` requirement made the gap
    // observable, but the invariant is general, not card-specific).
    return targets.filter((t) => !isAlreadySelectedTarget(t, alreadySelected));
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

/** LIVE supertypes (CR 205.4a) of the source whose target-selection is in
 *  progress. Used to enforce CR 702.16b for a CHARACTERISTIC protection
 *  quality that names a supertype ("protection from legendary creatures",
 *  Tsabo Tavoc — issue #1120). Fourth sibling of
 *  `getPendingTargetSourceColors` / `…Types` / `…Subtypes`, with the same
 *  source-location logic: copy-retarget/retarget/trigger → the stack item;
 *  ability → the battlefield permanent; cast → the hand card. Returns an empty
 *  array if the source can't be located. */
export function getPendingTargetSourceSupertypes(
    state: GameState,
    cardInstanceId: string,
    kind: "cast" | "ability" | "copy-retarget" | "retarget" | "trigger"
): CardSupertype[] {
    const source: CardInstanceState | undefined =
        kind === "copy-retarget" || kind === "retarget" || kind === "trigger"
            ? state.stack.find((x) => x.id === cardInstanceId)
            : state.players
                  .flatMap((p) => (kind === "ability" ? p.battlefield : p.hand))
                  .find((x) => x.id === cardInstanceId);
    return source
        ? [...protectionSourceCharacteristics(source).supertypes]
        : [];
}

/** Effective POWER (CR 613 layer 7c) of a TRIGGERED ability's source
 *  permanent, read live off the CURRENT battlefield (not the trigger stack
 *  item's `...self` snapshot, which carries the source's PRINTED base
 *  power/toughness from `collectTriggers`-time, not the layered effective
 *  value). Used by `TargetRequirement.mvFilter`'s `"sourcePower"` cap
 *  (Guardian Scalelord: "mana value X or less, where X is this creature's
 *  power", issue #1378, CR 603.3d) — called from `raiseTriggerTargetSelection`
 *  at the exact moment the trigger's target is chosen, which is what fixes
 *  the value as the ability is put on the stack (no separate snapshot/carry
 *  needed, mirroring how Ward / Backup's `targetIsAnother` already need no
 *  re-check plumbing for a "checked once, at this moment" CR 603.3d value).
 *  Returns 0 when the source can no longer be found on any battlefield (CR
 *  608.2b last-known-information convention, matching `EffectManaValueValue`'s
 *  own left-play fallback) — unreachable in practice since target selection
 *  runs synchronously as the trigger is placed on the stack, with no
 *  priority window for the source to leave beforehand. */
export function getTriggerSourcePower(
    state: GameState,
    triggerSourceId: string | undefined
): number {
    if (!triggerSourceId) return 0;
    for (const p of state.players) {
        const card = p.battlefield.find((c) => c.id === triggerSourceId);
        if (card) return getEffectivePower(state, card);
    }
    return 0;
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
    chosenX: number | undefined,
    /** Issue #1378 — see `getLegalTargets`'s same-named parameter. Threaded
     *  through so the CARRIED `PendingTarget.mvFilter` (validated later at
     *  `selectTarget`, `game.ts`) resolves `"sourcePower"` to the SAME live
     *  value the offered set (`getLegalTargets`) just used — "lower once,
     *  check everywhere" (ADR 0068). */
    sourcePower?: number
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
        ...(lowerPermanentFilters(
            req,
            chosenX,
            sourcePower
        ) as Partial<PendingTarget>),
    };
    // Fixup (T2 review, issue #1409): `lowerSpellFilters` always resolves
    // `spellStackKind` to its explicit default `"spell"` (never
    // `undefined` — see the descriptor's doc comment), so spreading it
    // unconditionally used to stamp `spellStackKind: "spell"` onto EVERY
    // `PendingTarget`, including permanent/player-only requirements that
    // never target a spell. Only carry the spell-lowered fields when the
    // requirement actually admits a spell target.
    const reqTypes = Array.isArray(req.type) ? req.type : [req.type];
    // Shared with the retarget producers and the CR 608.2b fizzle gate
    // (`gre/state.ts`) — one authority for the `"spell" | "spell-or-permanent"`
    // test instead of three inline copies of the same `includes` pair, which
    // is the shape the exhaustive-target-type rule keeps having to re-audit.
    if (requirementAdmitsSpellTarget(req)) {
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
            lowerCardFilters(
                req,
                chosenX,
                sourcePower
            ) as Partial<PendingTarget>
        );
    }
    if (req.zone) out.zone = req.zone;
    return out;
}

/** Resolve a trigger requirement's `count` to a concrete {min, max}. A
 *  triggered ability's announcement (CR 603.3d) incorporates CR 601.2c–d —
 *  which DOES include announcing how many targets a variable-target
 *  ability picks (601.2c) — but NOT 601.2b, the step that announces an `X`
 *  value. So a trigger has no way to learn what `X` even IS; a bare `"X"`
 *  collapses to none (0). An "up to" requirement without an explicit `max`
 *  is treated as unbounded. The object form's `max` may itself be the
 *  literal `"X"` (CR 601.2c "up to X" range, issue #2365) — it collapses the
 *  SAME way a bare `"X"` does, folding the upper bound down to `min` (never
 *  `NaN`, never a literal string reaching a `PendingTarget`): a `{min: 0,
 *  max: "X"}` trigger requirement always resolves to `{min: 0, max: 0}`,
 *  i.e. no targets.
 *
 *  This collapse is a DEFENSIVE fallback, not the primary guard: the one
 *  inline-authoring surface a validator can statically check —
 *  `reflexiveTrigger`'s own `targetRequirement` field — REJECTS `max: "X"`
 *  outright at authoring time (`isInlineTargetRequirement`,
 *  `gre/effects/validate.ts`), so it should never actually reach here that
 *  way. A card-def or emblem `TriggeredAbility.targetRequirement` is NOT
 *  routed through that validator (only `effects[]` is) and could still
 *  tsc-check with this shape; the catalogue-wide guard in
 *  `cards/__tests__/triggerVariableTargetCount.test.ts` covers that surface
 *  instead, so the shape can't ship silently inert either way (#957/#958). */
function triggerTargetMinMax(count: TargetRequirement["count"]): {
    min: number;
    max: number;
} {
    if (typeof count === "number") return { min: count, max: count };
    if (count === "X") return { min: 0, max: 0 };
    const max =
        count.max === "X" ? count.min : (count.max ?? Number.MAX_SAFE_INTEGER);
    return { min: count.min, max };
}

/** The announcement-time target legality of ONE trigger stack item under ONE
 *  requirement (CR 603.3d) — the shared half of "which targets are legal right
 *  now", used both to decide whether a MODE is choosable at all (CR 603.3c) and
 *  to lock/prompt the targets themselves. Extracted verbatim from
 *  `raiseTriggerTargetSelection` so the mode-legality question is answered by
 *  the SAME code that later announces the targets — a mode offered here must
 *  never turn out to have no legal target one step later. */
/** Reflexive self-EXCLUDE for a requirement whose source is known by instance
 *  id — "ANOTHER target nonlegendary creature you control" (Reflection of
 *  Kiki-Jiki, issue #2399). Merges `sourceInstanceId` into the requirement's
 *  `excludeInstanceIds` when `excludeSource` is set, preserving any author-time
 *  entries; returns the requirement untouched otherwise.
 *
 *  `excludeInstanceIds` — not a new mechanism — is deliberate: it is the field
 *  `getLegalTargets`, the pending-target carrier `applyOneTargetSelection`
 *  validates against, and the client's `matchesTargetRequirement` all already
 *  read, so ONE merge here reaches every consumer (ADR 0068 single-authority
 *  target filtering). The alternative idiom shipped cards use for the same
 *  clause — a dynamic `getTargetRequirement(source)` closure (Giver of Runes,
 *  Manifold Key) — cannot serve here twice over: a back face's activated
 *  abilities are JSON-encoded into their synthesized definition id
 *  (`backFaceAsTokenSpec`), so a closure does not survive a client-side decode,
 *  and `enumerateAbilityMoves` skips any ability carrying one, which would make
 *  the ability invisible to the bot. */
export function applySelfExclusion(
    req: TargetRequirement,
    sourceInstanceId: string
): TargetRequirement {
    if (!req.excludeSource) return req;
    return {
        ...req,
        excludeInstanceIds: [
            ...(req.excludeInstanceIds ?? []),
            sourceInstanceId,
        ],
    };
}

function triggerTargetLegality(
    state: GameState,
    item: StackItem,
    req: TargetRequirement
): {
    effectiveReq: TargetRequirement;
    effectiveLegal: TargetSelection[];
    sourcePower: number | undefined;
} {
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
    if (item.triggerSourceId) {
        effectiveReq = applySelfExclusion(effectiveReq, item.triggerSourceId);
    }

    // A triggered ability's source characteristics come from the on-stack
    // trigger item (a `...self` snapshot of the source), read the same way
    // a retargeted spell reads its stack item (CR 109.5). ALL FIVE
    // dimensions come from the one factory — CR 113.3 (a triggered ability
    // is not a spell) included. This site is why `TargetingSource` is one
    // required-field object: it used to assemble colours/types/subtypes by
    // hand and take the `[]` default for CR 205.4a supertypes, which made a
    // supertype-bearing protection quality invisible on the ENTIRE
    // triggered-ability path — including the CR 603.3c/603.3d auto-select
    // in the caller, which locks a target with no later mutation-side
    // re-check (issue #1120 review).
    const triggerSource = pendingTargetingSource(state, item.id, "trigger");
    // Issue #1378 — CR 603.3d: the source's live effective power, read
    // NOW (as this trigger's target is chosen) for a `mvFilter` bound of
    // `"sourcePower"` (Guardian Scalelord). `item.triggerSourceId` is the
    // BATTLEFIELD permanent carrying the ability (`buildTriggerItem`) —
    // distinct from `item.id`, the synthetic stack-item id
    // `triggerSource` above reads from.
    const sourcePower = getTriggerSourcePower(state, item.triggerSourceId);
    const legal = getLegalTargets(
        state,
        effectiveReq,
        triggerSource,
        item.controllerId,
        undefined,
        [],
        sourcePower
    );

    // CR 702.21a (issue #1361) — when TWO+ spells/abilities simultaneously
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

    return { effectiveReq, effectiveLegal, sourcePower };
}

/** The announce-time mode list of a triggered ability stack item, or
 *  `undefined` when the ability is not modal (CR 603.3c, issue #2461).
 *  `findTriggeredAbility` is the same union-of-printed-and-granted lookup
 *  resolution uses (CR 707.9d), so a modal trigger granted by a copy effect
 *  announces exactly like a printed one. */
function triggerAbilityModes(item: StackItem): AbilityMode[] | undefined {
    if (!item.triggeredAbilityId) return undefined;
    const modes = findTriggeredAbility(item, item.triggeredAbilityId)?.modes;
    return modes && modes.length > 0 ? modes : undefined;
}

/** CR 700.2c — "If a spell or ability targets one or more targets only if a
 *  particular mode is chosen for it, its controller will need to choose those
 *  targets only if they chose that mode" — the announcement-time
 *  `targetRequirement` that actually applies
 *  to a triggered-ability stack item: for a MODAL ability it is the ANNOUNCED
 *  mode's requirement and never the ability-level one (a modal ability has no
 *  ability-level body or requirement to fall back on — the modes carry both);
 *  for every other trigger it is the ability's own. Returns `undefined` for a
 *  modal trigger whose mode has not been announced yet, so no target can be
 *  locked ahead of the mode. */
function triggerAnnouncedRequirement(
    item: StackItem
): TargetRequirement | undefined {
    if (!item.triggeredAbilityId) return undefined;
    const ability = findTriggeredAbility(item, item.triggeredAbilityId);
    if (!ability) return undefined;
    const modes = triggerAbilityModes(item);
    if (!modes) return ability.targetRequirement;
    if (!item.chosenModeId) return undefined;
    return modes.find((m) => m.id === item.chosenModeId)?.targetRequirement;
}

/** CR 603.3c — is `mode` a legal choice for this trigger right now? "If one of
 *  the modes would be illegal (due to an inability to choose legal targets, for
 *  example), that mode can't be chosen." A mode with no target requirement is
 *  always choosable; a mode with a REQUIRED one (min ≥ 1) is choosable only
 *  while the board supplies at least that many legal candidates. An "up to"
 *  requirement (min 0) stays choosable with nothing legal — choosing zero
 *  targets is legal. */
function triggerModeIsChoosable(
    state: GameState,
    item: StackItem,
    mode: AbilityMode
): boolean {
    const req = mode.targetRequirement;
    if (!req) return true;
    const { min } = triggerTargetMinMax(req.count);
    if (min === 0) return true;
    const { effectiveLegal } = triggerTargetLegality(state, item, req);
    return effectiveLegal.length >= min;
}

/** CR 603.3c (issue #2461) — announce the MODE of every modal triggered ability
 *  now on the stack that has not announced one yet. "If a triggered ability is
 *  modal, its controller announces the mode choice when putting the ability on
 *  the stack. If one of the modes would be illegal (due to an inability to
 *  choose legal targets, for example), that mode can't be chosen. If no mode is
 *  chosen, the ability is removed from the stack." CR 700.2b states the same
 *  rule from the modal side ("The controller of a modal triggered ability
 *  chooses the mode(s) as part of putting that ability on the stack … If no
 *  mode is chosen, the ability is removed from the stack").
 *
 *  Scans the stack top-down, and for the first un-announced modal trigger:
 *   - removes the ability from the stack when NO mode is choosable, then keeps
 *     scanning (CR 603.3c's last sentence);
 *   - auto-announces the sole choosable mode with no prompt — there is no
 *     decision to make, the same way a sole legal target auto-selects;
 *   - otherwise raises a `kind: "trigger-mode"` PendingChoice carrying ONLY the
 *     choosable modes, parks priority on the controller and returns `true`
 *     (suspended). The submission lands on `StackItem.chosenModeId`
 *     (`pendingChoiceSubmit.ts`) and is never revisited — CR 700.2b makes the
 *     pick part of PUTTING the ability on the stack, a one-time announcement.
 *
 *  Returns `false` when no mode announcement is owed. Called only from
 *  `raiseTriggerTargetSelection`, which every trigger-placement path already
 *  funnels through, so the announcement rides all four of them for free. */
function raiseTriggerModeAnnouncement(state: GameState): boolean {
    for (let i = state.stack.length - 1; i >= 0; i--) {
        const item: StackItem = state.stack[i];
        // CR 700.2b — the mode is chosen as part of putting the ability on the
        // stack, once; CR 700.2f — "Changing a spell or ability's target can't
        // change its mode". An already-announced trigger is never re-prompted.
        if (item.chosenModeId !== undefined) continue;
        const modes = triggerAbilityModes(item);
        if (!modes) continue;

        const choosable = modes.filter((m) =>
            triggerModeIsChoosable(state, item, m)
        );
        if (choosable.length === 0) {
            state.stack.splice(i, 1);
            continue;
        }
        if (choosable.length === 1) {
            item.chosenModeId = choosable[0].id;
            continue;
        }

        state.pendingChoices = [
            ...(state.pendingChoices ?? []),
            {
                stackItemId: item.id,
                step: 0,
                choiceId: `trigger-mode-${item.id}`,
                playerId: item.controllerId,
                kind: "trigger-mode",
                count: 1,
                // Only the CHOOSABLE modes cross the wire — an illegal mode is
                // not offered at all (CR 603.3c), so every option the chooser
                // (or the Bot) can submit is a legal announcement.
                options: choosable.map((m) => ({ id: m.id, label: m.label })),
                prompt: "Choose a mode for this triggered ability.",
            },
        ];
        state.priorityPlayerId = state.pendingChoices[0].playerId;
        state.passCount = 0;
        return true;
    }
    return false;
}

/** CR 603.3d / 603.3c (issue #1193) — the whole announcement sweep for a
 *  triggered ability that has just gone on the stack: it raises the MODE
 *  announcement FIRST and the target selection second, so the name understates
 *  it (see the mode paragraph below; the rename to `raiseTriggerAnnouncement`
 *  is deliberately deferred — ~130 references across ~60 catalogue test files
 *  would bury a correction-grade change in mechanical churn). Locks
 *  announcement-time targets for any TARGETED triggered ability now on the
 *  stack. Scans the stack top-down; for
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
 *  normal priority flow). CR 603.3c (issue #2461) — a MODAL trigger's MODE is
 *  announced first (`raiseTriggerModeAnnouncement`, which can itself suspend on
 *  a `trigger-mode` PendingChoice or remove a no-choosable-mode ability from the
 *  stack); only the announced mode's requirement is then read here (CR 700.2c).
 *  Divide-as-you-choose (Fury) rides on `divideTotal`;
 *  the per-target amounts are assigned through the existing divide UI and
 *  written onto the trigger's `targetAmounts` at `finalizeTargetSelection`. */
export function raiseTriggerTargetSelection(state: GameState): boolean {
    // CR 603.3c (issue #2461) — a MODAL triggered ability announces its MODE
    // first: the pick gates which `targetRequirement` even applies (CR 700.2c),
    // so no target may be locked before it. Suspends on the announcement when a
    // controller genuinely has to choose.
    if (raiseTriggerModeAnnouncement(state)) return true;
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
              ? triggerAnnouncedRequirement(item)
              : undefined;
        if (!req) continue;

        const { effectiveReq, effectiveLegal, sourcePower } =
            triggerTargetLegality(state, item, req);

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
            // `"triggered-ability"` (issue #2360) — an AUTO-selected trigger
            // target is still a trigger's target, not a cast spell's.
            emitBecameTargetEvents(
                state,
                item.targets,
                item.controllerId,
                item.id,
                "triggered-ability"
            );
            continue;
        }

        // A real choice is owed — raise the same PendingTarget the spell path
        // uses, pointed at this on-stack trigger item (kind: "trigger").
        const divideTotal =
            req.divideAsChosen && typeof req.divideAsChosen.total === "number"
                ? req.divideAsChosen.total
                : undefined;
        // Reuses the SAME {min, max} `triggerTargetMinMax` already resolved
        // above (issue #2365) — this used to re-derive `count` independently
        // from `req.count`, which missed the object form's `max === "X"`
        // shape (a literal `"X"` string would have reached `PendingTarget`).
        const count: PendingTarget["count"] =
            typeof req.count === "number" ? req.count : { min, max };
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
            ...pendingTargetFiltersFromRequirement(
                effectiveReq,
                undefined,
                sourcePower
            ),
            ...(divideTotal !== undefined ? { divideTotal } : {}),
            ...(req.divideAsChosen?.kind
                ? { divideKind: req.divideAsChosen.kind }
                : {}),
        };
        state.priorityPlayerId = item.controllerId;
        state.passCount = 0;
        return true;
    }
    return false;
}
