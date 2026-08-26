import { ConvexError, v, type GenericId, type Infer } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { assertIsAdmin, auth, getCurrentUser } from "./auth";
import {
    internalMutation,
    mutation,
    query,
    type MutationCtx,
} from "./_generated/server";
import {
    getAllCardNames,
    getDefinition,
    getInstanceManaCost,
    tryGetDefinition,
} from "./cards";
import { isExileCostEligible } from "./cards/exileCostEligibility";
import { buildStateFromScenario } from "./gre/scenarioBuilder";
import { BLADE_SCENARIOS } from "./gre/ai/blade/registry";
import { resolveBladeLoadState } from "./gre/ai/blade/runner";
import {
    type CardInstanceState,
    type GameState,
    type GenericSpendAmbiguity,
    type ManaSubstitution,
    type PendingActivation,
    type PendingCast,
    type PendingTarget,
    type PlayerState,
    type StackItem,
    getPlayer,
    getOpponentId,
    drawCard as drawCardFromLibrary,
    emitCardDrawn,
    discardToGraveyard,
    payExileThisCost,
    matchesPermanentFilter,
    moveCard,
    removeFromZone,
    removePermanentTo,
    getBasicLandMana,
    payManaCost,
    manaSpentDelta,
    genericSpendAmbiguityForPayment,
    validateManaSpendOrder,
    payManaCostForSpell,
    spendablePoolForSpell,
    payManaCostForAbility,
    spendablePoolForAbility,
    addRestrictedManaToPool,
    reverseRestrictedManaFromPool,
    payRemoveCounterCost,
    canPayDiscardLastDrawn,
    payDiscardLastDrawn,
    payDiscardAtRandomCost,
    commitLandsForCost,
    resolveTopOfStack,
    normalizeManaCost,
    isManaCostCovered,
    getManaSubstitutions,
    getCostModifiers,
    applyCostModifiers,
    getStaticAdditionalSacrifices,
    emitSpellCastEvent,
    emitBecameTargetEvents,
    emitPermanentTapped,
    discardPermanentTappedEvent,
    processPendingActionTriggers,
    realizeManaAbilityTapBonus,
    allocInstanceId,
    tapPermanent,
    dealDamageFromPermanentToPlayer,
    loseLifeEmitting,
    refreshCounterGatedStatics,
    PENDING_TARGET_FILTER_KEYS,
    resolveTargetRequirementCount,
} from "./gre/state";
import {
    selectCompanion,
    canSummonCompanion,
    COMPANION_SUMMON_COST,
} from "./gre/companion";
import {
    type SacrificeSelection,
    type SacrificeRequirement,
    buildSacrificeRequirements,
    autoResolveFungible,
    isSacrificeSelectionComplete,
    isSacrificeCandidateLegal,
    applySacrificeSelection,
    sacrificeCandidates,
    canAffordSacrifice,
} from "./gre/sacrificeChoice";
import {
    buildAutoTapSources,
    solveAutoTap,
    solveSmartAutoTap,
    solveAutoTapPartial,
    manaFromPlan,
    floatingAfterPlan,
    type AutoTapPlan,
    type AutoTapSource,
    type Demand,
} from "./gre/autoTap";
import { evaluateAutoTapPosition } from "./gre/evaluate";
import {
    buildBoardAbilityDemands,
    buildHandSpellDemands,
} from "./gre/autoTapDemands";
import { isGuardedAgainst, playerHasShroud } from "./gre/permanentGuard";
import { playerHasProtectionFromEverything } from "./gre/protection";
import {
    findFlashbackCastable,
    flashbackExileEligibleCount,
    getFlashbackAdditionalCost,
    getFlashbackCost,
    hasFlashback,
} from "./gre/flashback";
import {
    countDistinctCardTypes,
    findEscapeCastable,
    getEscapeExileSpec,
    getEscapeManaCost,
    hasEscape,
} from "./gre/escape";
import {
    findRetraceCastable,
    hasRetrace,
    RETRACE_COST_LEGS,
} from "./gre/retrace";
import {
    applyGenericOffset,
    buildConvokeCreatureChoice,
    buildDelveExileChoice,
    collapseForcedDelvePick,
    coverColoredAndHybridPips,
    creatureConvokeColors,
    spellHasConvoke,
    spellHasDelve,
} from "./gre/payWith";
import {
    getMadnessCost,
    declineMadness,
    consumeMadnessCastChoice,
} from "./gre/madness";
import {
    hasRebound,
    declineRebound,
    consumeReboundCastChoice,
} from "./gre/rebound";
import { assertDeckLegal, type ResolvePool } from "./formats";
import {
    JOIN_CODE_REJECTED,
    findGameByJoinCode,
    mintJoinCode,
} from "./joinCodes";
import { loadBanlistOverrides } from "./banlists";
import {
    assertLimitedSeatOwnership,
    resolvePoolFromEvent,
} from "./limited/poolResolution";
import { hydrateSeat } from "./limitedSeatStore";
import {
    assertChallengeableSeat,
    assertSameEventDeck,
} from "./limited/challenge";
import {
    bindPairingMatch,
    recordPlayedPairing,
    resolveStartablePairing,
    unbindPairingMatch,
} from "./limited/pairingMatch";
import type { LimitedRound } from "./limited/eventTypes";
import type { AdvanceRoundResult } from "./limited/rounds";
import { areRoundsRunning } from "./limited/eventStatus";
import {
    bestOfForMatchFormat,
    resolveMatchFormat,
} from "./limited/matchFormat";
// One-directional (issue #1645): `limitedEvents.ts` imports nothing from this
// module, so this cannot cycle. A round Match against a bot seat must be built
// from the deck the SERVER derives from that seat's Pool — never a
// client-supplied decklist, because the Match's result lands in the standings.
// `cascadeEventRounds` (issue #1646) is the same one-directional import: the
// round-advance/event-finish decision lives there, this module only calls it.
// `scheduleRoundDeadline` (issue #1647) is the same shape again: a round this
// module's own cascade just opened needs the identical deadline schedule
// `openPlayPhaseIfReady` arms for round 1, so the scheduling call lives once
// in `limitedEvents.ts` and is invoked from both places.
import {
    cascadeEventRounds,
    resolveSeatAutoBuiltDeck,
    scheduleRoundDeadline,
} from "./limitedEvents";
import type {
    AbilityMode,
    ActivatedAbility,
    AdditionalCostSpec,
    CardDefinition,
    CardType,
    Color,
    CostLegs,
    ManaCost,
    PermanentFilter,
    SpellMode,
    TargetRequirement,
} from "./cards/types";
import {
    permanentFilterValuesFromCarrier,
    playerFilterValuesFromCarrier,
    spellFilterValuesFromCarrier,
} from "./gre/targetFilters";
import {
    assertLegalAction,
    canCastFromGraveyardByPermission,
    canCastPermanentFromGraveyardByPermission,
    canCastSpellsFromTopOfLibrary,
    canPlayLandsFromGraveyard,
    isCastableLibraryTopSpell,
    isPlayableLibraryTopLand,
    libraryTopCastLifeCost,
    markGraveyardPermanentCastUsed,
    getLegalTargets,
    checkPermanentTargetFilters,
    checkSpellTargetFilters,
    checkPlayerTargetFilters,
    checkCardTargetFilters,
    pickCardFilterValues,
    type TargetFilterCtx,
    pendingTargetingSource,
    isProtectedFrom,
    protectionSourceFromTargeting,
    targetingSourceFromCard,
    pendingTargetFiltersFromRequirement,
    raiseTriggerTargetSelection,
    solvePhyrexianSplit,
    siblingControllerIdFor,
    isAlreadySelectedTarget,
    genericManaShortfall,
    flashSurchargeRequired,
    foldFlashSurchargeCost,
    effectiveRequirementForSource,
} from "./gre/rules";
// issue #2283 — the raised-origin (`trigger`/`retarget`/`copy-retarget`)
// finalization and its divide split live in one module shared with the bot's
// in-search applier, so the two can never drift.
import {
    applyRaisedTargetFinalization,
    finalizeDivideAmounts,
    pendingTargetCountMaxReached,
} from "./gre/pendingTargetOrigin";
import {
    PHYREXIAN_LIFE_PER_PIP,
    phyrexianManaAdditions,
    phyrexianPipCount,
} from "./gre/phyrexian";
import { STATIC_EFFECT_CTX, getEffectivePower } from "./gre/layers";
import {
    attackTargetExcessSink,
    damageAssignmentLethalViolation,
} from "./gre/damageAssignment";
import {
    canPayTapOtherCost,
    totalTapOtherPower,
    type TapOtherCandidate,
    type TapOtherCostSpec,
} from "./gre/tapOtherCost";
import { buildActivationSacrificeSelection } from "./gre/activationCostPicks";
// ADR 0091 / issue #1209 — the OWED-PAYMENT seam. The two commit gates below
// are expressed through `nextOwedPayment` rather than each carrying its own
// copy of the park list; `isTapOtherPaid` / `tapOtherContribution` live beside
// it so the gate, the picker mutation and the bot all weigh a crew pick the
// same way.
import {
    isTapOtherPaid,
    nextOwedPayment,
    tapOtherContribution,
} from "./gre/owedPayment";
import { projectFullState, projectPublicState } from "./gameProjections";
import {
    canPayAlternativeCost,
    getAlternativeCost,
    validateAlternativeHandCostPicks,
    handCardMatchesFilter,
} from "./gre/alternativeCost";
// Bestow (CR 702.103) — the cost half rides the alternative-cost machinery
// above; these are the CHARACTERISTIC half (`convex/gre/bestow.ts`).
import {
    BESTOW_TARGET_REQUIREMENT,
    applyBestowCharacteristics,
    isBestowAlternativeCost,
} from "./gre/bestow";
// Additional-cost system (CR 118.8 / 601.2b) — costs paid ALONGSIDE the mana
// cost, including the caster-chosen `oneOf` disjunction.
import {
    additionalCostHandLeg,
    additionalCostLegs,
    additionalCostLifePayment,
    canPayAdditionalCostSpec,
    resolveAdditionalCosts,
} from "./gre/additionalCost";
// Kicker cost system (CR 702.33 / 702.33e, ADR 0079) — plural kickers on the
// shared `CostLegs` vocabulary, payment recorded per kicker id.
import type { KickerPayments } from "./gre/kicker";
import {
    assertKickerPermanentSlotFree,
    buildCastHandCostChoice,
    buildCastPermanentCostChoice,
    canPayKickerLegs,
    foldKickerCosts,
    kickerLifeCost,
    resolveCastPermanentSelection,
    resolveKickerPayments,
    totalKickerCount,
} from "./gre/kicker";
import { liveSupertypesOf, countSnowLands } from "./gre/snow";
import { computeSoloViewerId } from "./soloViewer";
import { type ManualGameState, type ManualLogEntry } from "./manual";
import {
    appendManualLog,
    getLatestManualState,
    saveManualState,
    setupManualGame,
    projectManualState,
    manualMoveCard as manualMoveCardFn,
    manualSetTapped as manualSetTappedFn,
    manualUntapAll as manualUntapAllFn,
    manualAdjustLife as manualAdjustLifeFn,
    manualAdjustCounter as manualAdjustCounterFn,
    manualSetFaceDown as manualSetFaceDownFn,
    manualSetLane as manualSetLaneFn,
    manualSetBackColumn as manualSetBackColumnFn,
    manualAttach as manualAttachFn,
    manualSetArrow as manualSetArrowFn,
    manualClearArrows as manualClearArrowsFn,
    manualClearArrow as manualClearArrowFn,
    manualDraw as manualDrawFn,
    manualMill as manualMillFn,
    manualExileTop as manualExileTopFn,
    manualPeek as manualPeekFn,
    manualShuffle as manualShuffleFn,
    manualCreateToken as manualCreateTokenFn,
    manualRoll as manualRollFn,
    manualSetNote as manualSetNoteFn,
    manualSetPhase as manualSetPhaseFn,
    manualSetActivePlayer as manualSetActivePlayerFn,
    manualEndTurn as manualEndTurnFn,
    manualConcede as manualConcedeFn,
    manualReveal as manualRevealFn,
    manualRevealHand as manualRevealHandFn,
    backfillManualCardNames,
} from "./manual";
import { compactState, expandState } from "./gre/serialize";
import {
    assertExpectedInput,
    computeOwedPlayerIds,
    refreshExpectedInput,
} from "./gre/expectedInput";
import {
    advancePhase,
    drainAutoPasses,
    applyAllCombatDamage,
    emitBlockersConfirmedEvents,
    emitAttackersDeclaredEvents,
    finalizeDrawReplacementPay,
    isSorceryTiming,
    wasCastOffSorceryTiming,
} from "./gre/phases";
// CR 606 (issue #2491) — the loyalty-ability rules live in pure engine code so
// the bot's enumerator/search can consume the SAME predicate this module's
// throwing wrapper does. `payLoyaltyCost` is re-exported below, unchanged, for
// the callers (and tests) that have always imported it from here.
import {
    LOYALTY_VIOLATION_MESSAGE,
    loyaltyActivationViolation,
    payLoyaltyCost,
} from "./gre/loyalty";
import { effectivePermanentView } from "./gre/permanentView";
import { freshSeed, seededShuffle } from "./gre/rng";
import { makeMulliganState, recordDeclaration } from "./gre/mulligan";
import type { Phase, ManaRestriction } from "./gre/types";
// CR 611.2a / 613.1f (issue #1880) — the post-layer activated-ability set now
// lives at GRE level so the leaf `gre/constants.ts` mana probes can reach it
// without importing this module; re-exported below for back-compat with every
// existing `from "./game"` / `from "../../game"` import site.
import { getEffectiveActivatedAbilities } from "./gre/activatedAbilities";
export { getEffectiveActivatedAbilities } from "./gre/activatedAbilities";
// CR 602.2a / 602.5 — the shared shape of an activated ability's stack item and
// the shared activation tally, so the three commit sites below and the ISMCTS
// search's move sandbox (`gre/search.ts`, issue #1920) cannot drift apart.
import {
    buildActivatedAbilityStackItem,
    recordActivation,
} from "./gre/activationCommit";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    MANA_COLORS,
    applyLandManaReplacement,
    declaresAsEntersMode,
    hybridCostKey,
    getActivatedManaAbility,
    manaAbilityPaidWithoutTapping,
    getActivatedManaColor,
    getActivatedManaRestriction,
    getDynamicManaProduced,
    getEffectiveManaChoices,
    getManaTapOptionsDetailed,
    getFixedManaAmount,
    getFixedSacrificeManaAbility,
    hasManaAbility,
    isCreature,
    isPlaneswalker,
    isTapLockedBySummoningSickness,
    manaGateBattlefields,
    manaValue,
    resolvePendingTargetKind,
} from "./gre/constants";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    getRequiredAttackerIds,
    mustAttack,
    getMaxBlockTargets,
    getAttackerCapEffect,
    getBlockerCapEffect,
    foldAttackRequirements,
    foldBlockRequirements,
    validateMinimumBlockers,
    validateDeclaredAttackers,
    validateDeclaredBlockers,
    collectBlockBypassCharges,
    collectAttackSacrificeTax,
    collectAttackManaTax,
    markAttacking,
    markDeclaredBlockers,
    recordAttackerDeclared,
} from "./gre/combat";
import {
    getEffectiveBlockGraph,
    outstandingDamageAssigner,
    isLegalBandComposition,
    recordBlockedAttackers,
    applyMeleeUnblockedRider,
} from "./gre/banding";
import { checkStateBasedActions } from "./gre/sba";
import {
    canTurnFaceUp,
    getMorphCost,
    isMorphCastAlternativeCost,
    morphTurnUpPaymentPlan,
} from "./gre/morph";
import { turnFaceDown, turnFaceUp } from "./gre/faceDown";
import {
    applyPlayLand,
    applyPlayLandFromExile,
    applyPlayLandFromGraveyard,
    applyPlayLandFromLibraryTop,
} from "./gre/playLand";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
    applyLandEntrySubmit,
    applyNameCardSubmit,
    applyRandomRevealAck,
} from "./gre/pendingChoiceSubmit";
import {
    assertCallerOwnsSeat,
    assertSeatOwnership,
    gameBelongsToUser,
    seatBelongsToUser,
} from "./gameLifecycle";
import {
    activeGameOpponentName,
    allSeatsReady,
    applySideboard,
    assertNotEventBotSeat,
    botIsChooser,
    botSeatId,
    buildNextGameSeats,
    findActiveMatchForUser,
    forfeitMatch as computeForfeitMatch,
    matchBelongsToUser,
    nextGameActivePlayerId,
    pickCoinTossWinner,
    recordGameResult,
    snapshotDeck,
    toNextGamePlayers,
    type MatchPlayer,
    type PlayDrawChoice,
} from "./matches";
import {
    appendMatchSeat,
    deleteGameDecks,
    deleteMatchDecks,
    hydrateGameSeats,
    hydrateMatchPlayers,
    insertGameWithDecks,
    insertMatchWithDecks,
    loadGameSeatCards,
    loadMatchSeatDecks,
    patchGameSeats,
    saveMatchSeatDeck,
} from "./deckStore";

export const STARTING_HAND_SIZE = 7;

/** Thrown by create/join when the user already occupies an active game (#155). */
const ACTIVE_GAME_MESSAGE =
    "You already have an active game. Finish or leave it before starting another.";

export type DeckInput = {
    id: string;
    name: string;
    format: string;
    cards: { cardId: string; cardName: string }[];
    sideboard?: { cardId: string; cardName: string }[];
};

export type PlayerInput = {
    id: string;
    name: string;
    bgColor: string;
    deck: DeckInput;
};

/** CR 702.139c (ADR 0064) — instantiates `player`'s auto-declared companion
 *  (`selectCompanion`, gre/companion.ts) into a fresh `CardInstanceState`,
 *  mirroring how a library card is instantiated above: same field shape, a
 *  real allocated instance id (so it can later move into `hand` and be cast
 *  normally), just no starting zone array to sit in — the instance lives on
 *  `PlayerState.companion` instead. Returns `undefined` when the sideboard
 *  carries no qualifying companion. */
function buildCompanionInstance(
    player: PlayerInput,
    counter: { nextInstanceId?: number }
): CardInstanceState | undefined {
    const def = selectCompanion(
        (player.deck.sideboard ?? []).map((c) => c.cardId),
        player.deck.cards.map((c) => c.cardId)
    );
    if (!def) return undefined;
    return {
        id: allocInstanceId(counter),
        card: { id: def.id },
        types: def.types,
        subtypes: def.subtypes ?? [],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: def.staticAbilities ?? [],
        controllerId: player.id,
        ownerId: player.id,
        // CR 702.139 — nominal tag only; the companion slot is not a real
        // zone (see the `PlayerState.companion` / serialize.ts doc).
        zone: "exile" as const,
        isTapped: false,
    };
}

function buildPlayerState(
    player: PlayerInput,
    counter: { nextInstanceId?: number }
): PlayerState {
    const instances = player.deck.cards.map((deckCard) => {
        const def = getDefinition(deckCard.cardId);
        return {
            id: allocInstanceId(counter),
            card: { id: def.id },
            types: def.types,
            subtypes: def.subtypes ?? [],
            power: def.power,
            toughness: def.toughness,
            staticAbilities: def.staticAbilities ?? [],
            controllerId: player.id,
            ownerId: player.id,
            zone: "library" as const,
            isTapped: false,
        };
    });

    const companionInstance = buildCompanionInstance(player, counter);

    return {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: 20,
        hand: [],
        library: instances,
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...(companionInstance
            ? { companion: { instance: companionInstance, used: false } }
            : {}),
    };
}

/** Builds the fresh initial GameState for a Game: shuffles each library, draws
 *  opening hands, and enters the mulligan phase (CR 103.5). Shared by every
 *  create/join path (and, later, the Bo3 next-Game build) so the init is
 *  identical everywhere. `activePlayerId` defaults to the first player. */
export function buildInitialGameState(
    players: PlayerInput[],
    activePlayerId?: string
): GameState {
    const idCounter: { nextInstanceId?: number } = {};
    const playersState = players.map((p) => buildPlayerState(p, idCounter));
    const activeId = activePlayerId ?? playersState[0].id;
    // CR 500.1: the active player begins their first turn at game start.
    const active = playersState.find((p) => p.id === activeId);
    if (active) active.turnsTaken = 1;

    const rngSeed = freshSeed();
    const initialState: GameState = {
        players: playersState,
        stack: [],
        turn: 1,
        activePlayerId: activeId,
        priorityPlayerId: activeId,
        passCount: 0,
        phase: "UNTAP" as Phase,
        rngSeed,
        rngCounter: 0,
        nextInstanceId: idCounter.nextInstanceId,
    };

    for (const player of initialState.players) {
        seededShuffle(initialState, player.library);
        for (let i = 0; i < STARTING_HAND_SIZE; i++)
            drawCardFromLibrary(player);
    }

    // CR 103.5: enter the mulligan phase — declarations begin with the active
    // player. advancePhase is deferred to finalizeMulligan.
    initialState.phase = "MULLIGAN" as Phase;
    initialState.mulligan = makeMulliganState(initialState);
    initialState.priorityPlayerId = initialState.mulligan.declaringPlayerId;

    return initialState;
}

/** Builds the Match `players[]` snapshot from the seat inputs. Each seat's
 *  maindeck is `deck.cards`; the sideboard defaults to empty (PRD #387). */
function buildMatchPlayers(players: PlayerInput[]): MatchPlayer[] {
    return players.map((p) => ({
        id: p.id,
        name: p.name,
        bgColor: p.bgColor,
        deck: snapshotDeck({
            id: p.deck.id,
            name: p.deck.name,
            format: p.deck.format,
            maindeck: p.deck.cards,
            sideboard: p.deck.sideboard,
        }),
        score: 0,
        ready: false,
    }));
}

/** Projects seat inputs into the immutable per-Game snapshot stored on the
 *  `games` row. The deck keeps only `{id,name,format,cards}` — the sideboard
 *  lives on the Match copy (`buildMatchPlayers`), never on the Game (PRD #387).
 *  Mirrors `buildNextGameSeats` (matches.ts) so all `games` inserts agree. */
function toGamePlayers(players: PlayerInput[]) {
    return players.map((p) => ({
        id: p.id,
        name: p.name,
        bgColor: p.bgColor,
        deck: {
            id: p.deck.id,
            name: p.deck.name,
            format: p.deck.format,
            cards: p.deck.cards,
        },
    }));
}

// --- Helpers ---

async function getLatestGameState(
    ctx: Pick<GenericQueryCtx<DataModel>, "db">,
    gameId: GenericId<"games">
): Promise<Doc<"gameStates"> | null> {
    const doc = await ctx.db
        .query("gameStates")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .order("desc")
        .first();
    if (!doc) return null;
    return {
        ...doc,
        state: expandState(doc.state as Record<string, unknown>),
    };
}

/** Save a game state. We keep exactly one row per game and patch it in
 *  place — there's no server-side undo history. Convex read bandwidth was
 *  dominated by snapshot reads, so collapsing to a single row plus a patch
 *  cuts per-mutation cost to 1 read (the handler's `getLatestGameState`) +
 *  1 write. Callers pass that already-fetched doc as `existing` so we don't
 *  re-query. Pass `null` for first-time inserts (game creation paths). */
async function saveGameState(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState | Record<string, unknown>,
    existing: Doc<"gameStates"> | null
) {
    // Issue #1379 review finding — `checkStateBasedActions` is NOT on every
    // path that reaches here: `announceCast`/`tryAutoCommitPendingCast` move a
    // card hand→stack, `summonCompanion` pushes one into hand, and
    // `declareMulligan` redraws a hand, all with ZERO SBA pass before
    // `saveGameState`. A `keyword-grant.condition` gated on non-battlefield
    // state (hand size, CR 611.2c "as long as ...", issue #1095's mechanism)
    // is materialized into `staticAbilities` only when re-swept — so a
    // persisted, priority-awaiting state could carry a STALE keyword for the
    // entire window a spell sits on the stack, which is exactly the window
    // the opponent responds in. `saveGameState` is the SOLE writer of the
    // `gameStates` row (every other write in this file is `gameTicks`/other
    // tables), so it is the one choke point every stable position must pass
    // through regardless of which caller reached it. Re-running the sweep
    // here — NOT `checkStateBasedActions` itself, just the static-effect
    // re-materialization it already runs unconditionally on every pass —
    // makes "a persisted state always has freshly-materialized conditional
    // statics" an invariant of persistence itself, not of any particular
    // caller remembering to call SBAs first. `refreshCounterGatedStatics`
    // performs no state-based actions, moves no cards, and is idempotent
    // (documented at its definition, `gre/state.ts`) — a no-op sweep of the
    // battlefield for every board where no source declares
    // `dependsOnCounters` or a conditioned `keyword-grant`, so this adds no
    // duplicate/skipped SBA behavior and is cheap on the common case.
    refreshCounterGatedStatics(state as GameState);
    // ADR 0047 — maintain the authoritative Expected Input at the persistence
    // seam. Every stable point flows through `saveGameState`, so recomputing
    // here keeps the persisted + projected field coherent with the settled
    // pending* / priority fields without touching every engine call site.
    refreshExpectedInput(state as GameState);
    const stored = compactState(state as GameState);
    // const _blobSize = JSON.stringify(stored).length;
    // console.log(
    //     `[BANDWIDTH] blob=${_blobSize} bytes, seq=${seq}, gameId=${gameId}`
    // );
    if (existing) {
        await ctx.db.patch(existing._id, {
            seq,
            state: stored,
            updatedAt: Date.now(),
        });
    } else {
        // Mirror the owning Game's mode flags onto the row (see `gameStates`
        // in `convex/schema.ts`). This is the ONE place the fat `games` row is
        // read for them — once per game, at insert — so that `getPublicState`
        // never has to. Both are written explicitly, `false` included, so the
        // reader can tell "not solo" from "row predates the field".
        const game = await ctx.db.get(gameId);
        await ctx.db.insert("gameStates", {
            gameId,
            seq,
            state: stored,
            solo: game?.solo === true,
            vsAi: game?.vsAi === true,
            updatedAt: Date.now(),
        });
    }

    // Companion tick row (PRD #1776 T3, issue #1778): every stable point
    // flows through this function, so this is the single seam to keep the
    // cheap wake-up signal coherent with what was just persisted. `state` is
    // already past `refreshExpectedInput` above, so `expectedInput` is the
    // settled, authoritative value for this save.
    await saveGameTick(ctx, gameId, seq, state as GameState);
}

/** Cheap wake-up-signal companion to `gameStates` (~150 bytes vs. 3-9 KB),
 *  written alongside every `gameStates` save from `saveGameState`. One row
 *  per game, patched in place. Exists so a subscriber that only needs to
 *  know "did anything change, and does it need to act" — the vs-AI driver —
 *  can hold this instead of a second full `getPublicState` subscription that
 *  gets discarded on every beat it doesn't own (`getGameTick` below). */
async function saveGameTick(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState
) {
    const existing = await ctx.db
        .query("gameTicks")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .first();
    const fields = {
        seq,
        priorityPlayerId: state.priorityPlayerId,
        phase: state.phase,
        expectedInputKind: state.expectedInput?.kind,
        // issue #1778 review finding 1: NOT `state.expectedInput?.playerId` —
        // that single id missed the non-active combat-damage assigner
        // (banding, CR 702.22j-k) and could deadlock a subscriber gating on
        // it. `computeOwedPlayerIds` folds in the `damageAssignerIds`
        // sub-flow so every player who genuinely owes input this tick is
        // named, even when it's not `priorityPlayerId`.
        owedPlayerIds: computeOwedPlayerIds(state),
        gameOver: state.gameOver !== undefined,
        updatedAt: Date.now(),
    };
    if (existing) {
        await ctx.db.patch(existing._id, fields);
        return;
    }
    await ctx.db.insert("gameTicks", { gameId, ...fields });
}

/** The Rounds array as the `limitedEvents` schema declares it. `convex/limited/**`
 *  never depends on `_generated`, so its `LimitedPairing.matchId` is a plain
 *  `string` where the schema stores a branded `Id<"matches">` — the same
 *  type-level reconciliation `limitedEvents.ts`'s `asDbRounds` performs, for
 *  the two writes this module makes. Every `matchId` written here originates
 *  from a real `insertMatchWithDecks` (`deckStore.ts`), never from client input. */
function asDbRounds(
    rounds: LimitedRound[]
): NonNullable<Doc<"limitedEvents">["rounds"]> {
    return rounds as unknown as NonNullable<Doc<"limitedEvents">["rounds"]>;
}

/**
 * Record a FINISHED pairing Match's result into its Limited Event's round,
 * then advance the round state it may have just completed (PRD #1628 stories
 * 14-15/20/39-40, ADR 0076, issues #1645/#1646).
 *
 * Called from **both** places a Match becomes finished — `finalizeGameOver`
 * (the SBA-detected game over, which is also the path `concede` takes) and the
 * `forfeitMatch` mutation. A result that only lands on one of them is the bug
 * this function exists to prevent, so it is deliberately a single shared
 * helper rather than two inline blocks.
 *
 * Recording lives in the pure `recordPlayedPairing` (`convex/limited/pairingMatch.ts`),
 * which refuses any Match the pairing isn't bound to and is idempotent on an
 * already-decided pairing. Advancing lives in `convex/limitedEvents.ts`'s
 * `cascadeEventRounds` (a thin shell over the pure
 * `convex/limited/rounds.ts#advanceRoundIfComplete`): if the pairing just
 * recorded was the round's LAST undecided one, it opens the next round —
 * cascading through any with no human pairing at all — or finishes the event
 * on the last round. Both steps land in the SAME `ctx.db.patch` below, so
 * "record the result" and "advance the round it may have completed" are one
 * read, one write on the `limitedEvents` document: Convex's OCC on that one
 * document is what makes two players finishing their pairings
 * near-simultaneously safe — whichever mutation commits second re-reads the
 * state the first one just wrote, so a round is never advanced twice and
 * never skipped. Recording itself never throws (`recordPlayedPairing` is a
 * pure refusal-by-return, never a throw). Advancing is wrapped in its own
 * try/catch below (issue #1646 review finding 2) so it can't throw either:
 * this runs inside the transaction that finishes the Match, and an uncaught
 * throw here would roll that completion back and lose the result.
 */
async function recordLimitedPairingResult(
    ctx: MutationCtx,
    match: Doc<"matches">,
    now: number
): Promise<void> {
    if (match.status !== "finished") return;
    const link = match.limitedPairing;
    if (!link || !match.limitedEventId) return;
    const event = await ctx.db.get(match.limitedEventId as Id<"limitedEvents">);
    if (!event) return;
    const rounds = recordPlayedPairing(event.rounds ?? [], link, match._id, {
        // Match seat order: `players[0]` is the seat that started the Match,
        // which `limitedPairing.seatA` names (`startPairingMatch`).
        winsA: match.players[0]?.score ?? 0,
        winsB: match.players[1]?.score ?? 0,
    });
    if (!rounds) return;

    // The pairing result itself must land no matter what happens next:
    // `cascadeEventRounds` is defence in depth ON TOP of an already-decided
    // Match (`roundsForSeatCount` throws outside `MIN_SEATS..MAX_SEATS`,
    // `pairRound` throws on an infeasible no-repeat matching), and this
    // function runs inside the SAME transaction that just finished the Match
    // — an uncaught throw here would roll back `finalizeGameOver`/
    // `forfeitMatch`'s own writes too, losing the result the docstring above
    // promises never happens (issue #1646 review finding 2). So the
    // round-advance step is best-effort: on failure it's skipped, the
    // pairing result is still recorded via `finalRounds = rounds`, and the
    // event is left exactly as it was — round-not-advanced, never
    // half-advanced — for the next recorded pairing (or an operator) to
    // retry. Genuinely unreachable today — the reviewer brute-forced
    // `pairRound` over every played-outcome history for seat counts 2-8 and
    // found zero infeasible pairings — this is defence in depth, kept
    // deliberately small.
    let advance: AdvanceRoundResult = { kind: "unchanged" };
    try {
        advance = await cascadeEventRounds(ctx, event, rounds, now);
    } catch (err) {
        console.error(
            `recordLimitedPairingResult: cascadeEventRounds failed for event ${event._id} — the pairing result was recorded without advancing the round`,
            err
        );
    }
    const finalRounds = advance.kind === "unchanged" ? rounds : advance.rounds;

    await ctx.db.patch(event._id, {
        rounds: asDbRounds(finalRounds),
        ...(advance.kind === "unchanged"
            ? {}
            : { currentRound: advance.currentRound }),
        ...(advance.kind === "eventFinished" ? { status: "finished" } : {}),
        updatedAt: now,
    });

    // Issue #1647: a round this cascade just opened needs the SAME deadline
    // schedule `openPlayPhaseIfReady` arms for round 1 — otherwise a table
    // whose round 1 had a deadline would silently lose it from round 2 on.
    // A no-op when the event has no configured deadline, or the newly opened
    // round came back fully decided on the spot (no human pairing anywhere).
    //
    // Wrapped in its own try/catch (issue #1647 review finding 4): this runs
    // AFTER the `ctx.db.patch` above, inside the same transaction that just
    // finished the Match (`finalizeGameOver` / `forfeitMatch`) — the entire
    // point of this function's OWN try/catch around `cascadeEventRounds` is
    // that nothing past the recorded result can roll it back. A
    // `scheduler.runAfter` throw here is no exception: best-effort, logged,
    // never allowed to lose the Match result or the round advance that were
    // already committed above.
    if (advance.kind === "roundOpened") {
        try {
            await scheduleRoundDeadline(
                ctx,
                event._id,
                finalRounds[finalRounds.length - 1],
                now
            );
        } catch (err) {
            console.error(
                `recordLimitedPairingResult: scheduleRoundDeadline failed for event ${event._id} — the newly opened round has no deadline schedule`,
                err
            );
        }
    }
}

/** If SBA detected game over, persist the result to the games table AND record
 *  it into the owning Match (PRD #387 / ADR 0029): bump the winner's score and,
 *  for a Bo1, immediately finish the Match. (Bo3 routes to "sideboarding" — a
 *  later slice builds the next Game; #392 only ever finishes Bo1 here.)
 *
 *  EXPORTED for `convex/__tests__/limitedPairingMatch.test.ts` (issue #1645),
 *  which drives the real game-over path rather than re-implementing it.
 *
 *  Widened from `Pick<GenericMutationCtx<DataModel>, "db">` to the full
 *  `MutationCtx` (issue #1646): `recordLimitedPairingResult` now calls
 *  `cascadeEventRounds`, which — to score a newly-opened round's bot-vs-bot
 *  pairings — needs `hydrateSeats`'s full seat payload read (`ctx.auth`/
 *  `ctx.storage` too, structurally, even though this path never touches
 *  storage). Every real caller already passes a genuine `MutationCtx`; the
 *  in-memory test stubs already cast `as unknown as MutationCtx`. */
export async function finalizeGameOver(
    ctx: MutationCtx,
    gameId: GenericId<"games">,
    _seq: number,
    state: GameState
) {
    if (!state.gameOver) return;
    const now = Date.now();

    const game = await ctx.db.get(gameId);
    await ctx.db.patch(gameId, {
        status: "finished",
        winner: state.gameOver.winnerId,
        updatedAt: now,
    });

    // CR 104.2a: a player who wins a Game wins it for the Match's tally. A draw
    // (no winnerId) leaves the Match score untouched in this slice.
    const winnerId = state.gameOver.winnerId;
    if (!game?.matchId || !winnerId) return;
    const match = await ctx.db.get(game.matchId);
    if (!match || match.status === "finished") return;

    const patch = recordGameResult(match, winnerId);
    if (!patch) return;
    await ctx.db.patch(game.matchId, { ...patch, updatedAt: now });
    // Limited Event round pairing (issue #1645): a normal win and a concede
    // both land here, so this is where a played pairing's result is recorded.
    // A no-op unless the patch actually FINISHED the Match (a Bo3 routing to
    // "sideboarding" is not a decided pairing).
    await recordLimitedPairingResult(ctx, { ...match, ...patch }, now);
}

/** Guard: reject actions on a finished game. */
function assertGameNotOver(state: GameState) {
    if (state.gameOver) throw new Error("Game is over");
}

/** Guard: reject actions while the engine is suspended awaiting
 *  mid-resolution player choices (CR 608.2). Priority is frozen in this
 *  window — only `submitResolutionChoice` is legal.
 *
 *  CR 117.3a exception: while a player is being asked an optional may-pay
 *  question, they may activate mana abilities to make the mana required.
 *  Pass `allowManaForMayPay: true` from the tap/untap mana mutations so
 *  they can run during the pending may-pay's payment window for that
 *  player. Other mid-resolution choice kinds keep the strict guard. */
function assertNoPendingChoices(
    state: GameState,
    opts: { allowManaForMayPay?: { playerId: string } } = {}
) {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) return;
    const head = queue[0];
    const allow = opts.allowManaForMayPay;
    if (allow && head.kind === "may-pay" && head.playerId === allow.playerId) {
        return;
    }
    throw new Error(
        "Waiting for resolution choices — complete them before acting"
    );
}

/** Taps a battlefield card as a mana source during a payment phase (pendingCast
 *  or pendingActivation) and adds its mana to the player's pool. Shared by
 *  tapForPayment and tapForActivationPayment — the logic is identical, only
 *  the bookkeeping state differs. Mutates `card`, `player.manaPool`, and
 *  pushes the card id onto `tappedLandIds`. */
/** CR 603.7a / ADR 0040 — arm a tap mana ability's delayed-trigger rider.
 *  When a tap mana ability declares `armsDelayedTriggerOnTap` and its source is
 *  tapped for mana, append a `DelayedTriggerInstance` (the same shape
 *  `scheduleDelayedTrigger` builds) for the named trigger on the source card's
 *  `delayedTriggers[]`, controlled by the ACTIVATING player (CR 113.7) with the
 *  source instance id in `payload.sourceId`. Drives Rainbow Vale's
 *  control-change-on-tap. Pure: mutates `state.delayedTriggers` /
 *  `state.nextDelayedSeq` only. No-op when the ability has no rider. */
export function armDelayedTriggerOnTap(
    state: GameState,
    ability: ActivatedAbility | undefined | null,
    card: CardInstanceState,
    activatorId: string
): void {
    const rider = ability?.armsDelayedTriggerOnTap;
    if (!rider) return;
    const sourceCardId = (card.card as { id?: string }).id;
    if (!sourceCardId) return;
    state.nextDelayedSeq = (state.nextDelayedSeq ?? 0) + 1;
    state.delayedTriggers = [
        ...(state.delayedTriggers ?? []),
        {
            id: `delayed-${state.nextDelayedSeq}`,
            sourceCardId,
            triggerId: rider.triggerId,
            controller: activatorId,
            timing: rider.timing,
            payload: { sourceId: card.id },
        },
    ];
}

/** CR 605.1a / 120 — painland coloured-tap self-damage rider. When a choice tap
 *  mana ability declares `dealsDamageToControllerOnColoredTap` and the chosen
 *  option produced a COLOURED mana (any colour other than {C}), the source deals
 *  N damage to its controller as part of resolving (Adarkar Wastes et al.). The
 *  painless {C} choice carries no damage. Routed through the permanent-source
 *  player-damage pipeline (`dealDamageFromPermanentToPlayer` — CR 614
 *  replacement → CR 615 prevention), never the stack (mana abilities don't use
 *  it, CR 605.3a). No-op when the ability lacks the rider, the source was
 *  sacrificed, or the chosen mana is colourless. Shared by both tap-for-mana
 *  paths (`tapUntap` priority tap + `tapSourceIntoPayment` payment tap). */
export function applyColoredTapSelfDamage(
    state: GameState,
    ability: ActivatedAbility | undefined | null,
    card: CardInstanceState,
    activatorId: string,
    chosen: ManaCost
): void {
    const painPerTap = ability?.dealsDamageToControllerOnColoredTap;
    if (!painPerTap || painPerTap <= 0) return;
    if (ability?.cost.sacrifice === true) return;
    const chosenIsColored = Object.entries(chosen).some(
        ([color, amount]) =>
            color !== "X" &&
            color !== "C" &&
            typeof amount === "number" &&
            amount > 0
    );
    if (!chosenIsColored) return;
    dealDamageFromPermanentToPlayer(
        state,
        card,
        activatorId,
        activatorId,
        painPerTap
    );
}

/** CR 605.1a / 120 — unconditional fixed-mana self-damage rider (Ancient
 *  Tomb — "{T}: Add {C}{C}. This land deals 2 damage to you."). Unlike
 *  `applyColoredTapSelfDamage` (gated on a coloured `manaChoices` pick), this
 *  fires on EVERY tap-for-mana regardless of the mana produced — the "every
 *  tap" shape shared with `applyDepletionCounterOnTap`. No-op when the
 *  ability lacks the rider or the source was sacrificed paying the cost.
 *  Shared by both tap-for-mana paths (`tapUntap` priority tap +
 *  `tapSourceIntoPayment` payment tap). */
export function applyUnconditionalTapSelfDamage(
    state: GameState,
    ability: ActivatedAbility | undefined | null,
    card: CardInstanceState,
    activatorId: string
): void {
    const painPerTap = ability?.dealsDamageToControllerOnTap;
    if (!painPerTap || painPerTap <= 0) return;
    if (ability?.cost.sacrifice === true) return;
    dealDamageFromPermanentToPlayer(
        state,
        card,
        activatorId,
        activatorId,
        painPerTap
    );
}

/** CR 605.1a / 118.4 — tap mana ability life-payment cost (Mana Confluence,
 *  Horizon Canopy, the MH1 Horizon-land cycle: "{T}, Pay 1 life: Add …").
 *  Pays `ability.cost.life` through the shared life-loss choke point
 *  (`loseLifeEmitting`) so it runs the CR 614 lifeloss replacement chain
 *  (Lich) and emits LIFE_LOST (CR 119.3) like every other life-loss path.
 *  No-op when the ability declares no life cost. Shared by both tap-for-mana
 *  paths (`tapUntap` priority tap + `tapSourceIntoPayment` payment tap) — the
 *  same pairing every other tap-mana rider in this file uses. */
export function applyManaAbilityLifeCost(
    state: GameState,
    ability: ActivatedAbility | undefined | null,
    activatorId: string
): void {
    const lifeCost = ability?.cost.life;
    if (!lifeCost || lifeCost <= 0) return;
    loseLifeEmitting(state, activatorId, lifeCost);
}

/** CR 605.1a / 118.3 — tap mana ability discard-at-random cost (Lion's Eye
 *  Diamond: "Discard your hand, Sacrifice this artifact: Add three mana of
 *  any one color."). Pays `ability.cost.discardAtRandom` through the shared
 *  `payDiscardAtRandomCost` primitive, which clamps to the actual hand size —
 *  so a count comfortably above any reachable hand (LED declares 99) always
 *  discards exactly the whole hand regardless of its size. No-op when the
 *  ability declares no discard cost. Shared by both tap-for-mana paths
 *  (`tapUntap` priority tap + `tapSourceIntoPayment` payment tap). */
export function applyManaAbilityDiscardCost(
    state: GameState,
    ability: ActivatedAbility | undefined | null,
    activatorId: string
): void {
    const count = ability?.cost.discardAtRandom;
    if (!count || count <= 0) return;
    payDiscardAtRandomCost(state, activatorId, count);
}

/** CR 605.1a / 601.2f — the MANA portion of a mana ability's activation cost
 *  (Chromatic Star's "{1}, {T}, Sacrifice this artifact: Add one mana of any
 *  color"). Unlike a spell, a mana ability resolves immediately (CR 605.3a),
 *  but its cost is still paid on activation: the {1} is deducted from the
 *  controller's pool BEFORE the ability's produced mana is added, so the cost
 *  can never be funded by the mana the ability itself makes. Because no
 *  upstream affordability gate threads the pool into the tap-for-mana option
 *  enumeration (the pool is absent from `TriggerStateView`), this helper is the
 *  authoritative check: it throws when the pool can't cover the cost, so every
 *  caller MUST invoke it FIRST — before tapping/sacrificing the source or
 *  emitting any event — so a rejected activation leaves the state untouched.
 *  No-op for the common mana ability with no mana cost. Shared by both
 *  tap-for-mana paths (`tapUntap` priority tap + `tapSourceIntoPayment`
 *  payment tap).
 *
 *  Snapshots the REAL per-colour pool delta onto `card.manaPaidThisTap` (the
 *  cost-side sibling of `lifePaidThisTap`) so an untap-toggle that reverses the
 *  whole activation before the produced mana is spent refunds exactly what was
 *  taken — a generic {1} can be paid with any colour, so the snapshot, not a
 *  re-derivation from the cost, is what makes the refund exact. */
export function applyManaAbilityManaCost(
    player: PlayerState,
    ability: ActivatedAbility | undefined | null,
    card?: CardInstanceState
): void {
    if (!ability?.cost.mana) return;
    const cost = normalizeManaCost(ability.cost.mana);
    if (Object.keys(cost).length === 0) return;
    if (!isManaCostCovered(player.manaPool, cost)) {
        throw new Error("Not enough mana to activate this ability");
    }
    const before = { ...player.manaPool };
    payManaCost(player.manaPool, cost);
    if (!card) return;
    const paid: Record<string, number> = {};
    for (const color of Object.keys(before) as (keyof typeof before)[]) {
        const delta = (before[color] ?? 0) - (player.manaPool[color] ?? 0);
        if (delta > 0) paid[color] = delta;
    }
    card.manaPaidThisTap =
        Object.keys(paid).length > 0
            ? (paid as CardInstanceState["manaPaidThisTap"])
            : undefined;
    // CR 106.4 — the sources whose mana just went into this cost can no longer
    // be untapped for a refund (their mana is spent), the same commitment
    // `activateGrantedAbility` records. Without it a land tapped for the {1},
    // then untapped after the filter consumed it, would silently swallow the
    // refund (the pool is clamped at zero).
    commitLandsForCost(player, cost);
}

/** CR 601.2g / 605.3a — auto-tap OTHER mana sources to cover this mana
 *  ability's own mana cost, so activating a filter rock (Mana Cylix, Chromatic
 *  Star, Celestial Prism, Fire Sprites) with an empty pool works the way every
 *  other costed play does: the client asks to tap it, and the engine produces
 *  the mana it needs. Without this the tap simply threw "Not enough mana"
 *  unless the player had manually floated the mana first — technically legal
 *  (activate a land's mana ability, THEN the filter, CR 605.3a) but a UX cliff
 *  no other cost in the game has.
 *
 *  Sequencing is exactly the legal one: each planned source's own mana ability
 *  resolves first (through `tapSourceIntoPayment`, so painland pings, depletion
 *  counters and becomes-tapped triggers all fire), leaving the mana floating for
 *  {@link applyManaAbilityManaCost} to spend. The activating permanent is
 *  excluded from the plan — it can't pay for itself.
 *
 *  A partial plan is still applied (the `autoTapForPayment` precedent): tap what
 *  is reachable and let `applyManaAbilityManaCost` reject the remainder, rather
 *  than no-op into a certain throw. No-op when the ability has no mana cost or
 *  the pool already covers it.
 *
 *  The taps are NOT registered for undo (there is no `pendingActivation` to
 *  hang them on — a mana ability resolves immediately, CR 605.3c). That matches
 *  the manual sequence exactly: untapping the filter afterwards refunds its
 *  {1} to the pool and leaves the auto-tapped land tapped, which is what
 *  happens if the player taps the land by hand. */
export function autoTapForManaAbilityCost(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    ability: ActivatedAbility | undefined | null
): void {
    if (!ability?.cost.mana) return;
    const cost = normalizeManaCost(ability.cost.mana);
    if (Object.keys(cost).length === 0) return;
    const substitutions = getManaSubstitutions(state, player.id);
    if (isManaCostCovered(player.manaPool, cost, substitutions)) return;
    // The activating permanent can't fund its own activation cost.
    const sources = buildAutoTapSources(
        player.battlefield,
        manaGateBattlefields(state)
    ).filter((s) => s.cardId !== card.id);
    const plan =
        solveAutoTap(player.manaPool, cost, substitutions, sources) ??
        solveAutoTapPartial(player.manaPool, cost, substitutions, sources);
    // No undo ledger for a mana ability (see the doc comment) — the primitive
    // still wants an array to append to.
    const untracked: string[] = [];
    for (const step of plan) {
        const source = player.battlefield.find((c) => c.id === step.cardId);
        if (!source) continue;
        tapSourceIntoPayment(
            state,
            player,
            source,
            step.manaChoiceIndex,
            untracked
        );
    }
}

/** CR 106.4 / 605.1a — refund the mana recorded by
 *  {@link applyManaAbilityManaCost} when a tap-for-mana is reversed before its
 *  produced mana is spent (the `tapUntap` untap toggle, `untapForPayment`).
 *  Symmetric with `restoreLifePaidOnUntap` and the `chosenMana` /
 *  charge-counter refunds: an undone activation must undo its COST too, or the
 *  toggle is a mana burner. No-op when the ability had no mana cost. */
export function restoreManaPaidOnUntap(
    player: PlayerState,
    card: CardInstanceState
): void {
    const paid = card.manaPaidThisTap;
    if (!paid) return;
    for (const [color, amount] of Object.entries(paid)) {
        if (color === "X" || typeof amount !== "number" || amount <= 0)
            continue;
        const key = color as keyof typeof player.manaPool;
        player.manaPool[key] = (player.manaPool[key] ?? 0) + amount;
    }
    card.manaPaidThisTap = undefined;
}

/** CR 605.1a / 122.1 — depletion-dual tap-for-mana rider. When a tap mana
 *  ability declares `putDepletionCounterOnTap`, the source puts one depletion
 *  counter on itself as part of resolving the mana ability (Land Cap, Lava
 *  Tubes, River Delta, Timberline Ridge, Veldt). Unlike the painland coloured-
 *  tap rider, this fires on EVERY tap-for-mana (both options are coloured;
 *  there is no painless {C}). No-op when the ability lacks the rider or the
 *  source was sacrificed paying the cost. Shared by both tap-for-mana paths
 *  (`tapUntap` priority tap + `tapSourceIntoPayment` payment tap) so the
 *  counter is added however the land is tapped for mana. The land's untap step
 *  is skipped while the counter remains (the `does-not-untap-with-depletion-
 *  counter` static ability), and its upkeep trigger removes one — so it untaps
 *  every other turn. */
export function applyDepletionCounterOnTap(
    ability: ActivatedAbility | undefined | null,
    card: CardInstanceState
): void {
    if (!ability?.putDepletionCounterOnTap) return;
    if (ability.cost.sacrifice === true) return;
    const next = { ...(card.counters ?? {}) };
    next["depletion"] = (next["depletion"] ?? 0) + 1;
    card.counters = next;
}

/** Reverses one depletion counter added by `applyDepletionCounterOnTap` when a
 *  depletion-dual is untapped to refund unspent mana in the same priority
 *  window (CR 106.4) — the whole mana-ability activation, including its
 *  counter-add rider, is undone. No-op when the ability lacks the rider or the
 *  source carries no depletion counter. */
export function reverseDepletionCounterOnUntap(
    ability: ActivatedAbility | undefined | null,
    card: CardInstanceState
): void {
    if (!ability?.putDepletionCounterOnTap) return;
    const have = card.counters?.["depletion"] ?? 0;
    if (have <= 0) return;
    const next = { ...(card.counters ?? {}) };
    if (have - 1 <= 0) delete next["depletion"];
    else next["depletion"] = have - 1;
    card.counters = Object.keys(next).length > 0 ? next : undefined;
}

/** CR 605.1a / 121.1 — mana-ability draw rider (Chromatic Sphere: "{1}, {T},
 *  Sacrifice this artifact: Add one mana of any color. Draw a card."). When a
 *  tap mana ability declares `drawsCardOnTap`, the controller draws N cards as
 *  part of the SAME mana ability resolving — CR 605.1a permits a mana ability
 *  to carry a non-mana additional effect and still resolve without the stack
 *  (the Wall of Roots precedent). Unlike `applyUnconditionalTapSelfDamage` /
 *  `applyDepletionCounterOnTap`, this rider fires EVEN when the ability
 *  sacrifices its own source (Chromatic Sphere IS a sacrifice ability) — the
 *  draw is a player-level effect, not conditioned on the permanent still
 *  existing. Routed through `drawCard` (aliased `drawCardFromLibrary`,
 *  `convex/gre/state.ts`) + `emitCardDrawn` so "whenever you draw a card"
 *  triggers (Sheoldred, Underworld Dreams) still see the draw, mirroring the
 *  draw step's own `if (drawCard(player) !== null) emitCardDrawn(...)`
 *  pattern (`gre/phases.ts`) — no event when the library was empty (CR
 *  704.5b). Deliberately NOT modeled as Chromatic Star's separate leaves-the-
 *  battlefield trigger: Sphere's draw is tied only to activating ITS OWN mana
 *  ability, not to dying by any means (issue #1093). No-op when the ability
 *  lacks the rider. Shared by both tap-for-mana paths (`tapUntap` priority tap
 *  + `tapSourceIntoPayment` payment tap). */
export function applyDrawCardOnTap(
    state: GameState,
    ability: ActivatedAbility | undefined | null,
    activatorId: string
): void {
    const count = ability?.drawsCardOnTap;
    if (!count || count <= 0) return;
    const player = getPlayer(state, activatorId);
    for (let i = 0; i < count; i++) {
        if (drawCardFromLibrary(player) !== null) {
            // CR 504.1 — a mana ability's draw rider (Chromatic Sphere) is
            // never the draw step's turn-based draw, whatever phase it is
            // activated in.
            emitCardDrawn(state, activatorId, 1, false);
        }
    }
}

/** CR 603.3 — a triggered ability, once put on the stack, cannot be undone.
 *  Called on the standalone tap-for-mana path right after the PERMANENT_TAPPED
 *  event is flushed into a trigger pass (`processPendingActionTriggers`). If
 *  that flush GREW the stack, this tap caused at least one triggered ability to
 *  be put on the stack — the source's own "becomes tapped" self-damage (City of
 *  Brass) or a third-party watcher (Manabarbs on every land tap). Such a tap is
 *  irreversible: refunding the floated mana and untapping the source while the
 *  trigger's effect (lost life, a token, a draw) stays applied is a state with
 *  no legal MTG equivalent. Flag the tapped source so the standalone
 *  untap-toggle refuses to untap it (the `tapTriggerCommitted` guard in
 *  `tapUntap`), mirroring the `manaCommitted` "mana already spent" guard.
 *  Class-wide: keyed on stack growth, not on any specific card. `stackSizeBefore`
 *  is the stack length captured immediately before the trigger flush. */
export function markTapTriggerCommitment(
    state: GameState,
    card: CardInstanceState,
    stackSizeBefore: number
): void {
    if (state.stack.length > stackSizeBefore) {
        card.tapTriggerCommitted = true;
    }
}

/** CR 106.4 / 605.1a — snapshot how much life a tap-for-mana's inline self-
 *  damage / life-cost riders (painland coloured-tap ping like Adarkar Wastes,
 *  Ancient Tomb's unconditional ping, Mana Confluence's "Pay 1 life") took, so
 *  a later reversal of the whole mana-ability activation can refund it — the
 *  life-side sibling of the mana / charge-counter refund. `lifeBeforeTap` is
 *  the controller's life captured before the riders ran; `lifeAfterTap` after.
 *  Records the REAL delta (post CR 614 replacement / CR 615 prevention), so a
 *  prevented or Lich-replaced ping refunds exactly what was paid, and clears
 *  the field when nothing was paid so a stale value from an earlier tap can
 *  never leak forward. Shared by both tap-for-mana paths (`tapUntap` priority
 *  tap + `tapSourceIntoPayment` payment tap). */
export function recordLifePaidOnTap(
    card: CardInstanceState,
    lifeBeforeTap: number,
    lifeAfterTap: number
): void {
    const paid = lifeBeforeTap - lifeAfterTap;
    card.lifePaidThisTap = paid > 0 ? paid : undefined;
}

/** CR 106.4 / 605.1a — restore the life recorded by `recordLifePaidOnTap` when
 *  a tap-for-mana is reversed before its mana is spent (the `tapUntap` untap
 *  toggle or `untapForPayment`). Symmetric with the mana / charge-counter
 *  refund. Unlike City of Brass, whose becomes-tapped TRIGGER goes on the stack
 *  and blocks the reversal (`tapTriggerCommitted`), painland-style inline riders
 *  resolve with no stack, so the tap — life ping included — stays reversible.
 *  No-op when the source paid no life. Shared by both untap paths. */
export function restoreLifePaidOnUntap(
    player: PlayerState,
    card: CardInstanceState
): void {
    if (!card.lifePaidThisTap) return;
    player.life += card.lifePaidThisTap;
    card.lifePaidThisTap = undefined;
}

type ResolvedManaTapChoice = {
    mana: ManaCost;
    ability: ActivatedAbility | null;
    choiceIndex: number | undefined;
};

/** Whether the source exposes 2+ mana-tap options (must prompt a choice) or a
 *  single choice-based ability that still requires an index (Fellwar Stone with
 *  one producible colour). Kept in lockstep with the client's picker gate.
 *
 *  CR 605.1a (issue #1889) — an EMPTY option list never needs a choice. The
 *  client's mirror (`getManaChoices`, `src/lib/card-utils.ts`) returns null on
 *  an empty list and so submits no index; without this guard a choice-based
 *  ability whose CURRENT list is empty (a Fellwar Stone facing opponents with
 *  no colour-producing lands, a source whose only options were filtered out)
 *  made the server demand an index the client structurally cannot send — a hard
 *  "Must choose a mana color" on a click the UI still offered. With nothing to
 *  choose BETWEEN there is nothing to prompt: fall through to the fixed branch.
 *
 *  What that fall-through then DOES differs by path, and for a choice-ONLY
 *  source it is not a silent zero-output tap. Such a source declares no
 *  `manaProduced` (Fellwar Stone `drk/colorless.ts`, Chrome Mox
 *  `mrd/colorless.ts`), so `getBasicLandMana(card) ?? getActivatedManaColor(card)`
 *  — the latter requires `manaProduced` (`gre/constants.ts`) — is null:
 *  `tapSourceIntoPayment` throws `"Card does not produce mana"`, the SAME
 *  rejection a zero-output fixed source gets, and nothing is tapped. The
 *  `tapUntap` priority path has no such throw: it toggles the tap and adds no
 *  mana. So the change is a rejection-MESSAGE swap on the payment path (from a
 *  "Must choose a mana color" the client structurally cannot satisfy, to an
 *  accurate statement about the source) plus a no-op tap toggle on the priority
 *  path — never a source that silently pays for something. The two gates now
 *  agree by construction on the same list. */
function manaTapNeedsChoice(
    card: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>,
    ability: ActivatedAbility | null
): boolean {
    const options = getManaTapOptionsDetailed(card, controllerId, battlefields);
    if (options.length === 0) return false;
    return (
        options.length >= 2 ||
        !!(
            ability?.manaChoices ||
            ability?.getManaChoices ||
            ability?.manaColorSource
        )
    );
}

/** Resolves the `manaChoiceIndex` the client submitted against the unified
 *  option list (CR 605.1a / 305.6), returning the produced mana + its
 *  provenance: `ability` is `null` for an intrinsic basic-land-subtype option
 *  (no riders), and `choiceIndex` is the ability-LOCAL index a Mana Battery
 *  reads as its counter-removal count. Null when the index is out of range.
 *
 *  CR 113.1 / 611.2a (issue #1880) — the id is resolved against the POST-LAYER
 *  effective set, the same list `getManaTapOptionsDetailed` enumerated the
 *  option from. Resolving against `def.activatedAbilities` alone returned
 *  `null` for a GRANTED option, which the caller cannot distinguish from an
 *  intrinsic basic-subtype pick: every tap rider (`applyManaAbilityManaCost`,
 *  `cost.sacrifice`, `manaChoiceRemovesCounters`, the self-damage / life /
 *  discard / draw riders, `manaRestriction`) was silently skipped, so a
 *  granted "{1}, {T}: Add {W}" produced FREE mana. */
function resolveManaTapChoice(
    card: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>,
    manaChoiceIndex: number
): ResolvedManaTapChoice | null {
    const options = getManaTapOptionsDetailed(card, controllerId, battlefields);
    const opt = options[manaChoiceIndex];
    if (!opt) return null;
    const source = opt.source;
    if (source.kind === "basic") {
        return { mana: opt.mana, ability: null, choiceIndex: undefined };
    }
    const ability =
        getEffectiveActivatedAbilities(card).find(
            ({ ability: a }) => a.id === source.abilityId
        )?.ability ?? null;
    return { mana: opt.mana, ability, choiceIndex: source.choiceIndex };
}

/** CR 605.1a — rejection message for a mana-choice tap whose submitted index
 *  resolves to nothing (`resolveManaTapChoice` returned null). Both call sites
 *  sit INSIDE a `manaTapNeedsChoice` branch, and that gate returns false on an
 *  empty option list (issue #1889), so "this source has no mana-tap option at
 *  all" can no longer reach here — the only remaining case is an out-of-range
 *  index for an otherwise legal source. A dedicated "This source has no mana to
 *  add" variant was deleted with the gate change rather than left as an
 *  unreachable branch: an un-imprinted Chrome Mox / zero-option source now
 *  falls through to the fixed branch and is rejected there with "Card does not
 *  produce mana". */
const MANA_CHOICE_REJECTION = "Invalid mana choice";

/** Battlefields shaped for the mana-tap resolvers (CR 106.1). Thin wrapper
 *  over the shared `manaGateBattlefields` (`gre/constants.ts`, issue #1754
 *  finding 6) — the same view `coloredCostLeftover` (rules.ts) and
 *  `planManaPayment` (moves.ts) build from a `GameState`, so all three
 *  board-dependent-mana-ability call sites stay identical by construction
 *  instead of drifting via three independent inline `.map`s. */
function manaTapBattlefields(state: GameState): ReadonlyArray<{
    playerId: string;
    battlefield: readonly CardInstanceState[];
}> {
    return manaGateBattlefields(state);
}

/** CR 605.4 — realize this tap's Wild-Growth-style triggered mana bonus into
 *  the pool NOW (so a cost payment sees it for the affordability check) and
 *  attribute the extra mana to the just-tapped `card` as `tapBonusMana`, so an
 *  undo (`untapForPayment`) reverses the bonus too. Measures the pool delta
 *  across `realizeManaAbilityTapBonus` — which resolves only the mana-ability
 *  triggers and leaves the non-mana ones deferred to cast commit. No-op when no
 *  bonus applies. Skips the stamp on a sacrificed source (it has no untap
 *  branch); the bonus, if any, still lands in the pool. */
function realizeAndStampTapBonus(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): void {
    const before = { ...player.manaPool };
    realizeManaAbilityTapBonus(state);
    const bonus: Record<string, number> = {};
    for (const [color, after] of Object.entries(player.manaPool)) {
        if (color === "X" || typeof after !== "number") continue;
        const delta = after - (before[color as keyof typeof before] ?? 0);
        if (delta > 0) bonus[color] = delta;
    }
    if (
        Object.keys(bonus).length > 0 &&
        player.battlefield.some((c) => c.id === card.id)
    ) {
        card.tapBonusMana = bonus as ManaCost;
    }
}

/** CR 106.6 (issue #1559 review) — deposits mana produced by tapping a source
 *  into the correct pool: the fungible `manaPool` when `restriction` is
 *  undefined, or the parallel `restrictedMana` pool (carrying `rider`, CR
 *  106.6 "can't be countered") when the producing ability declares one
 *  (Mishra's Workshop, Adarkar Unicorn, Delighted Halfling's legendary-spell
 *  ability). Shared by every tap-for-mana path — `tapUntap`'s priority tap and
 *  `tapSourceIntoPayment`'s payment tap — so a restricted ability's output
 *  never reaches the fungible pool no matter which mutation taps it. Fixes
 *  the bug found in the #1559 PR review: `tapSourceIntoPayment` added
 *  restricted mana straight to `manaPool`, so the restriction was entirely
 *  unenforced (CR 106.6 — the mana paid for anything) and the "can't be
 *  countered" rider was silently dropped, on the payment-tap path — the
 *  auto-tap / click-to-pay UX that is the DEFAULT way to cast a spell. */
function depositTappedMana(
    player: PlayerState,
    chosen: ManaCost,
    restriction: ManaRestriction | undefined,
    rider: boolean | undefined
): void {
    for (const [color, amount] of Object.entries(chosen)) {
        if (color !== "X" && typeof amount === "number" && amount > 0) {
            if (restriction) {
                addRestrictedManaToPool(
                    player,
                    color,
                    amount,
                    restriction,
                    undefined,
                    rider
                );
            } else {
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        }
    }
}

/** CR 106.6 (issue #1559 review) — resolves the activated mana ability that
 *  ACTUALLY produced `refund` (a `card.chosenMana` snapshot) by matching its
 *  exact shape against every one of the card's non-useStack mana abilities'
 *  declared output. `getActivatedManaAbility` returns only the FIRST such
 *  ability on the card, which is wrong when the chosen output came from a
 *  SECOND, distinct ability (Delighted Halfling: "{T}: Add {C}." is found
 *  first, but the actual restricted deposit can come from the separate
 *  legendary-spell ability) — reversing against the wrong ability corrupts
 *  state (decrementing a pool that was never credited while the real deposit
 *  sits untouched in `restrictedMana`). Correct as long as no two mana
 *  abilities on the same card produce byte-identical mana (true of every card
 *  in the catalogue today). Falls back to `fallback` (the card's single/first
 *  ability) when nothing matches — the previously-only-supported single-mana-
 *  ability shape. Shared by every untap/refund site that reverses a
 *  `chosenMana` snapshot: `tapUntap`'s untap toggle, `untapSourceFromPayment`,
 *  `untapForPayment`'s toggle, and `rollbackPendingCast`'s bulk undo. */
function resolveManaAbilityByOutput(
    card: CardInstanceState,
    refund: ManaCost,
    fallback: ActivatedAbility | null
): ActivatedAbility | null {
    const manaShapesEqual = (a: ManaCost, b: ManaCost): boolean =>
        MANA_COLORS.every((c) => (a[c] ?? 0) === (b[c] ?? 0));
    const cardDef = getDefinition(card.card.id as string);
    return (
        cardDef.activatedAbilities?.find(
            (a) =>
                !a.useStack &&
                (a.manaChoices?.some((m) => manaShapesEqual(m, refund)) ??
                    (a.manaProduced
                        ? manaShapesEqual(a.manaProduced, refund)
                        : false))
        ) ?? fallback
    );
}

/** CR 106.4/106.6 (issue #1559 review) — refunds mana a payment tap produced,
 *  restriction-aware: reverses the parallel `restrictedMana` deposit (with its
 *  rider) when the producing ability was restricted, instead of always
 *  assuming the fungible `manaPool` like every one of these sites used to. The
 *  `card.chosenMana` half of the split below — refunds a manaChoices-based
 *  ability's snapshotted output, resolving which ability actually produced it
 *  via `resolveManaAbilityByOutput` (more than one ability can be in play on
 *  the same card — Delighted Halfling). No-op if `chosenMana` is unset (the
 *  caller is expected to check first, matching each call site's own "which
 *  branch applies" logic — a bulk rollback vs. a single-tap undo differ on
 *  what to do in the OTHER (fixed-ability) branch, so that half is kept
 *  separate below as `refundFixedManaOutput` rather than folded in here). */
function refundChosenManaOutput(
    player: PlayerState,
    card: CardInstanceState
): void {
    const refund = card.chosenMana;
    if (!refund) return;
    const producingAbility = resolveManaAbilityByOutput(
        card,
        refund,
        getActivatedManaAbility(card)
    );
    const restriction = producingAbility?.manaRestriction;
    const rider = producingAbility?.manaCantBeCounteredRider;
    for (const [color, amount] of Object.entries(refund)) {
        if (color !== "X" && typeof amount === "number" && amount > 0) {
            if (restriction) {
                reverseRestrictedManaFromPool(
                    player,
                    color,
                    amount,
                    restriction,
                    rider
                );
            } else {
                player.manaPool[color] = Math.max(
                    0,
                    (player.manaPool[color] ?? 0) - amount
                );
            }
        }
    }
    card.chosenMana = undefined;
}

/** The FIXED-ability sibling of {@link refundChosenManaOutput} — refunds a
 *  single-mana-ability card (a land / Mishra's Workshop) whose output was
 *  never snapshotted onto `chosenMana` (the non-dynamic, non-substituted
 *  case). `manaColor` is the caller's already-resolved
 *  `getBasicLandMana ?? getActivatedManaColor` result — callers differ on
 *  what to do when that's absent (throw vs. silently skip), so this assumes
 *  a valid color was already found. */
function refundFixedManaOutput(
    player: PlayerState,
    card: CardInstanceState,
    manaColor: Color
): void {
    const amount = getFixedManaAmount(card, manaColor);
    const restriction = getActivatedManaRestriction(card);
    if (restriction) {
        reverseRestrictedManaFromPool(player, manaColor, amount, restriction);
    } else {
        player.manaPool[manaColor] = Math.max(
            0,
            (player.manaPool[manaColor] ?? 0) - amount
        );
    }
}

/** Activates a FIXED-output mana ability whose cost is "Sacrifice this" with NO
 *  {T} component (CR 605.1a / 302.6, issue #2021): Tinder Wall, Gaea's Touch,
 *  Coal Golem, the five Invasion Attendants, the Eldrazi Spawn token.
 *
 *  Its own path rather than a widening of the two fixed-output branches below,
 *  because every step those branches take around the mana is tap-shaped —
 *  `card.isTapped` toggling, the `chosenMana` snapshot the untap refunds from,
 *  the depletion counter reversed on untap, `tappedLandIds` — and a sacrifice
 *  is ONE-WAY: the source is in the graveyard, there is nothing to untap and
 *  nothing to refund. What it does share with them is the rider set, applied
 *  here in the same order.
 *
 *  Multi-colour by construction: it deposits the ability's whole `manaProduced`
 *  `ManaCost`, so Crosis's Attendant's {U}{B}{R} arrives as three mana. The
 *  single-`Color` `getActivatedManaColor` lookup those branches use returns null
 *  for a multi-colour output, which is the second half of why they can't host
 *  this shape.
 *
 *  CR 605.2 — the "tapped for mana" event is emitted BEFORE the sacrifice moves
 *  the card off the battlefield, so trigger predicates still see the
 *  permanent's characteristics. CR 603.6 / 700.4 — the departure routes through
 *  `removePermanentTo` so the leave-the-battlefield / dies trigger fires. */
function activateFixedSacrificeManaAbility(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    ability: ActivatedAbility
): void {
    // CR 605.1a / 601.2f — pay the MANA portion of the cost (the Attendants'
    // {1}, Coal Golem's {3}) FIRST, before any source mutation, so an
    // unaffordable activation throws with nothing changed.
    applyManaAbilityManaCost(player, ability, card);
    const produced = ability.manaProduced ?? {};
    // CR 106.6 — a restricted output floats in the parallel `restrictedMana`
    // pool, exactly as the tap branches deposit it.
    depositTappedMana(
        player,
        produced,
        ability.manaRestriction,
        ability.manaCantBeCounteredRider
    );
    emitPermanentTapped(state, card, true, produced);
    removePermanentTo(state, card.id, "graveyard", "sacrifice");
    // The riders a sacrifice activation can still carry (CR 605.1a / 120 /
    // 118.4 / 118.3 / 121.1). No depletion counter, no `lifePaidThisTap`, no
    // Wild-Growth tap bonus: all three exist only to be reversed by an untap
    // this source will never have.
    applyUnconditionalTapSelfDamage(state, ability, card, player.id);
    applyManaAbilityLifeCost(state, ability, player.id);
    applyManaAbilityDiscardCost(state, ability, player.id);
    applyDrawCardOnTap(state, ability, player.id);
}

export function tapSourceIntoPayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    manaChoiceIndex: number | undefined,
    tappedLandIds: string[]
): void {
    // CR 602.5b (issue #947) — gate on the ability's own `canActivate`
    // precondition so an un-imprinted Chrome Mox is treated as having no
    // usable mana ability at all.
    const ability = getActivatedManaAbility(card, state);

    // CR 302.6 — a mana ability paid PURELY by sacrificing the source has no
    // {T} leg and nothing to untap, so "already tapped" — a statement about
    // paying {T} — does not apply to it (see `manaAbilityPaidWithoutTapping`,
    // the single authority this shares with the castability mana census in
    // `gre/rules.ts`). Narrow by construction: the gate keeps its exact
    // pre-existing behaviour for every source whose payment does tap it, a
    // {T}+sacrifice ability (Basal Thrull) included.
    if (!manaAbilityPaidWithoutTapping(card, state) && card.isTapped) {
        throw new Error("Card already tapped");
    }

    // CR 302.6 — summoning sickness gates an activated ability whose cost
    // contains the tap (or untap) symbol, and nothing else. A sacrifice-only
    // mana ability (Tinder Wall, the Eldrazi Spawn token) carries no {T}, so a
    // freshly-created creature can activate it the turn it arrives — which is
    // the whole point of a mana creature you sacrifice. Mirrors the identical
    // `requiresTap &&` gate in `tapUntap` (issue #2021: this site gated
    // unconditionally, so the payment path rejected what the priority path
    // allowed).
    const requiresTap = !!getBasicLandMana(card) || ability?.cost.tap === true;
    if (requiresTap && isTapLockedBySummoningSickness(card)) {
        throw new Error("Creature has summoning sickness");
    }

    // CR 605.1a / 302.6 (issue #2021) — the tap-less sacrifice activation.
    // Checked before the choice branch below because it is one-way: it neither
    // taps the source nor records it in `tappedLandIds`, so there is no untap
    // to model. A `manaChoices` sacrifice ability (Lion's Eye Diamond) is NOT
    // this shape and stays on the choice branch.
    const fixedSacrifice = getFixedSacrificeManaAbility(card);
    if (fixedSacrifice) {
        activateFixedSacrificeManaAbility(state, player, card, fixedSacrifice);
        return;
    }

    // CR 106.4 / 605.1a — snapshot life before the mana ability's inline self-
    // damage / life-cost riders run, so an untapForPayment that reverses this
    // source restores exactly the life it took (painland ping, Ancient Tomb,
    // Mana Confluence). City of Brass's becomes-tapped TRIGGER deals no life
    // here — its PERMANENT_TAPPED event isn't flushed to the stack until the
    // spell finishes casting, and untapForPayment discards that event first.
    const lifeBeforeTap = player.life;

    // CR 605.1a / 305.6 — a source with 2+ mana-tap options (its own ability
    // AND/OR one per distinct basic land subtype it has, e.g. any land under
    // Urborg) requires the activator to pick which ability to activate. A single
    // choice-based ability (Fellwar Stone) also routes here.
    if (
        manaTapNeedsChoice(card, player.id, manaTapBattlefields(state), ability)
    ) {
        if (manaChoiceIndex === undefined) {
            throw new Error("Must choose a mana color");
        }
        // CR 106.1 — resolve the submitted index against the unified option list
        // (activated abilities + intrinsic basic-land subtypes), carrying the
        // chosen option's provenance so riders fire only for the ability that
        // actually produced the mana (a basic-subtype pick has none).
        const resolved = resolveManaTapChoice(
            card,
            player.id,
            manaTapBattlefields(state),
            manaChoiceIndex
        );
        if (!resolved) {
            throw new Error(MANA_CHOICE_REJECTION);
        }
        const { ability: effAbility, choiceIndex } = resolved;
        // CR 614 — Deep Water rewrites a land's produced mana to {U} before it
        // reaches the pool, so the event and refund snapshot the {U} actually
        // added (no-op for non-lands / players without the effect).
        const chosen = applyLandManaReplacement(
            state,
            player.id,
            card,
            resolved.mana
        );

        // CR 122.6 / 605.1a — Mana Battery tapped as a payment source: the
        // ability-LOCAL choice index is the number of charge counters removed.
        const counterType = effAbility?.manaChoiceRemovesCounters;
        const removeCounters =
            counterType !== undefined &&
            choiceIndex !== undefined &&
            choiceIndex > 0;
        if (removeCounters) {
            const have = card.counters?.[counterType] ?? 0;
            if (have < choiceIndex) {
                throw new Error("Not enough counters for this choice");
            }
            payRemoveCounterCost(card, {
                type: counterType,
                count: choiceIndex,
            });
        }

        const isSacrifice = effAbility?.cost.sacrifice === true;
        // CR 605.1a / 601.2f — pay the mana portion of the activation cost
        // (Chromatic Star's {1}) FIRST, before any source mutation, so an
        // unaffordable activation throws with nothing changed.
        applyManaAbilityManaCost(player, effAbility, card);
        // CR 605.2 — emit "tapped for mana" before the sacrifice path moves
        // the card off the battlefield, so the event carries the permanent's
        // pre-sacrifice types/subtypes for trigger predicates.
        emitPermanentTapped(state, card, true, chosen);
        if (isSacrifice) {
            // CR 603.6 / 700.4 — sacrificing the source to pay its own mana
            // ability puts it into the graveyard from the battlefield, which is
            // the trigger condition for its leave-the-battlefield / dies trigger
            // (Chromatic Star, Basal Thrull) regardless of WHY it left. Route
            // through the `removePermanentTo` funnel so a `PERMANENT_LEFT` event
            // is queued and the trigger scan (`processPendingActionTriggers`)
            // puts the trigger on the stack after the mana ability resolves — a
            // raw `moveCard` would silently skip the leave event.
            removePermanentTo(state, card.id, "graveyard", "sacrifice");
        } else {
            card.isTapped = true;
            card.chosenMana = chosen;
            if (removeCounters) {
                card.manaCounterRemoval = {
                    type: counterType,
                    count: choiceIndex,
                };
            }
        }
        // CR 106.6 (issue #1559 review) — deposit into the parallel
        // `restrictedMana` pool (with its rider) when the resolved ability is
        // restricted (Adarkar Unicorn, Delighted Halfling's legendary-spell
        // ability), instead of always crediting the fungible pool. Previously
        // this path (the payment-tap / auto-tap default UX) ignored the
        // restriction entirely.
        depositTappedMana(
            player,
            chosen,
            effAbility?.manaRestriction,
            effAbility?.manaCantBeCounteredRider
        );
        // CR 603.7a / ADR 0040 — arm a control-change-on-tap rider (Rainbow
        // Vale) when this source is tapped for mana during a payment.
        if (!isSacrifice)
            armDelayedTriggerOnTap(state, effAbility, card, player.id);
        // CR 605.1a / 120 — painland coloured-tap self-damage rider (Adarkar
        // Wastes et al.): when a coloured option is chosen (not {C}), the source
        // deals N damage to its controller. Fires in the payment-tap path too,
        // so the ping applies whether the land is tapped for mana via priority
        // (`tapUntap`) or while paying a spell/ability cost (here).
        applyColoredTapSelfDamage(state, effAbility, card, player.id, chosen);
        // CR 605.1a / 120 — unconditional fixed-mana self-damage rider (Ancient
        // Tomb): fires when the chosen option is the source's own fixed ability.
        // A basic-subtype pick (effAbility null) carries no rider — Ancient Tomb
        // under Urborg tapped for {B} via the Swamp ability deals no damage.
        applyUnconditionalTapSelfDamage(state, effAbility, card, player.id);
        // CR 605.1a / 122.1 — depletion-dual tap-for-mana rider (Land Cap et
        // al.): every tap for mana puts one depletion counter on the source.
        // Fires in the payment-tap path too, so the land depletes whether
        // tapped via priority or while paying a spell/ability cost.
        applyDepletionCounterOnTap(effAbility, card);
        // CR 605.1a / 118.4 — tap mana ability life-payment cost (Mana
        // Confluence et al.): fires in the payment-tap path too, so the life
        // is paid whether the land is tapped for mana via priority
        // (`tapUntap`) or while paying a spell/ability cost (here).
        applyManaAbilityLifeCost(state, effAbility, player.id);
        // CR 605.1a / 118.3 — tap mana ability discard-at-random cost (Lion's
        // Eye Diamond): fires in the payment-tap path too, so the discard
        // applies whether the source is tapped via priority (`tapUntap`) or
        // while paying a spell/ability cost (here).
        applyManaAbilityDiscardCost(state, effAbility, player.id);
        // CR 605.1a / 121.1 — mana-ability draw rider (Chromatic Sphere):
        // fires in the payment-tap path too, so the draw applies whether the
        // source is tapped via priority (`tapUntap`) or while paying a
        // spell/ability cost (here). Unlike the riders above, this one is NOT
        // gated on `!isSacrifice` — it must fire on Sphere's own sacrifice.
        applyDrawCardOnTap(state, effAbility, player.id);
        // CR 106.4 / 605.1a — record the life paid to the inline riders so
        // untapForPayment can restore it. Real delta (post CR 614/615), and 0
        // on the sacrifice path (the painland rider no-ops on a sacrificed
        // source, and a sacrificed source has no untap branch anyway).
        recordLifePaidOnTap(card, lifeBeforeTap, player.life);
        // CR 605.4 — resolve this tap's Wild-Growth-style mana bonus into the
        // pool now (so the affordability check sees it) and record it for undo.
        if (!isSacrifice) realizeAndStampTapBonus(state, player, card);
        tappedLandIds.push(card.id);
        return;
    }

    const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
    if (!manaColor) throw new Error("Card does not produce mana");
    // ADR 0039 / CR 605.1a — a fixed-output "Sacrifice this" mana ability
    // (Basal Thrull) sacrifices the source instead of tapping it. One-way: the
    // sacrificed source is never in `tappedLandIds` as an untappable entry.
    const isSacrifice = ability?.cost.sacrifice === true;
    // CR 605.1a / 601.2f — pay the mana portion of the activation cost FIRST,
    // before any source mutation, so an unaffordable activation throws with
    // nothing changed.
    applyManaAbilityManaCost(player, ability, card);
    if (!isSacrifice) card.isTapped = true;
    // CR 106.1 / 605.1a — board-conditional output (Urza trio) is computed from
    // the controller's battlefield now and snapshotted onto `chosenMana` so the
    // untap/refund path returns the exact amount that was added.
    const amount = getFixedManaAmount(card, manaColor, player.battlefield);
    // CR 614 — Deep Water rewrites a land's produced mana to {U} (no-op for
    // non-lands / unaffected players).
    const added = applyLandManaReplacement(state, player.id, card, {
        [manaColor]: amount,
    } as ManaCost);
    if (
        getDynamicManaProduced(card, player.battlefield) ||
        added[manaColor] === undefined
    ) {
        card.chosenMana = added;
    }
    // CR 106.6 (issue #1559 review) — deposit into the parallel
    // `restrictedMana` pool when this FIXED mana ability is restricted
    // (Mishra's Workshop), instead of always crediting the fungible pool.
    // Mirrors `tapUntap`'s already-fixed fixed-ability tap branch.
    depositTappedMana(
        player,
        added,
        getActivatedManaRestriction(card) ?? undefined,
        undefined
    );
    // CR 605.2 — emit "tapped for mana" before the sacrifice moves the card off
    // the battlefield, so leaves-the-battlefield triggers see the mana added and
    // the event carries the permanent's pre-sacrifice characteristics.
    emitPermanentTapped(state, card, true, added);
    // ADR 0039 / CR 605.1a — pay the "Sacrifice this" portion of a fixed-output
    // sacrifice mana ability (Basal Thrull). One-way: the sacrificed source is
    // never recorded in `tappedLandIds` (there is no untap/refund branch for it).
    // CR 603.6 / 700.4 — route through `removePermanentTo` so the graveyard
    // departure queues a `PERMANENT_LEFT` event and the source's leave-the-
    // battlefield / dies trigger fires (a raw `moveCard` skips the event).
    if (isSacrifice) {
        removePermanentTo(state, card.id, "graveyard", "sacrifice");
    } else {
        // CR 603.7a / ADR 0040 — arm a control-change-on-tap rider when a
        // fixed-output tap mana source is tapped during a payment.
        armDelayedTriggerOnTap(state, ability, card, player.id);
        tappedLandIds.push(card.id);
    }
    // CR 605.1a / 120 — unconditional fixed-mana self-damage rider (Ancient
    // Tomb): a FIXED (non-choice) tap mana ability pings the controller on
    // every tap regardless of the mana produced. Fires in the payment-tap
    // path too, so the ping applies whether tapped via priority (`tapUntap`)
    // or while paying a spell/ability cost (here).
    applyUnconditionalTapSelfDamage(state, ability, card, player.id);
    // CR 605.1a / 118.4 — tap mana ability life-payment cost. Fires in the
    // payment-tap path too, so the life is paid whether tapped via priority
    // (`tapUntap`) or while paying a spell/ability cost (here).
    applyManaAbilityLifeCost(state, ability, player.id);
    // CR 605.1a / 118.3 — tap mana ability discard-at-random cost. Fires in
    // the payment-tap path too, so the discard applies whether tapped via
    // priority (`tapUntap`) or while paying a spell/ability cost (here).
    applyManaAbilityDiscardCost(state, ability, player.id);
    // CR 605.1a / 121.1 — mana-ability draw rider (Chromatic Sphere). Fires in
    // the payment-tap path too, whether tapped via priority (`tapUntap`) or
    // while paying a spell/ability cost (here). Unlike the riders above, this
    // one is NOT gated on `!isSacrifice` — it must fire on a sacrifice cost.
    applyDrawCardOnTap(state, ability, player.id);
    // CR 106.4 / 605.1a — record the life paid to the inline riders (Ancient
    // Tomb, Mana Confluence) so untapForPayment can restore it. Skip on the
    // sacrifice path: the source is gone and has no untap branch.
    if (!isSacrifice) recordLifePaidOnTap(card, lifeBeforeTap, player.life);
    // CR 605.4 — resolve this tap's Wild-Growth-style mana bonus into the pool
    // now (so the affordability check sees it) and record it for undo.
    if (!isSacrifice) realizeAndStampTapBonus(state, player, card);
}

/** CR 605.4 / 106.4 — reversing a for-mana tap undoes the whole mana ability,
 *  so refund the extra mana a Wild-Growth-style triggered mana ability added on
 *  this tap (`tapBonusMana`) and clear the record. Without this the bonus stays
 *  floating after the source untaps — the tap → +2 / untap → −1 infinite-mana
 *  leak. Symmetric with the `chosenMana` / `lifePaidThisTap` refunds. No-op when
 *  the tap added no bonus. */
export function refundTapBonusMana(
    player: PlayerState,
    card: CardInstanceState
): void {
    if (!card.tapBonusMana) return;
    for (const [color, amount] of Object.entries(card.tapBonusMana)) {
        if (color !== "X" && typeof amount === "number" && amount > 0) {
            player.manaPool[color] = Math.max(
                0,
                (player.manaPool[color] ?? 0) - amount
            );
        }
    }
    card.tapBonusMana = undefined;
}

/** Reverses a single tap recorded in `tappedLandIds` — refunds the mana and
 *  untaps the source. Shared by untapForPayment and untapForActivationPayment. */
function untapSourceFromPayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): void {
    discardPermanentTappedEvent(state, card.id);
    refundTapBonusMana(player, card);
    // CR 106.6 (issue #1559 review) — restriction-aware refund: reverses the
    // parallel `restrictedMana` deposit (with its rider) instead of always
    // assuming the fungible pool.
    if (card.chosenMana) {
        refundChosenManaOutput(player, card);
    } else {
        const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
        if (!manaColor) throw new Error("Card does not produce mana");
        refundFixedManaOutput(player, card, manaColor);
    }
    // CR 122.6 — restore the charge counters removed to pay a Mana Battery's
    // scaling cost when the payment tap is reversed.
    if (card.manaCounterRemoval) {
        const { type, count } = card.manaCounterRemoval;
        const next = { ...(card.counters ?? {}) };
        next[type] = (next[type] ?? 0) + count;
        card.counters = next;
        card.manaCounterRemoval = undefined;
    }
    // CR 106.4 / 605.1a — reversing this payment tap undoes the whole mana
    // ability, so restore the life its inline riders took (painland ping,
    // Ancient Tomb, Mana Confluence). Symmetric with the mana / counter refund
    // above.
    restoreLifePaidOnUntap(player, card);
    // CR 106.4 / 601.2f — and the mana its own activation cost took (Chromatic
    // Star's {1}). Same reversal, cost side.
    restoreManaPaidOnUntap(player, card);
    card.isTapped = false;
}

/** True iff a card sitting in a graveyard satisfies the exile-from-graveyard
 *  cost's optional card-type filter (CR 118.5 / 406 — Night Soil: "creature
 *  cards"). The card's printed types are read from its instance (graveyard
 *  cards retain `types`); when `cardType` is omitted any card qualifies. */
function graveyardCardMatchesExileCost(
    card: CardInstanceState,
    cardType?: CardType
): boolean {
    if (cardType === undefined) return true;
    return card.types.includes(cardType);
}

/** True iff at least ONE eligible graveyard holds `count` cards matching
 *  `cardType` (CR 118.5 — the whole cost must be paid from a SINGLE graveyard;
 *  it cannot be split across two). Gates activation legality for an
 *  `exileFromGraveyard` cost (Night Soil). When `restrictOwnerId` is set, only
 *  that player's graveyard is eligible (CR 118.5 — Grim Lavamancer's "your
 *  graveyard", `owner: "you"`); otherwise any player's graveyard qualifies. */
function canPayExileFromGraveyard(
    state: GameState,
    count: number,
    cardType?: CardType,
    restrictOwnerId?: string
): boolean {
    const sources =
        restrictOwnerId !== undefined
            ? state.players.filter((p) => p.id === restrictOwnerId)
            : state.players;
    return sources.some(
        (p) =>
            p.graveyard.filter((c) =>
                graveyardCardMatchesExileCost(c, cardType)
            ).length >= count
    );
}

/** True iff the graveyard card matches a FLASHBACK exile cost's colour filter
 *  (CR 105.2 / 202.2 — Flash of Insight "blue cards"). Colours are the card's
 *  actual printed COLOUR (`cardHasColor` → colours of its mana cost), NOT its
 *  deck-builder colour identity: an Island taps for blue but is COLOURLESS
 *  (CR 105.2a) and never pays "exile a blue card". `color` undefined matches any
 *  card. A card whose definition can't be resolved never matches (a token has no
 *  graveyard existence, CR 111.7). COLOUR LEG ONLY — delegates to the shared
 *  `isExileCostEligible` (issue #1659) so this authoritative server check can
 *  never drift from the bot view / dialog mirrors. Not `excludeInstanceId`-aware:
 *  callers that also need CR 601.2a's "can't exile itself" check apply that
 *  separately (`recordCastExileCostPick`'s own check at commit carries its own
 *  distinct error message and stays independent of this helper). The sentinel
 *  `""` never matches a real instance id — ids are allocated `1, 2, 3, …`
 *  (`allocInstanceId`, `convex/gre/state.ts`), never the empty string. */
function graveyardCardMatchesColor(
    card: CardInstanceState,
    color?: Color
): boolean {
    return isExileCostEligible(card, "", color);
}

/** True iff `player`'s OWN graveyard holds `count` cards matching `color`,
 *  EXCLUDING `excludeInstanceId` (the flashback card itself — casting it moves
 *  it from the graveyard to the stack before its costs are paid, CR 601.2a, so
 *  it can never be exiled for its own cost). Gates the legality
 *  of a `flashbackExileFromGraveyard` cost at cast announcement (Flash of
 *  Insight). */
function canPayFlashbackExile(
    player: PlayerState,
    count: number,
    color: Color | undefined,
    excludeInstanceId: string
): boolean {
    return (
        flashbackExileEligibleCount(player, color, excludeInstanceId) >= count
    );
}

/** Untapped permanents on `player`'s battlefield that match `filter` and are
 *  eligible to pay a `tapOtherFilter` cost (CR 602.1 / 118.8). The source
 *  permanent (`sourceId`) is excluded — the cost taps OTHER permanents — as is
 *  anything already tapped. Effective colours are derived per-candidate via the
 *  layer system so a `colors` filter ("white creatures") reads the same colour
 *  the rest of the engine sees. The activating player is the controller-relation
 *  reference, so `controllerRelation: "you"` resolves to `player`. */
function tapOtherCandidates(
    player: PlayerState,
    sourceId: string,
    filter: PermanentFilter
): CardInstanceState[] {
    return player.battlefield.filter((c) => {
        if (c.id === sourceId) return false;
        if (c.isTapped) return false;
        const view = {
            ...c,
            colors: STATIC_EFFECT_CTX.getColors(c),
        };
        return matchesPermanentFilter(view, filter, {
            selfControllerId: player.id,
            supertypesOf: liveSupertypesOf,
        });
    });
}

/** Pays a `cost.tapOtherFilter` component for a NON-stack (`useStack: false`)
 *  mana ability (CR 602.1 / 118.8 — Urza, Lord High Artificer, issue #2371:
 *  "Tap an untapped artifact you control: Add {U}."). Every OTHER
 *  `tapOtherFilter` cost in the catalogue (Hand of Justice, Vodalian War
 *  Machine, Earthcraft, Hecatomb, Karplusan Giant) is a `useStack: true`
 *  ability paid through the deferred `pendingActivation.tapOtherChoice`
 *  picker above (`selectActivationCostOnState`) — that machinery assumes a
 *  stack item exists to defer onto. A mana ability resolves in ONE mutation
 *  call with no deferred step (CR 605.3c), so `activateManaAbility` instead
 *  passes the WHOLE pick set up front (`tapOtherIds`); this function
 *  validates every pick — on the activating player's battlefield, untapped,
 *  not the ability's own source, matching `spec.filter` — BEFORE tapping any
 *  of them, so a rejected activation leaves the board untouched. Reuses the
 *  SAME `tapOtherFilter` predicates (`gre/tapOtherCost.ts`) the picker above
 *  and the bot's `pickTapOtherPayment` share.
 *
 *  Deliberately NOT exported. Its coverage runs through the registered
 *  `activateManaAbility` `_handler` (`cards/sets/mh1/__tests__/blue.test.ts`
 *  via `gameMutationHarness.ts`), because a test that calls this directly
 *  stays green when the mutation stops calling it at all — which is exactly
 *  what shipped in PR #2419 round 1 and what the harness's own header comment
 *  forbids. */
function payTapOtherAbilityCost(
    state: GameState,
    player: PlayerState,
    sourceId: string,
    spec: TapOtherCostSpec,
    tapOtherIds: readonly string[]
): void {
    const seen = new Set<string>();
    const picks: CardInstanceState[] = [];
    for (const id of tapOtherIds) {
        if (id === sourceId) {
            throw new Error("Cannot tap the ability's own source");
        }
        if (seen.has(id)) {
            throw new Error("Permanent already selected to tap");
        }
        seen.add(id);
        const perm = player.battlefield.find((c) => c.id === id);
        if (!perm) {
            throw new Error("Selected permanent not on your battlefield");
        }
        if (perm.isTapped) {
            throw new Error("Selected permanent is already tapped");
        }
        const view = { ...perm, colors: STATIC_EFFECT_CTX.getColors(perm) };
        if (
            !matchesPermanentFilter(view, spec.filter, {
                selfControllerId: player.id,
                supertypesOf: liveSupertypesOf,
            })
        ) {
            throw new Error(
                "Selected permanent does not match the tap cost filter"
            );
        }
        picks.push(perm);
    }
    if (
        !canPayTapOtherCost(
            spec,
            picks.map((p) => tapOtherContribution(state, p))
        )
    ) {
        throw new Error("Not enough untapped permanents to pay the tap cost");
    }
    for (const perm of picks) tapPermanent(state, perm);
}

/** A tap-other picker's current picks as weighed candidates, recomputed from
 *  the LIVE battlefield (a pick that has since been pumped/shrunk counts at its
 *  current value, CR 608.2 — the cost isn't locked until it's paid). A pick
 *  that has left the battlefield stays in the list at power 0 so the
 *  fixed-cardinal shape keeps its historical `pickedIds.length` semantics;
 *  commit re-validates every pick and aborts on a vanished one. */
function tapOtherPickedCandidates(
    state: GameState,
    player: PlayerState,
    pickedIds: readonly string[]
): TapOtherCandidate[] {
    return pickedIds.map((id) => {
        const perm = player.battlefield.find((c) => c.id === id);
        return perm ? tapOtherContribution(state, perm) : { id, power: 0 };
    });
}

/** Running crew total of a tap-other picker's picks (CR 702.122a). */
function tapOtherPickedPower(
    state: GameState,
    player: PlayerState,
    pickedIds: readonly string[]
): number {
    return totalTapOtherPower(
        tapOtherPickedCandidates(state, player, pickedIds)
    );
}

/** Cast-from-exile lookup (CR 601.3e — Ice Cauldron: "You may cast that card
 *  for as long as it remains exiled"). Returns the card carrying
 *  `castableFromExileBy === casterId` and matching `instanceId`, or undefined.
 *  Searches EVERY player's exile, not just the caster's own (issue #1156):
 *  a grant is usually same-player (Ice Cauldron), but `grantCastFromExile`'s
 *  `zoneOwnerId` already supports a CROSS-PLAYER grant (Robber of the Rich,
 *  Dauthi Voidwalker — the redirected/exiled card stays in ITS OWNER's exile,
 *  CR 400.7, while a different player is granted the cast permission), so the
 *  lookup can't assume the caster's own zone. The cast pipeline checks the
 *  hand first, then this. */
function findCastableExileCard(
    state: GameState,
    casterId: string,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.exile.find(
            (c) => c.id === instanceId && c.castableFromExileBy === casterId
        );
        if (found) return found;
    }
    return undefined;
}

/** CR 601.3e / 400.7 (issue #1156) — the player whose zone actually holds a
 *  card being cast/played, which may differ from the CASTER (`player`) for a
 *  cross-player exile grant (Robber of the Rich, Dauthi Voidwalker). Every
 *  other cast zone (hand, graveyard) is always the caster's own — Flashback /
 *  Escape / the broad graveyard-cast permission all read from the caster's
 *  OWN graveyard, no cross-player graveyard-cast primitive exists — so this
 *  only ever redirects for `zone === "exile"`. Falls back to `player` when
 *  the card isn't found in any exile (defensive; callers have already located
 *  the card via `locateCastSource` / `findCastableExileCard`, so this should
 *  always resolve for a real cast). Exported so the cross-player cast-commit
 *  integration test can drive the exact removal the mutation performs (no
 *  convex-test harness in this repo — mirrors `locateCastSource` /
 *  `castRawManaCost`, issue #944 pattern). */
export function castZoneOwner(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string,
    zone: CastFromZone
): PlayerState {
    if (zone !== "exile") return player;
    return (
        state.players.find((p) =>
            p.exile.some((c) => c.id === cardInstanceId)
        ) ?? player
    );
}

/** Play-from-graveyard lookup (CR 305.1-analog permission, issue #1190 —
 *  Icetill Explorer). Returns the LAND in `player`'s graveyard matching
 *  `instanceId` while `player` holds the unconditional, player-wide
 *  play-lands-from-graveyard permission (`canPlayLandsFromGraveyard`), or
 *  undefined. Unlike the exile permission (`castableFromExileBy`, a per-card
 *  grant), this permission is derived live from the battlefield every call —
 *  there is nothing to check or clear on the card itself. */
function findPlayableGraveyardLand(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    if (!canPlayLandsFromGraveyard(state, player)) return undefined;
    const card = player.graveyard.find((c) => c.id === instanceId);
    return card && card.types.includes("Land") ? card : undefined;
}

/** Play-from-top-of-library lookup (CR 305.1-analog permission — Courser of
 *  Kruphix). Returns the LAND on top of `player`'s own library when it matches
 *  `instanceId` and `player` holds the play-from-top permission, or undefined.
 *  Position-strict: only index 0 qualifies, because the permission names the
 *  TOP card and the rest of the library is a hidden zone (CR 400.2) — a stale
 *  client id naming a card the library has since moved must not become a play
 *  from the middle of the deck. Like the graveyard permission this is derived
 *  live from the battlefield every call, so there is nothing on the card
 *  itself to check or clear. */
function findPlayableLibraryTopLand(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    if (!isPlayableLibraryTopLand(state, player, instanceId)) return undefined;
    return player.library[0];
}

/** CR 305.1-analog / 601 (issue #1149) — the SPELL half of the BROAD,
 *  turn-scoped graveyard-cast permission (Yawgmoth's Will). Returns the
 *  NON-LAND card in `player`'s graveyard matching `instanceId` while the
 *  permission covers it, or undefined. Never returns a card that already has
 *  Flashback/Escape — `locateCastSource` checks those first, so this is only
 *  ever reached for a card with neither (the permission then covers it for
 *  its normal printed mana cost). */
function findGraveyardPermissionCastable(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return canCastFromGraveyardByPermission(state, player, card)
        ? card
        : undefined;
}

/** Per-card cast-from-graveyard grant lookup (CR 601.3e / 117.6-analog,
 *  issue #1344 — Malcolm, Alluring Scoundrel: "you may cast the discarded
 *  card without paying its mana cost"). Returns the NON-LAND card in
 *  `player`'s graveyard matching `instanceId` while it carries
 *  `castableFromGraveyardBy === player.id`, or undefined. Distinct from
 *  `findGraveyardPermissionCastable` above (the BROAD, turn-scoped
 *  permission) — this is a SPECIFIC-CARD grant, always same-player (no
 *  cross-player graveyard-cast primitive exists, `castZoneOwner`'s doc
 *  below). Never returns a card that already has Flashback/Escape/the
 *  broad permission — `locateCastSource` checks those first, so this is
 *  only ever reached for a card with none of them. */
function findGraveyardGrantCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card || card.types.includes("Land")) return undefined;
    return card.castableFromGraveyardBy === player.id ? card : undefined;
}

/** CR 702.51 / 601.3e (issue #1338, Hogaak, Arisen Necropolis) — the INTRINSIC
 *  self-permission lookup: a non-land card in `player`'s graveyard whose own
 *  definition declares `castableFromOwnGraveyard` ("You may cast this card from
 *  your graveyard"). Always same-player. Never returns a card that has
 *  Flashback/Escape/a broad-or-specific external permission — `locateCastSource`
 *  checks those first, so this is only reached for a card with none of them. */
function findIntrinsicGraveyardCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card || card.types.includes("Land")) return undefined;
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    return def?.castableFromOwnGraveyard ? card : undefined;
}

/** CR 702.139 (issue #1392, Lurrus of the Dream-Den) — the STATIC,
 *  battlefield-derived graveyard-permanent-cast permission lookup. Returns
 *  the card in `player`'s graveyard matching `instanceId` while
 *  `canCastPermanentFromGraveyardByPermission` covers it, or undefined.
 *  Never returns a card that already has Flashback/Escape/the broad
 *  permission/a specific grant — `locateCastSource` checks those first, so
 *  this is only ever reached for a card with none of them. */
function findGraveyardPermanentPermissionCastable(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return canCastPermanentFromGraveyardByPermission(state, player, card)
        ? card
        : undefined;
}

/** CR 601.3e-analog (issue #2398, Bolas's Citadel) — the cast-from-top-of-
 *  library lookup. Returns the NONLAND card on top of `player`'s own library
 *  when it matches `instanceId` and `player` holds the cast-from-top
 *  permission, or undefined. Position-strict (index 0 only): the permission
 *  names the TOP card and the rest of the library is a hidden zone (CR 400.2),
 *  so a stale client id naming a card the library has since moved must never
 *  become a cast from the middle of the deck. Like the graveyard/library land
 *  permissions this is derived live from the battlefield every call — nothing
 *  on the card itself to check or clear. */
function findCastableLibraryTopSpell(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    if (!isCastableLibraryTopSpell(state, player, instanceId)) return undefined;
    return player.library[0];
}

/** The zone a cast originates from (CR 601.3e). Normally the hand; exile for
 *  Ice Cauldron's noted card; graveyard for a Flashback cast (CR 702.34);
 *  library for a cast off the TOP under a cast-from-top permission
 *  (CR 601.3e-analog, Bolas's Citadel). */
type CastFromZone = "hand" | "exile" | "graveyard" | "library";

/** Locate the card being cast and the zone it comes from — hand, exile
 *  (Ice Cauldron, CR 601.3e), or graveyard (Flashback, CR 702.34, Escape,
 *  CR 702.138, or the BROAD graveyard-cast permission, CR 305.1-analog / 601,
 *  issue #1149). A single choke point so every cast-commit site derives the
 *  origin identically. The `card` is undefined when the id isn't castable
 *  from any zone (callers throw "Card not in hand"). `viaGraveyardPermanentPermission`
 *  is set true ONLY when the STATIC graveyard-permanent-cast permission
 *  (Lurrus, issue #1392) is what supplied this cast — the ordered chain
 *  below reaches that branch only when no higher-precedence mechanism
 *  (Flashback/Escape/the broad permission/a specific grant) already claimed
 *  the card, so the flag unambiguously identifies which permission to debit
 *  its once-per-turn use against at commit (`markGraveyardPermanentCastUsed`).
 *  `viaRetrace` is the same idea for Retrace (CR 702.81, issue #2358): the
 *  LAST branch of the chain, so the flag unambiguously says "this cast owes
 *  the discard-a-land additional cost" and no other mechanism's cast ever
 *  pays it.
 *  Exported so the flashback integration test can drive the REAL cast-source
 *  resolution (no convex-test harness — issue #944). */
export function locateCastSource(
    state: GameState,
    player: PlayerState,
    instanceId: string
): {
    card?: CardInstanceState;
    zone: CastFromZone;
    viaGraveyardPermanentPermission?: true;
    viaRetrace?: true;
} {
    const inHand = player.hand.find((c) => c.id === instanceId);
    if (inHand) return { card: inHand, zone: "hand" };
    const exile = findCastableExileCard(state, player.id, instanceId);
    if (exile) return { card: exile, zone: "exile" };
    const flashback = findFlashbackCastable(player, instanceId);
    if (flashback) return { card: flashback, zone: "graveyard" };
    // CR 702.138b — a card with escape may be cast from its owner's graveyard.
    const escape = findEscapeCastable(state, player, instanceId);
    if (escape) return { card: escape, zone: "graveyard" };
    // CR 305.1-analog / 601 (issue #1149) — a card castable purely under the
    // BROAD graveyard-cast permission (neither Flashback nor Escape).
    const permissionCast = findGraveyardPermissionCastable(
        state,
        player,
        instanceId
    );
    if (permissionCast) return { card: permissionCast, zone: "graveyard" };
    // CR 601.3e / 117.6-analog (issue #1344) — a card castable purely under a
    // SPECIFIC-CARD graveyard-cast grant (Malcolm, Alluring Scoundrel),
    // reached only when the card has none of Flashback/Escape/the broad
    // permission (those branches above already returned).
    const grantCast = findGraveyardGrantCastable(player, instanceId);
    if (grantCast) return { card: grantCast, zone: "graveyard" };
    // CR 702.51 / 601.3e (issue #1338) — a card castable purely under its OWN
    // intrinsic "you may cast this from your graveyard" permission (Hogaak),
    // reached only when the card has no Flashback/Escape/external permission/
    // specific grant. Resolves normally (no exile-on-resolve).
    const intrinsicGraveyardCast = findIntrinsicGraveyardCastable(
        player,
        instanceId
    );
    if (intrinsicGraveyardCast) {
        return { card: intrinsicGraveyardCast, zone: "graveyard" };
    }
    // CR 702.139 (issue #1392) — a card castable purely under Lurrus's
    // STATIC, once-per-turn, permanent-cards-only permission, reached only
    // when the card has none of Flashback/Escape/the broad permission/a
    // specific grant (those branches above already returned).
    const permanentPermissionCast = findGraveyardPermanentPermissionCastable(
        state,
        player,
        instanceId
    );
    if (permanentPermissionCast) {
        return {
            card: permanentPermissionCast,
            zone: "graveyard",
            viaGraveyardPermanentPermission: true,
        };
    }
    // CR 601.3e-analog (issue #2398, Bolas's Citadel) — the NONLAND card on
    // top of the caster's OWN library, under the player-wide cast-from-top
    // permission. Last in the chain because every other mechanism above is
    // scoped to hand/exile/graveyard and can never name a library card, so
    // the ordering is informational rather than a precedence rule.
    const libraryTopCast = findCastableLibraryTopSpell(
        state,
        player,
        instanceId
    );
    if (libraryTopCast) return { card: libraryTopCast, zone: "library" };
    // CR 702.81 (issue #2358) — a card castable under RETRACE, printed or
    // granted (Wrenn and Six's emblem). Deliberately last among the GRAVEYARD
    // branches: retrace
    // pays the card's normal mana cost PLUS an extra land discard, so every
    // graveyard mechanism above is cheaper for the caster and a card
    // qualifying for two of them takes the other.
    const retraceCast = findRetraceCastable(state, player, instanceId);
    if (retraceCast) {
        return { card: retraceCast, zone: "graveyard", viaRetrace: true };
    }
    return { zone: "hand" };
}

/** CR 118.8 / 601.2f / 701.9 / 702.81a — every HAND-cost leg a cast owes that
 *  `buildCastHandCostChoice` cannot derive from the card definition and the
 *  announced choices it is already given:
 *
 *   - the card's OWN "discard a card" ADDITIONAL cost (CR 118.8 / 701.9 — Bitter
 *     Triumph), read off the already-`oneOf`-flattened spec;
 *   - the RETRACE additional cost (CR 702.81a — "discard a land card"), which is
 *     keyword-derived rather than declared on the definition and so can only be
 *     known from WHICH mechanism supplied this cast (`CastSource.viaRetrace`).
 *
 *  THE choke point (issue #2358 review, finding 1). It exists because the same
 *  cost was previously threaded per call site: `finalizeTargetSelection` spread
 *  the retrace leg in, `announceCast`'s two no-target branches did not, and a
 *  retrace cast of a NON-targeting spell therefore committed having discarded
 *  nothing — a straight CR 702.81a violation that also removed the only thing
 *  bounding the no-exile recast loop. One function, three call sites, and
 *  `buildCastHandCostChoice`'s `extraLegs` is a REQUIRED parameter so a fourth
 *  commit path cannot silently omit it.
 *
 *  Every leg lands in the cast's ONE `alternativeCostHandChoice` picker, so it
 *  is paid by the same commit path, gated by the same `nextOwedPayment`, picked
 *  through the same mutation and rendered by the same component as every
 *  CR 118.9 hand leg. Returns `[]` for the overwhelming majority of casts. */
export function castExtraHandCostLegs(
    effectiveAdditionalCosts: AdditionalCostSpec | undefined,
    castSource: { viaRetrace?: true }
): CostLegs[] {
    const additionalHandLeg = additionalCostHandLeg(effectiveAdditionalCosts);
    return [
        ...(additionalHandLeg ? [additionalHandLeg] : []),
        ...(castSource.viaRetrace ? [RETRACE_COST_LEGS] : []),
    ];
}

/** CR 702.34 — the stack-item flags a Flashback cast (from the graveyard) adds:
 *  `castFromGraveyard` (read by "if this spell was cast from a graveyard"
 *  clauses) and `exileOnResolve` (so `finalizeSpellResolution` exiles the card
 *  instead of returning it to the graveyard). Empty for a normal hand/exile
 *  cast. Exported for the flashback integration test (issue #944 pattern). */
export function flashbackStackFlags(zone: CastFromZone): {
    exileOnResolve?: true;
    castFromGraveyard?: true;
} {
    return zone === "graveyard"
        ? { exileOnResolve: true, castFromGraveyard: true }
        : {};
}

/** CR 702.34 / 702.138 / 305.1-analog / 117.6-analog — the stack-item flags a
 *  graveyard cast adds, choosing between Escape, Flashback, and every OTHER
 *  graveyard-cast mechanism by the card's live capability:
 *   - Escape (CR 702.138b): `castFromGraveyard` + `escaped` — the resulting
 *     permanent escaped. NO `exileOnResolve` (the card resolves normally).
 *   - Flashback (CR 702.34a): `castFromGraveyard` + `exileOnResolve` — the card
 *     is exiled as it leaves the stack.
 *   - Permission cast (CR 305.1-analog / 601, issue #1149, Yawgmoth's Will)
 *     OR a per-card grant (issue #1344, Malcolm, Alluring Scoundrel):
 *     `castFromGraveyard` only — the card resolves and lands in the graveyard
 *     normally, exactly like a hand cast, no exile / no `escaped`. Both share
 *     this same fallback branch — a granted card is never also Flashback/
 *     Escape in practice, so no extra disambiguation is needed.
 *  A non-graveyard cast adds nothing. Exported for the escape integration test. */
export function graveyardCastStackFlags(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): { exileOnResolve?: true; castFromGraveyard?: true; escaped?: true } {
    if (zone !== "graveyard") return {};
    if (hasEscape(state, card)) {
        return { castFromGraveyard: true, escaped: true };
    }
    if (hasFlashback(card)) {
        return flashbackStackFlags(zone);
    }
    // CR 614.1 / 400.7 (issue #2380) — a per-card grant may carry an
    // "if that spell would be put into your graveyard, exile it instead"
    // rider (Jace, Telepath Unbound's −3). Checked BEFORE the plain-grant
    // fallback below and routed through the SAME `exileOnResolve` flag
    // Flashback uses, so there is exactly one exile-as-it-leaves-the-stack
    // path rather than a second parallel one.
    if (card.castFromGraveyardExilesOnResolve) {
        return { castFromGraveyard: true, exileOnResolve: true };
    }
    // CR 702.81a (issue #2358) — a RETRACE cast.
    //
    // THIS BRANCH IS DOCUMENTATION, NOT CONTROL FLOW: it returns exactly the
    // same object as the fallback three lines below, so deleting it changes no
    // behaviour and reds no test (issue #2358 review, finding 3 — the original
    // proof-of-failure claim for it was wrong; only ADDING `exileOnResolve`
    // here reds `retrace.test.ts`). It is kept deliberately, because the
    // ABSENCE of `exileOnResolve` is the mechanic's headline divergence from
    // Flashback and is worth stating where the choice between mechanisms is
    // made: CR 702.81a says nothing about exiling, so a retraced instant or
    // sorcery finishes resolving and is put into its owner's graveyard
    // (CR 608.2m) — which is exactly what makes it retraceable again, bounded
    // only by the lands left in hand to discard. `escaped` is likewise absent:
    // retrace is an ADDITIONAL cost, not the escape alternative cost, so
    // nothing escaped. The behaviour itself IS asserted, on the fallback's
    // output, by `retrace.test.ts`'s `graveyardCastStackFlags` and end-to-end
    // resolve cases.
    if (hasRetrace(state, card)) {
        return { castFromGraveyard: true };
    }
    // CR 305.1-analog / 601 (issue #1149) / 117.6-analog (issue #1344) —
    // neither Escape nor Flashback: this is a plain cast under the BROAD
    // graveyard-cast permission (Yawgmoth's Will) or a per-card grant
    // (Malcolm). No exile-on-resolve, no `escaped` — the card resolves and
    // lands in the graveyard exactly like any other spell (CR 608.2m).
    return { castFromGraveyard: true };
}

/** CR 702.88a — the stack-item flag a Rebound cast adds: `reboundFromHand`,
 *  read by `finalizeSpellResolution` (state.ts) to redirect the resolving
 *  spell to exile (instead of the graveyard) and schedule its next-upkeep
 *  reflexive Cast/Decline trigger. Gated on BOTH the card having rebound AND
 *  the cast originating from HAND — this single gate is what makes CR
 *  702.88a free: the later exile recast has `zone === "exile"`, so it never
 *  re-stamps the flag and can never rebound again. Empty for every other
 *  cast (a card with no rebound, or a rebound card recast from exile/
 *  graveyard). Exported for symmetry with `flashbackStackFlags` / a future
 *  integration test. */
export function reboundCastStackFlags(
    card: CardInstanceState,
    zone: CastFromZone
): { reboundFromHand?: true } {
    return zone === "hand" && hasRebound(card) ? { reboundFromHand: true } : {};
}

/** The mana cost a cast pays: the Escape cost or Flashback cost when cast from
 *  the graveyard (CR 702.138a / 702.34a — "rather than paying its mana cost"),
 *  the card's normal printed mana cost under the BROAD graveyard-cast
 *  permission (CR 305.1-analog / 601, issue #1149 — Yawgmoth's Will pays no
 *  alternative cost, just the printed one), else the card's printed mana cost
 *  for a hand/exile cast. Exported for the flashback/escape integration tests
 *  (issue #944 pattern). */
/** CR 118.9-analog / 119.4 / 107.3b (issue #2398, Bolas's Citadel) — the
 *  payment a cast owes INSTEAD of its mana cost when it comes off the top of
 *  the caster's library under a permission that replaces the mana cost.
 *  `undefined` for every other cast (including a library-top cast under a
 *  permission with no replacement — Vizier of the Menagerie's shape — which
 *  simply pays the printed cost).
 *
 *  The caster is the library's OWNER: `zone === "library"` is only ever
 *  produced by `locateCastSource`'s own-library branch, and no cross-player
 *  library-cast primitive exists (mirroring `castZoneOwner`'s reasoning for
 *  the graveyard).
 *
 *  One helper feeds BOTH halves of the substitution — `castRawManaCost` zeroes
 *  the mana, and each of the two cast-commit life accumulators (the targeted
 *  `finalizeTargetSelection` path and the no-target `announceCast` path) adds
 *  `.life` — so the two can never disagree about whether this cast is free.
 *  It is ALSO the CR 107.3b / 601.2b discriminator at announcement: an `{X}`
 *  is locked to 0 and no alternative cost may ride along on this cast. */
function libraryTopCastPayment(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): { life: number } | undefined {
    if (zone !== "library") return undefined;
    const owner = state.players.find((p) => p.id === card.ownerId);
    if (!owner) return undefined;
    const grant = canCastSpellsFromTopOfLibrary(state, owner);
    if (grant?.manaCostReplacement !== "life-equal-to-mana-value") {
        return undefined;
    }
    return { life: libraryTopCastLifeCost(state, owner, card) };
}

export function castRawManaCost(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): ManaCost | undefined {
    // CR 601.3e / 117.6 (issue #1156) — Dauthi Voidwalker's "play it without
    // paying its mana cost" free-cast waiver: this specific exile-sourced
    // card was granted a cost-free cast (`SpellContext.grantCastFromExile`'s
    // `withoutPayingManaCost` option). Checked BEFORE the Madness branch — a
    // card can't carry both markers in practice (they come from unrelated
    // exile sources), but the free-cast waiver wins if it ever did, since
    // "no cost is required" is stronger than any specific alternative cost.
    if (zone === "exile" && card.castFromExileWithoutPayingManaCost) {
        return {};
    }
    // CR 702.35a — a card discarded via Madness is cast from exile for its
    // madness cost, not its printed mana cost. `Madness {0}` is the empty cost.
    if (zone === "exile" && card.madnessExiled) {
        return getMadnessCost(card) ?? {};
    }
    // CR 118.9-analog / 119.4 (issue #2398, Bolas's Citadel) — a cast made
    // under a cast-from-top-of-library permission whose `manaCostReplacement`
    // is `"life-equal-to-mana-value"` pays NO mana at all: the whole mana cost
    // is replaced by a life payment charged at commit
    // (`castLifeInsteadOfMana`, deducted alongside every other life leg).
    // Returning `{}` here — not `undefined` — is what makes the mana half free
    // at every cost site (`normalizeManaCost`, the pool-coverage gate, the
    // auto-tap solver) without any of them learning about the permission.
    if (libraryTopCastPayment(state, card, zone)) {
        return {};
    }
    if (zone !== "graveyard") return getInstanceManaCost(card);
    // CR 601.3e / 117.6-analog (issue #1344) — Malcolm, Alluring Scoundrel's
    // "cast the discarded card without paying its mana cost" free-cast
    // waiver: this specific graveyard-sourced card was granted a cost-free
    // cast (`SpellContext.grantCastFromGraveyard`'s `withoutPayingManaCost`
    // option). Checked BEFORE Escape/Flashback/the broad permission below —
    // the free-cast waiver wins if a card somehow carried more than one
    // marker, since "no cost is required" is stronger than any specific
    // alternative cost (mirrors the exile branch's own precedence above).
    if (card.castFromGraveyardWithoutPayingManaCost) {
        return {};
    }
    // CR 702.138a — an escape cast pays the escape mana cost; a card never has
    // both escape and flashback, so this preference is unambiguous.
    if (hasEscape(state, card)) return getEscapeManaCost(state, card);
    // CR 702.34a — a Flashback cast pays the flashback mana cost, which may be
    // ABSENT for a purely non-mana flashback (Lava Dart: "Sacrifice a
    // Mountain", no mana portion) — `undefined` here correctly means "no mana
    // to pay", NOT "fall back to the printed cost".
    if (hasFlashback(card)) return getFlashbackCost(card);
    // CR 305.1-analog / 601 (issue #1149) — neither Escape nor Flashback: a
    // plain cast under the BROAD graveyard-cast permission (Yawgmoth's Will)
    // pays the card's normal printed mana cost.
    return getInstanceManaCost(card);
}

/** Resolves an activated ability's mana cost, folding in the FEM Merseine
 *  "pay enchanted creature's mana cost" dynamic cost (CR 601.2f / 202.3). When
 *  `manaEqualToEnchantedCreatureCost` is set, the source's `attachedTo`
 *  permanent's PRINTED mana cost is added on top of any declared `cost.mana`
 *  (normally none). Returns `undefined` when there is no mana cost at all, and
 *  throws when the dynamic cost is declared but the source isn't attached to a
 *  permanent on the battlefield (illegal activation). */
export function resolveAbilityManaCost(
    state: GameState,
    card: CardInstanceState,
    ability: { cost: ActivatedAbility["cost"] },
    opts: { chosenX?: number } = {}
): Record<string, number> | undefined {
    const base = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana, { chosenX: opts.chosenX })
        : undefined;
    // CR 601.2f — Chromatic Armor's "{X}: … X is the number of sleight counters
    // on this Aura": fold `card.counters[type]` generic pips onto the base. X is
    // fixed by board state (no player choice), read at activation.
    if (ability.cost.manaEqualToCounterCount) {
        const have =
            card.counters?.[ability.cost.manaEqualToCounterCount.type] ?? 0;
        const merged: Record<string, number> = { ...(base ?? {}) };
        if (have > 0) merged.X = (merged.X ?? 0) + have;
        return Object.keys(merged).length > 0 ? merged : undefined;
    }
    if (!ability.cost.manaEqualToEnchantedCreatureCost) return base;

    const hostId = card.attachedTo;
    const host = hostId
        ? state.players
              .flatMap((p) => p.battlefield)
              .find((c) => c.id === hostId)
        : undefined;
    if (!host) {
        throw new Error("Enchanted creature is no longer on the battlefield");
    }
    const hostCardId = (host.card as { id?: string }).id;
    const hostCost = (hostCardId ? tryGetDefinition(hostCardId) : undefined)
        ?.manaCost;
    // Merge the host's printed cost (normalized so X folds to 0, CR 202.3b)
    // onto the base.
    const merged: Record<string, number> = { ...(base ?? {}) };
    const hostNormalized = hostCost ? normalizeManaCost(hostCost) : {};
    for (const [sym, amt] of Object.entries(hostNormalized)) {
        merged[sym] = (merged[sym] ?? 0) + amt;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Builds the `pendingActivation` payment descriptor for a non-targeted
 *  activated ability whose costs are deferred (mana not yet covered, or a
 *  choice cost still pending). Single source of truth for the `activateAbility`
 *  mutation so every deferred cost — crucially the CR 106.10 noted-mana capture
 *  flag (Jeweled Amulet / Ice Cauldron) — is carried onto the payment and
 *  honoured at `tryAutoCommitPendingActivation`. Pure: returns the descriptor,
 *  mutates nothing. */
export function buildPendingActivation(opts: {
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
    ability: ActivatedAbility;
    manaCost: Record<string, number> | undefined;
    chosenX?: number;
    /** CR 700.2c (issue #1341) — mode locked in at announcement for a modal
     *  activated ability; rides to the stack item at commit. */
    chosenModeId?: string;
    keepPriority?: boolean;
    grantedSourceCardId?: string;
    fromGraveyard?: boolean;
    fromHand?: boolean;
    /** Unified filtered-sacrifice choice (own cost + static Drought), built by
     *  the caller which has `state` (CR 701.21a). */
    sacrificeSelection?: SacrificeSelection;
}): PendingActivation {
    const { ability } = opts;
    return {
        playerId: opts.playerId,
        cardInstanceId: opts.cardInstanceId,
        ...(opts.fromGraveyard ? { fromGraveyard: true } : {}),
        ...(opts.fromHand ? { fromHand: true } : {}),
        abilityId: opts.abilityId,
        ...(opts.chosenModeId ? { chosenModeId: opts.chosenModeId } : {}),
        manaCost: opts.manaCost ?? {},
        tappedLandIds: [],
        tapSource: !!ability.cost.tap,
        sacrificeSource: !!ability.cost.sacrifice,
        ...(ability.cost.discardThis ? { discardThisSource: true } : {}),
        // CR 702.29c / 702.29f — carry the "this discard pays a cycling cost"
        // marker to commit, where the ability object is no longer in scope.
        // Declared once on `cyclingActivationShell`, so cycling AND typecycling
        // both get it without either factory restating it.
        ...(ability.cost.cyclingCost ? { cyclingCost: true } : {}),
        // CR 702.129a / 118.3 — Eternalize's "Exile this card from your
        // graveyard" leg. Deferred to commit like `discardThisSource` so a
        // cancelled mana payment leaves the graveyard untouched.
        ...(ability.cost.exileThis ? { exileThisSource: true } : {}),
        ...(ability.cost.removeCounter
            ? { removeCounterCost: { ...ability.cost.removeCounter } }
            : {}),
        ...(ability.cost.life !== undefined
            ? { lifeCost: ability.cost.life }
            : {}),
        ...(ability.cost.discardLastDrawn
            ? { discardLastDrawnSource: true }
            : {}),
        ...(ability.cost.discardAtRandom
            ? { discardAtRandomCount: ability.cost.discardAtRandom }
            : {}),
        ...(opts.sacrificeSelection
            ? { sacrificeSelection: opts.sacrificeSelection }
            : {}),
        ...(ability.cost.exileFromGraveyard
            ? {
                  exileFromGraveyardChoice: {
                      count: ability.cost.exileFromGraveyard.count,
                      ...(ability.cost.exileFromGraveyard.cardType !== undefined
                          ? {
                                cardType:
                                    ability.cost.exileFromGraveyard.cardType,
                            }
                          : {}),
                      ...(ability.cost.exileFromGraveyard.owner !== undefined
                          ? { owner: ability.cost.exileFromGraveyard.owner }
                          : {}),
                  },
              }
            : {}),
        ...(ability.cost.tapOtherFilter
            ? {
                  tapOtherChoice: {
                      filter: ability.cost.tapOtherFilter.filter,
                      ...(ability.cost.tapOtherFilter.count !== undefined
                          ? { count: ability.cost.tapOtherFilter.count }
                          : {}),
                      ...(ability.cost.tapOtherFilter.totalPower !== undefined
                          ? {
                                totalPower:
                                    ability.cost.tapOtherFilter.totalPower,
                                pickedPower: 0,
                            }
                          : {}),
                      pickedIds: [],
                  },
              }
            : {}),
        ...(ability.cost.discardFilter
            ? {
                  discardFilterChoice: {
                      filter: ability.cost.discardFilter.filter,
                      count: ability.cost.discardFilter.count,
                  },
              }
            : {}),
        ...(opts.chosenX !== undefined ? { chosenX: opts.chosenX } : {}),
        // CR 106.10 — noted-mana battery (Jeweled Amulet / Ice Cauldron). Carry
        // the capture flag onto the deferred payment so the per-colour
        // mana-spent delta is snapshotted at commit (auto-tap / manual-tap
        // path). Without this the noted mana is silently lost when the pool
        // doesn't already cover the cost.
        ...(ability.noteManaSpent ? { noteManaSpent: true } : {}),
        keepPriority: opts.keepPriority,
        ...(opts.grantedSourceCardId
            ? { grantedSourceCardId: opts.grantedSourceCardId }
            : {}),
    };
}

/** Effective card types of an activated ability's SOURCE object, used to key
 *  restricted-mana eligibility at the ACTIVATION payment path (CR 106.6, issue
 *  #728 — Soldevi Machinist's "spend this mana only to activate abilities of
 *  artifacts"). Searches every battlefield first (CR 113.3c — the source may
 *  sit on an opponent's board for an "any player may activate" ability), then
 *  graveyards (CR 113.6 — Ashen Ghoul-style graveyard activations). Returns an
 *  empty list when the source can't be found, which makes EVERY restriction
 *  ineligible — the conservative direction (the payment falls back to the
 *  fungible pool exactly as it did before the seam existed). */
function activationSourceTypes(
    state: GameState,
    cardInstanceId: string | undefined
): readonly string[] {
    if (!cardInstanceId) return [];
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === cardInstanceId);
        if (found) return found.types;
    }
    for (const p of state.players) {
        const found = p.graveyard.find((c) => c.id === cardInstanceId);
        if (found) return found.types;
    }
    return [];
}

/** If the activator's pool now covers pendingActivation, pay mana, apply the
 *  deferred tap/sacrifice costs on the source, push the ability on the stack,
 *  and swap priority. Mirrors tryAutoCommitPendingCast for abilities. Returns
 *  the source card name on commit, or null if nothing was committed. */
export function tryAutoCommitPendingActivation(
    state: GameState,
    playerId: string,
    genericSpendOrder?: readonly string[]
): { cardInstanceId: string; abilityId: string; cardName?: string } | null {
    const pa = state.pendingActivation;
    if (!pa || pa.playerId !== playerId) return null;

    // CR 602.2 — an activated ability may only be put on the stack while its
    // controller has priority. Same defense as tryAutoCommitPendingCast: a
    // payment left dangling after priority moves away must not auto-commit on
    // the opponent's turn.
    if (state.priorityPlayerId !== playerId) return null;

    const player = getPlayer(state, playerId);
    // CR 106.6 (issue #728) — restricted mana eligible for THIS ability's
    // source (Soldevi Machinist's artifact-ability mana) counts toward
    // coverage, exactly as `spendablePoolForSpell` does at the cast path.
    const paSourceTypes = activationSourceTypes(state, pa.cardInstanceId);
    if (
        !isManaCostCovered(
            spendablePoolForAbility(player, paSourceTypes),
            pa.manaCost,
            getManaSubstitutions(state, player.id)
        )
    )
        return null;
    // CR 602.1 / 118 — every DEFERRED cost pick (sacrifice, graveyard exile,
    // tap-other/crew, filtered discard) blocks commit until the activator has
    // named the cards, regardless of mana coverage. This gate does not CALL the
    // owed-payment seam, it IS it (ADR 0091 / issue #1209): `nextOwedPayment`
    // carries the exact chain of early returns that used to sit here, in the
    // same order, and the vs-AI bot reads the same function — so a park cannot
    // exist that the gate blocks on and the bot cannot see. `gateOwnsManaSpend`
    // holds back the CR 601.2g mana-spend park only: this gate re-derives that
    // one from the live pool a few lines below (a parked prompt whose ambiguity
    // has since vanished must be CLEARED, not honoured).
    if (nextOwedPayment(state, playerId, { gateOwnsManaSpend: true })) {
        return null;
    }

    // CR 113.3c — the source may live on another player's battlefield for an
    // "any player may activate" ability, so search every battlefield rather
    // than just the activator's. Mana is still paid from the activator's pool
    // above; only the source-permanent lookup is global.
    let card = player.battlefield.find((c) => c.id === pa.cardInstanceId);
    if (!card) {
        for (const p of state.players) {
            const found = p.battlefield.find((c) => c.id === pa.cardInstanceId);
            if (found) {
                card = found;
                break;
            }
        }
    }
    // CR 113.6 — a graveyard-source activation (Ashen Ghoul): the source is not
    // on any battlefield. Search graveyards only when the payment was flagged
    // `fromGraveyard`, so a battlefield source that died mid-payment still
    // drops silently (below) rather than resurrecting from its graveyard.
    if (!card && pa.fromGraveyard) {
        for (const p of state.players) {
            const found = p.graveyard.find((c) => c.id === pa.cardInstanceId);
            if (found) {
                card = found;
                break;
            }
        }
    }
    // CR 113.6 / 702.29a — a hand-source activation (Cycling): the source is
    // not on any battlefield. Search the activator's hand only when the payment
    // was flagged `fromHand`, so a battlefield source that left mid-payment
    // still drops silently (below) rather than resurrecting from a hand.
    if (!card && pa.fromHand) {
        const found = player.hand.find((c) => c.id === pa.cardInstanceId);
        if (found) card = found;
    }
    if (!card) {
        // Source vanished (e.g. removed by an opposing effect). Drop the
        // payment silently — lands stay tapped (same policy as cancelCast for
        // sacrificed sources).
        state.pendingActivation = undefined;
        return null;
    }

    // CR 601.2g — an ambiguous generic-mana payment PARKS awaiting the
    // activator's choice of which mana pays the generic cost. Evaluated once
    // every other cost/choice gate above has cleared and mana is covered, so the
    // pool reflects only the generic portion still owed. When no order was
    // supplied (the caller is the plain resume path) and the choice is
    // meaningful, stash it on `pendingActivation` and return without committing;
    // `resolveManaSpendChoice` supplies a valid order and re-enters here.
    if (!genericSpendOrder) {
        const ambiguity = genericSpendAmbiguityForPayment(
            player.manaPool,
            pa.manaCost,
            getManaSubstitutions(state, player.id)
        );
        if (ambiguity) {
            pa.manaSpendChoice = ambiguity;
            return null;
        }
    }
    // The choice is settled (auto-pick or a supplied order) — clear any stale
    // parked prompt before the pool is spent.
    pa.manaSpendChoice = undefined;

    // CR 106.10 — noted-mana battery (Jeweled Amulet / Ice Cauldron). Snapshot
    // the pool before payment so the per-colour delta becomes the noted mana.
    const poolBeforePayment = pa.noteManaSpent
        ? { ...player.manaPool }
        : undefined;
    // CR 106.6 (issue #728) — restricted-first settlement, mirroring the cast
    // path's `payManaCostForSpell`.
    payManaCostForAbility(
        player,
        pa.manaCost,
        paSourceTypes,
        getManaSubstitutions(state, player.id),
        genericSpendOrder
    );
    const notedManaSpent = poolBeforePayment
        ? manaSpentDelta(poolBeforePayment, player.manaPool)
        : undefined;
    commitLandsForCost(player, pa.manaCost);

    // Deferred non-mana costs (CR 602.1) — applied now so cancellation leaves
    // the source untouched.
    if (pa.tapSource) {
        if (card.isTapped) {
            // Benign double-commit race: the source got tapped between the
            // payment opening and this commit (e.g. the player double-clicked
            // the land). A misclick must not surface a server error — drop the
            // payment silently, same policy as a vanished source above (lands
            // stay tapped).
            state.pendingActivation = undefined;
            return null;
        }
        card.isTapped = true;
    }
    if (pa.removeCounterCost) {
        payRemoveCounterCost(card, pa.removeCounterCost);
    }
    if (pa.discardLastDrawnSource) {
        // CR 118.3 — re-check at commit: the recorded card may have left the
        // hand while mana was being tapped. If so, drop the payment silently
        // (lands stay tapped, same policy as a vanished source above).
        if (!canPayDiscardLastDrawn(player)) {
            state.pendingActivation = undefined;
            return null;
        }
        payDiscardLastDrawn(state, player);
    }
    if (pa.discardAtRandomCount) {
        // CR 118.3 — re-check at commit: the hand may have emptied while mana
        // was being tapped. If so, drop the payment silently (lands stay
        // tapped, mirroring the vanished-source / discardLastDrawn policy).
        if (player.hand.length === 0) {
            state.pendingActivation = undefined;
            return null;
        }
        payDiscardAtRandomCost(state, playerId, pa.discardAtRandomCount);
    }
    // CR 119.4 — pay the life cost at commit (deferred so a dropped/cancelled
    // payment leaves the total untouched). Validated up-front at announcement.
    if (pa.lifeCost !== undefined) {
        player.life -= pa.lifeCost;
    }
    if (pa.sacrificeSource) {
        removePermanentTo(state, card.id, "graveyard", "sacrifice");
    }
    // CR 702.29a / 118.3 — the Cycling "Discard this card" cost. The source is
    // discarded from hand as the ability goes on the stack, routed through the
    // shared choke point so CARD_DISCARDED fires (Marauding Mako). Re-check at
    // commit: the card may have left the hand while mana was tapped; if so,
    // drop the payment silently (lands stay tapped, mirroring the
    // vanished-source policy above). Runs BEFORE the stack-item clone below so
    // the ability's source is captured while still valid.
    if (pa.discardThisSource) {
        // CR 702.29c — a cycling/typecycling cost payment is marked on the one
        // CARD_DISCARDED event so a "when you cycle this card" trigger can tell
        // it apart from an ordinary discard, without a second event (702.29d).
        if (
            !discardToGraveyard(
                state,
                playerId,
                card.id,
                pa.cyclingCost ? "cycling" : undefined
            )
        ) {
            state.pendingActivation = undefined;
            return null;
        }
    }
    // CR 118.1 / 601.2h — the "Exile this card/permanent" cost, paid as the
    // ability goes on the stack: graveyard → exile for an Eternalize-shaped
    // ability, battlefield → exile for a permanent's own self-exile cost
    // (Feldon's Cane). Re-check at commit: the source may have left that zone
    // while mana was tapped; if so, drop the payment silently (lands stay
    // tapped, mirroring the vanished-source policy above). Runs BEFORE the
    // stack-item clone below so the ability's source is captured while valid.
    if (pa.exileThisSource) {
        if (!payExileThisCost(state, player, card.id, !!pa.fromGraveyard)) {
            state.pendingActivation = undefined;
            return null;
        }
    }
    // CR 602.1 / 118.3 — pay the "discard a card matching <filter>" cost
    // (Survival of the Fittest): move each picked card from hand to graveyard
    // through the shared discard choke point so CR 614 replacements /
    // CARD_DISCARDED fire. Re-check presence at commit (vanished-card
    // policy): if any picked card left the hand while mana was tapped, drop
    // the activation silently (lands stay tapped, mirroring the
    // vanished-source policy above).
    if (pa.discardFilterChoice?.pickedCardIds) {
        const stillInHand = pa.discardFilterChoice.pickedCardIds.every((id) =>
            player.hand.some((c) => c.id === id)
        );
        if (!stillInHand) {
            state.pendingActivation = undefined;
            return null;
        }
        for (const id of pa.discardFilterChoice.pickedCardIds) {
            discardToGraveyard(state, playerId, id);
        }
    }
    // CR 602.1 / 118.5 / 701.21a — execute the player-chosen filtered
    // sacrifice(s) (own cost + Drought) through the unified layer. The own-cost
    // requirement is snapshot-flagged: its mv/subtypes/effective power ride on
    // the stack item (Priest of Yawgmoth, Freyalise Supplicant).
    const activationSacrificeSnapshot = sacrificeSnapshotFromSelection(
        pa.sacrificeSelection,
        state
    );
    // CR 602.1 / 118.5 / 406 — pay the "exile N cards from a single graveyard"
    // cost: move each picked card from that owner's graveyard to their exile.
    // Re-check presence at commit (vanished-card policy): if any picked card
    // is no longer in the chosen graveyard, drop the activation silently.
    let activationExileSnapshot: StackItem["additionalSacrificeSnapshot"];
    if (pa.exileFromGraveyardChoice?.pickedCardIds) {
        const ownerId = pa.exileFromGraveyardChoice.pickedGraveyardOwnerId;
        const owner = ownerId
            ? state.players.find((p) => p.id === ownerId)
            : undefined;
        const stillThere =
            owner !== undefined &&
            pa.exileFromGraveyardChoice.pickedCardIds.every((id) =>
                owner.graveyard.some((c) => c.id === id)
            );
        if (!stillThere) {
            state.pendingActivation = undefined;
            return null;
        }
        activationExileSnapshot = exileCostSnapshot(
            owner,
            pa.exileFromGraveyardChoice.pickedCardIds
        );
        for (const id of pa.exileFromGraveyardChoice.pickedCardIds) {
            moveCard(owner, id, "graveyard", "exile");
        }
    }
    // CR 602.1 / 118.8 — tap the chosen "other" permanents (Hand of Justice).
    // Re-validate each at commit: a pick may have left play or been tapped
    // while mana was being paid. If any pick is no longer a legal payment,
    // drop the activation silently (lands stay tapped, mirroring the
    // vanished-source policy above).
    if (pa.tapOtherChoice) {
        const picks: CardInstanceState[] = [];
        for (const id of pa.tapOtherChoice.pickedIds) {
            const perm = player.battlefield.find((c) => c.id === id);
            if (!perm || perm.isTapped || perm.id === card.id) {
                state.pendingActivation = undefined;
                return null;
            }
            picks.push(perm);
        }
        for (const perm of picks) {
            tapPermanent(state, perm);
        }
    }

    // CR 601.2f / 701.21a — the filtered sacrifice(s) were executed above via
    // the unified layer (pa.sacrificeSelection); nothing more to pay here.
    const stackItem: StackItem = buildActivatedAbilityStackItem(card, {
        castById: playerId,
        abilityId: pa.abilityId,
        ...(pa.chosenModeId ? { chosenModeId: pa.chosenModeId } : {}),
        ...(pa.targets && pa.targets.length > 0 ? { targets: pa.targets } : {}),
        // CR 601.2d — divide-as-you-choose split forwarded from the deferred
        // payment to the resolving stack item (Arc Mage).
        ...(pa.targetAmounts ? { targetAmounts: pa.targetAmounts } : {}),
        ...(pa.chosenX !== undefined ? { chosenX: pa.chosenX } : {}),
        ...(pa.grantedSourceCardId
            ? { grantedSourceCardId: pa.grantedSourceCardId }
            : {}),
        // CR 118.1 / 608.2h — the additional-cost victim's snapshot, from
        // whichever leg this activation actually paid. No shipped ability
        // declares BOTH a snapshot-flagged sacrifice cost and a single-card
        // graveyard-exile cost; if one ever does, the SACRIFICE leg wins, so
        // adding an exile leg can never silently change what an existing card
        // (Priest of Yawgmoth, Freyalise Supplicant) reads back.
        ...((activationSacrificeSnapshot ?? activationExileSnapshot)
            ? {
                  additionalSacrificeSnapshot:
                      activationSacrificeSnapshot ?? activationExileSnapshot,
              }
            : {}),
        ...(notedManaSpent ? { notedManaSpent } : {}),
    });
    state.stack.push(stackItem);
    recordActivation(state, card, pa.abilityId, !!pa.tapSource);

    const keepPriority = pa.keepPriority;
    state.pendingActivation = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;

    // CR 603.2b (issue #1265) — a DEFERRED-payment targeted ability locks its
    // targets as it finally reaches the stack; fire "becomes the target of an
    // ability" triggers (Leovold) alongside the tap-trigger flush below.
    // `"activated-ability"` (issue #2360) — a deferred-payment ACTIVATED
    // ability (CR 602.2b), never a cast spell.
    emitBecameTargetEvents(
        state,
        pa.targets,
        playerId,
        stackItem.id,
        "activated-ability"
    );
    // CR 603.2 — flush PERMANENT_TAPPED events queued during payment so
    // mana-tap triggers (Manabarbs / Mana Flare / Wild Growth) land on top
    // of the freshly-pushed activated ability. BEFORE the auto-pass drain,
    // which may otherwise start resolving the ability first (see
    // `commitPendingCast`).
    processPendingActionTriggers(state);

    drainAutoPasses(state);

    return {
        cardInstanceId: pa.cardInstanceId,
        abilityId: pa.abilityId,
        cardName: (card.card as { name?: string }).name,
    };
}

/** If the caster's mana pool now covers pendingCast, pay the cost, move the
 *  spell to the stack, clear pendingCast, and swap priority — mirroring the
 *  tail of tapForPayment. Returns the card name on commit (for SPELL_CAST
 *  event logging), or null if nothing was committed. */
/** Roll back the in-progress spell payment: untap every land tapped so far,
 *  return their mana to nothing, and clear `pendingCast`. Sacrificed sources
 *  (Black Lotus) cannot be un-sacrificed, so their mana contribution is left in
 *  the pool — the empty-pool step at phase end drains it. Mirrors the rollback
 *  the player triggers explicitly via `cancelCast`. */
function rollbackPendingCast(state: GameState): void {
    if (!state.pendingCast) return;
    const player = getPlayer(state, state.pendingCast.playerId);
    for (const cardId of state.pendingCast.tappedLandIds) {
        discardPermanentTappedEvent(state, cardId);
        const card = player.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        card.isTapped = false;
        // CR 605.4 — refund the Wild-Growth-style bonus mana this tap added.
        refundTapBonusMana(player, card);
        // CR 106.6 (issue #1559 review) — restriction-aware refund: reverses
        // the parallel `restrictedMana` deposit (with its rider) instead of
        // always assuming the fungible pool.
        if (card.chosenMana) {
            refundChosenManaOutput(player, card);
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (manaColor) refundFixedManaOutput(player, card, manaColor);
        }
    }
    // CR 702.126 — Improvise: undo every artifact tapped toward this cast's
    // generic cost. Unlike land taps, these never touched the mana pool, so
    // there's nothing to refund — just untap and drop the queued tap event.
    // `manaCost` itself is discarded below with the whole pendingCast, so the
    // generic reduction it carried needs no separate restoration.
    for (const cardId of state.pendingCast.improviseTappedArtifactIds ?? []) {
        discardPermanentTappedEvent(state, cardId);
        const card = player.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        card.isTapped = false;
    }
    state.pendingCast = undefined;
}

/** Roll back the in-progress activated-ability payment and clear
 *  `pendingActivation`. Mirrors `cancelActivation`. */
function rollbackPendingActivation(state: GameState): void {
    const pa = state.pendingActivation;
    if (!pa) return;
    const player = getPlayer(state, pa.playerId);
    for (const cardId of pa.tappedLandIds) {
        const card = player.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        untapSourceFromPayment(state, player, card);
    }
    state.pendingActivation = undefined;
}

/** A player who surrenders priority (passes / ends the turn) while a mana
 *  payment is still in progress abandons that payment: the spell/ability was
 *  never put on the stack, so the tapped lands must be returned. Without this,
 *  a stale pendingCast/pendingActivation lingers across the priority change —
 *  the PaymentBanner stays up and a later auto-tap could try to commit at an
 *  illegal time (the commit guards then reject it, but the lands would be
 *  stuck tapped). CR 601.2 / 602.2. */
export function abandonPendingPayment(
    state: GameState,
    playerId: string
): void {
    if (state.pendingCast?.playerId === playerId) {
        rollbackPendingCast(state);
    }
    if (state.pendingActivation?.playerId === playerId) {
        rollbackPendingActivation(state);
    }
}

/** CR 118.9 / 601.2h — pay the HAND leg of a chosen alternative cost: move each
 *  picked card from the caster's hand to exile (CR 701.13) or discard it to the
 *  graveyard (CR 701.9, through the discard choke point so CARD_DISCARDED /
 *  Library of Leng apply). Re-checks presence at commit (vanished-card policy):
 *  returns `false` if any picked card is no longer in hand, so the caller can
 *  drop the cast silently. Runs BEFORE the cast card itself leaves the hand. */
function payAlternativeCostHandChoice(
    state: GameState,
    playerId: string,
    choice: NonNullable<PendingCast["alternativeCostHandChoice"]>
): boolean {
    const picks = choice.pickedCardIds;
    if (!picks) return false;
    const player = getPlayer(state, playerId);
    if (!picks.every((id) => player.hand.some((c) => c.id === id))) {
        return false;
    }
    for (const id of picks) {
        if (choice.action === "exile") {
            moveCard(player, id, "hand", "exile");
        } else {
            discardToGraveyard(state, playerId, id);
        }
    }
    return true;
}

/** What a cast-time mana payment produced, beyond draining the pool: the
 *  CR 106.6 "can't be countered" rider flag (issue #1559) and the CR 106.4
 *  per-colour record of the mana actually spent. */
interface CastManaPayment {
    usedRiderMana: boolean;
    /** Present only when the card declares `noteManaSpent` (and the cost had a
     *  mana part at all) — the per-colour delta over the payment. */
    notedManaSpent?: Record<string, number>;
}

/** CR 601.2h — pay a spell's mana cost at the cast-commit step, and capture
 *  what was spent.
 *
 *  This is the ONE payment site for every spell cast-commit path in this file:
 *  `tryAutoCommitPendingCast` (park-and-pay), `finalizeTargetSelection`'s
 *  immediate branch, and `announceCast`'s two immediate-commit branches
 *  (normal cost and alternative cost). It exists because the capture half used
 *  to be copy-pasted at each site and only TWO of the four had it (issue
 *  #2378): a caster who floated the mana at priority before casting reached
 *  `announceCast`'s immediate branch, whose stack item carried no
 *  `notedManaSpent` at all — so Soul Burn (CR 202.3) read an empty record and
 *  a Sunburst permanent (CR 702.44a, Pentad Prism) entered with zero counters.
 *  Every path now shares one implementation, so a fifth cannot forget.
 *
 *  `cardDef` is the single source of the spell's printed types/supertypes
 *  (CR 106.6 restricted-mana eligibility, CR 205.4a `legendary-spell`) as well
 *  as the `noteManaSpent` opt-in — the callers no longer derive them
 *  separately and cannot disagree. */
export function payCastManaCost(
    player: PlayerState,
    manaCost: Record<string, number>,
    cardDef: CardDefinition | null | undefined,
    substitutions: ManaSubstitution[],
    cardInstanceId: string,
    genericSpendOrder?: readonly string[]
): CastManaPayment {
    if (Object.keys(manaCost).length === 0) return { usedRiderMana: false };
    // CR 106.4 / 202.3 / 702.44b — snapshot the pool before payment so the
    // per-colour delta (`manaSpentDelta`, CR 106.10) becomes `notedManaSpent`
    // on the stack item. Only for cards that asked for it: the snapshot is a
    // pool copy per cast otherwise.
    const poolBeforePayment = cardDef?.noteManaSpent
        ? { ...player.manaPool }
        : undefined;
    const usedRiderMana = payManaCostForSpell(
        player,
        manaCost,
        cardDef?.types ?? [],
        substitutions,
        cardInstanceId,
        genericSpendOrder,
        cardDef?.supertypes ?? []
    );
    return {
        usedRiderMana,
        ...(poolBeforePayment
            ? {
                  notedManaSpent: manaSpentDelta(
                      poolBeforePayment,
                      player.manaPool
                  ),
              }
            : {}),
    };
}

export function tryAutoCommitPendingCast(
    state: GameState,
    playerId: string,
    genericSpendOrder?: readonly string[]
): { cardInstanceId: string; cardName: string | undefined } | null {
    if (!state.pendingCast || state.pendingCast.playerId !== playerId) {
        return null;
    }
    // CR 601.2 / 601.2i — a spell may only be put on the stack while its caster
    // has priority. Payment is a multi-step server interaction (tap each land);
    // if priority moved away mid-payment (player passed / ended turn), the
    // lingering pendingCast must NOT auto-commit. Without this guard a stale
    // payment could be finalized on the opponent's turn, casting at an illegal
    // time. The stale pendingCast is rolled back separately when priority is
    // surrendered (see abandonPendingPayment).
    if (state.priorityPlayerId !== playerId) {
        return null;
    }
    const player = getPlayer(state, playerId);
    // CR 106.6: a creature spell may also be paid with restricted mana whose
    // restriction permits it (Metamorphosis). Fold it into the affordability
    // check and drain it first at payment.
    const castInstanceId = state.pendingCast!.cardInstanceId;
    // CR 601.3e — the card may be cast from the hand OR from exile (Ice
    // Cauldron's "you may cast that card for as long as it remains exiled").
    const castSource = locateCastSource(state, player, castInstanceId);
    const castCard = castSource.card;
    const castDef = castCard
        ? tryGetDefinition((castCard.card as { id: string }).id)
        : undefined;
    const castTypes = castDef?.types ?? [];
    // CR 106.6 / 205.4a (issue #1559) — the printed supertypes of the spell
    // being cast, for the `legendary-spell` restriction's eligibility check
    // (Delighted Halfling). Reads the DEFINITION's printed supertypes rather
    // than the live overlay (`liveSupertypesOf`, `cards/snowReads.ts` —
    // `CardInstanceState` DOES carry a mutable overlay via
    // `grantedSupertypes`/`removedSupertypes`, contrary to an earlier,
    // inaccurate version of this comment). Matches `sba.ts`'s legend rule
    // (also printed-only) — no card grants/removes "Legendary" on a card
    // sitting in hand, so the two coincide for every real spell today.
    const castSupertypes = castDef?.supertypes ?? [];
    if (
        !isManaCostCovered(
            spendablePoolForSpell(
                player,
                castTypes,
                castInstanceId,
                castSupertypes
            ),
            state.pendingCast.manaCost,
            getManaSubstitutions(state, player.id)
        )
    ) {
        return null;
    }
    // CR 601.2f / 118.8 / 702.51 / 702.34a / 118.9 — every DEFERRED cost pick
    // (filtered sacrifice incl. Drought's static tax, the exile additional cost,
    // convoke's creature picker, the flashback/escape/delve graveyard exile, the
    // alternative-cost hand leg) blocks commit until the caster has named the
    // cards, regardless of mana coverage. This gate does not CALL the
    // owed-payment seam, it IS it (ADR 0091 / issue #1209): `nextOwedPayment`
    // carries the exact chain of early returns that used to sit here, in the
    // same ORDER — convoke BEFORE delve, because the convoke pick pays the
    // coloured/hybrid pips and reduces the generic, so the delve picker is only
    // built after convoke resolves (`recordConvokeCreaturePick`). The vs-AI bot
    // reads the same function, so a park cannot exist that the gate blocks on
    // and the bot cannot see. `gateOwnsManaSpend` holds back the CR 601.2g
    // mana-spend park only: this gate re-derives that one from the live pool
    // below (a parked prompt whose ambiguity has since vanished must be
    // CLEARED, not honoured).
    if (nextOwedPayment(state, playerId, { gateOwnsManaSpend: true })) {
        return null;
    }
    // Every park above is now ANSWERED — these are the answers, applied by the
    // commit body below (they are read, never re-gated on, here).
    const castSel = state.pendingCast.sacrificeSelection;
    const ac = state.pendingCast.additionalCost;
    const castConvoke = state.pendingCast.convokeCreatureChoice;
    const castExile = state.pendingCast.exileFromGraveyardChoice;
    const castAltHand = state.pendingCast.alternativeCostHandChoice;
    // CR 601.2g — an ambiguous generic-mana payment PARKS awaiting the caster's
    // choice of which mana pays the generic cost. Evaluated once every other
    // cost/choice gate above has cleared and mana is covered (manual floating
    // pool and auto-tap overproduction converge here). With no order supplied
    // (plain resume path) and a meaningful choice, stash it on `pendingCast`
    // and return without putting the spell on the stack; `resolveManaSpendChoice`
    // supplies a valid order and re-enters here. The ambiguity is checked on the
    // spell's spendable pool (folds any eligible restricted mana), matching the
    // coverage check above.
    if (!genericSpendOrder) {
        const ambiguity = genericSpendAmbiguityForPayment(
            spendablePoolForSpell(
                player,
                castTypes,
                castInstanceId,
                castSupertypes
            ),
            state.pendingCast.manaCost,
            getManaSubstitutions(state, player.id)
        );
        if (ambiguity) {
            state.pendingCast.manaSpendChoice = ambiguity;
            return null;
        }
    }
    // The choice is settled (auto-pick or a supplied order) — clear any stale
    // parked prompt before the pool is spent.
    state.pendingCast.manaSpendChoice = undefined;

    // CR 106.4 / 202.3 — cast-path payment + mana-spent tracking (Soul Burn,
    // Sunburst), through the shared `payCastManaCost` seam.
    const {
        usedRiderMana: castUsedRiderMana,
        notedManaSpent: castNotedManaSpent,
    } = payCastManaCost(
        player,
        state.pendingCast.manaCost,
        castDef,
        getManaSubstitutions(state, player.id),
        castInstanceId,
        genericSpendOrder
    );
    commitLandsForCost(player, state.pendingCast.manaCost);

    // CR 118.8 / 701.21a — execute the player-chosen filtered sacrifice(s)
    // (Drought / own additional cost) through the unified layer. The own-cost
    // requirement is snapshot-flagged: its mana value + subtypes ride on the
    // stack item, read at resolve via SpellContext.getAdditionalSacrificeMv /
    // getAdditionalCostSubtypes.
    let additionalSacrificeSnapshot: StackItem["additionalSacrificeSnapshot"];
    if (castSel) {
        additionalSacrificeSnapshot = sacrificeSnapshotFromSelection(
            castSel,
            state
        );
    }
    // CR 406 — the exile additional cost (Soul Exchange). Snapshot the exiled
    // permanent's mv/subtypes ("+2/+2 if the exiled creature was a Thrull"),
    // then exile it (no sacrifice cause to leave-the-battlefield triggers).
    if (ac?.pickedId) {
        const exiled = player.battlefield.find((c) => c.id === ac.pickedId);
        if (!exiled) {
            // Picked permanent vanished between selection and commit —
            // refuse to push the spell, drop pendingCast silently.
            state.pendingCast = undefined;
            return null;
        }
        const exCardId = (exiled.card as { id?: string }).id;
        const exDef = exCardId ? tryGetDefinition(exCardId) : undefined;
        const exMv = exDef?.manaCost
            ? Object.entries(exDef.manaCost).reduce<number>(
                  (acc, [, v]) => acc + (typeof v === "number" ? v : 0),
                  0
              )
            : 0;
        additionalSacrificeSnapshot = {
            cardInstanceId: exiled.id,
            mv: exMv,
            ...(exiled.subtypes && exiled.subtypes.length > 0
                ? { subtypes: [...exiled.subtypes] }
                : {}),
        };
        removePermanentTo(state, exiled.id, "exile");
    }

    // CR 702.34a / 118.5 — pay the flashback "exile X blue cards from your
    // graveyard" cost (Flash of Insight): move each picked card from the
    // caster's own graveyard to their exile. Re-check presence at commit
    // (vanished-card policy): if any picked card is no longer in the graveyard,
    // drop the pendingCast silently. Runs BEFORE the flashback card itself
    // leaves the graveyard below (the picks never include it — CR 601.2a).
    if (castExile?.pickedCardIds) {
        // CR 702.34a / 118.5 — the picked cost cards leave the caster's own
        // graveyard (default) or hand (`zone: "hand"`, the exile-from-hand
        // flashback cost) for exile.
        const exileSourceZone = castExile.zone ?? "graveyard";
        const exileSource =
            exileSourceZone === "hand" ? player.hand : player.graveyard;
        const stillThere = castExile.pickedCardIds.every((id) =>
            exileSource.some((c) => c.id === id)
        );
        if (!stillThere) {
            state.pendingCast = undefined;
            return null;
        }
        for (const id of castExile.pickedCardIds) {
            moveCard(player, id, exileSourceZone, "exile");
        }
    }
    // CR 702.51a (issue #1338) — pay Convoke: TAP each chosen creature as the
    // spell moves to the stack. Deferred to commit (like the delve exile above)
    // so a cancelled cast leaves the creatures untapped. Re-check presence
    // (vanished-card policy); drop the pendingCast silently on a mismatch.
    if (castConvoke?.pickedCreatureIds) {
        const stillThere = castConvoke.pickedCreatureIds.every((id) =>
            player.battlefield.some((c) => c.id === id && !c.isTapped)
        );
        if (!stillThere) {
            state.pendingCast = undefined;
            return null;
        }
        for (const id of castConvoke.pickedCreatureIds) {
            const creature = player.battlefield.find((c) => c.id === id);
            if (creature) creature.isTapped = true;
        }
    }
    // CR 118.9 — pay the alternative-cost HAND leg (Force of Will's "exile a
    // blue card", Foil's "discard an Island card and another card"): move each
    // picked card from hand to exile / graveyard. Runs BEFORE the cast card
    // itself leaves the hand below. Re-check presence (vanished-card policy);
    // drop the pendingCast silently on a mismatch.
    if (castAltHand?.pickedCardIds) {
        if (!payAlternativeCostHandChoice(state, playerId, castAltHand)) {
            state.pendingCast = undefined;
            return null;
        }
    }

    // CR 702.139 (issue #1392) — this cast is enabled EXCLUSIVELY by Lurrus's
    // STATIC graveyard-permanent-cast permission (no higher-precedence
    // mechanism claimed the card, `locateCastSource`'s ordered chain): debit
    // its once-per-turn use now, at commit.
    if (castSource.viaGraveyardPermanentPermission) {
        markGraveyardPermanentCastUsed(state, playerId);
    }
    // CR 601.3e / 702.34 — remove from the zone the card was actually cast from
    // (hand, exile for Ice Cauldron's noted card, or graveyard for Flashback).
    const castFromZone = castSource.zone;
    // issue #1156 — a cross-player exile grant (Dauthi Voidwalker, Robber of
    // the Rich) removes from the ACTUAL exile owner, not the caster.
    const spellCard = removeFromZone(
        castZoneOwner(
            state,
            player,
            state.pendingCast.cardInstanceId,
            castFromZone
        ),
        state.pendingCast.cardInstanceId,
        castFromZone
    );
    const pendingTargets = (state.pendingCast as Record<string, unknown>)
        .targets as StackItem["targets"] | undefined;
    const pendingChosenX = state.pendingCast.chosenX;
    const pendingKickerPayments = state.pendingCast.kickerPayments;
    const pendingBuybackPaid = state.pendingCast.buybackPaid;
    const pendingChosenModeId = state.pendingCast.chosenModeId;
    const pendingTargetAmounts = state.pendingCast.targetAmounts;
    // CR 601.2b / 118.4 — pay the "pay X life" additional cost the instant the
    // spell moves hand → stack (Fire Covenant). Affordability was validated at
    // announcement; SBA handles a fatal payment.
    const pendingPayLife = state.pendingCast.payLife;
    if (pendingPayLife && pendingPayLife > 0) {
        player.life -= pendingPayLife;
    }
    // CR 601.2f / 701.21a — the filtered sacrifice(s) were executed above via
    // the unified layer (castSel); nothing more to pay here.
    const stackItem: StackItem = {
        ...spellCard,
        castById: playerId,
        ...(pendingTargets ? { targets: pendingTargets } : {}),
        ...(pendingChosenX !== undefined ? { chosenX: pendingChosenX } : {}),
        ...(pendingKickerPayments
            ? { kickerPayments: pendingKickerPayments }
            : {}),
        ...(pendingBuybackPaid ? { buybackPaid: true } : {}),
        ...(pendingTargetAmounts
            ? { targetAmounts: pendingTargetAmounts }
            : {}),
        ...(pendingChosenModeId ? { chosenModeId: pendingChosenModeId } : {}),
        ...(additionalSacrificeSnapshot ? { additionalSacrificeSnapshot } : {}),
        ...(castNotedManaSpent ? { notedManaSpent: castNotedManaSpent } : {}),
        // CR 106.6 rider (issue #1559) — mana spent on this cast carried
        // `cantBeCounteredRider` (Delighted Halfling); `counter()` reads this
        // alongside the static `CardDefinition.cantBeCountered`.
        ...(castUsedRiderMana ? { dynamicCantBeCountered: true } : {}),
        // CR 702.74a — a parked Evoke cast (real hand-cost choice) carries the
        // marker through `PendingCast.evoked` (set at announcement) so it
        // still lands on the stack item once the picker completes.
        ...(state.pendingCast.evoked ? { evoked: true } : {}),
        // CR 702.109a — a parked Dash cast (mana payment via `tapForPayment`,
        // or a real non-mana pick composing with Dash) carries the marker
        // through `PendingCast.dashed` (set at announcement) so it still
        // lands on the stack item once mana is covered / the picker completes.
        ...(state.pendingCast.dashed ? { dashed: true } : {}),
        // CR 601.2 / 307.1 / 117.1a / 601.3a (issue #2473) — the timing
        // memory Necromancy-shaped clauses key on, read back off the
        // ANNOUNCEMENT-time snapshot (`announceCast`) rather than re-derived
        // here, exactly like `evoked`/`dashed` immediately above. Re-deriving
        // at commit is NOT equivalent: activating mana abilities is part of
        // casting (CR 601.2g), and `tapForPayment` →
        // `resolveManaAbilityTriggerImmediately` can leave a SUSPENDED
        // triggered mana ability (CR 605.4a — Fertile Ground parks on its
        // colour pick) on the stack while this function runs in that very
        // same mutation, which made a textbook sorcery-speed main-phase cast
        // read as cast off sorcery timing.
        ...(state.pendingCast.castOffSorceryTiming
            ? { castOffSorceryTiming: true }
            : {}),
        ...graveyardCastStackFlags(state, spellCard, castFromZone),
        ...reboundCastStackFlags(spellCard, castFromZone),
    };
    // CR 702.103b (issue #2388) — see the matching call in
    // `finalizeTargetSelection`. This is the DEFERRED half of the same commit:
    // a bestow cast whose mana was paid across a separate `tapForPayment`
    // mutation lands here instead, and must become an Aura at exactly the same
    // seam. The choice rode here on `PendingCast.bestowed` (set at
    // announcement, the `evoked`/`dashed` shape); the flag on the stack item
    // itself is written by `applyBestowCharacteristics`, alongside the type
    // line it rewrites, so the two can never be set apart from each other.
    if (state.pendingCast.bestowed) applyBestowCharacteristics(stackItem);
    // CR 702.37c (issue #2705) — a MORPH cast puts a FACE-DOWN 2/2 on the
    // stack, not the printed card. The choice rode here on
    // `PendingCast.morphed` (set at announcement, the `evoked`/`dashed`/
    // `bestowed` shape); this is the branch a real morph cast reaches, since
    // the {3} is almost never already floating. Turned down BEFORE the push and
    // before `emitSpellCastEvent` below, so no viewer and no cast trigger ever
    // observes the face-up card on the stack.
    if (state.pendingCast.morphed) turnFaceDown(stackItem);
    state.stack.push(stackItem);

    const cardName = (spellCard.card as { name?: string }).name;
    const keepPriority = state.pendingCast.keepPriority;
    state.pendingCast = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;

    // CR 601.2i / 603.3 — the spell is now on the stack. Emit SPELL_CAST and
    // run the trigger pass BEFORE draining auto-passes: cast triggers
    // (Verduran Enchantress, the sphere cycle, Ledger Shredder's connive) must
    // be on the stack ABOVE the spell before any player receives priority. The
    // drain can reach two consecutive passes and call `resolveTopOfStack`, so
    // draining first would resolve — or suspend mid-resolution on a choice —
    // the very spell whose trigger has not been placed yet, then bury the
    // half-resolved spell under its own trigger.
    emitSpellCastEvent(state, stackItem);
    processPendingActionTriggers(state);

    drainAutoPasses(state);

    return { cardInstanceId: spellCard.id, cardName };
}

// --- Queries ---

/** Cheap wake-up signal (PRD #1776 T3, issue #1778): the `gameTicks` row
 *  companion to `getPublicState`, ~150 bytes instead of 3-9 KB. A subscriber
 *  that only needs to know "did the game state change, and does a given seat
 *  owe input" — the vs-AI driver — subscribes here and only mounts the full
 *  `getPublicState` query once its seat appears in `owedPlayerIds` (issue
 *  #1778 review finding 1 — membership, not equality with a single
 *  `expectedInputPlayerId`; see `computeOwedPlayerIds`,
 *  `convex/gre/expectedInput.ts`), instead of holding a second full-state
 *  subscription that gets discarded on every beat it doesn't own. Returns
 *  `null` before the first save — the driver fails OPEN on that (finding 4,
 *  `useVsAiDriver.ts`) rather than deadlocking a pre-existing game. */
export const getGameTick = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("gameTicks")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .first();
    },
});

/** Public view: hides opponent's hand and all library contents. Computes legalActions only for own hand. */
export const getPublicState = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        debugAllActions: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) return null;
        // Mode flags come off the `gameStates` row this query already read —
        // reading the `games` row for them cost 8.3 KB per execution, 7.33 KB
        // of it decklists nothing here projects (see `gameStates` in
        // `convex/schema.ts`). A row written before the mirror existed carries
        // NEITHER flag, which is what distinguishes it from a plain 2-player
        // game; only then is the fat row read.
        const { solo, vsAi } =
            gameState.solo === undefined && gameState.vsAi === undefined
                ? ((await ctx.db.get(args.gameId)) ?? {
                      solo: undefined,
                      vsAi: undefined,
                  })
                : gameState;
        const state = gameState.state as GameState;
        // In solo mode, the single user controls both players: the viewer follows
        // whoever currently owes input so the UI shows that player's hand, legal
        // actions, and any private choice zone (e.g. a `search-library` pile).
        // This MUST use the same selector as the client board
        // (`computeSoloViewerId`) — if the projection's viewer and the rendered
        // viewer diverge, a private zone is exposed to the wrong seat and the
        // search dialog opens without its cards until a refresh re-syncs.
        // A vs-AI game is structurally solo but the two seats are distinct
        // viewpoints — the human stays pinned to their seat and the bot driver
        // queries as its own seat (ADR 0001) — so it uses the requested playerId.
        const viewerId =
            solo === true && vsAi !== true
                ? computeSoloViewerId({
                      activePlayerId: state.activePlayerId,
                      priorityPlayerId:
                          state.priorityPlayerId ?? state.activePlayerId,
                      phase: state.phase,
                      combat: state.combat,
                      meleeCombat: state.meleeCombat,
                      pendingCast: state.pendingCast,
                      pendingActivation: state.pendingActivation,
                      pendingTarget: state.pendingTarget,
                      pendingChoices: state.pendingChoices,
                      playerIds: state.players.map((p) => p.id),
                  })
                : args.playerId;
        return projectPublicState(
            state,
            gameState.seq,
            viewerId,
            args.debugAllActions ?? false
        );
    },
});

/** One-shot backfill for the `gameStates.solo`/`vsAi` mirror
 *  (`convex/schema.ts`): stamps the flags onto every row written before the
 *  field existed.
 *
 *  Not required for correctness — `getPublicState` falls back to the `games`
 *  row when both flags are absent — but a row nobody backfills keeps paying
 *  the 8.3 KB fallback read on every subscription re-execution for the rest of
 *  that game's life, which is the entire cost this mirror exists to remove.
 *  Run once per deployment after deploying:
 *
 *      bunx convex run --prod game:backfillGameStateMode '{}'
 *
 *  Idempotent: an already-stamped row is skipped without a write, so
 *  re-running is free. `limit` bounds one invocation's transaction; the
 *  returned `remaining` says whether to run it again. */
export const backfillGameStateMode = internalMutation({
    args: { limit: v.optional(v.number()) },
    returns: v.object({ stamped: v.number(), remaining: v.number() }),
    handler: async (ctx, args) => {
        const limit = args.limit ?? 200;
        const rows = await ctx.db.query("gameStates").collect();
        const pending = rows.filter(
            (row) => row.solo === undefined && row.vsAi === undefined
        );
        let stamped = 0;
        for (const row of pending.slice(0, limit)) {
            const game = await ctx.db.get(row.gameId);
            await ctx.db.patch(row._id, {
                solo: game?.solo === true,
                vsAi: game?.vsAi === true,
            });
            stamped += 1;
        }
        return { stamped, remaining: pending.length - stamped };
    },
});

/** Debug-only: returns the full unfiltered game state with legal actions. */
export const getFullState = query({
    args: {
        gameId: v.id("games"),
        debugAllActions: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) return null;
        return projectFullState(
            gameState.state as GameState,
            gameState.seq,
            args.debugAllActions ?? false
        );
    },
});

/** Returns the game record (status, players). Since issue #2506 the decklists
 *  are NOT on it — `players[].deck` carries identity only, `cardIds` carries
 *  the art-preload manifest, and a client that needs real card entries asks
 *  `getSeatDeck` for its OWN seat. */
export const getGame = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.gameId);
    },
});

/** ONE seat's decklist (issue #2506) — the client-side read that replaces the
 *  card entries `getGame` used to carry. Two callers, both of which need real
 *  card identities rather than the id manifest: the vs-AI driver, which wires
 *  the BOT's own deck into the search adapter so fetch/tutor subtrees search
 *  real cards (issue #1509), and the Debug panel's "clone this deck into a new
 *  solo game".
 *
 *  A seat's own decklist is public knowledge to its owner (only the ORDER is
 *  hidden), so this is gated on SEAT ownership, not mere presence in the game:
 *  in solo / vs-AI both handles belong to the one user, while in a 2-player
 *  game a client can no longer read the opponent's list at all — which
 *  `getGame` incidentally allowed before the split.
 *
 *  Deliberately NOT a subscription on the `games` row: the point lookup in
 *  `loadGameSeatCards` reads only the (immutable) decklist row, so this query
 *  does not re-execute on the `games` patches that fire several times a turn. */
export const getSeatDeck = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        if (!seatBelongsToUser(args.playerId, userId)) return null;
        const cards = await loadGameSeatCards(ctx, args.gameId, args.playerId);
        if (!cards) return null;
        return { playerId: args.playerId, cards };
    },
});

/** Returns the projected ManualGameState for a viewer. Reads the latest
 *  manualStates row and strips private information (opponent hand / library /
 *  faceDown identity) via projectManualState. Returns null when no state row
 *  exists yet (the game is still in pregame). */
export const getManualState = query({
    args: {
        gameId: v.id("games"),
        viewerId: v.string(),
    },
    handler: async (ctx, args) => {
        const latest = await getLatestManualState(ctx, args.gameId);
        if (!latest) return null;
        const state = latest.state as ManualGameState;
        return projectManualState(state, args.viewerId);
    },
});

/**
 * The top N cards of one seat's library, TOP FIRST — what the "Peek top N…" /
 * "Peek all" pile verbs actually show (manual-mode QA round 3, item 2).
 *
 * A dedicated query rather than a field on the projected state, because the
 * library is projected as `{ count }` for EVERYONE (`projectManualState`) and
 * must stay that way: peeking is an action a player takes, logged as such by
 * `manualPeek`, not a standing view. Subscribing to it keeps the open dialog
 * live — a card drawn or milled while it is up disappears from it.
 *
 * `n` omitted means the whole library ("Peek all" / searching). Private
 * metadata (`knownTo` / `revealedTo`) is stripped exactly as the state
 * projection strips it. Access follows `getManualState`'s convention (the
 * caller names the seat): a Manual Game enforces nothing, and one user
 * routinely steers both seats.
 */
export const getManualLibraryTop = query({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const latest = await getLatestManualState(ctx, args.gameId);
        if (!latest) return null;
        const state = latest.state as ManualGameState;
        const player = state.players.find((p) => p.id === args.playerId);
        if (!player) return null;
        const count =
            args.n === undefined
                ? player.library.length
                : Math.max(0, Math.min(args.n, player.library.length));
        const top = player.library
            .slice(player.library.length - count)
            .reverse()
            .map((card) => {
                const { knownTo, revealedTo, ...rest } = card;
                void knownTo;
                void revealedTo;
                return rest;
            });
        return { cards: top, libraryCount: player.library.length };
    },
});

/** Lightweight info for the invite antechamber (`/join/<gameId>`). Deliberately
 *  does NOT return either player's decklist — a prospective joiner must never
 *  see the host's cards. Exposes only what the join page renders: who created
 *  the game, its format (for pre-filtering the joiner's deck list), and whether
 *  the game is still joinable. Returns `null` for an unknown id. */
export const getJoinInfo = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) return null;
        const host = game.players[0];
        const isHost = game.players.some((p) => p.id === user._id);
        return {
            gameId: game._id,
            name: game.name,
            hostName: host?.name ?? "Unknown",
            // Game format = the host deck's declared format (ADR 0036). Solo
            // games shouldn't surface here, but fall back defensively.
            format: host?.deck.format ?? "freeform",
            status: game.status,
            playerCount: game.players.length,
            isHost,
            // Joinable only while open, not yet full, and not the caller's own
            // game — mirrors the `joinGame` mutation guards (authoritative there).
            joinable:
                game.status === "waiting" && game.players.length < 2 && !isHost,
        };
    },
});

// `getGameCardIds` was removed (Convex read-bandwidth): it re-read the whole
// ~9 KB `games` row — decklists included — to return a set the client already
// holds, since `<Board>` subscribes to `getGame` anyway. Two subscriptions on
// one fat document, one of them pure duplication. The id set is now derived
// client-side in `src/components/board/board.tsx`.

/** Returns all games waiting for a second player, excluding any the caller
 *  is already part of. Auth is required. Uses the `by_status` index so the
 *  subscription only re-fires (and reads docs) for `waiting` games — not the
 *  whole table. Finished/solo games never enter this query's bandwidth.
 *
 *  Each row carries the owning Match's `bestOf` (PRD #387 / #397) so the join
 *  UI can surface the inherited format ("Bo3 Match") BEFORE the player commits
 *  — a joiner inherits the creator's format, not their own lobby selection. */
export const listOpenGames = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return [];
        const waiting = await ctx.db
            .query("games")
            .withIndex("by_status", (q) => q.eq("status", "waiting"))
            .collect();
        const mine = waiting.filter(
            // Limited Event challenges (issue #1577) are PRIVATE to their two
            // paired seats — surfaced on the event page, never in the public
            // open-games lobby.
            (g) =>
                !g.limitedChallenge && !g.players.some((p) => p.id === userId)
        );
        return Promise.all(
            mine.map(async (g) => {
                // The Match owns `bestOf`; a waiting Game always has a matchId
                // (createGame inserts both). Default to Bo1 if the Match is gone.
                const match = g.matchId ? await ctx.db.get(g.matchId) : null;
                // A join code is the HOST's to share (issue #2649). This query
                // spreads the raw row, so without the strip every open table's
                // code would ride every other player's lobby subscription —
                // handing out by broadcast the one thing a code is for.
                const { joinCode, ...row } = g;
                void joinCode;
                return { ...row, bestOf: (match?.bestOf ?? 1) as 1 | 3 };
            })
        );
    },
});

// --- Mutations ---

const PLAYER_COLORS = ["#4B5A6C", "#63768D"];

const deckValidator = v.object({
    id: v.string(),
    name: v.string(),
    format: v.string(),
    cards: v.array(
        v.object({
            cardId: v.string(),
            cardName: v.string(),
        })
    ),
    // Sideboard (PRD #387). Optional so legacy callers (and tests) without a
    // sideboard still validate; snapshotted into the Match deck copy.
    sideboard: v.optional(
        v.array(
            v.object({
                cardId: v.string(),
                cardName: v.string(),
            })
        )
    ),
    // Limited Event + Seat reference (ADR 0054/0055, issue #1109/#1111).
    // Present only for a `format: "limited"` deck; `assertDeckLegal`'s
    // injected `ResolvePool` reads these two to resolve the deck's
    // authoritative Pool (`loadLimitedPoolResolver` below). Absent for every
    // other Format.
    limitedEventId: v.optional(v.string()),
    limitedSeatId: v.optional(v.string()),
});

/**
 * Resolves a `deckValidator`-shaped deck's `ResolvePool` (ADR 0036) for the
 * authoritative game-start legality gate (issue #1111): fetches the
 * referenced Limited Event ONCE, then hands `assertDeckLegal` a pure
 * synchronous callback over the already-fetched Pool — mirrors
 * `loadBanlistOverrides`'s injection pattern. `undefined` for a non-Limited
 * deck (no `limitedEventId`) so every existing call site's non-Limited decks
 * are completely unaffected.
 *
 * SECURITY (issue #1111 follow-up): `createGame`/`createSoloGame`/`joinGame`
 * accept an INLINE `args.deck`, never one loaded from a persisted `userDecks`
 * row — so the ownership gate `userDecks.create` applies at deck-*save* time
 * never runs for a deck built ad hoc for game-start. Without re-asserting
 * ownership HERE, a client could point `limitedSeatId`/`limitedEventId` at
 * ANOTHER user's seat and have this resolver source THEIR Pool. Reuses the
 * exact same `assertLimitedSeatOwnership` gate `userDecks.create` uses — one
 * seat-ownership authority, never duplicated — keyed off the AUTHENTICATED
 * `callerUserId`, never anything from `deck`. Throws (not a silent
 * `pool-unresolved`) so the mutation aborts before any Match/Game row is
 * written.
 */
export async function loadLimitedPoolResolver(
    ctx: MutationCtx,
    deck: { limitedEventId?: string; limitedSeatId?: string },
    callerUserId: string
): Promise<ResolvePool | undefined> {
    if (!deck.limitedEventId || !deck.limitedSeatId) return undefined;
    const event = await ctx.db.get(deck.limitedEventId as Id<"limitedEvents">);
    assertLimitedSeatOwnership(event, deck.limitedSeatId, callerUserId);
    // Seat ownership is decided on the event row alone; only the Pool needs
    // the `limitedSeats` payload, and only for the ONE seat this deck claims
    // (`convex/limitedSeatStore.ts`).
    const seatIndex = Number(deck.limitedSeatId);
    const hydrated = event
        ? { seats: await hydrateSeat(ctx, event, seatIndex) }
        : null;
    const pool = resolvePoolFromEvent(hydrated, deck.limitedSeatId);
    return () => pool;
}

const bestOfValidator = v.optional(v.union(v.literal(1), v.literal(3)));

export const createGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
        // Bo1 | Bo3 (PRD #387). Defaults to Bo1 — the only format #392 plays.
        bestOf: bestOfValidator,
    },
    handler: async (ctx, args) => {
        // ADR 0080 — a manual-format deck is rejected by the real engine.
        // This is the whole seam: the format validator has no concept of
        // "mode", so the rejection lives here, fail-closed.
        if (args.deck.format === "manual")
            throw new Error(
                "Tabletop decks cannot start a real game. Play a Tabletop game instead."
            );
        const user = await getCurrentUser(ctx);
        // #155 (match-scoped, ADR 0029): at most one active match per user.
        // Guard runs server-side so it holds against double-click / two-tab
        // races (Convex OCC retries the loser, which then sees the new match
        // and is rejected here).
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        // Authoritative deck legality gate (ADR 0036): reject an illegal deck
        // before any Match/Game row is written. The DB banlist override (PRD
        // #1138, issue #1144) is loaded first so a card banned in `formatBanlists`
        // is enforced here even if the client is stale.
        assertDeckLegal(
            args.deck,
            undefined,
            await loadBanlistOverrides(ctx, args.deck.format),
            await loadLimitedPoolResolver(ctx, args.deck, user._id)
        );
        const now = Date.now();

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[0],
            deck: args.deck,
        };

        // The Match opens "waiting" for an opponent; joinGame completes it and
        // builds Game 1. The waiting game row carries the matchId up front.
        const matchId = await insertMatchWithDecks(ctx, {
            bestOf: args.bestOf ?? 1,
            status: "waiting",
            players: buildMatchPlayers([player]),
            currentGameNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await insertGameWithDecks(ctx, {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "waiting",
            players: toGamePlayers([player]),
            // "Join by code" (issue #2649). This is the ONLY producer of a
            // join code: a public, human-vs-human, engine-mode table waiting
            // for a second seat. Every other `insertGameWithDecks` call site
            // is solo, vs-AI, Tabletop, addressed to one Limited seat, or a
            // Game 2+ of a match already under way — none has a second seat to
            // sell to a stranger, so none gets a code (`isCodeJoinableGame`
            // re-checks the same class on the way in, fail-closed).
            // Randomness at the mutation site, the pure part in
            // `joinCodes.ts` — same split as `pickCoinTossWinner` below.
            joinCode: await mintJoinCode(ctx, Math.random),
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        return gameId;
    },
});

/**
 * Challenge another human seat in a Limited Event (issue #1577). Reuses the
 * exact `createGame` waiting-Match primitive (`buildMatchPlayers` /
 * `toGamePlayers`, ADR 0029) — a challenge is just a `waiting` 2-player Match
 * BOUND to an event and ADDRESSED to a specific opponent seat, which the
 * challenged player completes via `joinGame` (event-aware branch below). It is
 * NOT a new game mode: once accepted it is an ordinary 2-player Match.
 *
 * SECURITY: identity is derived from `ctx.auth` (CLAUDE.md § Player identity);
 * the challenger's own seat is taken from their AUTHENTICATED deck's
 * `limitedSeatId` and re-checked with `assertLimitedSeatOwnership`, never a
 * client claim. The paired decks are validated to share the event both here
 * (challenger) and at accept time (challenged) — `assertSameEventDeck`.
 */
export const challengeLimitedSeat = mutation({
    args: {
        eventId: v.id("limitedEvents"),
        challengedSeatIndex: v.number(),
        deck: deckValidator,
        name: v.optional(v.string()),
        bgColor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        // A challenge is only ever between two Limited decks bound to THIS
        // event — reject a non-Limited or foreign-event deck up front (the same
        // rule the accept side enforces, `assertSameEventDeck`).
        assertSameEventDeck(args.deck.limitedEventId, args.eventId);
        if (!args.deck.limitedSeatId)
            throw new Error("Challenge requires your Limited deck's seat.");
        // #155 (match-scoped): at most one active match per user — a pending
        // challenge counts, so a challenger can have only one outstanding.
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        const event = await ctx.db.get(args.eventId);
        // Challenger owns the seat they claim (same gate `userDecks.create`
        // uses — one seat-ownership authority, keyed off the AUTHENTICATED id).
        assertLimitedSeatOwnership(event, args.deck.limitedSeatId, user._id);
        if (!event) throw new Error("Limited Event not found.");
        // A PHASE question, never a status literal (ADR 0076 decision 1):
        // free challenges are withdrawn while the event's Swiss rounds are
        // running (PRD #1628 story 36, issue #1648) — the round pairing is
        // the only Match a seat plays. Rejected server-side, not merely
        // hidden by the panel (`startPairingMatch` uses the identical gate).
        if (areRoundsRunning(event.status))
            throw new Error(
                "Free challenges are off while this event's rounds are running."
            );
        const challengerSeatIndex = Number(args.deck.limitedSeatId);
        // Target must be a seated human opponent (not a bot, not empty, not
        // self). `event` non-null past `assertLimitedSeatOwnership`.
        const challenged = assertChallengeableSeat(
            event,
            args.challengedSeatIndex,
            user._id
        );
        // Authoritative deck legality gate (ADR 0036) — the challenger's deck
        // must be legal against its own seat's Pool before any row is written.
        assertDeckLegal(
            args.deck,
            undefined,
            await loadBanlistOverrides(ctx, args.deck.format),
            await loadLimitedPoolResolver(ctx, args.deck, user._id)
        );
        const now = Date.now();
        const challengedLabel =
            challenged.nickname ?? `Seat ${challenged.seatIndex + 1}`;
        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[0],
            deck: args.deck,
        };
        const limitedChallenge = {
            challengerSeatIndex,
            challengedUserId: challenged.userId!,
            challengedSeatIndex: challenged.seatIndex,
        };

        const matchId = await insertMatchWithDecks(ctx, {
            // Bo1 — a Limited challenge has no sideboarding flow (out of scope).
            bestOf: 1,
            status: "waiting",
            players: buildMatchPlayers([player]),
            currentGameNumber: 1,
            createdAt: now,
            updatedAt: now,
            limitedEventId: args.eventId,
            limitedChallenge,
        });

        const gameId = await insertGameWithDecks(ctx, {
            name: args.name ?? `${user.nickname} vs ${challengedLabel}`,
            matchId,
            gameNumber: 1,
            status: "waiting",
            players: toGamePlayers([player]),
            createdAt: now,
            updatedAt: now,
            limitedEventId: args.eventId,
            limitedChallenge,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        return gameId;
    },
});

/**
 * Start the Match for the caller's own pairing in the Limited Event's CURRENT
 * Swiss round (PRD #1628 stories 8-13, ADR 0076, issue #1645).
 *
 * One action, two shapes, decided by the paired seat — never by the client:
 *
 * - **Against a bot seat** the Match starts immediately as the existing vs-AI
 *   Match (`createSoloGame`'s seat model, ADR 0001) against that seat's
 *   Auto-Built deck, resolved SERVER-SIDE off the seat's own drafted Pool
 *   (`resolveSeatAutoBuiltDeck`). The projection already publishes that deck
 *   for the unrecorded "Play vs Bots" playtest, but a pairing's result lands
 *   in the standings, so its opponent decklist can never be client-supplied.
 * - **Against a human seat** it creates the pairing's Match ADDRESSED to that
 *   opponent — the same `waiting` + `limitedChallenge` shape
 *   `challengeLimitedSeat` builds, so the opponent accepts it through the
 *   unchanged `joinGame` path. A pairing is an appointment, not a race to
 *   challenge first: whichever of the two seats starts it, the other one gets
 *   the very same Match.
 *
 * The Match is Bo1 or Bo3 per the EVENT's Match Format (`bestOfForMatchFormat`),
 * so a Bo3 sideboards from the pool through the existing between-games flow
 * (the Limited deck's `sideboard` IS the rest of its Pool, ADR 0055).
 *
 * SECURITY: identity is `ctx.auth`'s (CLAUDE.md § Player identity). The seat is
 * taken from the caller's own AUTHENTICATED deck (`limitedSeatId`, re-checked
 * with `assertLimitedSeatOwnership`) and the pairing is looked up FROM that
 * seat — a client can neither claim a seat nor name a pairing. The created
 * Match id is stamped onto the pairing server-side (`bindPairingMatch`), which
 * is what later lets `recordLimitedPairingResult` refuse a result for a pairing
 * the Match isn't bound to.
 *
 * A pairing is started ONCE: `bindPairingMatch` refuses a pairing that already
 * carries a Match, and the single-active-Match guard (#155) still applies on
 * top. The one tolerated exception is a Match ABANDONED before it started (the
 * waiting room's `leaveGame` deleted the row) — the dangling id is cleared and
 * the pairing becomes startable again, rather than stranding the seat.
 */
export const startPairingMatch = mutation({
    args: {
        eventId: v.id("limitedEvents"),
        deck: deckValidator,
        name: v.optional(v.string()),
        bgColor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        // A round Match is only ever played with the deck built for THIS event
        // (PRD story 9) — the same rule the challenge path enforces.
        assertSameEventDeck(args.deck.limitedEventId, args.eventId);
        if (!args.deck.limitedSeatId)
            throw new Error("Your round Match needs your Limited deck's seat.");
        // #155 (match-scoped): at most one active Match per user.
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        const event = await ctx.db.get(args.eventId);
        // Caller owns the seat they claim (one seat-ownership authority, keyed
        // off the AUTHENTICATED id). `event` is non-null past this gate.
        assertLimitedSeatOwnership(event, args.deck.limitedSeatId, user._id);
        if (!event) throw new Error("Limited Event not found.");
        // A PHASE question, never a status literal (ADR 0076 decision 1).
        if (!areRoundsRunning(event.status))
            throw new Error("This event's rounds are not running.");

        const seatIndex = Number(args.deck.limitedSeatId);
        const { round, pairing, opponentSeatIndex } = resolveStartablePairing(
            event.rounds ?? [],
            event.currentRound,
            seatIndex
        );
        let rounds: LimitedRound[] = event.rounds ?? [];
        if (pairing.matchId) {
            const existing = await ctx.db.get(pairing.matchId as Id<"matches">);
            if (existing)
                throw new Error(
                    "Your Match for this round has already started."
                );
            // The bound Match is gone (abandoned waiting room) — recover.
            rounds =
                unbindPairingMatch(rounds, round.roundNumber, seatIndex) ??
                rounds;
        }
        const opponentSeat = event.seats.find(
            (s) => s.seatIndex === opponentSeatIndex
        );
        if (!opponentSeat)
            throw new Error("Your opponent's seat is no longer at the table.");

        // Authoritative deck legality gate (ADR 0036) before any row is
        // written — the caller's deck must be legal against its own Pool.
        assertDeckLegal(
            args.deck,
            undefined,
            await loadBanlistOverrides(ctx, args.deck.format),
            await loadLimitedPoolResolver(ctx, args.deck, user._id)
        );

        const now = Date.now();
        const bestOf = bestOfForMatchFormat(
            resolveMatchFormat(event.matchFormat)
        );
        // Match seat order: `players[0]` is always the seat that STARTED the
        // Match, which is what `recordPlayedPairing` re-orients the score from.
        const limitedPairing = {
            round: round.roundNumber,
            seatA: seatIndex,
            seatB: opponentSeatIndex,
        };
        const opponentLabel =
            opponentSeat.nickname ?? `Seat ${opponentSeat.seatIndex + 1}`;
        const name = args.name ?? `${user.nickname} vs ${opponentLabel}`;

        let matchId: Id<"matches">;
        let gameId: Id<"games">;

        if (opponentSeat.isBot) {
            const botDeck = await resolveSeatAutoBuiltDeck(
                ctx,
                event,
                opponentSeatIndex
            );
            if (!botDeck)
                throw new Error("Your opponent's deck is not ready yet.");
            // Same seat model as `createSoloGame({ vsAi: true })` (ADR 0001):
            // the caller drives `-p1`, the brain drives `-p2`. The bot deck is
            // tagged `freeform` because it belongs to no user's own Seat — the
            // Limited ownership gate would reject it — and it is legal by
            // construction (issue #1115).
            const player1: PlayerInput = {
                id: `${user._id}-p1`,
                name: `${user.nickname} (P1)`,
                bgColor: args.bgColor ?? PLAYER_COLORS[0],
                deck: args.deck,
            };
            const player2: PlayerInput = {
                id: `${user._id}-p2`,
                name: opponentLabel,
                bgColor: PLAYER_COLORS[1],
                deck: {
                    id: `limited-autobuild-${args.eventId}-${opponentSeatIndex}`,
                    name: opponentLabel,
                    format: "freeform",
                    cards: botDeck.cards,
                    sideboard: botDeck.sideboard,
                },
            };
            const allPlayers = [player1, player2];
            const matchPlayers = buildMatchPlayers(allPlayers);
            matchId = await insertMatchWithDecks(ctx, {
                bestOf,
                status: "pregame",
                players: matchPlayers,
                currentGameNumber: 1,
                playDrawChooserId: pickCoinTossWinner(
                    matchPlayers,
                    Math.random()
                ),
                solo: true,
                vsAi: true,
                limitedEventId: args.eventId,
                limitedPairing,
                createdAt: now,
                updatedAt: now,
            });
            gameId = await insertGameWithDecks(ctx, {
                name,
                matchId,
                gameNumber: 1,
                status: "pregame",
                players: toGamePlayers(allPlayers),
                solo: true,
                vsAi: true,
                limitedEventId: args.eventId,
                limitedPairing,
                createdAt: now,
                updatedAt: now,
            });
        } else {
            if (!opponentSeat.userId)
                throw new Error("Your opponent's seat is empty.");
            // Identical to a `challengeLimitedSeat` challenge — a `waiting`
            // 2-player Match bound to the event and ADDRESSED to the paired
            // seat, which `joinGame` completes. Reusing that binding is what
            // makes the opponent's accept path (and its event projection) work
            // with no parallel mechanism.
            const limitedChallenge = {
                challengerSeatIndex: seatIndex,
                challengedUserId: opponentSeat.userId,
                challengedSeatIndex: opponentSeatIndex,
            };
            const player: PlayerInput = {
                id: user._id,
                name: user.nickname,
                bgColor: args.bgColor ?? PLAYER_COLORS[0],
                deck: args.deck,
            };
            matchId = await insertMatchWithDecks(ctx, {
                bestOf,
                status: "waiting",
                players: buildMatchPlayers([player]),
                currentGameNumber: 1,
                createdAt: now,
                updatedAt: now,
                limitedEventId: args.eventId,
                limitedChallenge,
                limitedPairing,
            });
            gameId = await insertGameWithDecks(ctx, {
                name,
                matchId,
                gameNumber: 1,
                status: "waiting",
                players: toGamePlayers([player]),
                createdAt: now,
                updatedAt: now,
                limitedEventId: args.eventId,
                limitedChallenge,
                limitedPairing,
            });
        }

        await ctx.db.patch(matchId, { currentGameId: gameId });

        // Stamp the Match onto the pairing (ADR 0076 decision 2) — the link a
        // finished Match is recorded through. `bindPairingMatch` refuses a
        // pairing that is already bound or decided, so a race that slipped past
        // the checks above cannot repoint it at a second Match.
        const bound = bindPairingMatch(
            rounds,
            round.roundNumber,
            seatIndex,
            matchId
        );
        if (!bound)
            throw new Error("Your Match for this round has already started.");
        await ctx.db.patch(args.eventId, {
            rounds: asDbRounds(bound),
            updatedAt: now,
        });

        return gameId;
    },
});

/**
 * Create a solo game: a single user controls both players. The viewer
 * auto-follows the priority player on the client. Game starts in "playing"
 * immediately — no second user needs to join.
 */
export const createSoloGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        deck2: v.optional(deckValidator),
        /** When true the second seat is driven by the AI brain (ADR 0001).
         *  Still structurally a solo game — no new game mode or move surface. */
        vsAi: v.optional(v.boolean()),
        /** Limited Event this playtest belongs to ("Play vs the Table", PRD
         *  #1107 story 25). Binds the solo/vs-AI Match to the event exactly the
         *  way `challengeLimitedSeat` binds a human-vs-human one, so the client
         *  can return to the EVENT lobby when the Match ends instead of the
         *  general lobby. Accepted only when the caller's OWN deck belongs to
         *  that event (`assertSameEventDeck`) — never a client-claimed binding. */
        limitedEventId: v.optional(v.id("limitedEvents")),
        // Bo1 | Bo3 (PRD #387). Defaults to Bo1.
        bestOf: bestOfValidator,
    },
    handler: async (ctx, args) => {
        // ADR 0080 — a manual-format deck is rejected by the real engine.
        if (args.deck.format === "manual")
            throw new Error(
                "Tabletop decks cannot start a real game. Play a Tabletop game instead."
            );
        if (args.deck2?.format === "manual")
            throw new Error(
                "Tabletop decks cannot start a real game. Play a Tabletop game instead."
            );
        const user = await getCurrentUser(ctx);
        // #155 (match-scoped): one active match per user (see createGame).
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        // An event binding is only legitimate when seat 1's deck IS that
        // event's deck — the ownership of that seat is re-checked below by
        // `loadLimitedPoolResolver`/`assertLimitedSeatOwnership`.
        if (args.limitedEventId) {
            assertSameEventDeck(args.deck.limitedEventId, args.limitedEventId);
            const limitedEvent = await ctx.db.get(args.limitedEventId);
            if (!limitedEvent) throw new Error("Limited Event not found.");
            // A PHASE question, never a status literal (ADR 0076 decision 1):
            // an event-bound "Play vs the Table" playtest is withdrawn while
            // the event's Swiss rounds are running (PRD #1628 story 36, issue
            // #1648) — the round pairing is the only Match a seat plays.
            // Rejected server-side, not merely hidden by the panel
            // (`startPairingMatch`/`challengeLimitedSeat` use the same gate).
            if (areRoundsRunning(limitedEvent.status))
                throw new Error(
                    "Play vs Bots is off while this event's rounds are running."
                );
        }
        const deck2 = args.deck2 ?? args.deck;
        // Authoritative deck legality gate (ADR 0036): both seats' decks must be
        // legal before the solo/vs-AI Match starts. Each deck's own DB banlist
        // override (PRD #1138, issue #1144) is loaded independently — the two
        // seats' decks aren't guaranteed to share a Format.
        assertDeckLegal(
            args.deck,
            undefined,
            await loadBanlistOverrides(ctx, args.deck.format),
            await loadLimitedPoolResolver(ctx, args.deck, user._id)
        );
        if (args.deck2)
            assertDeckLegal(
                args.deck2,
                undefined,
                await loadBanlistOverrides(ctx, args.deck2.format),
                // Solo/vs-AI: a single authenticated user occupies BOTH seats
                // it controls, so the same `user._id` is the correct owner
                // check for `deck2`'s seat too — not a false-reject of a
                // legitimate solo Limited playtest.
                await loadLimitedPoolResolver(ctx, args.deck2, user._id)
            );

        const player1: PlayerInput = {
            id: `${user._id}-p1`,
            name: `${user.nickname} (P1)`,
            bgColor: PLAYER_COLORS[0],
            deck: args.deck,
        };
        const player2: PlayerInput = {
            id: `${user._id}-p2`,
            name: `${user.nickname} (P2)`,
            bgColor: PLAYER_COLORS[1],
            deck: deck2,
        };

        const allPlayers = [player1, player2];
        const now = Date.now();

        // Solo/vs-AI: both seats exist immediately, but G1 opens on the coin-toss
        // gate (CR 103.2-103.4) rather than building the Game up front. The toss
        // winner (`playDrawChooserId`) picks play/draw; `chooseFirstPlayer` then
        // builds Game 1 with the resolved active player. Bo1 by default.
        const matchPlayers = buildMatchPlayers(allPlayers);
        const tossWinnerId = pickCoinTossWinner(matchPlayers, Math.random());
        const matchId = await insertMatchWithDecks(ctx, {
            bestOf: args.bestOf ?? 1,
            status: "pregame",
            players: matchPlayers,
            currentGameNumber: 1,
            playDrawChooserId: tossWinnerId,
            solo: true,
            vsAi: args.vsAi === true ? true : undefined,
            limitedEventId: args.limitedEventId,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await insertGameWithDecks(ctx, {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "pregame",
            players: toGamePlayers(allPlayers),
            solo: true,
            vsAi: args.vsAi === true ? true : undefined,
            limitedEventId: args.limitedEventId,
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        return gameId;
    },
});

/**
 * Create a solo Tabletop (manual) game (ADR 0080 S12): one user controls both
 * seats, no rule enforcement, no automations. Game starts in "playing"
 * immediately — no coin toss, no mulligan flow. Concede is the only terminator.
 */
/**
 * The Tabletop-side deck gate (ADR 0080), mirroring the three real-engine
 * rejections in `createGame` / `joinGame` / `createSoloGame`. Two conditions:
 * the deck's Format must be `manual`, and it must not be empty — the manual
 * Format validates nothing by design, so `validateDeck` passes an empty deck
 * and a table with no cards is not a game.
 */
function assertTabletopDeck(deck: { format: string; cards: unknown[] }): void {
    if (deck.format !== "manual")
        throw new Error(
            "Only Tabletop-format decks can start a Tabletop game."
        );
    if (deck.cards.length === 0)
        throw new Error("A Tabletop deck must contain at least one card.");
}

export const createManualSoloGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        deck2: v.optional(deckValidator),
        bestOf: bestOfValidator,
    },
    handler: async (ctx, args) => {
        // ADR 0080 — only Tabletop-format decks can start a Tabletop game.
        assertTabletopDeck(args.deck);
        if (args.deck2) assertTabletopDeck(args.deck2);
        const user = await getCurrentUser(ctx);
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);

        const deck2 = args.deck2 ?? args.deck;

        const player1Id = `${user._id}-p1`;
        const player2Id = `${user._id}-p2`;
        const allPlayers = [
            {
                id: player1Id,
                name: `${user.nickname} (P1)`,
                bgColor: PLAYER_COLORS[0],
                deck: args.deck,
            },
            {
                id: player2Id,
                name: `${user.nickname} (P2)`,
                bgColor: PLAYER_COLORS[1],
                deck: deck2,
            },
        ];
        const now = Date.now();

        // Manual games skip the pregame/coin-toss gate — start immediately.
        const matchPlayers = buildMatchPlayers(allPlayers);
        const matchId = await insertMatchWithDecks(ctx, {
            bestOf: args.bestOf ?? 1,
            status: "playing",
            players: matchPlayers,
            currentGameNumber: 1,
            solo: true,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await insertGameWithDecks(ctx, {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "playing",
            players: toGamePlayers(allPlayers),
            solo: true,
            mode: "manual",
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        // Build the initial ManualGameState from both decks.
        const initial = setupManualGame(
            allPlayers.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                deck: p.deck.cards,
            }))
        );

        await saveManualState(ctx, gameId, 0, initial, null);
        await appendManualLog(ctx, gameId, {
            text: "Tabletop game started",
            timestamp: now,
        });

        return gameId;
    },
});

/**
 * Open a MULTIPLAYER Tabletop (manual) table (ADR 0080 S12): a `waiting` Match
 * another human completes with `joinManualGame`. Structurally identical to
 * `createGame`'s waiting room — same `buildMatchPlayers` / `toGamePlayers`
 * primitives, same single-active-match guard — with two differences: the row
 * carries `mode: "manual"`, and the Match never enters the `pregame` coin-toss
 * gate, because a Tabletop game has no automated turn structure to hand to a
 * first player (roll the die verb, then "you start", exactly as at a table).
 */
export const createManualGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
        bestOf: bestOfValidator,
    },
    returns: v.id("games"),
    handler: async (ctx, args) => {
        assertTabletopDeck(args.deck);
        const user = await getCurrentUser(ctx);
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);

        const now = Date.now();
        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[0],
            deck: args.deck,
        };

        const matchId = await insertMatchWithDecks(ctx, {
            bestOf: args.bestOf ?? 1,
            status: "waiting",
            players: buildMatchPlayers([player]),
            currentGameNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await insertGameWithDecks(ctx, {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "waiting",
            players: toGamePlayers([player]),
            mode: "manual",
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        return gameId;
    },
});

/**
 * Sit down at an open multiplayer Tabletop table (ADR 0080 S12). The mirror of
 * `joinGame` for manual mode — and it must be a SEPARATE mutation, not a branch
 * inside it: `joinGame` rejects a manual deck fail-closed (invariant 1, the
 * engine's only seam), builds a `pregame` coin-toss gate the Tabletop has no
 * use for, and runs the real-engine setup. Both seats' decks are snapshotted
 * into the initial `ManualGameState`; the game is immediately playable.
 */
export const joinManualGame = mutation({
    args: {
        gameId: v.id("games"),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        assertTabletopDeck(args.deck);
        const user = await getCurrentUser(ctx);
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);

        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        if (game.mode !== "manual")
            throw new Error(
                "That table is a real game — join it with a real deck."
            );
        if (game.status !== "waiting") throw new Error("Game is not open");
        if (game.players.length >= 2) throw new Error("Game is full");
        if (game.players.some((p) => p.id === user._id))
            throw new Error("Cannot join a game you are already in");

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[1],
            deck: args.deck,
        };
        // The host's decklist lives in `gameDecks` now (issue #2506) — hydrate
        // it, because the seats written back must carry BOTH decks.
        const allPlayers = [
            ...(await hydrateGameSeats(ctx, game)),
            ...toGamePlayers([player]),
        ];
        const now = Date.now();

        // No coin toss, no pregame gate: the table is live the moment the
        // second player sits down (ADR 0080 — no automation, concede is the
        // only terminator).
        if (game.matchId) {
            const match = await ctx.db.get(game.matchId);
            if (match) {
                await appendMatchSeat(
                    ctx,
                    match,
                    buildMatchPlayers([player])[0],
                    {
                        status: "playing",
                        updatedAt: now,
                    }
                );
            }
        }

        await patchGameSeats(ctx, args.gameId, allPlayers, {
            status: "playing",
            updatedAt: now,
        });

        const initial = setupManualGame(
            allPlayers.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                deck: p.deck.cards,
            }))
        );
        await saveManualState(ctx, args.gameId, 0, initial, null);
        await appendManualLog(ctx, args.gameId, {
            text: "Tabletop game started",
            timestamp: now,
        });

        return null;
    },
});

/**
 * Resolve the G1 coin toss into the first Game (CR 103.2-103.4). The Match must
 * be in the "pregame" gate opened by `joinGame` / `createSoloGame`, with the
 * toss winner recorded as `playDrawChooserId`. That winner's `choice` sets the
 * turn-1 active player via `nextGameActivePlayerId`; a vs-AI bot chooser
 * auto-chooses "play" (mirrors `buildNextGameForMatch`). Builds the deferred G1
 * state onto the EXISTING pregame Game row (`currentGameId`) — the client's
 * stored session id must stay valid — and flips Match + Game to "playing".
 * Idempotent: once "playing" the built Game is returned without rebuilding.
 */
export const chooseFirstPlayer = mutation({
    args: {
        matchId: v.id("matches"),
        choice: v.optional(v.union(v.literal("play"), v.literal("draw"))),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");

        // Idempotent on double-click / OCC retry: G1 already built.
        if (match.status === "playing" && match.currentGameId)
            return { gameId: match.currentGameId };
        if (match.status !== "pregame")
            throw new Error("Match is not in the coin-toss step");
        const gameId = match.currentGameId;
        if (!gameId) throw new Error("Match has no pregame Game to build");

        const now = Date.now();
        // The Match deck copies live in `matchDecks` now (issue #2506) — the
        // next Game's library is built from them, so this path hydrates.
        const seats = buildNextGameSeats({
            players: await hydrateMatchPlayers(ctx, match),
        });
        // The toss winner (`playDrawChooserId`) chooses; a bot chooser is forced
        // to "play" server-side with no human prompt (CR 103.4, #394).
        const resolvedChoice: PlayDrawChoice = botIsChooser(match)
            ? "play"
            : (args.choice ?? "play");
        const activePlayerId = nextGameActivePlayerId(match, resolvedChoice);

        await ctx.db.patch(gameId, { status: "playing", updatedAt: now });
        await ctx.db.patch(args.matchId, {
            status: "playing",
            playDrawChooserId: undefined,
            updatedAt: now,
        });

        // CR 103.5: opening hands are drawn only after the starting player is
        // decided. The on-the-play skip-first-draw rule (CR 103.8) is already
        // handled by the engine (turn === 1).
        const initialState = buildInitialGameState(seats, activePlayerId);
        await saveGameState(ctx, gameId, 0, initialState, null);

        return { gameId };
    },
});

/** Resolves the game a join attempt is aimed at, AFTER the caller-shaped
 *  guards and BEFORE the game-shaped ones. The only thing the two join entry
 *  points differ by (issue #2649): `joinGame` gets a client-supplied
 *  `Id<"games">`, `joinGameByCode` gets a code it resolves server-side.
 *  Throwing from here is how each entry point words its own "no such game". */
type JoinTargetResolver = (
    ctx: MutationCtx
) => Promise<Doc<"games"> | null | undefined>;

/** The whole of a second-seat join: twelve guards in a fixed order, then the
 *  seat write and the Match's coin-toss gate.
 *
 *  Extracted from `joinGame` (issue #2649) so "join by code" reuses it rather
 *  than re-implementing the guard sequence — two copies drift, and the copy is
 *  the one that silently misses the NEXT Limited-challenge gate someone adds.
 *  Nothing here knows how the game was addressed. */
async function joinWaitingGame(
    ctx: MutationCtx,
    args: {
        deck: Infer<typeof deckValidator>;
        bgColor?: string;
    },
    resolveTarget: JoinTargetResolver
): Promise<{ gameId: Id<"games"> }> {
    // ADR 0080 — a manual-format deck is rejected by the real engine.
    if (args.deck.format === "manual")
        throw new ConvexError(
            "Tabletop decks cannot start a real game. Play a Tabletop game instead."
        );
    const user = await getCurrentUser(ctx);
    // #155 (match-scoped): reject joining when the user already occupies
    // another active match (their own waiting room or an in-progress match).
    if (await findActiveMatchForUser(ctx, user._id))
        throw new ConvexError(ACTIVE_GAME_MESSAGE);
    const game = await resolveTarget(ctx);
    if (!game) throw new ConvexError("Game not found");
    const gameId = game._id;
    if (game.status !== "waiting") throw new ConvexError("Game is not open");
    if (game.players.length >= 2) throw new ConvexError("Game is full");
    if (game.players.some((p) => p.id === user._id))
        throw new ConvexError("Cannot join a game you are already in");
    // Limited Event challenge (issue #1577): a challenge Game is PRIVATE to
    // the two paired seats — only the addressed opponent may accept it, and
    // only with a deck from the SAME event (the "reject pairing decks from
    // different events" AC). A non-challenge open game skips both checks.
    if (game.limitedChallenge) {
        if (user._id !== game.limitedChallenge.challengedUserId)
            throw new ConvexError("This challenge is not addressed to you.");
        assertSameEventDeck(
            args.deck.limitedEventId,
            game.limitedEventId ?? ""
        );
        // A PHASE question, never a status literal (ADR 0076 decision 1):
        // free challenges are withdrawn while the event's Swiss rounds are
        // running (PRD #1628 story 36, issue #1648) — the round pairing is
        // the only Match a seat plays. `challengeLimitedSeat` already
        // rejects CREATING a free challenge once rounds are running, but a
        // free challenge sent during deckbuild is still a `waiting` row
        // when the phase flips to `playing` (nothing cancels it —
        // `openPlayPhaseIfReady` only patches status/rounds), so the ACCEPT
        // side needs the identical gate or the challenged seat can still
        // join it, landing both players in a live event-bound Match
        // outside the pairing and burning the single-active-Match slot the
        // pairing needs. A round pairing Match carries BOTH
        // `limitedChallenge` AND `limitedPairing` (`startPairingMatch`) —
        // that accept path must stay open even while rounds run, since it
        // IS the round, so the gate applies only to a "free" challenge
        // Game (no `limitedPairing`).
        if (!game.limitedPairing && game.limitedEventId) {
            const event = await ctx.db.get(
                game.limitedEventId as Id<"limitedEvents">
            );
            if (event && areRoundsRunning(event.status))
                throw new ConvexError(
                    "Free challenges are off while this event's rounds are running."
                );
        }
    }
    // A round pairing Match (issue #1645) is an appointment between two
    // SEATS: the accepting player must sit down with the deck of the seat
    // the pairing actually names, not merely with a deck from the same
    // event. (`limitedPairing.seatB` is the addressed side — `seatA` is
    // whoever started it.)
    if (
        game.limitedPairing &&
        args.deck.limitedSeatId !== String(game.limitedPairing.seatB)
    ) {
        throw new ConvexError(
            "This Match is your round pairing — accept it with that seat's deck."
        );
    }
    // Authoritative deck legality gate (ADR 0036): the joiner's deck must be
    // legal for its declared format before the Match flips to "playing".
    // The DB banlist override (PRD #1138, issue #1144) is loaded first so a
    // joiner can't sneak in a DB-banned card even on a stale client.
    assertDeckLegal(
        args.deck,
        undefined,
        await loadBanlistOverrides(ctx, args.deck.format),
        await loadLimitedPoolResolver(ctx, args.deck, user._id)
    );

    const player: PlayerInput = {
        id: user._id,
        name: user.nickname,
        bgColor: args.bgColor ?? PLAYER_COLORS[1],
        deck: args.deck,
    };
    // The host's decklist lives in `gameDecks` now (issue #2506) — hydrate
    // it, because the seats written back must carry BOTH decks.
    const allPlayers = [
        ...(await hydrateGameSeats(ctx, game)),
        ...toGamePlayers([player]),
    ];
    const now = Date.now();

    // Complete the owning Match and open the G1 coin-toss gate (CR
    // 103.2-103.4): add the joiner's deck snapshot, flip the Match to
    // "pregame", and record the toss winner as the play/draw chooser. Game 1
    // is NOT built yet — `chooseFirstPlayer` builds it once the choice lands.
    if (game.matchId) {
        const match = await ctx.db.get(game.matchId);
        if (match) {
            const joiner = buildMatchPlayers([player])[0];
            const tossWinnerId = pickCoinTossWinner(
                [...match.players, joiner],
                Math.random()
            );
            await appendMatchSeat(ctx, match, joiner, {
                status: "pregame",
                playDrawChooserId: tossWinnerId,
                updatedAt: now,
            });
        }
    }

    // Update game record (no gameStates row until the toss is resolved).
    await patchGameSeats(ctx, gameId, allPlayers, {
        status: "pregame",
        // The join code's lifetime IS the `waiting` window (issue #2649):
        // clearing it here is what makes every stale code fail closed, at
        // the single point every second-seat join passes through. A code
        // is never recycled or re-issued — a table that has started has no
        // code at all, so there is nothing left for an old code to name.
        joinCode: undefined,
        updatedAt: now,
    });
    return { gameId };
}

export const joinGame = mutation({
    args: {
        gameId: v.id("games"),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await joinWaitingGame(ctx, args, (c) => c.db.get(args.gameId));
    },
});

/** "Join by code" (issue #2649). The code is resolved INSIDE the mutation that
 *  joins — there is deliberately no `resolveJoinCode(code) → gameId` query for
 *  a client to feed back: that would both trust a client-supplied id and turn
 *  the code space into an enumerable oracle for game and host names.
 *
 *  Every way a CODE can fail to name an open table — unknown, malformed,
 *  stale, already started, already full, or naming a class of game codes are
 *  not issued for — produces the SAME message (`JOIN_CODE_REJECTED`), so the
 *  failure never reveals what the game was. Everything past the resolution is
 *  the shared `joinWaitingGame` body, guard for guard identical to `joinGame`.
 *
 *  Scope of that uniformity, precisely: it covers the RESOLUTION. The guards
 *  either side of it word themselves — a Tabletop deck is refused before the
 *  code is ever looked at, and `assertDeckLegal` runs after, so a caller
 *  submitting a deliberately illegal deck can tell "this code named a table"
 *  from "it named nothing". Left as is on purpose: every table a code can
 *  name is already public in `listOpenGames`, id and all, so the distinction
 *  buys an attacker nothing — and collapsing it would mean either loading the
 *  banlist and Limited pool twice per join or telling an honest player their
 *  code was bad when it was their decklist. */
export const joinGameByCode = mutation({
    args: {
        code: v.string(),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    returns: v.object({ gameId: v.id("games") }),
    handler: async (ctx, args) => {
        return await joinWaitingGame(ctx, args, async (c) => {
            const game = await findGameByJoinCode(c, args.code);
            // `ConvexError`, never a plain `Error`: a PRODUCTION deployment
            // replaces a plain Error's message with "Server Error" on its way
            // to the client (`src/lib/mutation-error.ts`), which would destroy
            // the one thing this feature's contract is made of — the single
            // uniform verdict the user reads. A `ConvexError`'s `data` crosses
            // that boundary intact.
            if (!game) throw new ConvexError(JOIN_CODE_REJECTED);
            return game;
        });
    },
});

/** #155 (match-scoped): the caller's current active match's game, or null. The
 *  lobby uses this to surface an existing match instead of letting the user
 *  attempt a (rejected) second creation. Derived from the active Match so the
 *  Match is the single source of truth, but the wire shape is unchanged for the
 *  lobby (gameId + status flags) with the Match id added. */
export const myActiveGame = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        const match = await findActiveMatchForUser(ctx, userId);
        if (!match || !match.currentGameId) return null;
        const game = await ctx.db.get(match.currentGameId);
        if (!game) return null;
        const solo = game.solo === true;
        const vsAi = game.vsAi === true;
        const opponentName = activeGameOpponentName(match, userId, solo, vsAi);
        return {
            gameId: game._id,
            matchId: match._id,
            name: game.name,
            status: game.status,
            solo,
            vsAi,
            mode: game.mode ?? null,
            opponentName,
        };
    },
});

/** #155: abandon a *waiting* game the user created but no opponent joined,
 *  freeing them to start another. A game in progress must be conceded
 *  instead (`concede`) — leaving it outright would strand the opponent. */
export const leaveGame = mutation({
    args: { gameId: v.id("games") },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) return; // already gone — nothing to free
        if (!gameBelongsToUser(game, user._id))
            throw new Error("You are not part of this game");
        // "pregame" (G1 coin-toss gate) has no gameStates row and no moves
        // played, so it abandons like a waiting room; "playing" must be
        // conceded instead.
        if (game.status !== "waiting" && game.status !== "pregame")
            throw new Error("Cannot leave a game in progress; concede instead");
        // Delete any state snapshots first, then the orphan waiting room and its
        // owning waiting Match (ADR 0029) so the user is free to start another.
        const states = await ctx.db
            .query("gameStates")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const s of states) await ctx.db.delete(s._id);
        // Tick row companion (PRD #1776 T3, issue #1778) — same defensive
        // cleanup as `gameStates` above, though a "waiting"/"pregame" game
        // has never reached `saveGameState` so this is normally a no-op.
        const ticks = await ctx.db
            .query("gameTicks")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const t of ticks) await ctx.db.delete(t._id);
        // Decklist companion (issue #2506) — same orphan risk as `gameStates`.
        await deleteGameDecks(ctx, args.gameId);
        await ctx.db.delete(args.gameId);
        if (game.matchId) {
            const match = await ctx.db.get(game.matchId);
            if (
                match &&
                (match.status === "waiting" || match.status === "pregame")
            ) {
                await deleteMatchDecks(ctx, game.matchId);
                await ctx.db.delete(game.matchId);
                // A round pairing Match abandoned before it started (issue
                // #1645): release the pairing so the seat can start it again,
                // rather than leaving it pointing at a deleted Match.
                await releaseAbandonedPairing(ctx, match);
            }
        }
    },
});

/** Clears the `matchId` a deleted, never-started pairing Match left on its
 *  pairing (issue #1645). Silent no-op for any Match that isn't a pairing
 *  Match, and for a pairing already decided — `unbindPairingMatch` owns both
 *  refusals. */
async function releaseAbandonedPairing(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    match: Doc<"matches">
): Promise<void> {
    const link = match.limitedPairing;
    if (!link || !match.limitedEventId) return;
    const event = await ctx.db.get(match.limitedEventId as Id<"limitedEvents">);
    if (!event) return;
    const rounds = unbindPairingMatch(
        event.rounds ?? [],
        link.round,
        link.seatA
    );
    if (!rounds) return;
    await ctx.db.patch(event._id, {
        rounds: asDbRounds(rounds),
        updatedAt: Date.now(),
    });
}

/**
 * Continue an undecided Bo3 Match into its next Game (PRD #387 / ADR 0029).
 * Called from the interstitial game-over screen. The owning Match must be in the
 * between-Games "sideboarding" gate (set by `recordGameResult` when a Game ends
 * without deciding the Match). Builds a fresh Game from each player's current
 * Match maindeck (20 life, shuffled library, new opening hand, MULLIGAN), bumps
 * `currentGameNumber`, repoints `currentGameId`, and flips the Match back to
 * "playing". Returns the new gameId and the caller's seat so the client can
 * re-point its session. Idempotent on races: if the Match already advanced to a
 * newer Game, returns that Game instead of building a duplicate.
 *
 * The previous Game's loser (`playDrawChooserId`) chooses play or draw (#394,
 * CR 103.4). `choice` sets the active player at turn 1 of the next Game: "play"
 * keeps the chooser active, "draw" hands the first turn to the opponent. In a
 * vs-AI Match where the bot is the chooser, the choice is forced to "play" with
 * no human prompt. If `choice` is omitted (legacy / no recorded chooser) the
 * next Game falls back to the default active player (first seat).
 */
/**
 * Build the next Game of an undecided Bo3 Match from the post-sideboard
 * Maindecks (PRD #387 / #394 / #395). Shared by `continueMatch` (legacy direct
 * build) and `setReady` (the #395 ready gate). Builds a fresh Game from each
 * player's CURRENT Match maindeck (20 life, shuffled library, new opening hand,
 * MULLIGAN), bumps `currentGameNumber`, repoints `currentGameId`, flips the
 * Match to "playing", and clears the consumed play/draw chooser. The previous
 * Game's loser's `choice` sets the turn-1 active player (CR 103.4); a vs-AI bot
 * chooser auto-chooses play. Caller must have verified status === "sideboarding".
 */
async function buildNextGameForMatch(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    match: Doc<"matches">,
    nickname: string,
    choice?: PlayDrawChoice
): Promise<{ gameId: Id<"games">; gameNumber: number }> {
    const now = Date.now();
    // The Match deck copies live in `matchDecks` now (issue #2506) — the
    // next Game's library is built from them, so this path hydrates.
    const seats = buildNextGameSeats({
        players: await hydrateMatchPlayers(ctx, match),
    });
    const nextGameNumber = match.currentGameNumber + 1;

    const resolvedChoice: PlayDrawChoice = botIsChooser(match)
        ? "play"
        : (choice ?? "play");
    const activePlayerId = nextGameActivePlayerId(match, resolvedChoice);

    // The seat's deck carries `sideboard` purely to feed `buildInitialGameState`'s
    // companion auto-declare (ADR 0064); it must NOT be persisted onto the `games`
    // row (the schema validator rejects the extra field). Strip it to the
    // immutable maindeck snapshot, mirroring `toGamePlayers` (PRD #387).
    const gamePlayers = toNextGamePlayers(seats);

    const gameId = await insertGameWithDecks(ctx, {
        name: match.solo ? `${nickname}'s solo game` : `${nickname}'s game`,
        matchId: match._id,
        gameNumber: nextGameNumber,
        status: "playing",
        players: gamePlayers,
        solo: match.solo === true ? true : undefined,
        vsAi: match.vsAi === true ? true : undefined,
        // The `games` row is declared a MIRROR of the owning Match's event
        // binding (schema.ts `limitedPairing`) — G1 (`startPairingMatch`)
        // wrote it, and every later Game of the same pairing must carry it
        // too. Dropping it here made every Bo3 Game 2+ read as unbound
        // (issue #1645 review): the standings write still landed (it reads
        // the MATCH), while any gate reading the games row silently no-oped.
        // `limitedChallenge` is deliberately NOT mirrored — it is the pending
        // -accept marker `joinGame` consumes, already spent by G2.
        limitedEventId: match.limitedEventId,
        limitedPairing: match.limitedPairing,
        createdAt: now,
        updatedAt: now,
    });

    await ctx.db.patch(match._id, {
        status: "playing",
        currentGameNumber: nextGameNumber,
        currentGameId: gameId,
        playDrawChooserId: undefined,
        updatedAt: now,
    });

    // CR 103: the next Game starts fresh from the post-sideboard maindeck. The
    // play/draw choice sets the turn-1 active player; the on-the-play skip-first-
    // draw rule is already correct in the engine (turn === 1, CR 103.8).
    const initialState = buildInitialGameState(seats, activePlayerId);
    await saveGameState(ctx, gameId, 0, initialState, null);

    return { gameId, gameNumber: nextGameNumber };
}

/** Shared seat-ownership check for the sideboarding mutations: a 2-player caller
 *  may only act on their own seat; a Solo/vs-AI caller owns both seats of the
 *  Match (they all belong to the single user). */
function callerOwnsSeat(
    match: Doc<"matches">,
    seat: { id: string },
    userId: string
): boolean {
    return (
        match.solo === true ||
        seat.id === userId ||
        seat.id.startsWith(`${userId}-`)
    );
}

/**
 * Submit a player's sideboarding swaps for the between-Games gate (PRD #387 /
 * #395). Re-partitions the player's Match deck copy via the pure `applySideboard`
 * helper, which validates the size-lock (Maindeck size unchanged) and the pool
 * invariant (combined pool unchanged). Edits the MATCH copy only — `userDecks`
 * is never touched. Submitting does NOT ready the seat; `setReady` is separate,
 * so a player may revise before confirming.
 */
export const submitSideboard = mutation({
    args: {
        matchId: v.id("matches"),
        seatId: v.string(),
        maindeck: v.array(
            v.object({ cardId: v.string(), cardName: v.string() })
        ),
        sideboard: v.array(
            v.object({ cardId: v.string(), cardName: v.string() })
        ),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");
        if (match.status !== "sideboarding")
            throw new Error("Match is not in the sideboarding step");

        const seatIdx = match.players.findIndex((p) => p.id === args.seatId);
        if (seatIdx === -1) throw new Error("Seat not found in this match");
        const seat = match.players[seatIdx];
        if (!callerOwnsSeat(match, seat, user._id))
            throw new Error("You cannot sideboard for that seat");

        // The deck copy this re-partitions lives in `matchDecks` (issue #2506)
        // — the ONE path that edits deck CONTENT between Games. Read only this
        // seat's row; the opponent's is untouched and unread.
        const current = (await loadMatchSeatDecks(ctx, match, [seat.id])).get(
            seat.id
        );
        if (!current) throw new Error("Seat has no deck copy in this match");

        // Pure validation + apply (size-lock + pool preservation). Throws on an
        // illegal swap, rolling the mutation back atomically.
        const nextDeck = applySideboard(current, {
            maindeck: args.maindeck,
            sideboard: args.sideboard,
        });

        await saveMatchSeatDeck(ctx, match, seat.id, nextDeck, {
            updatedAt: Date.now(),
        });
    },
});

/**
 * Mark a seat ready in the between-Games gate (PRD #387 / #395). Ready is
 * required even with no swaps. In vs-AI the bot seat auto-readies (no swaps) the
 * moment the human readies, so the human is never blocked on it. In Solo the
 * single human readies each seat in turn on the same client. When every seat is
 * ready the next Game is built from the post-swap Maindecks via
 * `buildNextGameForMatch`, with the chooser's `choice` setting the active player
 * (CR 103.4). Returns `{ gameId }` once built, else `{ gameId: null }` (still
 * waiting on another seat). Idempotent: once "playing" the next Game is returned.
 */
export const setReady = mutation({
    args: {
        matchId: v.id("matches"),
        seatId: v.string(),
        choice: v.optional(v.union(v.literal("play"), v.literal("draw"))),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");

        // Idempotent on double-click / OCC retry: the next Game already exists.
        if (match.status === "playing" && match.currentGameId)
            return { gameId: match.currentGameId };
        if (match.status !== "sideboarding")
            throw new Error("Match is not in the sideboarding step");

        const seatIdx = match.players.findIndex((p) => p.id === args.seatId);
        if (seatIdx === -1) throw new Error("Seat not found in this match");
        const seat = match.players[seatIdx];
        if (!callerOwnsSeat(match, seat, user._id))
            throw new Error("You cannot ready that seat");

        // Ready this seat, and in vs-AI auto-ready the bot (no swaps) so the
        // human never waits on it (PRD #387 user story 23).
        const bot = botSeatId(match);
        const players = match.players.map((p, i) => {
            if (i === seatIdx) return { ...p, ready: true };
            if (bot && p.id === bot) return { ...p, ready: true };
            return p;
        });
        await ctx.db.patch(args.matchId, { players, updatedAt: Date.now() });

        if (!allSeatsReady({ players })) return { gameId: null };

        // All seats ready → build the next Game from the post-sideboard decks.
        const fresh = await ctx.db.get(args.matchId);
        if (!fresh) throw new Error("Match not found");
        const { gameId } = await buildNextGameForMatch(
            ctx,
            fresh,
            user.nickname,
            args.choice
        );
        return { gameId };
    },
});

/**
 * Legacy/compat: continue an undecided Bo3 Match straight into its next Game,
 * applying the play/draw choice but skipping the Sideboarding ready gate (PRD
 * #387 / #394). The #395 flow goes through `submitSideboard` + `setReady`; this
 * is retained for idempotency and any caller that bypasses the editor.
 */
export const continueMatch = mutation({
    args: {
        matchId: v.id("matches"),
        choice: v.optional(v.union(v.literal("play"), v.literal("draw"))),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");

        if (match.status === "playing" && match.currentGameId) {
            return {
                gameId: match.currentGameId,
                gameNumber: match.currentGameNumber,
            };
        }
        if (match.status !== "sideboarding")
            throw new Error("Match is not awaiting the next game");

        return buildNextGameForMatch(ctx, match, user.nickname, args.choice);
    },
});

/**
 * Forfeit the entire Match in one action (PRD #387 user story 30 / issue #396).
 * Unlike `concede` — which loses only the CURRENT Game and routes through the
 * normal flow (the Match continues into Sideboarding if undecided) — a forfeit
 * ends the WHOLE Match immediately: the opponent is awarded the Games they need
 * to win, the Match is marked `finished`, and `winner` is set to the opponent.
 * In a Bo1 a concede and a forfeit coincide; in a Bo3 a forfeit ends the Match
 * regardless of the running score.
 *
 * Also the mapping for "Back to Lobby" mid-Match: leaving an in-progress Match
 * forfeits it so no orphaned active Match is left behind (the single-active-
 * match guard would otherwise block a new Match). If the current Game is still
 * in progress it is marked finished with the opponent as the Game winner, so the
 * board reflects the forfeit too. Idempotent: a finished Match is a no-op.
 */
export const forfeitMatch = mutation({
    args: {
        matchId: v.id("matches"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");
        // SECURITY (issue #1645 review): `matchBelongsToUser` only proves the
        // caller is IN this Match — it does not prove they own the seat they
        // named. Without this, either seat of a 2-player pairing Match could
        // forfeit AS the OPPONENT and write itself a `source: "played"` win in
        // the Limited standings (and in a solo bot pairing, forfeiting as
        // `-p2` would be a one-call 2-0). Solo play is unaffected: one user
        // legitimately drives both `-p1` and `-p2`.
        assertSeatOwnership(args.playerId, user._id);
        // …which is precisely why seat ownership is NOT enough here: in a
        // vs-AI pairing the human owns the bot's `-p2` handle too, so the
        // one-call 2-0 above survives that check. Forfeiting the BOT's seat of
        // an event-bound Match is the exploit; block it at the resignation
        // path only, so the Brain keeps driving that seat's ordinary plays.
        assertNotEventBotSeat(match, args.playerId);

        // Idempotent: an already-finished Match needs nothing.
        if (match.status === "finished") return;

        const patch = computeForfeitMatch(match, args.playerId);
        if (!patch) throw new Error("Seat not found in this match");

        const now = Date.now();
        await ctx.db.patch(args.matchId, { ...patch, updatedAt: now });
        // The SECOND place a Match becomes finished (issue #1645). A forfeited
        // pairing Match must land in the standings exactly like a played one —
        // `computeForfeitMatch` awarded the opponent the games they needed, so
        // the recorded score is already internally consistent (2-0 in a Bo3).
        await recordLimitedPairingResult(ctx, { ...match, ...patch }, now);

        // If a Game is in progress, end it too so the board shows the result.
        // The opponent (the Match winner) is the Game winner.
        const winnerId = patch.winner;
        if (match.currentGameId && winnerId) {
            const gameState = await getLatestGameState(
                ctx,
                match.currentGameId
            );
            if (gameState && !gameState.state.gameOver) {
                const state = structuredClone(gameState.state) as GameState;
                state.gameOver = {
                    winnerId,
                    loserId: args.playerId,
                    reason: "concede",
                };
                const nextSeq = gameState.seq + 1;
                await saveGameState(
                    ctx,
                    match.currentGameId,
                    nextSeq,
                    state,
                    gameState
                );
                // Mark the games row finished (the Match patch above already
                // recorded the final score; don't re-run recordGameResult).
                await ctx.db.patch(match.currentGameId, {
                    status: "finished",
                    winner: winnerId,
                    updatedAt: now,
                });
            }
        }
    },
});

export const playCard = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        skipValidation: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });
        assertNoPendingChoices(state);
        const player = getPlayer(state, args.playerId);

        // Validate: card must be a legal "play" source. The normal source is a
        // hand card; CR 601.3e — a LAND in exile carrying a play-from-exile
        // permission (Headliner Scarlett / Expressive Iteration exiling a land,
        // "you may play that card this turn") is also a legal play source; a
        // LAND in the graveyard is a legal play source while the controller
        // holds an unconditional play-lands-from-graveyard permission (Icetill
        // Explorer, issue #1190 — `canPlayLandsFromGraveyard`); the LAND on
        // top of the controller's own library is a legal play source while
        // they hold the play-from-top permission (Courser of Kruphix —
        // `isPlayableLibraryTopLand`, position-strict at index 0).
        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        const exileLand = cardInHand
            ? undefined
            : findCastableExileCard(state, player.id, args.cardInstanceId);
        const graveyardLand =
            cardInHand || exileLand
                ? undefined
                : findPlayableGraveyardLand(state, player, args.cardInstanceId);
        const libraryTopLand =
            cardInHand || exileLand || graveyardLand
                ? undefined
                : findPlayableLibraryTopLand(
                      state,
                      player,
                      args.cardInstanceId
                  );
        const playSource =
            cardInHand ?? exileLand ?? graveyardLand ?? libraryTopLand;
        if (!playSource) throw new Error("Card not in hand");
        if (exileLand && !exileLand.types.includes("Land")) {
            // A non-land exile card is cast (announceCast), never played here.
            throw new Error("Card not in hand");
        }
        if (!args.skipValidation) {
            assertLegalAction(state, player, playSource, "play");
        }

        // Shared canonical play-land core (CR 305.2 land-drop tracking,
        // CR 302.6 summoning-sickness clock, CR 603.6a ETB triggers, CR 704
        // SBAs). Identical sequence to the Bot's `applyMoveForSearch`
        // play-land case — both call `applyPlayLand` so the authoritative and
        // simulated paths cannot drift. (Pre-fix this mutation skipped
        // `markEnteredThisTurn`, so a Mishra's Factory played and animated the
        // same turn could illegally attack — issue: manland summoning sickness.)
        if (exileLand) {
            applyPlayLandFromExile(state, player, args.cardInstanceId);
        } else if (graveyardLand) {
            applyPlayLandFromGraveyard(state, player, args.cardInstanceId);
        } else if (libraryTopLand) {
            applyPlayLandFromLibraryTop(state, player, args.cardInstanceId);
        } else {
            applyPlayLand(state, player, args.cardInstanceId);
        }

        const nextSeq = gameState.seq + 1;

        // Insert new snapshot (don't overwrite previous)
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** CR 116.2 / 702.139a (ADR 0064) — the `summon-companion` special action:
 *  once per game, at sorcery timing, pay {3} (auto-tapped) to move the
 *  declared companion from its slot into hand — no stack item. Legality is
 *  the single `canSummonCompanion` predicate (gre/companion.ts), shared with
 *  the Bot's move enumerator (moves.ts) so the human and Bot paths can never
 *  disagree. The {3} payment is solved and applied SYNCHRONOUSLY in this one
 *  call (`pendingCompanionPay` exists for architectural symmetry with
 *  `pendingCast`/`pendingActivation`, not because this cost ever needs a
 *  second round-trip — see its doc on `GameState`), mirroring the
 *  `castChosenSpell` (Word of Command) auto-tap-and-commit shape. */
export const summonCompanion = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });
        assertNoPendingChoices(state);
        const player = getPlayer(state, args.playerId);

        if (!canSummonCompanion(state, player)) {
            throw new Error("Can't summon your companion right now");
        }

        const subs = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(
            player.battlefield,
            manaGateBattlefields(state)
        );
        const plan = solveSmartAutoTap(
            player.manaPool,
            COMPANION_SUMMON_COST,
            subs,
            sources
        );
        if (plan === null) {
            throw new Error("Can't afford the companion's {3} summon cost");
        }

        state.pendingCompanionPay = {
            playerId: player.id,
            manaCost: COMPANION_SUMMON_COST,
            tappedLandIds: plan.map((step) => step.cardId),
        };

        // Tap the planned lands and add their mana (CR 605.1a), mirroring
        // `castChosenSpell`'s auto-tap-and-commit sequence.
        const tappedIds = new Set(plan.map((step) => step.cardId));
        for (const src of player.battlefield) {
            if (tappedIds.has(src.id)) src.isTapped = true;
        }
        const produced = manaFromPlan(sources, plan);
        for (const color of MANA_COLORS) {
            const v2 = produced[color];
            if (v2) player.manaPool[color] = (player.manaPool[color] ?? 0) + v2;
        }
        // CR 702.139a — pay the flat {3}, no card/restricted-mana eligibility
        // (a special action, not a spell cast — restricted mana never applies).
        payManaCostForSpell(player, COMPANION_SUMMON_COST, [], subs);
        commitLandsForCost(player, COMPANION_SUMMON_COST);

        // Move the companion into hand (no stack item, CR 116.2a) and mark it
        // spent. The slot's `instance` is left in place (a historical record —
        // `used: true` alone gates any further summon).
        const companion = player.companion!;
        player.hand.push({ ...companion.instance, zone: "hand" });
        companion.used = true;
        state.pendingCompanionPay = undefined;

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** CR 116.2b / 702.37e (issue #2705) — the `turn-face-up` special action:
 *  "Any time you have priority, you may turn a face-down permanent you control
 *  with a morph ability face up. This is a special action; it doesn't use the
 *  stack. To do this, show all players what the permanent's morph cost would be
 *  if it were face up, pay that cost, then turn the permanent face up."
 *
 *  The engine's SECOND special action, and deliberately not a copy of the
 *  first: `summonCompanion` is per-player, fixed {3}, once per game and gated
 *  to sorcery timing, where this one is per-PERMANENT, VARIABLE-cost (the
 *  permanent's own printed morph cost), repeatable and legal at ANY priority —
 *  CR 116.2b attaches no timing restriction whatever, and unmorphing as a
 *  blocker or in response to removal is the mechanic's whole point.
 *
 *  Legality is the single `canTurnFaceUp` predicate (gre/morph.ts), shared with
 *  the Bot's move enumerator (moves.ts) and with the wire affordance flag
 *  (`projectBattlefieldCard`), so the button, the Bot and the server can never
 *  disagree. The cost is solved and applied SYNCHRONOUSLY here by the shared
 *  auto-tap solver, the same one-shot shape `summonCompanion` uses: the action
 *  offers the player no choices, so a second payment round-trip would buy
 *  nothing (a player who wants specific lands tapped can float the mana first —
 *  the solver spends pool mana before it taps anything).
 *
 *  CR 708.8 / 702.37e's last sentence — "Any abilities relating to the permanent
 *  entering the battlefield don't trigger when it's turned face up and don't
 *  have any effect, because the permanent has already entered the battlefield"
 *  — needs no suppression flag: `turnFaceUp` mutates the permanent IN PLACE and
 *  never runs the enter-the-battlefield path, so no ETB event is emitted for
 *  the permanent's own triggers or for another permanent's ETB watchers to
 *  see. SBAs run afterwards because the turn-up changes toughness (CR 704.5f
 *  can kill a permanent whose real toughness is at or below its marked
 *  damage — or spare a 2/2 with 2 damage that turns into a 4/5). */
export const turnPermanentFaceUp = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });
        assertNoPendingChoices(state);
        applyTurnPermanentFaceUp(state, args.playerId, args.cardInstanceId);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** The whole of the CR 116.2b / 702.37e special action, as a PURE state
 *  transition: re-check legality, pay the morph cost, turn the permanent face
 *  up, restart the pass cycle, run SBAs. Split out of the mutation above (the
 *  `recordConvokeCreaturePick` shape) so the full path is reachable from a test
 *  without a Convex context — the mutation adds only auth, the clone and the
 *  save. Throws on every illegal input; the caller has already asserted
 *  priority and the absence of pending choices. */
export function applyTurnPermanentFaceUp(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const player = getPlayer(state, playerId);
    const permanent = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!permanent) throw new Error("Permanent not found");

    if (!canTurnFaceUp(state, player, permanent)) {
        throw new Error("Can't turn that permanent face up right now");
    }

    const plan = morphTurnUpPaymentPlan(state, player, permanent);
    if (plan === null) throw new Error("Can't afford the morph cost");
    // CR 702.37e — the morph cost is SHOWN to all players as it is paid. Read
    // from the real card behind `faceDownOf`, never from the sentinel def
    // (which has no mana cost at all).
    const morphCost = normalizeManaCost(getMorphCost(permanent) ?? {});

    // Tap the planned lands and add their mana (CR 605.1a), mirroring
    // `summonCompanion`'s auto-tap-and-commit sequence.
    const subs = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(
        player.battlefield,
        manaGateBattlefields(state)
    );
    const tappedIds = new Set(plan.map((step) => step.cardId));
    for (const src of player.battlefield) {
        if (tappedIds.has(src.id)) src.isTapped = true;
    }
    const produced = manaFromPlan(sources, plan);
    for (const color of MANA_COLORS) {
        const amount = produced[color];
        if (amount) {
            player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
        }
    }
    // CR 702.37e — pay the morph cost. No card/restricted-mana eligibility: a
    // special action is not a spell cast, so restricted mana never applies (the
    // same reasoning `summonCompanion` records for its {3}).
    payManaCostForSpell(player, morphCost, [], subs);
    commitLandsForCost(player, morphCost);

    // CR 702.37e — "then turn the permanent face up. The morph effect on it
    // ends, and it regains its normal characteristics." One primitive, shared
    // with ADR 0013's replacement-driven turn-up.
    turnFaceUp(permanent);

    // CR 116 — a special action puts nothing on the stack and cannot be
    // responded to, but it IS a game action: the pass cycle restarts and
    // priority stays with the player who took it (CR 117.3c).
    state.passCount = 0;
    checkStateBasedActions(state);
}

/** Resolves an activated ability id on a battlefield card against its
 *  post-layer effective set ({@link getEffectiveActivatedAbilities}). Returns
 *  the template and, when the ability was granted to this permanent by
 *  another card (CR 113.1), the granting card def id. Returns null if no
 *  matching ability exists. */
function resolveActivatedAbility(
    card: CardInstanceState,
    abilityId: string
): {
    ability: NonNullable<
        ReturnType<typeof getDefinition>["activatedAbilities"]
    >[number];
    grantedSourceCardId?: string;
} | null {
    return (
        getEffectiveActivatedAbilities(card).find(
            (r) => r.ability.id === abilityId
        ) ?? null
    );
}

/** Throws a descriptive Error if the activated ability's CR 602.5 timing
 *  restrictions (controller-turn-only, once-per-turn cap) are violated
 *  against the current state. Called by every activation entry point before
 *  cost lock so the rejection is surfaced before any mutation. Exported so an
 *  integration test can drive the real check (no convex-test harness in this
 *  repo — see `untapRefundsLife.test.ts`). */
export function assertActivationTimingLegal(
    state: GameState,
    card: CardInstanceState,
    ability: {
        id: string;
        controllerTurnOnly?: boolean;
        oncePerTurn?: boolean;
        sorcerySpeedOnly?: boolean;
    }
): void {
    if (
        ability.controllerTurnOnly &&
        state.activePlayerId !== card.controllerId
    ) {
        throw new Error("Activate only during your turn");
    }
    if (ability.oncePerTurn) {
        const used = card.activationsThisTurn?.[ability.id] ?? 0;
        if (used >= 1) {
            throw new Error("Activate only once each turn");
        }
    }
    // CR 602.3b / 307.5 template — "activate only as a sorcery" follows the
    // same timing window a sorcery's own casting does (main phase, empty
    // stack, activator holds priority). Reuses the engine's canonical
    // `isSorceryTiming` helper — the same one `assertLoyaltyActivationLegal`
    // layers an active-player requirement on top of for loyalty abilities.
    if (ability.sorcerySpeedOnly && !isSorceryTiming(state)) {
        throw new Error("Activate only as a sorcery");
    }
}

/** CR 606 — validates a LOYALTY ABILITY (an ability whose cost carries a signed
 *  `cost.loyalty`) up-front, before any cost is paid. No-op for a non-loyalty
 *  ability.
 *
 *  THE THROWING WRAPPER, nothing more. The rule itself lives in
 *  `convex/gre/loyalty.ts` (`loyaltyActivationViolation`), because the bot's
 *  move enumerator and the search's cost payer need the SAME rule in boolean
 *  form and cannot import this module (`convex/gre/**` must not depend on
 *  `convex/game.ts`). Issue #2491: before the extraction the enumerator simply
 *  refused every loyalty ability, so the bot cast planeswalkers it never
 *  activated; re-deriving the rule there instead would have produced an
 *  enumerator-says-legal / server-rejects divergence that half-applies the
 *  bot's `activateAbility → selectTarget` sequence.
 *
 *  The three clauses (unchanged, and the messages are byte-identical):
 *   - CR 606.3 — at most one loyalty ability of a given permanent per turn
 *     (the per-instance `loyaltyActivatedThisTurn` lock);
 *   - CR 606.3 — the controller's own main phase, empty stack, holding
 *     priority (`isSorceryTimingFor`, the engine's one authority on that
 *     window — the old inline form paired the player-agnostic
 *     `isSorceryTiming` with an explicit active-player check, which is the
 *     same condition);
 *   - CR 606.6 — a `-N` cost is illegal unless the permanent has at least that
 *     many loyalty counters. (This clause cited CR 606.5 before #2491; 606.5
 *     is the cost-COMBINATION rule and 606.6 is the floor — `bun run cr 606.6`
 *     prints it.) */
export function assertLoyaltyActivationLegal(
    state: GameState,
    card: CardInstanceState,
    ability: { cost: { loyalty?: number } }
): void {
    const violation = loyaltyActivationViolation(state, card, ability);
    if (violation) throw new Error(LOYALTY_VIOLATION_MESSAGE[violation]);
}

export { payLoyaltyCost };

/** Minimum number of targets required for a TargetRequirement.count value.
 *  Fixed N → N; range → min. Used to validate confirmTargets (CR 601.2c). */
function minTargetCount(count: number | { min: number; max?: number }): number {
    return typeof count === "number" ? count : count.min;
}

/** Resolves a target-count's `"X"` bound(s) (a literal `"X"` count, or a
 *  `{ min, max: "X" }` "up to X" range) to fixed numbers using the cast's
 *  `chosenX` (CR 107.3 / 601.2c). Returns the input unchanged for a plain
 *  numeric / already-fixed range. Thin wrapper over the single shared
 *  resolver (`gre/state.ts` `resolveTargetRequirementCount`, issue #2365)
 *  with `requireX: true` — the cast/activated-ability path is the one
 *  consumer that must reject an X-bearing count with no announced X
 *  (activated abilities without X in their cost never carry one). */
function resolveTargetCount(
    count: number | "X" | { min: number; max?: number | "X" },
    chosenX: number | undefined
): number | { min: number; max?: number } {
    return resolveTargetRequirementCount(count, chosenX, { requireX: true });
}

/** True when the selected targets have reached the maximum allowed for this
 *  requirement. Fixed N → selected >= N; range → selected >= max (undefined
 *  max means no upper limit, so this never triggers auto-advance). */
// `pendingTargetFiltersFromRequirement` moved to `./gre/rules` (issue #1193) so
// the gre trigger-target path (`raiseTriggerTargetSelection`) can build a
// `PendingTarget` without importing `game.ts`. Imported above; same behavior.

/** Loads the next INDEPENDENT target group of a multi-group spell (CR 601.2c —
 *  Fumarole) into `pt` in place: clears every group-specific filter field and
 *  re-derives them from `req`, resetting `selected` for the fresh group. The
 *  primary group's build in `announceCast` is the single-group analogue; both
 *  derive their filters from `pendingTargetFiltersFromRequirement`. */
function applyRequirementToPendingTarget(
    pt: PendingTarget,
    req: TargetRequirement,
    chosenX: number | undefined
): void {
    pt.targetType = req.type;
    pt.count = resolveTargetCount(req.count, chosenX);
    pt.selected = [];
    // Clear every optional filter so a prior group's constraint never leaks,
    // then re-apply from the shared builder. The key set is COMPILE-FORCED —
    // `PENDING_TARGET_FILTER_KEYS` (`gre/state.ts`, ADR 0068 / issue #1956)
    // fails `tsc` the moment a registry filter that lands on `PendingTarget`
    // is missing from it. This used to be a hand-written run of assignments,
    // which is a fail-OPEN shape — a filter added to the registry but
    // forgotten here silently leaks the previous group's constraint into the
    // next one (Fumarole's creature-then-land walk), and ten permanent-kind
    // filters had already drifted out of it.
    for (const key of Object.keys(PENDING_TARGET_FILTER_KEYS)) {
        (pt as Record<string, unknown>)[key] = undefined;
    }
    pt.zone = undefined;
    pt.divideTotal = undefined;
    pt.divideAmounts = undefined;
    Object.assign(pt, pendingTargetFiltersFromRequirement(req, chosenX));
}

/** After a target group's selection completes (CR 601.2c): if the spell has
 *  further INDEPENDENT groups queued (Fumarole), lock the current group's picks
 *  into `priorSelected` and load the next requirement; otherwise finalize the
 *  whole selection. Exported for integration tests that exercise the multi-group
 *  target walk (Fumarole's creature-then-land selection). */
export function advanceTargetGroupOrFinalize(
    state: GameState,
    pt: PendingTarget,
    playerId: string
): void {
    const remaining = pt.remainingRequirements;
    if (remaining && remaining.length > 0) {
        const [next, ...rest] = remaining;
        pt.priorSelected = [...(pt.priorSelected ?? []), ...pt.selected];
        pt.remainingRequirements = rest.length > 0 ? rest : undefined;
        applyRequirementToPendingTarget(pt, next, pt.chosenX);
        return;
    }
    finalizeTargetSelection(state, pt, playerId);
}

/** Finalizes target selection and either places the spell on the stack (if
 *  the caster can already pay) or transitions into the payment phase.
 *  Mutates `state` in place. Handles chosenX propagation and the per-target
 *  additional generic cost modifier (CR 601.2f). Exported for integration
 *  tests that exercise the real cost/target commit path (e.g. Reflecting
 *  Mirror's derived-X + retarget finalization). */
/** CR 702.27 — validate a requested Buyback choice against a card and return
 *  the canonical boolean (false = not paid). Throws when buyback is
 *  requested for a card with no Buyback cost. Unlike Kicker (CR 702.33e
 *  Multikicker), Buyback has no repeatable variant — CR 702.27a's "an
 *  additional [cost]" is singular, paid at most once per cast. Exported for
 *  the same reason `resolveKickerPayments` is: `convex/gre/__tests__/
 *  buyback.test.ts` drives the real cost/target commit path over the GRE
 *  state (no convex-test harness for game.ts mutations, ADR 0001). */
export function resolveBuybackChoice(
    cardDef: CardDefinition,
    requested: boolean | undefined
): boolean {
    if (!requested) return false;
    if (!cardDef.buyback) throw new Error("This spell has no buyback");
    return true;
}

/** CR 702.27a / 601.2f — fold the Buyback cost into a normalized mana-cost
 *  record, mutating it in place, when `buybackPaid`. No-op when not paid or
 *  the card has no Buyback cost. Applied to the total mana cost BEFORE cost
 *  modifiers (CR 601.2f — an additional cost joins the total, then
 *  increases/reductions apply), mirroring `foldKickerCosts`. */
function foldBuybackCost(
    cost: Record<string, number>,
    cardDef: CardDefinition,
    buybackPaid: boolean
): void {
    if (!buybackPaid || !cardDef.buyback) return;
    const per = normalizeManaCost(cardDef.buyback);
    for (const [sym, amt] of Object.entries(per)) {
        cost[sym] = (cost[sym] ?? 0) + amt;
    }
}

/** CR 601.3c (issue #2146) — validate a client's DECLARED intent to pay the
 *  conditional-flash surcharge against the card, mirroring the
 *  `alternativeCostId` declared-but-absent guard in `announceCast`: a client
 *  claiming the surcharge on a card that declares none is rejected outright,
 *  and a client explicitly DECLINING it (`false`) on a cast that owes it is
 *  rejected too, since CR 601.3c prices the permission rather than making it
 *  optional — declining is "don't cast this now", not "cast it for free".
 *
 *  What it deliberately does NOT do is decide whether the surcharge is owed.
 *  That is `flashSurchargeRequired` (`gre/rules.ts`), evaluated server-side on
 *  the real board: an OMITTED flag (every non-UI caller — the bot driver,
 *  a scripted cast) still pays, so the client's word can never dodge a
 *  mandatory cost, and a client that says "pay" when the board says nothing is
 *  owed is charged nothing rather than rejected (the two can disagree
 *  benignly — the client reads a projection taken before it clicked).
 *
 *  Exported for the same reason `resolveBuybackChoice` is: the tests drive the
 *  real cost/commit path over the GRE state (no convex-test harness for
 *  game.ts mutations, ADR 0001). */
export function assertFlashSurchargeDeclaration(
    cardDef: CardDefinition,
    requested: boolean | undefined,
    required: boolean
): void {
    if (requested !== undefined && !cardDef.flashSurcharge) {
        throw new Error("This spell has no flash surcharge");
    }
    if (requested === false && required) {
        throw new Error(
            "This spell can only be cast now by paying its flash surcharge"
        );
    }
}

/** The target requirement in force for a cast, given the cast-time choices
 *  that can REPLACE the card's printed one. Two do:
 *
 *   - CR 702.103b/303.4a — a BESTOWED cast. "As a spell cast bestowed is put
 *     onto the stack, it becomes an Aura enchantment and gains enchant
 *     creature … Because the spell is an Aura spell, its controller must
 *     choose a legal target for that spell as defined by its enchant creature
 *     ability." A bestow creature has no printed `targetRequirement` at all,
 *     so this is the whole of it. Checked FIRST: bestow is an alternative cost
 *     and a Kicker is an additional one, and CR 601.2b forbids neither
 *     combination outright, but no printed card combines them and the
 *     characteristic change is the stronger claim on the target set.
 *   - CR 702.33 — a KICKED cast with a declared `kickedTargetRequirement`
 *     (Bloodchief's Thirst, Tear Asunder), else the base `targetRequirement`.
 *
 *  A chosen modal mode's requirement still wins over both (modal never
 *  co-occurs with kicker or bestow on a shipped card, but the precedence is
 *  defined at the call site). */
function castAdjustedTargetRequirement(
    cardDef: CardDefinition,
    kickerPayments: KickerPayments | undefined,
    isBestowCost: boolean,
    isMorphCost: boolean
): TargetRequirement | undefined {
    // CR 702.37c — a face-down spell has "no text", so none of the card's
    // printed clauses apply to it, including a target requirement. Checked
    // FIRST and unconditionally: this is a characteristic-defining property of
    // the object on the stack, not a preference among requirements.
    //
    // `morphCards.test.ts` already forbids a morph card from declaring a
    // `targetRequirement` at all, so today this branch returns what the
    // fallthrough would. It is here because the guard proves a fact about the
    // CATALOGUE and this proves a fact about the RULE — and only the second one
    // still holds when the catalogue changes.
    if (isMorphCost) return undefined;
    if (isBestowCost) return BESTOW_TARGET_REQUIREMENT;
    if (
        totalKickerCount(kickerPayments) > 0 &&
        cardDef.kickedTargetRequirement
    ) {
        return cardDef.kickedTargetRequirement;
    }
    return cardDef.targetRequirement;
}

/** CR 107.4f / 601.2f — resolve the mana-vs-life split for a cast's Phyrexian
 *  pips ({C/P}). Returns the per-colour mana to FOLD into the spell's mana cost
 *  (the pips paid with mana) plus the total LIFE to pay (2 per pip paid with
 *  life). `argLifePips` is the caster's announced choice of how many pips to pay
 *  with life (threaded from `announceCast` through `pendingTarget`); when it is
 *  absent the split is auto-resolved to the most-life affordable option via
 *  `solvePhyrexianSplit` (the signature "pay 2 life" line, falling back to mana
 *  only when life can't cover a pip). A no-Phyrexian cost is a `{}`/`0` no-op.
 *  Throws when the chosen life payment exceeds the caster's life (CR 119.4).
 *  `state`, when passed, is forwarded into `solvePhyrexianSplit` /
 *  `canPayNormalizedCost` (issue #1757 finding 2) so the auto-resolved split
 *  sees the same both-players board (`manaGateBattlefields`, issue #1751
 *  finding 1) the human gate and the Bot's enumerator already agree on —
 *  otherwise a Mox-Opal-funded split the gate offered comes back `null` here
 *  and falls into the all-life branch below, which then throws the CR 119.4
 *  life check on a cast the gate legally offered. */
function resolvePhyrexianCastPayment(
    player: PlayerState,
    card: CardInstanceState,
    rawCost: ManaCost | undefined,
    chosenX: number | undefined,
    argLifePips: number | undefined,
    state?: GameState
): { manaAdditions: Partial<Record<Color, number>>; payLife: number } {
    if (!rawCost) return { manaAdditions: {}, payLife: 0 };
    const totalPips = phyrexianPipCount(rawCost);
    if (totalPips === 0) return { manaAdditions: {}, payLife: 0 };
    let lifePips: number;
    let manaAdditions: Partial<Record<Color, number>>;
    if (argLifePips !== undefined) {
        // The caster explicitly chose how many pips to pay with life; the rest
        // fold into coloured mana (paid via the normal pool / auto-tap path).
        lifePips = Math.max(0, Math.min(argLifePips, totalPips));
        manaAdditions = phyrexianManaAdditions(rawCost, lifePips);
    } else {
        const split = solvePhyrexianSplit(
            player,
            card,
            rawCost,
            chosenX,
            state
        );
        if (split) {
            lifePips = split.lifePips;
            manaAdditions = split.manaAdditions;
        } else {
            // No affordable split (the affordability gate should have blocked
            // the cast); default to all-life so the commit fails via the life
            // check below rather than silently under-paying.
            lifePips = totalPips;
            manaAdditions = {};
        }
    }
    const payLife = lifePips * PHYREXIAN_LIFE_PER_PIP;
    // CR 119.4 — a life payment is legal only if the caster's life covers it.
    if (player.life < payLife) {
        throw new Error("Cannot pay more life than you have");
    }
    return { manaAdditions, payLife };
}

export function finalizeTargetSelection(
    state: GameState,
    pt: PendingTarget,
    playerId: string
): void {
    // CR 707.10b / 115.7 / 603.3d (issue #2283) — the three ENGINE-RAISED
    // origins (`"copy-retarget"` / `"retarget"` / `"trigger"`) write their
    // targets onto an object already on the stack and pay nothing. They live in
    // `gre/pendingTargetOrigin.ts` as the SINGLE AUTHORITY, because the bot's
    // in-tree simulation (`applyMoveInSearch`) must commit a raised selection
    // the same way this mutation path does; a second copy there would be the
    // "the bot simulates a different game than the server plays" bug. Returns
    // false (untouched) for an ANNOUNCED origin, which falls through below.
    if (applyRaisedTargetFinalization(state, pt)) return;

    // CR 601.2c — a multi-group spell (Fumarole) locked earlier groups' picks
    // into `priorSelected`; concatenate in declaration order so the stack
    // item's `targets` are positionally indexable by the Effect Script.
    const targets = [...(pt.priorSelected ?? []), ...pt.selected];
    const cardInstanceId = pt.cardInstanceId;
    const keepPriority = pt.keepPriority;
    const chosenX = pt.chosenX;
    // CR 702.33 — the PER-KICKER payment record chosen at announcement, whose
    // mana legs fold into the cost paid at this commit and which is propagated
    // whole to the resolving stack item (ADR 0079).
    const kickerPayments = pt.kickerPayments;
    // CR 702.27a — Buyback choice made at announcement, folded into the mana
    // cost paid at this commit and propagated to the resolving stack item.
    const buybackPaid = pt.buybackPaid ?? false;
    // CR 601.3c / 601.6a — the conditional-flash surcharge verdict taken at
    // ANNOUNCEMENT and locked in on `pendingTarget`, never re-derived here:
    // target selection is a separate mutation, so the board this commit runs
    // on is not the board the cast was announced on, and the caster having
    // BEGUN the cast under the permission finishes it at the announced price.
    const flashSurchargePaid = pt.flashSurchargePaid ?? false;
    const chosenModeId = pt.chosenModeId;
    // CR 601.2b / 118.8 — the ADDITIONAL-cost leg the caster named at
    // announcement ("discard a card or pay 3 life"), locked in on
    // `pendingTarget` for exactly the reason `flashSurchargePaid` above is:
    // target selection is a separate mutation, so this commit must flatten the
    // leg that was CHOSEN, never re-decide one from the board it now sees.
    const additionalCostLegId = pt.additionalCostLegId;
    // The absent-kind default is the SHARED one (`gre/constants.ts`), never a
    // local `?? "cast"` — issue #2296 review.
    const kind = resolvePendingTargetKind(pt.kind);
    const abilityId = pt.abilityId;
    // CR 601.2d / 120.4 — divide-as-you-choose split assigned during target
    // selection. Fill in a deterministic ≥1-each default when the caster did
    // not assign explicit amounts (auto-resolve when there's no real choice —
    // e.g. one target gets the whole total). Computed against `pt.divideTotal`.
    const divideAmounts =
        pt.divideTotal !== undefined && targets.length > 0
            ? finalizeDivideAmounts(pt, targets)
            : undefined;
    state.pendingTarget = undefined;

    const player = getPlayer(state, playerId);

    // Activated-ability targeting branch (CR 602.2b). Targets were chosen
    // first; costs are paid NOW. If mana isn't in the pool, enter a
    // pendingActivation payment phase — the already-selected targets ride
    // along and are re-applied at commit.
    if (kind === "ability") {
        if (!abilityId) throw new Error("pendingTarget.abilityId missing");
        // CR 113.6 / 602.1 — locate the ability's source. Most activated
        // abilities live on the battlefield, but a from-hand (Cycling,
        // Harvester of Misery's targeted discard ability) or from-graveyard
        // (Ashen Ghoul) source lives elsewhere. A TARGETED such ability
        // detours through this pendingTarget → finalize path, so mirror
        // activateAbility's multi-zone lookup here; a battlefield-only scan
        // would spuriously reject it ("Ability source not on battlefield").
        let card = player.battlefield.find((c) => c.id === cardInstanceId);
        let sourceFromGraveyard = false;
        let sourceFromHand = false;
        if (!card) {
            const found = player.graveyard.find((c) => c.id === cardInstanceId);
            if (found) {
                card = found;
                sourceFromGraveyard = true;
            }
        }
        if (!card) {
            const found = player.hand.find((c) => c.id === cardInstanceId);
            if (found) {
                card = found;
                sourceFromHand = true;
            }
        }
        if (!card) throw new Error("Ability source not on battlefield");
        const resolved = resolveActivatedAbility(card, abilityId);
        if (!resolved) throw new Error("Ability not found");
        const ability = resolved.ability;
        // CR 113.6 / 702.29a — the source was found off the battlefield: legal
        // only for an ability that opts into that zone (a stale prompt whose
        // source moved zones between announcement and confirmation is rejected).
        if (sourceFromGraveyard && !ability.activateFromGraveyard) {
            throw new Error(
                "This ability can't be activated from the graveyard"
            );
        }
        if (sourceFromHand && !ability.activateFromHand) {
            throw new Error("This ability can't be activated from your hand");
        }
        const grantedSourceCardId =
            pt.grantedSourceCardId ?? resolved.grantedSourceCardId;
        if (ability.cost.tap && card.isTapped) {
            throw new Error("Card is already tapped");
        }
        if (ability.cost.removeCounter) {
            const have = card.counters?.[ability.cost.removeCounter.type] ?? 0;
            if (have < ability.cost.removeCounter.count) {
                throw new Error("Not enough counters to pay activation cost");
            }
        }
        if (
            ability.canActivate !== undefined &&
            !ability.canActivate(card, state)
        ) {
            throw new Error("Ability cannot be activated right now");
        }
        // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>": illegal
        // if no matching permanent is on the activating player's battlefield.
        if (ability.cost.sacrificeFilter) {
            const candidates = player.battlefield.filter((c) =>
                // Same layered view as `sacrificeCandidates`, the scan that
                // later builds the picker. Matching the RAW instance here made
                // this gate disagree with it on every colour-filtered cost
                // (issue #1209).
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    ability.cost.sacrificeFilter!,
                    {
                        selfControllerId: player.id,
                        // CR 109.2 (issue #2367) — "Sacrifice ANOTHER artifact":
                        // the source is not a legal payment for its own cost.
                        selfInstanceId: card.id,
                        supertypesOf: liveSupertypesOf,
                    }
                )
            );
            // CR 602.1 / 118.5 (issue #2398) — "Sacrifice TEN nonland
            // permanents" (Bolas's Citadel): the cost gives up
            // `sacrificeFilterCount` matching permanents (default 1), so the
            // gate is a COUNT, not mere existence.
            if (candidates.length < (ability.cost.sacrificeFilterCount ?? 1)) {
                throw new Error("No legal permanent to pay the sacrifice cost");
            }
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard": illegal
        // unless one graveyard holds enough matching cards.
        if (ability.cost.exileFromGraveyard) {
            const { count, cardType, owner } = ability.cost.exileFromGraveyard;
            if (
                !canPayExileFromGraveyard(
                    state,
                    count,
                    cardType,
                    owner === "you" ? player.id : undefined
                )
            ) {
                throw new Error(
                    "No single graveyard has enough cards to pay the exile cost"
                );
            }
        }
        // CR 602.1 / 118.8 — "tap N untapped permanents matching <filter> you
        // control": illegal unless at least N matching untapped permanents
        // (other than the source) are on the activating player's battlefield.
        if (ability.cost.tapOtherFilter) {
            const candidates = tapOtherCandidates(
                player,
                card.id,
                ability.cost.tapOtherFilter.filter
            );
            if (
                !canPayTapOtherCost(
                    ability.cost.tapOtherFilter,
                    candidates.map((c) => tapOtherContribution(state, c))
                )
            ) {
                throw new Error(
                    "Not enough untapped permanents to pay the tap cost"
                );
            }
        }
        // CR 118.3 — "discard a card at random" cost (Coral Helm): illegal with
        // an empty hand. Validated up-front so we never enter a pendingActivation
        // that can't be paid.
        if (ability.cost.discardAtRandom && player.hand.length === 0) {
            throw new Error("No card in hand to discard");
        }
        // CR 602.1 / 118.3 — "discard a card matching <filter>" cost
        // (Survival of the Fittest): illegal unless at least `count` matching
        // cards are in the activating player's hand. Validated up-front so we
        // never enter a pendingActivation that can't be paid.
        if (ability.cost.discardFilter) {
            const candidates = player.hand.filter((c) =>
                handCardMatchesFilter(c, ability.cost.discardFilter!.filter)
            );
            if (candidates.length < ability.cost.discardFilter.count) {
                throw new Error(
                    "Not enough matching cards in hand to pay the discard cost"
                );
            }
        }
        assertActivationTimingLegal(state, card, ability);
        // CR 606 — re-validate a targeted loyalty ability at commit (the timing
        // / once-per-turn / below-0 gates), since the board may have changed
        // between opening the target prompt and confirming it.
        assertLoyaltyActivationLegal(state, card, ability);

        const hasXInCost =
            ability.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        // CR 107.3 — Reflecting Mirror: X is twice the mana value of the
        // targeted spell, derived from the chosen spell target rather than from
        // a player-chosen value. Computed here, once the target is known.
        let derivedX: number | undefined;
        if (ability.cost.xFromTargetSpellMv) {
            const spellTarget = targets.find((t) => t.type === "spell");
            const spell = spellTarget
                ? state.stack.find((s) => s.id === spellTarget.id)
                : undefined;
            if (!spell) {
                throw new Error("Target spell is no longer on the stack");
            }
            const spellCardId = (spell.card as { id?: string }).id;
            const spellDef = spellCardId
                ? tryGetDefinition(spellCardId)
                : undefined;
            const spellMv =
                manaValue(spellDef?.manaCost) + (spell.chosenX ?? 0);
            derivedX = ability.cost.xFromTargetSpellMv.multiplier * spellMv;
        }
        const abilityChosenX = ability.cost.xFromTargetSpellMv
            ? derivedX
            : hasXInCost
              ? chosenX
              : undefined;
        if (hasXInCost && abilityChosenX === undefined) {
            throw new Error("This ability requires a chosen X value");
        }
        const manaCost = resolveAbilityManaCost(state, card, ability, {
            chosenX: abilityChosenX,
        });
        if (manaCost) {
            applyCostModifiers(
                manaCost,
                getCostModifiers(state, card, "ability")
            );
        }
        // CR 601.2f / 118.5 — board-wide static NON-mana additional cost
        // (Drought: "Activated abilities cost an additional 'Sacrifice a Swamp'
        // for each black mana symbol"). Gate on affordability at announcement;
        // pip count comes from the ability's PRINTED activation cost.
        assertStaticAdditionalCostAffordable(
            state,
            ability.cost.mana,
            card,
            player,
            "ability"
        );

        // Enter pendingActivation (deferred commit) when mana isn't covered OR
        // the ability has a "sacrifice a permanent matching <filter>" cost that
        // still needs a player choice (CR 602.1 / 118.5). In the latter case we
        // always defer to selectActivationCost even when mana is covered, so
        // the player picks the sacrifice before the targeted ability commits.
        // CR 106.6 (issue #728) — restricted mana eligible for an ability of
        // THIS source (Soldevi Machinist) counts toward coverage.
        const abilitySourceTypes = card.types;
        const manaUncovered =
            !!manaCost &&
            !isManaCostCovered(
                spendablePoolForAbility(player, abilitySourceTypes),
                manaCost,
                getManaSubstitutions(state, player.id)
            );
        // CR 602.1 / 118.5 / 701.21a — unified filtered sacrifice (own cost +
        // Drought). A non-fungible board defers so the player chooses.
        const activationSac = buildActivationSacrificeSelection(
            state,
            ability,
            card,
            player,
            tryGetDefinition((card.card as { id?: string }).id ?? "")?.name ??
                "Sacrifice"
        );
        const needsSacrificeChoice =
            !!activationSac && !isSacrificeSelectionComplete(activationSac);
        if (
            manaUncovered ||
            needsSacrificeChoice ||
            ability.cost.exileFromGraveyard ||
            ability.cost.tapOtherFilter ||
            ability.cost.discardFilter
        ) {
            // SINGLE AUTHORITY (CR 602.1 / 118.8): the deferred-payment
            // descriptor is built by `buildPendingActivation` here too, exactly
            // as the non-targeted path does. This site used to duplicate the
            // object literal, and every cost shape added to the builder had to
            // be remembered twice — the `tapOtherChoice` totalPower/pickedPower
            // shape (CR 702.122a, Crew N) was dropped here, which made a
            // `totalPower` picker report itself PAID with zero picks. Only the
            // target-specific fields (`targets`, `targetAmounts`) are layered
            // on top; nothing else may be re-derived locally.
            state.pendingActivation = {
                ...buildPendingActivation({
                    playerId,
                    cardInstanceId: card.id,
                    abilityId,
                    ability,
                    manaCost,
                    chosenX: abilityChosenX,
                    // CR 700.2c (issue #1341) — carry the announcement-time
                    // mode through the deferred payment onto the stack item.
                    chosenModeId,
                    keepPriority,
                    grantedSourceCardId,
                    fromGraveyard: sourceFromGraveyard,
                    fromHand: sourceFromHand,
                    ...(activationSac
                        ? { sacrificeSelection: activationSac }
                        : {}),
                }),
                targets,
                // CR 601.2d — carry the divide-as-you-choose split through the
                // deferred payment so it reaches the stack item at commit.
                ...(divideAmounts ? { targetAmounts: divideAmounts } : {}),
            };
            // If mana was already covered (choice-only deferral), commit fires
            // once selectActivationCost sets the pickedId / completes the picks.
            tryAutoCommitPendingActivation(state, playerId);
            return;
        }

        // Commit immediately.
        if (ability.cost.tap) card.isTapped = true;
        // CR 106.10 — noted-mana battery: snapshot the pool before payment so
        // the per-colour delta becomes the mana noted on the source.
        const poolBeforePayment =
            ability.noteManaSpent && manaCost
                ? { ...player.manaPool }
                : undefined;
        if (manaCost) {
            payManaCostForAbility(
                player,
                manaCost,
                abilitySourceTypes,
                getManaSubstitutions(state, player.id)
            );
            commitLandsForCost(player, manaCost);
        }
        const notedManaSpent = poolBeforePayment
            ? manaSpentDelta(poolBeforePayment, player.manaPool)
            : undefined;
        if (ability.cost.removeCounter) {
            payRemoveCounterCost(card, ability.cost.removeCounter);
        }
        if (ability.cost.discardAtRandom) {
            payDiscardAtRandomCost(
                state,
                playerId,
                ability.cost.discardAtRandom
            );
        }
        // CR 119.4 — pay the life cost as the targeted ability goes on the
        // stack. Validated up-front in activateAbility before pendingTarget.
        if (ability.cost.life !== undefined) {
            player.life -= ability.cost.life;
        }
        // CR 606.4 — pay a targeted loyalty ability's signed loyalty cost as it
        // goes on the stack (Liliana's "-2"). No-op for a non-loyalty ability.
        payLoyaltyCost(card, ability);
        if (ability.cost.sacrifice) {
            removePermanentTo(state, card.id, "graveyard", "sacrifice");
        }
        // CR 702.29a / 118.3 — the "Discard this card" activation cost
        // (Harvester of Misery's targeted discard ability): discard the source
        // from hand as the ability commits, routed through the shared choke
        // point so CARD_DISCARDED fires (Marauding Mako). Runs BEFORE the
        // stack-item clone below (the card object persists after the move).
        // CR 702.29c — `cyclingCost` marks a cycling/typecycling cost payment on
        // the one CARD_DISCARDED event (Harvester of Misery's discard-this cost
        // is NOT a cycling cost and stays unmarked).
        if (ability.cost.discardThis) {
            discardToGraveyard(
                state,
                player.id,
                card.id,
                ability.cost.cyclingCost ? "cycling" : undefined
            );
        }
        // CR 118.1 / 601.2h — the "Exile this card/permanent" activation cost:
        // graveyard → exile for an Eternalize-shaped ability, battlefield →
        // exile for a permanent's own self-exile cost (Feldon's Cane). Runs
        // BEFORE the stack-item clone below (the card object persists after
        // the move, so the item keeps CR 608.2h last-known information).
        if (ability.cost.exileThis) {
            payExileThisCost(
                state,
                player,
                card.id,
                !!ability.activateFromGraveyard
            );
        }
        // CR 601.2f / 118.5 / 701.21a — apply the auto-resolved filtered
        // sacrifice (Drought / fungible own cost) as the ability commits.
        const targetedSacSnapshot = sacrificeSnapshotFromSelection(
            activationSac,
            state
        );

        const stackItem: StackItem = buildActivatedAbilityStackItem(card, {
            castById: playerId,
            abilityId,
            targets,
            ...(chosenModeId ? { chosenModeId } : {}),
            // CR 601.2d / 120.4 — the divide-as-you-choose split rides to
            // resolution so `dealDamageDividedAsChosen` uses the chosen amounts.
            ...(divideAmounts ? { targetAmounts: divideAmounts } : {}),
            ...(abilityChosenX !== undefined
                ? { chosenX: abilityChosenX }
                : {}),
            ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            ...(targetedSacSnapshot
                ? { additionalSacrificeSnapshot: targetedSacSnapshot }
                : {}),
            ...(notedManaSpent ? { notedManaSpent } : {}),
        });
        state.stack.push(stackItem);
        recordActivation(state, card, abilityId, !!ability.cost.tap);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, playerId);
        state.singleShotAutoPass = keepPriority ? undefined : playerId;
        // CR 603.2b (issue #1265) — the ability's targets are locked onto its
        // stack item; fire "becomes the target of an ability" triggers
        // (Leovold) alongside the ABILITY_ACTIVATED flush below.
        // `"activated-ability"` (issue #2360) — an ACTIVATED ability's targets
        // (CR 602.2b), never a cast spell's.
        emitBecameTargetEvents(
            state,
            targets,
            playerId,
            stackItem.id,
            "activated-ability"
        );
        // CR 603.3 — flush ABILITY_ACTIVATED queued by recordActivation so the
        // "non-tap ability activated" punisher lands on top of the freshly
        // pushed ability (resolves first). No-op for {T} abilities. BEFORE the
        // auto-pass drain (see `commitPendingCast`).
        processPendingActionTriggers(state);
        drainAutoPasses(state);
        return;
    }

    // Spell cast branch (CR 601.2c). CR 601.3e / 702.34 — normally the hand,
    // but Ice Cauldron's noted card is cast from exile, and a Flashback card is
    // cast from the graveyard.
    const castSource = locateCastSource(state, player, cardInstanceId);
    const castZone = castSource.zone;
    const cardInHand = castSource.card;
    if (!cardInHand) throw new Error("Card not in hand");
    const cardDef = getDefinition((cardInHand.card as { id: string }).id);

    // CR 118.9 — the caster opted into an ALTERNATIVE casting cost at
    // announcement (Thwart returns Islands, Fireblast sacrifices Mountains); it
    // rode along on `pendingTarget` and is paid at this commit (601.2h),
    // replacing the mana cost entirely.
    const chosenAltCost = pt.alternativeCostId
        ? getAlternativeCost(cardDef, pt.alternativeCostId)
        : undefined;
    // CR 702.74a — the chosen alt cost IS the card's Evoke cost (compared by
    // reference — `getAlternativeCost` resolves `def.evoke` for its own id):
    // the resulting stack item is tagged `evoked: true` below so the
    // "sacrifice this when it enters" trigger (`evokeTrigger`) fires.
    const isEvokeCost =
        chosenAltCost !== undefined && chosenAltCost === cardDef.evoke;
    // CR 702.109a — the chosen alt cost IS the card's Dash cost (compared by
    // reference — `getAlternativeCost` resolves `def.dash` for its own id):
    // the resulting stack item is tagged `dashed: true` below so the "gains
    // haste, returned to hand at the next end step" trigger (`dashTrigger`)
    // fires.
    const isDashCost =
        chosenAltCost !== undefined && chosenAltCost === cardDef.dash;
    // CR 702.103a — the chosen alt cost IS the card's Bestow cost (compared by
    // reference — `getAlternativeCost` resolves `def.bestow` for its own id).
    // Unlike `evoked`/`dashed` this is not just a marker for a later trigger:
    // `applyBestowCharacteristics` rewrites the resulting stack item into the
    // Aura enchantment CR 702.103b says it becomes.
    const isBestowCost = isBestowAlternativeCost(cardDef, chosenAltCost);
    // CR 601.2 / 307.1 / 117.1a / 601.3a (issue #2473) — the ANNOUNCEMENT-time
    // timing snapshot, taken in `announceCast` and ridden here on
    // `pendingTarget` (target selection is a separate mutation, so the board
    // this commit runs on is not the board the cast was announced on). Never
    // re-derived from `state`: see `PendingCast.castOffSorceryTiming`.
    const castOffSorceryTiming = pt.castOffSorceryTiming === true;

    // CR 702.34a — a Flashback cast pays the flashback cost from the graveyard
    // instead of the printed mana cost.
    const rawCost = castRawManaCost(state, cardInHand, castZone);
    const extraPer = cardDef.additionalGenericPerExtraTarget ?? 0;
    const additionalGeneric =
        extraPer > 0 ? Math.max(0, targets.length - 1) * extraPer : 0;
    // CR 118.9 — an alternative cost REPLACES the printed mana cost with its
    // own `mana` leg: `{}` (fully zeroed) for a pure non-mana give-up (Gush,
    // evoke), Dash's own amount (CR 702.109a) for a dash cast. The generic
    // mana-payment machinery below (pool-coverage check → immediate commit,
    // else park for `tapForPayment`) is unaffected by WHICH leg produced this
    // value — it always just pays `manaCost`.
    const manaCost = chosenAltCost
        ? normalizeManaCost(chosenAltCost.mana ?? {}, { chosenX })
        : rawCost
          ? normalizeManaCost(rawCost, { chosenX, additionalGeneric })
          : {};
    // CR 702.33a / 601.2f — a Kicker cast pays the kicker cost ON TOP of the
    // cost, as an ADDITIONAL cost. It composes with an ALTERNATIVE cost (CR
    // 118.9): the alt cost zeroes the printed mana (`manaCost` starts `{}`) and
    // is paid through its own non-mana legs (return/sacrifice/pay-life/exile),
    // while the kicker's mana still folds on top here — so a spell that is both
    // kicked AND alt-cast pays the kicker mana plus the alt cost, neither leg
    // clobbering the other. `foldKickerCosts` iterates only the PAID kickers, so
    // this is a no-op for a plain alt-cost cast. Folded BEFORE cost modifiers so
    // reductions/increases apply to the total (CR 601.2f).
    foldKickerCosts(manaCost, cardDef, kickerPayments);
    // CR 702.27a / 601.2f — mirrors the Kicker fold above for Buyback's
    // additional cost.
    foldBuybackCost(manaCost, cardDef, buybackPaid);
    // CR 601.3c / 601.2f — mirrors the two folds above for the
    // conditional-flash surcharge. Composes with an ALTERNATIVE cost the same
    // way Kicker does: the alt cost zeroes the printed mana and the surcharge
    // still joins the total, because it buys the TIMING, not the spell.
    // The fold itself lives in `gre/rules.ts`, shared with the Bot's enumerator
    // (`gre/moves.ts`), so the tap plan and the charged total cannot disagree.
    foldFlashSurchargeCost(
        manaCost,
        cardDef.flashSurcharge,
        flashSurchargePaid
    );
    applyCostModifiers(manaCost, getCostModifiers(state, cardInHand, "spell"));
    // CR 107.4f — resolve the Phyrexian pips ({B/P}, {U/P}) for this cast: the
    // pips paid with mana fold into the coloured mana cost (paid via the pool /
    // auto-tap like any pip); the pips paid with life add to `payLife` below. An
    // alternative cost zeroes the printed mana, so Phyrexian folding is skipped
    // there (no shipped card mixes the two). No-op for a non-Phyrexian cost.
    const phyrexianPayment = chosenAltCost
        ? { manaAdditions: {}, payLife: 0 }
        : resolvePhyrexianCastPayment(
              player,
              cardInHand,
              rawCost,
              chosenX,
              pt.phyrexianLifePips,
              state
          );
    for (const [c, n] of Object.entries(phyrexianPayment.manaAdditions)) {
        if (n && n > 0) manaCost[c] = (manaCost[c] ?? 0) + n;
    }
    // CR 601.2f / 118.5 — board-wide static NON-mana additional cost (Drought:
    // "Spells cost an additional 'Sacrifice a Swamp' for each black mana
    // symbol"). Gate on affordability at announcement; pip count comes from the
    // spell's PRINTED mana cost.
    assertStaticAdditionalCostAffordable(
        state,
        rawCost,
        cardInHand,
        player,
        "spell"
    );

    // CR 601.2b / 118.8 — the EFFECTIVE additional cost for this cast: the
    // declared spec with the caster's chosen `oneOf` leg flattened onto it.
    // Identity for every card without a disjunction, so each read below is
    // unchanged for them. Computed ONCE and used at every additional-cost site
    // in this commit, so no two sites can flatten differently.
    const effectiveAdditionalCosts = resolveAdditionalCosts(
        cardDef.additionalCosts,
        additionalCostLegId
    );

    // CR 601.2b / 118.4 / 119.4 — the card's OWN "pay X life" / "pay N life"
    // additional cost (Fire Covenant, Fumarole, Bitter Triumph's chosen life
    // leg), through the seam BOTH commit paths share. X was chosen at
    // announcement and rides on `pt.chosenX`; the life is paid the instant the
    // spell hits the stack (immediate or deferred commit below).
    const payLife =
        additionalCostLifePayment(effectiveAdditionalCosts, chosenX) +
        // CR 119.4 / 118.9 — the LIFE leg of the chosen alternative cost (Snuff
        // Out "pay 4 life", Force of Will "pay 1 life and exile a blue card").
        (chosenAltCost?.life ?? 0) +
        // CR 702.33a / 118.4 — the LIFE leg of every paid Kicker ("pay 3 life"),
        // an ADDITIONAL cost that joins the total rather than replacing it.
        kickerLifeCost(cardDef, kickerPayments) +
        // CR 107.4f — the life paid for Phyrexian pips chosen to be paid with
        // life (2 per pip). Dismember paying both {B/P} with life adds 4.
        phyrexianPayment.payLife +
        // CR 118.9-analog / 119.4 (issue #2398) — the life that REPLACES the
        // whole mana cost on a cast off the top of the library (Bolas's
        // Citadel). `castRawManaCost` already zeroed the mana half; this is
        // the other half of the same substitution. 0 for every other cast.
        (libraryTopCastPayment(state, cardInHand, castZone)?.life ?? 0);

    // CR 601.2c → 601.2f — targets have just been chosen; now the additional
    // cost is paid. A spell with both a target and an additional cost (FEM Soul
    // Exchange: target a graveyard creature, then exile a creature you control)
    // must open the additional-cost picker BEFORE mana, even when the pool
    // already covers the mana — otherwise the spell would commit without the
    // extra cost being paid. The picker carries the targets along on
    // pendingCast so the resolve still sees them (CR 118.8 / 601.2f).
    // CR 118.8 / 601.2f / 701.21a — assemble the cast's player-chosen filtered
    // sacrifices (own additional cost + Drought). The exile additional cost
    // still rides on `pendingCast.additionalCost`. A spell with an exile cost or
    // a non-fungible sacrifice choice parks BEFORE mana so the cost is chosen
    // and paid before the spell commits (Soul Exchange carries its targets too).
    const { selection: additionalSac, exilePicker } =
        buildCastSacrificeSelection(
            state,
            rawCost,
            cardInHand,
            player,
            effectiveAdditionalCosts,
            cardDef.name ?? "Sacrifice",
            castZone
        );
    // CR 118.9 — the chosen alternative cost (return/sacrifice N lands) is a
    // player-chosen filtered give-up, built as a `SacrificeSelection` and paid
    // through the SAME unified layer as every other cost sacrifice, so WHICH
    // permanents pay it is the caster's explicit choice (parks when real,
    // auto-resolves when forced/fungible).
    // CR 702.33a — a paid Kicker's PERMANENT leg (sacrifice two lands, return a
    // creature you control) joins that same selection, marked `explicit` so it is
    // never auto-picked (ADR 0079).
    //
    // The branch is decided by what the builder actually PRODUCES, never by "did
    // the alt cost / kicker produce a leg at all": `kickerCostLegs` yields one
    // entry per PAYMENT, so a mana-only Kicker — every shipped one — makes that
    // count positive while contributing NOTHING to the permanent picker.
    // Gating on it sent every kicked cast down this branch and silently
    // discarded `additionalSac`, i.e. Drought's "Sacrifice a Swamp" (CR 118.8)
    // went unpaid on a kicked spell (issue #1937). The builder returns
    // `undefined` when nothing contributes, so `?? additionalSac` keeps the
    // historical branch byte-identical for an unkicked or mana-only-kicked
    // cast — and, as of issue #1985, for an ALT-cost cast too:
    // `chosenAltCost` used to gate a SEPARATE branch that dropped
    // `additionalSac` unconditionally, on the premise that "alt-cost cards
    // carry no additional cost of their own" — true, but Drought's is a
    // BOARD-WIDE cost, not a card-owned one, so it applies to an alt-cost cast
    // exactly as it does to any other (CR 601.2f: additional costs apply to
    // "the total cost", whichever cost — mana or alternative — was chosen,
    // CR 118.9d). Snuff Out (`mmq/black.ts`, one black pip) cast under
    // Drought is the shipped repro: the Swamp used to survive the alt-cost
    // cast and the spell still reached the stack.
    //
    // Defence-in-depth (issue #1986, widened #1985): `announceCast`'s shared
    // prelude already ran the identical check (`assertKickerAnnouncementLegal`,
    // now alt-cost-aware too) before this spell's `pendingTarget` was ever
    // written, so a colliding composition — a Kicker OR an alt cost's own
    // permanent leg claiming the slot `additionalSac` also needs — can no
    // longer reach this line via the UI; a real cast either never opened
    // target selection, or (non-colliding) is guaranteed to pass here too.
    assertKickerPermanentSlotFree(
        cardDef,
        kickerPayments,
        additionalSac,
        chosenAltCost
    );
    const castPermSel = buildCastPermanentCostChoice(
        state,
        playerId,
        chosenAltCost,
        cardDef,
        kickerPayments,
        cardDef.name ?? (chosenAltCost ? "Alternative cost" : "Kicker")
    );
    const castSac = resolveCastPermanentSelection(castPermSel, additionalSac);
    // CR 118.9 — the HAND leg of the chosen alternative cost (Force of Will
    // "exile a blue card", Foil "discard an Island card and another card"). A
    // player-chosen filtered give-up FROM HAND, paid at commit through the
    // cast's `alternativeCostHandChoice` picker (parks when real, auto-resolves
    // when forced). None of these cards also carries a permanent leg, so the
    // two never coexist. CR 702.33a — a paid Kicker's HAND leg joins the same
    // picker. Same rule as the permanent selection above: the builder itself
    // returns `undefined` when no leg contributes, so no leg-count gate.
    // CR 118.8 / 701.9 / 702.81a — the card's OWN "discard a card" additional
    // cost and a RETRACE cast's "discard a land card" join the SAME picker (see
    // `buildCastHandCostChoice`'s `extraLegs`); the cast has one hand-cost slot
    // and an additional cost is paid alongside the mana cost, not instead of
    // it. `castExtraHandCostLegs` is the single authority on that list — see its
    // doc for why it is a function rather than a per-site ternary.
    const altHandChoice = buildCastHandCostChoice(
        player,
        chosenAltCost,
        cardDef,
        kickerPayments,
        cardInstanceId,
        castExtraHandCostLegs(effectiveAdditionalCosts, castSource)
    );
    // CR 702.34a / 118.5 — the flashback-only "Exile a <colour> card from your
    // hand" cost (generalized `FlashbackCost.exileFromHand`) also applies to a
    // TARGETED flashback cast (e.g. a Lava-Dart-shaped card that both targets
    // and pays exileFromHand). The no-target announce path builds this same
    // picker (`zone: "hand"`); a targeted flashback reaches its commit here
    // instead, AFTER target selection (CR 601.2c → 601.2f), so build the
    // picker here too and park on it before mana (issue #1038). Reuses the
    // exile-from-graveyard choice slot — a card never has both. Affordability
    // is gated by getLegalActions; this re-check is defence in depth.
    let castExileChoice: PendingCast["exileFromGraveyardChoice"];
    const fbHandSpec = getFlashbackAdditionalCost(cardInHand)?.exileFromHand;
    if (fbHandSpec && castZone === "graveyard") {
        const eligible = player.hand.filter((c) =>
            graveyardCardMatchesColor(c, fbHandSpec.color)
        );
        if (eligible.length < 1) {
            throw new Error(
                "No matching card in your hand to pay the flashback cost"
            );
        }
        castExileChoice = {
            count: 1,
            ...(fbHandSpec.color !== undefined
                ? { color: fbHandSpec.color }
                : {}),
            excludeInstanceId: cardInstanceId,
            zone: "hand",
        };
    }
    // CR 702.138a — the ESCAPE additional cost "exile N other cards from your
    // graveyard" also applies to a TARGETED escape cast (e.g. a Lightning Bolt
    // granted escape by Underworld Breach, cast from the graveyard at a target).
    // The no-target announce path builds this same picker; a targeted escape
    // reaches its commit here instead, AFTER target selection (CR 601.2c →
    // 601.2f), so build the picker here too and park on it before mana.
    const escExileSpec =
        castZone === "graveyard" && !castExileChoice
            ? getEscapeExileSpec(state, cardInHand)
            : undefined;
    if (escExileSpec) {
        const others = player.graveyard.filter((c) => c.id !== cardInstanceId);
        if ("minCardTypes" in escExileSpec) {
            if (countDistinctCardTypes(others) < escExileSpec.minCardTypes) {
                throw new Error(
                    "Not enough card types in your graveyard to pay the escape cost"
                );
            }
            castExileChoice = {
                count: 1,
                minCardTypes: escExileSpec.minCardTypes,
                excludeInstanceId: cardInstanceId,
            };
        } else {
            if (others.length < escExileSpec.count) {
                throw new Error(
                    "Not enough other cards in your graveyard to pay the escape cost"
                );
            }
            castExileChoice = {
                count: escExileSpec.count,
                excludeInstanceId: cardInstanceId,
            };
        }
    }
    // CR 702.66 / 601.2g — Delve (`payWith`, ADR 0063). Same twin as the escape
    // block above: a TARGETED delve spell reaches its commit here, after target
    // selection, so build the graveyard picker here too and park on it before
    // mana. Reuses the graveyard-exile picker slot — no delve card in the pool
    // also carries a flashback/escape exile cost.
    // CR 702.51 / 601.2g (issue #1338) — Convoke takes the FIRST payWith prompt:
    // it alone pays the coloured / hybrid pips and reduces the generic, so the
    // delve picker is built only AFTER the convoke pick lands
    // (`recordConvokeCreaturePick`). Build the convoke picker here; skip the
    // delve build when convoke is present (a convoke+delve card, Hogaak).
    const castConvokeChoice = spellHasConvoke(cardInHand)
        ? buildConvokeCreatureChoice(player, cardInHand, manaCost)
        : undefined;
    if (!castExileChoice && !castConvokeChoice) {
        castExileChoice = buildDelveExileChoice(
            player,
            cardInHand,
            manaCost,
            cardInstanceId,
            genericManaShortfall(player, cardInHand, manaCost, state)
        );
        // CR 601.2g (issue #1660) — collapse a fully-forced pick right here at
        // the commit seam (see `collapseForcedDelvePick`'s doc). No convoke on
        // this cast, so this is the ONLY leg — nothing else has to run first.
        collapseForcedDelvePick(
            player,
            cardInstanceId,
            castExileChoice,
            manaCost
        );
    }
    const parkForSacrifice =
        !!exilePicker ||
        !!castExileChoice ||
        !!castConvokeChoice ||
        (castSac !== undefined && !isSacrificeSelectionComplete(castSac)) ||
        (altHandChoice !== undefined && !altHandChoice.pickedCardIds);
    if (parkForSacrifice) {
        state.pendingCast = {
            playerId,
            cardInstanceId,
            manaCost,
            tappedLandIds: [],
            keepPriority,
            chosenX,
            ...(payLife > 0 ? { payLife } : {}),
            ...(kickerPayments ? { kickerPayments } : {}),
            ...(buybackPaid ? { buybackPaid: true } : {}),
            ...(chosenModeId ? { chosenModeId } : {}),
            // CR 601.2b / 118.8 — the record of WHICH additional-cost leg this
            // parked cast is paying; the cost itself is already folded into
            // `payLife` / `alternativeCostHandChoice` / the sacrifice selection.
            ...(additionalCostLegId ? { additionalCostLegId } : {}),
            ...(exilePicker ? { additionalCost: exilePicker } : {}),
            ...(castSac ? { sacrificeSelection: castSac } : {}),
            ...(castConvokeChoice
                ? { convokeCreatureChoice: castConvokeChoice }
                : {}),
            ...(castExileChoice
                ? { exileFromGraveyardChoice: castExileChoice }
                : {}),
            ...(altHandChoice
                ? { alternativeCostHandChoice: altHandChoice }
                : {}),
            ...(isEvokeCost ? { evoked: true } : {}),
            ...(isDashCost ? { dashed: true } : {}),
            // CR 702.103a (producer census, issue #2388) — a bestowed cast
            // that PARKS carries the choice here so the deferred commit
            // (`tryAutoCommitPendingCast`) still applies the CR 702.103b
            // characteristic change; same shape and same reason as
            // `evoked`/`dashed` above.
            ...(isBestowCost ? { bestowed: true } : {}),
            // CR 601.2 (issue #2473) — carry the announcement-time timing
            // snapshot one more hop, to the deferred commit.
            ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
        };
        (state.pendingCast as Record<string, unknown>).targets = targets;
        // CR 601.2g (issue #1660) — `castExileChoice` can come back from the
        // `collapseForcedDelvePick` call above already fully resolved (a
        // forced, zero-branch delve pick, `pickedCardIds` pre-filled) —
        // `buildDelveExileChoice` itself is a pure builder that never
        // resolves anything. There is nothing left for the player to decide,
        // so try to finish the cast right now instead of leaving a
        // picker-shaped `pendingCast` with no picker to show. A no-op (stays
        // parked) whenever mana isn't covered yet or something ELSE
        // genuinely still needs the player's input (real sacrifice/hand
        // choice, exile picker) — `tryAutoCommitPendingCast` re-checks every
        // gate itself.
        if (castExileChoice?.pickedCardIds) {
            tryAutoCommitPendingCast(state, playerId);
        }
        return;
    }

    // CR 106.6: a spell may also spend restriction-permitting mana —
    // creature mana (Metamorphosis) or artifact mana (Mishra's Workshop) —
    // in addition to the fungible pool. Eligibility is decided from the
    // spell's card types in restrictionAllowsSpell.
    // CR 205.4a (issue #1559) — the spell's printed supertypes, for the
    // `legendary-spell` restriction's eligibility check (Delighted Halfling).
    const cardSupertypes = cardDef.supertypes ?? [];
    if (
        Object.keys(manaCost).length === 0 ||
        isManaCostCovered(
            spendablePoolForSpell(
                player,
                cardDef.types,
                cardInstanceId,
                cardSupertypes
            ),
            manaCost,
            getManaSubstitutions(state, player.id)
        )
    ) {
        // CR 106.4 / 202.3 — cast-path mana-spent tracking (Soul Burn).
        let immediateNotedManaSpent: Record<string, number> | undefined;
        // CR 106.6 rider (issue #1559) — whether the mana paid below carried
        // `cantBeCounteredRider`; stamped onto the pushed stack item below.
        let immediateUsedRiderMana = false;
        if (Object.keys(manaCost).length > 0) {
            const payment = payCastManaCost(
                player,
                manaCost,
                cardDef,
                getManaSubstitutions(state, player.id),
                cardInstanceId
            );
            immediateUsedRiderMana = payment.usedRiderMana;
            immediateNotedManaSpent = payment.notedManaSpent;
            commitLandsForCost(player, manaCost);
        }
        // CR 601.2b / 118.4 — pay the "pay X life" additional cost as the spell
        // moves hand → stack (Fire Covenant). Affordability validated at
        // announcement; SBA handles a fatal payment.
        if (payLife > 0) player.life -= payLife;
        // CR 118.9 — pay the alternative-cost HAND leg's forced picks (Force of
        // Vigor's single green card when it's the only one, etc.) BEFORE the
        // cast card leaves the hand. A real (unforced) choice already parked
        // above; this branch is reached only when the picks are complete.
        if (altHandChoice?.pickedCardIds) {
            payAlternativeCostHandChoice(state, playerId, altHandChoice);
        }
        // CR 702.139 (issue #1392) — debit Lurrus's once-per-turn use now, at
        // commit, when it EXCLUSIVELY enabled this cast (see the matching
        // comment in `tryAutoCommitPendingCast`).
        if (castSource.viaGraveyardPermanentPermission) {
            markGraveyardPermanentCastUsed(state, playerId);
        }
        // issue #1156 — a cross-player exile grant removes from the ACTUAL
        // exile owner, not the caster.
        const card = removeFromZone(
            castZoneOwner(state, player, cardInstanceId, castZone),
            cardInstanceId,
            castZone
        );
        // CR 601.2f / 118.5 / 118.9 / 701.21a — pay the filtered give-up cost as
        // the spell hits the stack: the fungible/forced additional sacrifice
        // (Drought / own cost) OR the chosen alternative cost (return / sacrifice
        // lands, Thwart / Fireblast), whichever this cast owes. A non-fungible
        // choice already parked above; here it is complete and applied.
        const additionalSacrificeSnapshot = sacrificeSnapshotFromSelection(
            castSac,
            state
        );
        const stackItem: StackItem = {
            ...card,
            castById: playerId,
            targets,
            ...(chosenX !== undefined ? { chosenX } : {}),
            ...(kickerPayments ? { kickerPayments } : {}),
            ...(buybackPaid ? { buybackPaid: true } : {}),
            ...(divideAmounts ? { targetAmounts: divideAmounts } : {}),
            ...(chosenModeId ? { chosenModeId } : {}),
            ...(additionalSacrificeSnapshot
                ? { additionalSacrificeSnapshot }
                : {}),
            ...(immediateNotedManaSpent
                ? { notedManaSpent: immediateNotedManaSpent }
                : {}),
            // CR 106.6 rider (issue #1559) — see the matching comment on the
            // `tryAutoCommitPendingCast` stack item above.
            ...(immediateUsedRiderMana ? { dynamicCantBeCountered: true } : {}),
            ...(isEvokeCost ? { evoked: true } : {}),
            ...(isDashCost ? { dashed: true } : {}),
            // CR 601.2 (issue #2473) — targeted-spell immediate-commit branch
            // (mana already covered, no park). The announcement-time snapshot,
            // not a re-derivation; see `PendingCast.castOffSorceryTiming`.
            ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
            ...graveyardCastStackFlags(state, card, castZone),
            ...reboundCastStackFlags(card, castZone),
        };
        // CR 702.103b (issue #2388) — "as a spell cast bestowed is put onto
        // the stack, it becomes an Aura enchantment and gains enchant
        // creature". THIS is the branch a real bestow cast reaches: a bestowed
        // spell always targets (CR 303.4a), so it is announced through
        // `pendingTarget` and committed here or, when a cost still owes a
        // payment, through `tryAutoCommitPendingCast`. Applied on the built
        // item immediately before the push, so everything downstream of the
        // stack — the CR 608.2b re-check, the wire projection, cast triggers —
        // sees the Aura and never the creature.
        if (isBestowCost) applyBestowCharacteristics(stackItem);
        state.stack.push(stackItem);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, playerId);
        state.singleShotAutoPass = keepPriority ? undefined : playerId;
        // CR 601.2i / 603.3 — cast triggers go on the stack above the spell
        // before any player gets priority, so BEFORE the auto-pass drain (which
        // may otherwise start resolving the spell). See `commitPendingCast`.
        emitSpellCastEvent(state, stackItem);
        processPendingActionTriggers(state);
        drainAutoPasses(state);
    } else {
        state.pendingCast = {
            playerId,
            cardInstanceId,
            manaCost,
            tappedLandIds: [],
            keepPriority,
            chosenX,
            ...(kickerPayments ? { kickerPayments } : {}),
            ...(buybackPaid ? { buybackPaid: true } : {}),
            ...(divideAmounts ? { targetAmounts: divideAmounts } : {}),
            ...(payLife > 0 ? { payLife } : {}),
            ...(chosenModeId ? { chosenModeId } : {}),
            // CR 601.2b / 118.8 — the record of WHICH additional-cost leg this
            // parked cast is paying; the cost itself is already folded into
            // `payLife` / `alternativeCostHandChoice` / the sacrifice selection.
            ...(additionalCostLegId ? { additionalCostLegId } : {}),
            // Auto-resolved sacrifice (complete) rides along so the deferred
            // commit applies the chosen ids (CR 701.21a).
            ...(castSac ? { sacrificeSelection: castSac } : {}),
            // CR 601.2f / 118.8 / 702.81a (issue #2358 review, finding 1) — and
            // so does an auto-resolved HAND choice. This is the THIRD cast-
            // commit path: `parkForSacrifice` above only fires on an INCOMPLETE
            // hand choice, so a FORCED pick (exactly one land in hand for
            // retrace, exactly one card for Bitter Triumph's discard leg) falls
            // through it with `pickedCardIds` pre-filled; the immediate branch
            // above then pays it, but THIS branch — mana not yet covered —
            // simply dropped the field, and `tryAutoCommitPendingCast` reads
            // the choice off `pendingCast` and nowhere else. The cost was
            // therefore never charged. Same shape and same reason as the
            // no-target park's `alternativeCostHandChoice` (`announceCast`).
            ...(altHandChoice
                ? { alternativeCostHandChoice: altHandChoice }
                : {}),
            // CR 702.109a — a Dash cast whose mana isn't yet covered parks here
            // like any ordinary cast; `tryAutoCommitPendingCast` reads this back
            // off `pendingCast.dashed` once `tapForPayment` covers it.
            ...(isDashCost ? { dashed: true } : {}),
            // CR 702.103a (producer census, issue #2388) — a bestowed cast
            // that PARKS carries the choice here so the deferred commit
            // (`tryAutoCommitPendingCast`) still applies the CR 702.103b
            // characteristic change; same shape and same reason as
            // `evoked`/`dashed` above.
            ...(isBestowCost ? { bestowed: true } : {}),
            // CR 601.2 (issue #2473) — the announcement-time timing snapshot
            // rides through the payment park exactly like `dashed` above; it
            // must NOT be re-derived once `tapForPayment` has run (CR 605.4a).
            ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
        };
        // Targets ride along on pendingCast until payment completes.
        (state.pendingCast as Record<string, unknown>).targets = targets;
    }
}

/** CR 601.2f / 118.5 — affordability gate for board-wide static NON-mana
 *  additional costs (Drought). Throws (the cast/activation is illegal) when the
 *  announcing `player` controls too few permanents to pay the per-pip
 *  "sacrifice a <filter>" cost imposed on this spell/ability. Called at each
 *  announcement site, before entering the payment phase.
 *
 *  Exported (issue #1985) so a focused GRE-level test can drive the
 *  no-target alt-cost commit branch's REAL composition (this call,
 *  `buildCastSacrificeSelection`, `assertKickerPermanentSlotFree`,
 *  `buildCastPermanentCostChoice`, in the same order `announceCast` runs
 *  them) without going through the full mutation — the same reason
 *  `buildCastSacrificeSelection` and `assertKickerAnnouncementLegal` are
 *  already exported. The mutation ITSELF is also covered end to end, through
 *  `gameMutationHarness` (`alternative-cost.test.ts`, issue #1985 round 2). */
export function assertStaticAdditionalCostAffordable(
    state: GameState,
    rawManaCost: ManaCost | undefined,
    announced: CardInstanceState,
    player: PlayerState,
    kind: "spell" | "ability"
): void {
    const reqs = getStaticAdditionalSacrifices(
        state,
        rawManaCost,
        announced,
        kind
    );
    if (
        reqs.length > 0 &&
        !canAffordSacrifice(
            state,
            player.id,
            reqs.map((r) => ({ filter: r.filter, count: r.count }))
        )
    ) {
        throw new Error(
            "Can't pay the additional cost (not enough permanents to sacrifice)"
        );
    }
}

/** Builds the additional-cost picker descriptor for a spell's
 *  `additionalCosts` (CR 118.8 / 601.2f), validating up-front that the caster
 *  controls at least one legal permanent (the cast is illegal otherwise). Both
 *  the `sacrificeFilter` (sacrifice) and `exileFilter` (exile — Soul Exchange)
 *  forms route through the same picker; the `kind` decides whether the picked
 *  permanent is sacrificed or exiled at commit. Returns `undefined` when the
 *  card has no additional cost. Exported (not just used internally by
 *  `announceCast`) so integration tests can drive the exact production
 *  candidate-matching logic instead of a hand-mirrored copy (issue #944). */
export function buildAdditionalCostPicker(
    spec:
        | { sacrificeFilter?: PermanentFilter; exileFilter?: PermanentFilter }
        | undefined,
    player: PlayerState
): { kind: "sacrifice" | "exile"; filter: PermanentFilter } | undefined {
    const filter = spec?.sacrificeFilter ?? spec?.exileFilter;
    if (!filter) return undefined;
    const kind: "sacrifice" | "exile" = spec?.exileFilter
        ? "exile"
        : "sacrifice";
    // Effective colours are derived per-candidate via the layer system
    // (mirrors `tapOtherCandidates` above) so a `colors` filter (Natural
    // Order's "a green creature") reads the same colour the rest of the
    // engine sees, not the raw instance which carries no `colors` field.
    const candidates = player.battlefield.filter((c) => {
        const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
        return matchesPermanentFilter(view, filter, {
            selfControllerId: player.id,
        });
    });
    // CR 118.8 / 601.2f — with `getLegalActions` (convex/gre/rules.ts)
    // gating "cast" on additional-cost payability, `announceCast` never
    // reaches this function with zero legal candidates (`assertLegalAction`
    // rejects the mutation first). This throw is now an unreachable
    // invariant guard, kept as defense in depth.
    if (candidates.length === 0) {
        throw new Error("No legal permanent to pay the additional cost");
    }
    return { kind, filter };
}

/** CR 601.2f / 118.5 / 701.21a — assemble every filtered sacrifice a cast owes
 *  into one player-chosen selection: the card's own additional sacrifice cost
 *  (snapshot-flagged for Priest of Yawgmoth-style reads) plus any board-wide
 *  static additional sacrifice (Drought). Auto-resolves the fungible/forced
 *  board inline so trivial casts never prompt. The exile additional cost is NOT
 *  folded — it rides on `pendingCast.additionalCost` unchanged (Soul Exchange). */
export function buildCastSacrificeSelection(
    state: GameState,
    rawCost: ManaCost | undefined,
    announced: CardInstanceState,
    player: PlayerState,
    additionalCosts:
        | { sacrificeFilter?: PermanentFilter; exileFilter?: PermanentFilter }
        | undefined,
    reason: string,
    /** CR 601.3e / 702.34 — the zone this cast originates from. On a `"graveyard"`
     *  (flashback) cast the card's flashback-only "Sacrifice a <filter>" cost
     *  (Lava Dart) is folded into the selection; on any other zone it is
     *  ignored, so the flashback cost never leaks onto the hand cast. */
    castFromZone: CastFromZone
): {
    selection?: SacrificeSelection;
    exilePicker?: { kind: "exile"; filter: PermanentFilter };
} {
    const picker = buildAdditionalCostPicker(additionalCosts, player);
    const specs: SacrificeRequirement[] = [];
    let exilePicker: { kind: "exile"; filter: PermanentFilter } | undefined;
    if (picker) {
        if (picker.kind === "exile") {
            exilePicker = { kind: "exile", filter: picker.filter };
        } else {
            specs.push({ filter: picker.filter, count: 1, snapshot: true });
        }
    }
    // CR 702.34a / 118.8 — the flashback-only "Sacrifice a <filter>" cost, added
    // ONLY on a flashback (graveyard) cast. WHICH permanent is sacrificed is the
    // caster's explicit choice through the unified sacrificeChoice layer (never
    // auto-picked); exactly one is owed. Not snapshot-flagged (the flashback
    // resolve reads no sacrificed-permanent data).
    if (castFromZone === "graveyard") {
        const fbSacrifice = getFlashbackAdditionalCost(announced)?.sacrifice;
        if (fbSacrifice) {
            specs.push({ filter: fbSacrifice, count: 1 });
        }
    }
    for (const req of getStaticAdditionalSacrifices(
        state,
        rawCost,
        announced,
        "spell"
    )) {
        specs.push({ filter: req.filter, count: req.count });
    }
    const requirements = buildSacrificeRequirements(specs);
    let selection: SacrificeSelection | undefined;
    if (requirements.length > 0) {
        selection = { playerId: player.id, reason, requirements, picked: [] };
        autoResolveFungible(state, selection);
    }
    return { selection, exilePicker };
}

/** CR 601.2f / 601.2h — announcement-PRELUDE gate for a paid Kicker's
 *  permanent leg (CR 702.33a kicker — "sacrifice two lands", "return a creature you
 *  control") OR the chosen ALTERNATIVE cost's own permanent leg (CR 118.9 —
 *  Gush's "return two Islands", Fireblast's "sacrifice two Mountains")
 *  colliding with the cast's own additional-cost sacrifice (its own
 *  `additionalCosts`, or a board-wide one like Drought, CR 118.5): the cast has
 *  exactly ONE permanent-cost selection slot, and honouring both would mean
 *  silently mispaying one of them (`assertKickerPermanentSlotFree`'s own
 *  docstring). Neither `buildCastSacrificeSelection`'s inputs nor
 *  `hasKickerPermanentLeg`'s/`altCost.permanent`'s depend on which targets were
 *  chosen, so this runs identically for a targeted or an untargeted cast.
 *
 *  MUST be called from `announceCast`'s SHARED prelude — before the branch
 *  fork that writes `state.pendingTarget` (targeted) or `state.pendingCast`
 *  (untargeted) for the first time (issue #1986). Before this gate existed,
 *  the targeted path only discovered the collision downstream, in
 *  `finalizeTargetSelection`, called from a SEPARATE later mutation
 *  (`selectTarget`/`selectTargets`/`confirmTargets`) — by then a PRIOR
 *  mutation had already persisted `pendingTarget`, so the throw left the
 *  player stuck with a pending target selection that could never finalize
 *  (the soft-lock shape `game.ts`'s "gates belong in the prelude" convention,
 *  ADR 0047, exists to prevent). The untargeted no-target branch already ran
 *  this check before its own writes; it is unchanged.
 *
 *  Exported (not just inlined in `announceCast`) so integration tests can
 *  drive the identical composition the mutation runs, in the same order,
 *  without a convex-test mutation harness (ADR 0001) — see
 *  `additional-cost-cast.test.ts` for the established pattern. The downstream
 *  `assertKickerPermanentSlotFree` calls (in `finalizeTargetSelection` and
 *  the no-target branch here) remain as defence-in-depth; a real UI cast can
 *  no longer reach either of them with a colliding composition. */
export function assertKickerAnnouncementLegal(
    state: GameState,
    cardDef: CardDefinition,
    cardInHand: CardInstanceState,
    player: PlayerState,
    kickerPayments: KickerPayments | undefined,
    castFromZone: CastFromZone,
    /** CR 601.2b — the EFFECTIVE additional cost (the caster's chosen `oneOf`
     *  leg already flattened on, `resolveAdditionalCosts`). Passed in rather
     *  than re-read off `cardDef` so this prelude gate prices the same cost the
     *  commit downstream pays. */
    effectiveAdditionalCosts: AdditionalCostSpec | undefined,
    /** CR 118.9 — the chosen alternative cost, if any (issue #1985). Before
     *  this parameter existed, this gate skipped entirely whenever there was
     *  no Kicker, so an alt-cost-only cast whose alt cost carries its own
     *  permanent leg never had the collision checked at all — only the
     *  Kicker/own-sacrifice collision was guarded. */
    chosenAltCost?: CostLegs
): void {
    if (!kickerPayments && !chosenAltCost?.permanent) return;
    const rawCost = castRawManaCost(state, cardInHand, castFromZone);
    const { selection: ownSac } = buildCastSacrificeSelection(
        state,
        rawCost,
        cardInHand,
        player,
        effectiveAdditionalCosts,
        cardDef.name ?? "Sacrifice",
        castFromZone
    );
    assertKickerPermanentSlotFree(
        cardDef,
        kickerPayments,
        ownSac,
        chosenAltCost
    );
}

/** Apply a selection and extract the snapshot-flagged victim's mv/subtypes/power
 *  for the resulting stack item (CR 118.8 / 602.1 — Priest of Yawgmoth,
 *  Freyalise Supplicant). Shared by the cast and activation commit paths. */
function sacrificeSnapshotFromSelection(
    selection: SacrificeSelection | undefined,
    state: GameState
): StackItem["additionalSacrificeSnapshot"] | undefined {
    if (!selection) return undefined;
    const results = applySacrificeSelection(state, selection);
    const snap = results.find((r) => r.snapshot);
    if (!snap) return undefined;
    return {
        cardInstanceId: snap.id,
        mv: snap.mv,
        ...(snap.subtypes ? { subtypes: snap.subtypes } : {}),
        ...(snap.power !== undefined ? { power: snap.power } : {}),
    };
}

/** Snapshot the card a `cost.exileFromGraveyard` activation cost is about to
 *  exile, for the resulting stack item (CR 118.1 — the cost is paid at
 *  activation; CR 608.2h — the object is gone by the time the ability
 *  resolves, so an effect reading "the exiled card's mana value" must read a
 *  snapshot, never the live zone). Necropolis ("Exile a creature card from
 *  your graveyard: Put X +0/+1 counters on this creature, where X is the
 *  exiled card's mana value").
 *
 *  The exile twin of `sacrificeSnapshotFromSelection`, writing the SAME
 *  `StackItem.additionalSacrificeSnapshot` field — which is already the
 *  additional-cost-victim snapshot for both departures, sacrifice AND exile
 *  (Soul Exchange's `additionalCosts.exileFilter` fills it on the cast path),
 *  and is read back through the same `SpellContext.getAdditionalSacrificeMv` /
 *  `getAdditionalCostSubtypes`.
 *
 *  Taken ONLY for a single-card cost, matching `sacrificeFilterCount`'s own
 *  documented policy: "the exiled card" has no referent once the cost exiles
 *  two (Night Soil, Grim Lavamancer — neither reads one back). MUST be called
 *  BEFORE the cards leave the graveyard. */
function exileCostSnapshot(
    owner: PlayerState,
    pickedCardIds: string[]
): StackItem["additionalSacrificeSnapshot"] | undefined {
    if (pickedCardIds.length !== 1) return undefined;
    const exiled = owner.graveyard.find((c) => c.id === pickedCardIds[0]);
    if (!exiled) return undefined;
    const defId = (exiled.card as { id?: string }).id;
    const def = defId ? tryGetDefinition(defId) : undefined;
    return {
        cardInstanceId: exiled.id,
        mv: manaValue(def?.manaCost),
        ...(exiled.subtypes && exiled.subtypes.length > 0
            ? { subtypes: [...exiled.subtypes] }
            : {}),
    };
}

/** CR 602.1 / 118.5 / 701.21a — assemble every filtered sacrifice an activation
 *  owes into one player-chosen selection: the ability's own "sacrifice a
 *  <filter>" cost (snapshot-flagged) plus any board-wide static additional
 *  sacrifice (Drought — activated-ability form). Auto-resolves fungible boards
 *  inline. Returns undefined when the ability owes no filtered sacrifice. The
 *  ability's fixed self-sacrifice (`cost.sacrifice`) is NOT folded — it has no
 *  choice and stays on `sacrificeSource`. */
// `buildActivationSacrificeSelection` now lives in the pure engine
// (`gre/activationCostPicks.ts`) and is imported above: the bot's move
// enumerator needs the IDENTICAL selection to know which victims it must
// submit, and a second copy here is exactly how the two would drift.

/** CR 107.3 / 608.2g — counts cards of the given types in the casting player's
 *  opponents' graveyards (2-player: the single opponent). A card matches if its
 *  `types` include ANY of `cardTypes` (Spoils of War: "artifact and/or creature
 *  cards"), so a single artifact creature is counted once. Used to derive X at
 *  cast time for `additionalCosts.xFromOpponentGraveyard`. */
function countOpponentGraveyardCards(
    state: GameState,
    casterId: string,
    cardTypes: CardType[]
): number {
    let count = 0;
    for (const p of state.players) {
        if (p.id === casterId) continue;
        for (const card of p.graveyard) {
            if (cardTypes.some((t) => card.types.includes(t))) count += 1;
        }
    }
    return count;
}

/** Resolves a divide-as-you-choose total spec against the chosen / derived X
 *  (CR 601.2d / 120.4). `"X"` → X, `"X+1"` → X+1 (Meteor Shower), a number → the
 *  fixed total (Fiery Justice). A missing X is treated as 0. Never negative. */
function resolveDivideTotal(
    spec: number | "X" | "X+1",
    chosenX: number | undefined
): number {
    if (typeof spec === "number") return Math.max(0, spec);
    const x = chosenX ?? 0;
    return Math.max(0, spec === "X+1" ? x + 1 : x);
}

/** Step 1 of casting: announce the spell, enter payment phase (CR 601.2a). */
export const announceCast = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        /** If true, the caster keeps priority after the spell hits the stack
         *  (Ctrl-initiated cast). Default is to auto-skip the caster's next
         *  priority window so they don't respond to their own spell. */
        keepPriority: v.optional(v.boolean()),
        /** Value chosen for X at cast-time (CR 107.3, 601.2b). Required when
         *  the spell has `X: "X"` in its mana cost. */
        chosenX: v.optional(v.number()),
        /** CR 702.33 — which of this spell's optional Kickers to pay as it is
         *  cast, and how many times each, keyed by `KickerCost.id`
         *  (omitted/empty = don't kick). A single Kicker accepts 0 or 1; a
         *  Multikicker (CR 702.33e) accepts any non-negative integer. Two
         *  entries = "Kicker {A} and/or {B}" with both paid (ADR 0079). */
        kickerPayments: v.optional(v.record(v.string(), v.number())),
        /** CR 702.27 — whether to pay this spell's optional Buyback cost as it
         *  is cast (false/omitted = don't pay it). When true, the spell
         *  returns to its owner's hand instead of the graveyard as it
         *  resolves. */
        buyback: v.optional(v.boolean()),
        /** CR 601.3c — the caster's ACKNOWLEDGEMENT of this spell's
         *  conditional-flash surcharge ("You may cast this spell as though it
         *  had flash if you pay {2} more to cast it"). Unlike `buyback` this is
         *  not a choice the server obeys: whether the surcharge is owed is
         *  derived from the board (`flashSurchargeRequired`), because CR 601.3c
         *  makes it MANDATORY once the off-window cast is committed. The arg
         *  exists so the client can (a) be rejected for claiming a surcharge on
         *  a card that declares none, and (b) send an explicit `false` to
         *  DECLINE a cast whose only route is the surcharge. Omitted = "charge
         *  me whatever the rules say", which is what every non-UI caller sends. */
        payFlashSurcharge: v.optional(v.boolean()),
        /** Mode chosen for modal spells (CR 700.2 / 700.2c). Required when
         *  the card defines `modes`. */
        chosenModeId: v.optional(v.string()),
        /** CR 118.9 — id of a chosen ALTERNATIVE casting cost
         *  (`CardDefinition.alternativeCosts`). When set, the spell is cast by
         *  returning / sacrificing the named lands INSTEAD of paying its mana
         *  cost (Gush, Thwart, Fireblast). */
        alternativeCostId: v.optional(v.string()),
        /** CR 601.2b / 118.8 — which ADDITIONAL-cost leg to pay, by
         *  `AdditionalCostLeg.id`, when the card declares a caster-chosen
         *  disjunction (`additionalCosts.oneOf` — Bitter Triumph's "discard a
         *  card or pay 3 life"). REQUIRED for such a card and rejected for any
         *  other, mirroring `chosenModeId`. A plain mutation arg, not a
         *  `PendingChoice`: CR 601.2b puts this choice at ANNOUNCEMENT, before
         *  targets (601.2c) and before the total cost is locked in (601.2f), so
         *  it is collected by a client-side picker exactly like the modal mode
         *  and the alternative cost. */
        additionalCostLegId: v.optional(v.string()),
        /** CR 107.4f — how many of this cast's Phyrexian pips ({C/P}) to pay
         *  with LIFE (2 each); the rest are paid with the pip's colour of mana.
         *  Omitted → the engine auto-resolves to the most-life affordable split
         *  (the signature "pay 2 life" line). Clamped to `[0, pipCount]`. */
        phyrexianLifePips: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        // CR 702.35a — the owner accepted the reflexive Madness cast-choice by
        // casting the exiled card: consume the choice so the normal cast flow
        // (priority, targets, mana) runs. Must run BEFORE the priority /
        // pending-choice gates below — otherwise the pending choice would make
        // Expected Input "choice" (not "priority") and reject the cast. Only the
        // window's own card, cast by its owner, consumes it; any other action
        // leaves the choice pending (the owner can still Decline it).
        consumeMadnessCastChoice(state, args.playerId, args.cardInstanceId);
        // CR 702.88a — the caster accepted the reflexive Rebound cast-choice
        // by casting the exiled card: same early-consume shape as Madness
        // above, so the pending choice doesn't block the priority gate below.
        consumeReboundCastChoice(state, args.playerId, args.cardInstanceId);

        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });
        assertNoPendingChoices(state);
        const player = getPlayer(state, args.playerId);

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }
        if (state.pendingCast) {
            throw new ConvexError("Another spell is already being cast");
        }
        if (state.pendingActivation) {
            throw new Error("An ability is already being activated");
        }
        if (state.pendingTarget) {
            throw new Error("Target selection is in progress");
        }

        // CR 601.2 / 307.1 / 117.1a / 601.3a (issue #2473) — ANNOUNCEMENT is
        // the moment this snapshot is taken: "to cast a spell is to take it
        // from where it is, put it on the stack, and pay its costs", so the
        // board that decides whether "a sorcery could have been cast" is the
        // board as the proposal begins (CR 601.2a), before any target is
        // chosen, any mana ability is activated (CR 601.2g) or any cost is
        // paid (CR 601.2h). Everything below is downstream of that instant,
        // and a cast can span several mutations (target selection, mana
        // payment), so the value is computed ONCE here and threaded on
        // `pendingTarget` / `pendingCast` — the same shape `evoked`/`dashed`
        // use for the same deferred-commit boundary. Re-deriving it at commit
        // is provably wrong: `tapForPayment` →
        // `resolveManaAbilityTriggerImmediately` (CR 605.4a) can leave a
        // SUSPENDED triggered mana ability (Fertile Ground's colour pick) on
        // the stack when `tryAutoCommitPendingCast` runs in the same mutation.
        const castOffSorceryTiming = wasCastOffSorceryTiming(
            state,
            args.playerId
        );

        // CR 601.3e / 702.34 — a spell is normally cast from the hand, but Ice
        // Cauldron lets the noted card be cast from exile ("You may cast that
        // card for as long as it remains exiled"), and a Flashback card is cast
        // from the graveyard. Check hand, then castable exile, then flashback.
        const castSource = locateCastSource(state, player, args.cardInstanceId);
        const cardInHand = castSource.card;
        if (!cardInHand) throw new Error("Card not in hand");
        assertLegalAction(state, player, cardInHand, "cast");
        // CR 601.3e / 702.34 — the zone this cast originates from (hand, exile
        // for Ice Cauldron, or graveyard for Flashback). Used at commit for
        // `removeFromZone` and to override the cost with the flashback cost.
        const castFromZone = castSource.zone;

        const cardDef = getDefinition((cardInHand.card as { id: string }).id);
        // CR 205.4a (issue #1559) — the spell's printed supertypes, for the
        // `legendary-spell` restriction's eligibility check (Delighted
        // Halfling). Shared by every mana-coverage/payment call below.
        const cardSupertypes = cardDef.supertypes ?? [];

        // CR 118.9 — the caster opted into an ALTERNATIVE casting cost (return /
        // sacrifice lands, Gush/Thwart/Fireblast). Validate the variant exists
        // and is affordable at announcement; it is PAID at cast commit (in the
        // no-target branch here, or in finalizeTargetSelection for a targeted
        // spell), replacing the mana cost entirely. Illegal when the lands
        // aren't available.
        const chosenAltCost = args.alternativeCostId
            ? getAlternativeCost(cardDef, args.alternativeCostId)
            : undefined;
        if (args.alternativeCostId && !chosenAltCost) {
            throw new Error("Unknown alternative cost for this spell");
        }
        if (
            chosenAltCost &&
            !canPayAlternativeCost(
                state,
                args.playerId,
                chosenAltCost,
                args.cardInstanceId
            )
        ) {
            throw new Error("Can't pay the alternative cost");
        }
        // CR 601.2b (issue #2398) — "A player can't apply two alternative
        // methods of casting or two alternative costs to a single spell."
        // Casting off the top of the library under a permission that replaces
        // the mana cost with a life payment (Bolas's Citadel) IS such a
        // method, so no announced alternative cost may ride along with it —
        // otherwise the caster would pay the life AND the alt cost's legs
        // while `castRawManaCost` zeroed the mana for both. Fail CLOSED here,
        // at announcement, so neither commit path can reach a double payment.
        const libraryTopPayment = libraryTopCastPayment(
            state,
            cardInHand,
            castFromZone
        );
        if (chosenAltCost && libraryTopPayment) {
            throw new Error(
                "Can't apply an alternative cost to a spell cast from the top of your library"
            );
        }
        // CR 702.74a — the chosen alt cost IS the card's Evoke cost. Tags the
        // resulting stack item `evoked: true` at commit below so the
        // "sacrifice this when it enters" trigger fires.
        const isEvokeCost =
            chosenAltCost !== undefined && chosenAltCost === cardDef.evoke;
        // CR 702.109a — the chosen alt cost IS the card's Dash cost. Tags the
        // resulting stack item `dashed: true` at commit below so the "gains
        // haste, returned to hand at the next end step" trigger fires.
        const isDashCost =
            chosenAltCost !== undefined && chosenAltCost === cardDef.dash;
        // CR 702.103a — the chosen alt cost IS the card's Bestow cost. Two
        // things follow from it in this mutation, and neither is a plain
        // marker: the spell takes the "enchant creature" TARGET REQUIREMENT
        // (CR 702.103b/303.4a, `castAdjustedTargetRequirement` below), and the
        // stack item it eventually becomes is rewritten into an Aura
        // enchantment at the commit (`applyBestowCharacteristics`).
        const isBestowCost = isBestowAlternativeCost(cardDef, chosenAltCost);
        // CR 702.37a/c (issue #2705) — the chosen alt cost IS this card's morph
        // face-down cast. Like Bestow and unlike evoke/dash it is not a plain
        // marker: it strips the spell's target requirement (a face-down spell
        // has "no text", CR 702.37c — `castAdjustedTargetRequirement` below)
        // and it REWRITES the object put on the stack into a face-down 2/2
        // (`turnFaceDown` at each commit below).
        const isMorphCost = isMorphCastAlternativeCost(cardDef, chosenAltCost);

        // Validate X is provided iff the cost contains a string X (CR 107.3).
        const hasX =
            typeof (cardDef.manaCost as { X?: unknown } | undefined)?.X ===
            "string";
        // CR 107.3b (issue #2398) — "If a player is casting a spell that has an
        // {X} in its mana cost … and an effect lets that player cast that spell
        // while paying neither its mana cost nor an alternative cost that
        // includes X, then the only legal choice for X is 0." A cast off the
        // top of the library under a permission that REPLACES the mana cost
        // (Bolas's Citadel: pay life equal to mana value) is exactly that
        // effect, and CR 202.3e already prices the card at X = 0 off the stack,
        // so the life charged never covers a larger X. `hasX` is read off the
        // PRINTED cost (`cardDef.manaCost`) while `castRawManaCost` has already
        // replaced it with `{}` — so without this clamp the announced X owed
        // nothing at all anywhere: `normalizeManaCost({}, { chosenX })` adds no
        // mana and `libraryTopCastLifeCost` charges the off-stack mana value.
        // Announcing anything but 0 is illegal; announcing nothing is fine and
        // means 0 (the client no longer offers the dialog on this path).
        const xLockedToZero = hasX && libraryTopPayment !== undefined;
        if (xLockedToZero) {
            if (args.chosenX !== undefined && args.chosenX !== 0) {
                throw new Error(
                    "The only legal choice for X is 0 for a spell cast without paying its mana cost (CR 107.3b)"
                );
            }
        } else if (hasX && (args.chosenX === undefined || args.chosenX < 0)) {
            throw new Error("Must choose X (≥ 0) for this spell");
        }
        // CR 107.3 — a board-count upper bound on X ("X can't be greater than
        // the number of snow lands you control", Winter's Chill). Announcing a
        // larger X is illegal; the Bot's X enumeration (moves.ts) caps to the
        // same ceiling so the two never disagree.
        if (
            hasX &&
            cardDef.castXUpperBound === "snow-lands" &&
            args.chosenX !== undefined &&
            args.chosenX > countSnowLands(player.battlefield)
        ) {
            throw new Error(
                "X can't be greater than the number of snow lands you control"
            );
        }
        // CR 601.2b / 118.8 — a CASTER-CHOSEN additional cost ("As an
        // additional cost to cast this spell, discard a card or pay 3 life",
        // Bitter Triumph): the caster names exactly ONE leg here, at
        // announcement — before targets (CR 601.2c) and before the total cost
        // is locked in (CR 601.2f). Same required-iff-declared / unknown-id /
        // not-declared triad the `chosenModeId` block below uses, plus one rung
        // the modal case has no analogue for: CR 601.2h — an UNPAYABLE cost
        // can't be paid, so a named leg the caster cannot afford is rejected
        // outright rather than parking a cast that can never commit.
        const declaredLegs = additionalCostLegs(cardDef.additionalCosts);
        if (declaredLegs.length > 0) {
            if (!args.additionalCostLegId) {
                throw new Error(
                    `${cardDef.name} — must choose which additional cost to pay at announcement`
                );
            }
            const leg = declaredLegs.find(
                (l) => l.id === args.additionalCostLegId
            );
            if (!leg) {
                throw new Error(
                    `Unknown additional-cost leg "${args.additionalCostLegId}" for ${cardDef.name}`
                );
            }
            if (
                !canPayAdditionalCostSpec(
                    player,
                    resolveAdditionalCosts(cardDef.additionalCosts, leg.id),
                    args.cardInstanceId
                )
            ) {
                throw new Error("Can't pay that additional cost");
            }
        } else if (args.additionalCostLegId) {
            throw new Error(
                "Card declares no additional-cost choice — additionalCostLegId must not be supplied"
            );
        }
        // CR 601.2b — the EFFECTIVE additional cost for this cast: the declared
        // spec with the chosen leg flattened onto it. Identity for every card
        // without a disjunction. Every additional-cost read below this line
        // goes through it, so the announcement and the commit can never price
        // different legs.
        const effectiveAdditionalCosts = resolveAdditionalCosts(
            cardDef.additionalCosts,
            args.additionalCostLegId
        );

        // CR 601.2b / 118.4 — "pay X life" additional cost (Fire Covenant):
        // the caster chooses X independently of the mana cost. Validate it's
        // present, non-negative, and affordable from current life (you can't
        // pay more life than you have, CR 119.4). The life itself is paid at
        // cast commit (finalizeTargetSelection / no-target commit), CR 601.2h.
        const payXLife = effectiveAdditionalCosts?.payXLife === true;
        if (payXLife) {
            if (args.chosenX === undefined || args.chosenX < 0) {
                throw new Error("Must choose X (≥ 0) life to pay");
            }
            if (args.chosenX > player.life) {
                throw new Error("Cannot pay more life than you have");
            }
        }
        // CR 601.2b / 118.4 — a FIXED "pay N life" additional cost (Fumarole):
        // the cast is illegal if the caster's life is below N.
        const fixedPayLife = effectiveAdditionalCosts?.payLife ?? 0;
        if (fixedPayLife > 0 && player.life < fixedPayLife) {
            throw new Error("Cannot pay more life than you have");
        }
        // CR 107.3 / 608.2g — X derived from an opponent's graveyard at cast
        // time (Spoils of War). Computed by the engine, not chosen / paid.
        const gyDeriv = effectiveAdditionalCosts?.xFromOpponentGraveyard;
        const derivedGraveyardX = gyDeriv
            ? countOpponentGraveyardCards(
                  state,
                  args.playerId,
                  gyDeriv.cardTypes
              )
            : undefined;
        const chosenX = xLockedToZero
            ? // CR 107.3b — the announced value is forced to 0, never carried
              // through as `undefined`: every downstream consumer
              // (`pendingTarget.chosenX`, `pendingCast.chosenX`, the stack
              // item's X, `normalizeManaCost`) then reads the one legal value
              // instead of re-deriving it from a cost that no longer has an X.
              0
            : hasX
              ? args.chosenX
              : payXLife
                ? args.chosenX
                : derivedGraveyardX;

        // Modal spell — caster locks in a mode at announcement (CR 700.2c).
        // The chosen mode's targetRequirement / resolve drive the rest of
        // the announcement and resolution flow.
        //
        // CR 614.12a (ADR 0100 slice 2, issue #2019) — EXCEPT when the card
        // declares its pick as an as-enters choice ("As this creature enters,
        // choose a color" — Voice of All, Prismatic Ward, Quirion Elves,
        // Jihad). That clause is a CR 614.1c replacement effect, so the choice
        // is made "before the permanent enters the battlefield" on EVERY entry
        // path, and the CR 614 chokepoint raises it there. Taking it here too
        // would ask a cast copy twice. Fail-closed: a stale client that still
        // sends one is rejected rather than silently double-picking.
        let chosenMode: SpellMode | undefined;
        if (declaresAsEntersMode(cardDef)) {
            if (args.chosenModeId) {
                throw new Error(
                    `${cardDef.name} chooses its mode as it enters the battlefield (CR 614.12a) — chosenModeId must not be supplied at announcement`
                );
            }
        } else if (cardDef.modes && cardDef.modes.length > 0) {
            if (!args.chosenModeId) {
                throw new Error(
                    "Modal spell — must choose a mode at announcement"
                );
            }
            chosenMode = cardDef.modes.find((m) => m.id === args.chosenModeId);
            if (!chosenMode) {
                throw new Error(
                    `Unknown mode id "${args.chosenModeId}" for ${cardDef.name}`
                );
            }
        } else if (args.chosenModeId) {
            throw new Error(
                "Card is not modal — chosenModeId must not be supplied"
            );
        }

        // CR 702.33 — validate and canonicalize the optional PER-KICKER tally
        // chosen for this cast (undefined = not kicked). Throws for a kicker id
        // the card does not declare, a bad count, or a single (non-Multikicker)
        // kicker asked to be paid more than once (ADR 0079).
        const kickerPayments = resolveKickerPayments(
            cardDef,
            args.kickerPayments
        );
        // CR 702.33a / 601.2f — a Kicker cost is an additional cost of ANY kind,
        // so gate its NON-MANA legs (permanents to sacrifice/return, life, cards
        // from hand) at announcement, exactly as the alternative cost's legs are
        // gated above. The mana legs are folded into the total and priced by the
        // ordinary mana path.
        if (
            !canPayKickerLegs(
                state,
                player,
                cardDef,
                kickerPayments,
                args.cardInstanceId
            )
        ) {
            throw new Error("Can't pay the kicker cost");
        }
        // CR 601.2f / 601.2h — a paid Kicker's PERMANENT leg and the cast's own
        // additional-cost sacrifice claim the SAME single permanent-cost
        // selection slot; reject the collision HERE, in the shared prelude,
        // before either the targeted branch's `pendingTarget` write below or
        // the no-target branch's `pendingCast` write can run (issue #1986 —
        // this used to only throw downstream, in `finalizeTargetSelection`,
        // from a SEPARATE later mutation, by which point a prior mutation had
        // already persisted `pendingTarget` — a soft-lock).
        assertKickerAnnouncementLegal(
            state,
            cardDef,
            cardInHand,
            player,
            kickerPayments,
            castFromZone,
            effectiveAdditionalCosts,
            chosenAltCost
        );

        // CR 702.27 — validate and canonicalize the optional Buyback choice
        // for this cast (false = not paid). Throws for a card with no Buyback
        // cost.
        const buybackPaid = resolveBuybackChoice(cardDef, args.buyback);

        // CR 601.3c (issue #2146) — the conditional-flash surcharge verdict for
        // THIS cast, taken here at announcement (CR 601.2a) for exactly the
        // reason `castOffSorceryTiming` is, and for the rest of the cast read
        // only off `pendingTarget`/the folded `manaCost`. Derived from the
        // board, never from `args`: the surcharge is mandatory (CR 601.3c
        // prices the permission, it does not make it optional), so a client
        // that omits the flag still pays and a bot can never dodge it. The
        // client's declaration is validated — not obeyed — right after.
        const flashSurchargePaid = flashSurchargeRequired(
            state,
            args.playerId,
            cardInHand
        );
        assertFlashSurchargeDeclaration(
            cardDef,
            args.payFlashSurcharge,
            flashSurchargePaid
        );

        // For modal spells, the chosen mode's targetRequirement drives target
        // selection (CR 700.2d). Falls back to the kicker-adjusted card-level
        // requirement for non-modal spells — a kicked spell with a
        // `kickedTargetRequirement` (Bloodchief's Thirst, Tear Asunder) targets
        // its wider/different set (CR 702.33).
        const activeTargetRequirement =
            chosenMode?.targetRequirement ??
            castAdjustedTargetRequirement(
                cardDef,
                kickerPayments,
                isBestowCost,
                isMorphCost
            );

        // Check if the card requires targets (CR 601.2c). When `count: "X"`
        // resolves to 0 (X chosen as 0), the spell takes no targets — fall
        // through to the no-target cast path (CR 107.3, e.g. Volcanic
        // Eruption with X=0 destroys 0 Mountains and deals 0 damage).
        // CR 601.2d / 120.4 — divide-as-you-choose total. Resolve the budget
        // from the card's `divideAsChosen.total` against the chosen / derived
        // X. Used to cap the target count (each target needs ≥ 1) and to drive
        // the per-target amount UI.
        const divideTotal = activeTargetRequirement?.divideAsChosen
            ? resolveDivideTotal(
                  activeTargetRequirement.divideAsChosen.total,
                  chosenX
              )
            : undefined;
        let resolvedCount = activeTargetRequirement
            ? resolveTargetCount(activeTargetRequirement.count, chosenX)
            : undefined;
        // A divide spell can target at most `total` permanents (one point each,
        // CR 601.2d). Cap the open-ended `{ min }` count so the UI can't offer
        // more targets than there are points to assign.
        if (
            divideTotal !== undefined &&
            typeof resolvedCount === "object" &&
            resolvedCount.max === undefined
        ) {
            resolvedCount = { min: resolvedCount.min, max: divideTotal };
        }
        const requiresTargets =
            activeTargetRequirement !== undefined &&
            (typeof resolvedCount !== "number" || resolvedCount > 0) &&
            // A divide-as-you-choose spell with a zero total (Fire Covenant /
            // Meteor Shower with X = 0) takes no targets — CR 601.2d, there is
            // nothing to divide. Fall through to the no-target cast path.
            divideTotal !== 0 &&
            // CR 601.2c — an "up to X" range (`{ min: 0, max }`, Pest
            // Infestation / Force of Vigor) with a resolved max of 0 (X = 0,
            // or a fixed zero-width range) takes no targets, same as the
            // plain-number `resolvedCount > 0` check above. Without this, an
            // object-shaped `resolvedCount` always satisfied the first
            // clause regardless of its value, so X = 0 still routed into a
            // `{ min: 0, max: 0 }` target-selection banner the caster had to
            // Confirm past for no reason.
            (typeof resolvedCount !== "object" || resolvedCount.max !== 0);

        if (activeTargetRequirement && requiresTargets) {
            // CR 202.2 / 702.16b: source colors derived from the casting
            // card's mana cost, so getLegalTargets can exclude permanents
            // with protection from any of those qualities. Casting from hand
            // — the source is a spell (CR 113.3). All five characteristics
            // come from the ONE factory (CR 202.2 colours, 205.2 types, 205.3
            // subtypes, 205.4a supertypes), so none can be dropped.
            const castSource = targetingSourceFromCard(cardInHand, true);
            const legalTargets = getLegalTargets(
                state,
                activeTargetRequirement,
                castSource,
                args.playerId,
                chosenX
            );
            // CR 601.2c: must be able to choose enough legal targets. A
            // min-0 requirement ("up to X" / "up to N", Pest Infestation /
            // Force of Vigor) is legal to announce with ZERO legal targets
            // on the board — the sibling checks already get this right
            // (`hasEnoughLegalTargets`'s `required <= 0` early return,
            // gre/rules.ts, and the client hint's identical guard,
            // src/lib/card-utils.ts) — so `required` must be resolved
            // BEFORE deciding whether an empty legal-target set is fatal,
            // not after an unconditional throw on `legalTargets.length ===
            // 0`.
            const required = minTargetCount(resolvedCount!);
            if (legalTargets.length < required) {
                throw new Error(
                    legalTargets.length === 0
                        ? "No legal targets available"
                        : "Not enough legal targets"
                );
            }
            // CR 601.2c — a spell with additional INDEPENDENT target groups
            // (Fumarole's "target creature AND target land") is legal only if
            // EVERY group has enough legal candidates at announcement. Validate
            // each additional requirement up front so a half-chosen cast can't
            // strand on an unfillable second group. The groups are chosen in
            // order after the primary one; `remainingRequirements` queues them.
            // For a MODAL spell the groups come from the chosen mode (Hull
            // Breach's "Destroy target artifact and target enchantment",
            // issue #1953), mirroring how `activeTargetRequirement` above
            // prefers `chosenMode.targetRequirement` — a modal card keeps its
            // card-level requirements undefined by convention, so the `??`
            // chain reduces to the card-level list for every non-modal spell.
            const additionalRequirements =
                chosenMode?.additionalTargetRequirements ??
                cardDef.additionalTargetRequirements ??
                [];
            for (const extra of additionalRequirements) {
                const extraLegal = getLegalTargets(
                    state,
                    extra,
                    castSource,
                    args.playerId,
                    chosenX
                );
                if (
                    extraLegal.length <
                    minTargetCount(resolveTargetCount(extra.count, chosenX))
                ) {
                    throw new Error("Not enough legal targets");
                }
            }
            // Enter target selection phase before mana payment. The
            // requirement-derived filters come from the SAME builder the
            // additional-group path uses (`pendingTargetFiltersFromRequirement`
            // — also invoked by `applyRequirementToPendingTarget`), so the two
            // pending-target builders can never drift. The omission that once
            // dropped `spellStackKind` here — leaving Stifle's trigger target
            // un-clickable because the client saw `spellStackKind: undefined`
            // and treated a "target ability" as "target spell" (CR 113 /
            // 701.5a) — is now structurally impossible.
            state.pendingTarget = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                targetType: activeTargetRequirement.type,
                count: resolvedCount!,
                selected: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(kickerPayments ? { kickerPayments } : {}),
                ...(buybackPaid ? { buybackPaid: true } : {}),
                // CR 601.3c / 601.6a — the announcement-time surcharge verdict
                // rides target selection so the cost folded at commit is the
                // one the caster was quoted, whatever the board does in
                // between.
                ...(flashSurchargePaid ? { flashSurchargePaid: true } : {}),
                // CR 107.4f — carry the caster's Phyrexian mana-vs-life choice
                // through target selection so it is applied at cast commit
                // (finalizeTargetSelection → resolvePhyrexianCastPayment).
                ...(args.phyrexianLifePips !== undefined
                    ? { phyrexianLifePips: args.phyrexianLifePips }
                    : {}),
                ...(divideTotal !== undefined ? { divideTotal } : {}),
                ...(activeTargetRequirement.divideAsChosen?.kind
                    ? {
                          divideKind:
                              activeTargetRequirement.divideAsChosen.kind,
                      }
                    : {}),
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                // CR 118.9 — carry the chosen alternative cost through target
                // selection so it is paid at cast commit (finalizeTargetSelection).
                ...(args.alternativeCostId
                    ? { alternativeCostId: args.alternativeCostId }
                    : {}),
                // CR 601.2b / 118.8 — carry the chosen ADDITIONAL-cost leg
                // through target selection: the leg was picked at announcement
                // (CR 601.2b, before targets), but the cost is assembled and
                // paid at cast commit, which is a later mutation.
                ...(args.additionalCostLegId
                    ? { additionalCostLegId: args.additionalCostLegId }
                    : {}),
                // CR 601.2 (issue #2473) — carry the ANNOUNCEMENT-time timing
                // snapshot through target selection so the commit downstream
                // stamps the board this cast was proposed on, not the board it
                // finished paying on.
                ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
                ...pendingTargetFiltersFromRequirement(
                    activeTargetRequirement,
                    chosenX
                ),
                // CR 601.2c — queue the additional independent target groups
                // (Fumarole). selectTarget loads the next one when the current
                // group completes instead of finalizing.
                ...(additionalRequirements.length > 0
                    ? { remainingRequirements: additionalRequirements }
                    : {}),
            };

            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );

            return;
        }

        // CR 118.9 — no targets AND an alternative cost was chosen (Gush): pay
        // the land cost INSTEAD of mana. This wholly replaces the mana /
        // additional-cost path below (these cards have no additional cost of
        // their own). WHICH permanents pay is the caster's choice: the cost is a
        // `SacrificeSelection` routed through the unified layer — it parks the
        // cast when the choice is real (more matching lands than the count) and
        // resumes via `selectSacrifice`, or auto-resolves + commits immediately
        // when the choice is forced/fungible. CR 702.109a — Dash's alt cost
        // carries a real MANA leg instead (`altManaCost`, `{}` for every other
        // alt cost here): the immediate-commit branch below is reached only
        // once that mana is ALSO covered, mirroring the printed-cost pool-
        // coverage check the normal cast path uses below.
        if (chosenAltCost) {
            const altManaCost = normalizeManaCost(chosenAltCost.mana ?? {}, {
                chosenX,
            });
            // CR 702.33a / 601.2f — a Kicker is an ADDITIONAL cost, so it
            // composes with the alternative cost rather than being replaced by
            // it: the kicker's mana folds ON TOP of the alt cost's mana leg, and
            // its permanent / hand / life legs join the alt cost's in the same
            // pickers (ADR 0079).
            foldKickerCosts(altManaCost, cardDef, kickerPayments);
            // CR 601.3c / 601.2f (issue #2146 review, finding 3) — the
            // conditional-flash surcharge composes with an alternative cost the
            // same way the Kicker above does: the alt cost replaces the PRINTED
            // mana, the surcharge buys the TIMING and still joins the total.
            // The targeted commit path (`finalizeTargetSelection`) already
            // folded it onto an alt cost; without this the two no-target/
            // targeted commit paths priced the same cast differently. No shipped
            // card carries both `alternativeCosts` and `flashSurcharge` today,
            // so this is symmetry, not a live repair. (The `foldBuybackCost`
            // asymmetry beside it is pre-existing and left alone here — Buyback
            // and alternative costs likewise never co-occur on a shipped card.)
            foldFlashSurchargeCost(
                altManaCost,
                cardDef.flashSurcharge,
                flashSurchargePaid
            );
            // CR 601.2f / 118.8 — board-wide static NON-mana additional cost
            // (Drought) and the card's own additional-cost sacrifice (alt-cost
            // cards carry none today) apply to THIS cast exactly as they do to
            // a mana-paid one: CR 118.9d — "any additional costs … that affect
            // that spell are applied to that alternative cost." Gate on
            // affordability at announcement, mirroring the non-alt commit path
            // below; pip count comes from the spell's PRINTED mana cost. This
            // was missing entirely on this branch (issue #1985): an
            // unaffordable board-wide sacrifice slipped straight through.
            const rawCost = castRawManaCost(state, cardInHand, castFromZone);
            assertStaticAdditionalCostAffordable(
                state,
                rawCost,
                cardInHand,
                player,
                "spell"
            );
            // CR 118.8 / 601.2f / 701.21a — assemble the cast's player-chosen
            // filtered sacrifices (own additional cost + Drought), the SAME
            // builder every other commit path uses. `ownSac` merges by
            // FALLBACK with the alt cost's own permanent leg below (never by
            // concatenation) — see `assertKickerPermanentSlotFree`'s guard
            // just below for the genuine-collision case.
            const { selection: ownSac, exilePicker: altExilePicker } =
                buildCastSacrificeSelection(
                    state,
                    rawCost,
                    cardInHand,
                    player,
                    effectiveAdditionalCosts,
                    cardDef.name ?? "Sacrifice",
                    castFromZone
                );
            // Defence-in-depth (issue #1986, widened #1985): `announceCast`'s
            // shared prelude already ran the identical check
            // (`assertKickerAnnouncementLegal`, alt-cost-aware) before this
            // no-target branch was ever reached, so a colliding composition —
            // a Kicker OR this alt cost's own permanent leg claiming the same
            // slot `ownSac` needs — can no longer reach this line via the UI.
            assertKickerPermanentSlotFree(
                cardDef,
                kickerPayments,
                ownSac,
                chosenAltCost
            );
            const altChoice = buildCastPermanentCostChoice(
                state,
                args.playerId,
                chosenAltCost,
                cardDef,
                kickerPayments,
                cardDef.name ?? "Alternative cost"
            );
            // CR 601.2f / 118.8 / 118.9d (issue #1985) — trust what the builder
            // actually produced; fall back to the board-wide/own sacrifice
            // selection when the alt cost + Kicker legs yield nothing. Mirrors
            // `finalizeTargetSelection`'s targeted-path fix and the kicker-arm
            // template (`kickerPermSel ?? ownSac` below in the non-alt
            // branch). Before this fix, `altChoice` alone was committed as
            // `pendingCast.sacrificeSelection` unconditionally, so a plain
            // alt-cost cast (no Kicker, no permanent leg of its own — Snuff
            // Out's is life-only) silently dropped `ownSac`, i.e. Drought's
            // "Sacrifice a Swamp" (CR 118.8) went unpaid and unchecked.
            const castSac = resolveCastPermanentSelection(altChoice, ownSac);
            // CR 118.8 / 601.2f / 702.81a — the card's own hand-cost additional
            // leg and the retrace discard, through the SAME authority the other
            // two commit paths use. An ALTERNATIVE cost replaces the mana cost
            // (CR 118.9); it never discharges an ADDITIONAL one, so both still
            // apply here. Inert for every shipped card (none carries both an
            // alternative cost and a hand-leg additional cost, and no retrace
            // card in the pool has an alternative cost either) — it is here so
            // the three commit paths price the same cast identically, the same
            // symmetry argument as the flash-surcharge fold above.
            const altHandChoice = buildCastHandCostChoice(
                player,
                chosenAltCost,
                cardDef,
                kickerPayments,
                args.cardInstanceId,
                castExtraHandCostLegs(effectiveAdditionalCosts, castSource)
            );
            const altPayLife =
                (chosenAltCost.life ?? 0) +
                kickerLifeCost(cardDef, kickerPayments);
            const parkPerm =
                castSac !== undefined && !isSacrificeSelectionComplete(castSac);
            const parkHand =
                altHandChoice !== undefined && !altHandChoice.pickedCardIds;
            // CR 118.8 / 601.2f — a board-wide/own EXILE additional cost
            // (`buildCastSacrificeSelection`'s `exilePicker`) always parks,
            // the same way it does on the non-alt commit path below; no
            // shipped alt-cost card reaches this (they carry no additional
            // cost of their own, and Drought's is a sacrifice, not an exile),
            // so this is symmetry, not a live repair.
            const parkExile = !!altExilePicker;
            const altManaCovered =
                Object.keys(altManaCost).length === 0 ||
                isManaCostCovered(
                    spendablePoolForSpell(
                        player,
                        cardDef.types,
                        args.cardInstanceId,
                        cardSupertypes
                    ),
                    altManaCost,
                    getManaSubstitutions(state, player.id)
                );
            if (parkPerm || parkHand || parkExile || !altManaCovered) {
                // Park with the alt cost's mana leg (zeroed for every existing
                // zero-mana alt cost, Dash's own amount otherwise): the commit
                // gate in tryAutoCommitPendingCast fires once mana is covered
                // (via `tapForPayment`) AND the pick (if any) is complete,
                // applying the return / sacrifice / exile / discard (and life)
                // through the same path.
                state.pendingCast = {
                    playerId: args.playerId,
                    cardInstanceId: args.cardInstanceId,
                    manaCost: altManaCost,
                    tappedLandIds: [],
                    keepPriority: args.keepPriority,
                    chosenX,
                    ...(altPayLife > 0 ? { payLife: altPayLife } : {}),
                    ...(args.chosenModeId
                        ? { chosenModeId: args.chosenModeId }
                        : {}),
                    ...(kickerPayments ? { kickerPayments } : {}),
                    ...(castSac ? { sacrificeSelection: castSac } : {}),
                    ...(altExilePicker
                        ? { additionalCost: altExilePicker }
                        : {}),
                    ...(altHandChoice
                        ? { alternativeCostHandChoice: altHandChoice }
                        : {}),
                    ...(isEvokeCost ? { evoked: true } : {}),
                    ...(isDashCost ? { dashed: true } : {}),
                    // CR 702.103a (issue #2388 producer census) — a bestow
                    // cast cannot structurally reach this NO-TARGET branch: a
                    // bestowed spell is an Aura spell and always requires a
                    // target (CR 303.4a), so `requiresTargets` is true and
                    // `announceCast` routes it through `pendingTarget`.
                    // Stamped anyway, fail-closed: the flag is cheap and a
                    // silently dropped cast mode is not.
                    ...(isBestowCost ? { bestowed: true } : {}),
                    // CR 702.37c (issue #2705) — a morph cast REACHES this
                    // branch whenever the {3} isn't already covered by the
                    // pool: the face-down spell takes no targets, so it is
                    // always the no-target path, and the payment park is the
                    // ordinary case (three lands tapped one at a time). The
                    // flag rides to `tryAutoCommitPendingCast`, which turns the
                    // stack item face down there. The card itself stays in HAND
                    // while parked and so is never exposed to the opponent by
                    // `pendingCast` (which carries only a `cardInstanceId`).
                    ...(isMorphCost ? { morphed: true } : {}),
                    // CR 601.2 (issue #2473) — the announcement-time timing
                    // snapshot rides to the deferred commit.
                    ...(castOffSorceryTiming
                        ? { castOffSorceryTiming: true }
                        : {}),
                };
                await saveGameState(
                    ctx,
                    args.gameId,
                    gameState.seq + 1,
                    state,
                    gameState
                );
                return;
            }
            // Forced/fungible choice AND mana already covered: pay + apply +
            // commit now.
            // CR 106.6 rider (issue #1559) — stamped onto the stack item below.
            let altUsedRiderMana = false;
            // CR 106.4 / 702.44b (issue #2378) — the alternative-cost mana leg
            // (Dash's own amount, and any future non-zero alt cost) is real
            // mana spent on the spell's costs, so its per-colour record rides
            // the stack item exactly as the printed-cost paths' does.
            let altNotedManaSpent: Record<string, number> | undefined;
            if (Object.keys(altManaCost).length > 0) {
                const payment = payCastManaCost(
                    player,
                    altManaCost,
                    cardDef,
                    getManaSubstitutions(state, player.id),
                    args.cardInstanceId
                );
                altUsedRiderMana = payment.usedRiderMana;
                altNotedManaSpent = payment.notedManaSpent;
                commitLandsForCost(player, altManaCost);
            }
            if (castSac) sacrificeSnapshotFromSelection(castSac, state);
            if (altHandChoice?.pickedCardIds) {
                payAlternativeCostHandChoice(
                    state,
                    args.playerId,
                    altHandChoice
                );
            }
            if (altPayLife > 0) player.life -= altPayLife;
            // issue #1156 — a cross-player exile grant removes from the
            // ACTUAL exile owner, not the caster.
            const card = removeFromZone(
                castZoneOwner(state, player, args.cardInstanceId, castFromZone),
                args.cardInstanceId,
                castFromZone
            );
            const stackItem: StackItem = {
                ...card,
                castById: args.playerId,
                ...(chosenX !== undefined ? { chosenX } : {}),
                ...(kickerPayments ? { kickerPayments } : {}),
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                // CR 106.6 rider (issue #1559) — see the matching comment on
                // the `tryAutoCommitPendingCast` stack item.
                ...(altUsedRiderMana ? { dynamicCantBeCountered: true } : {}),
                // CR 106.4 / 202.3 / 702.44a (issue #2378) — the mana actually
                // spent, for Soul Burn's resolution and Sunburst's colour count.
                ...(altNotedManaSpent
                    ? { notedManaSpent: altNotedManaSpent }
                    : {}),
                ...(isEvokeCost ? { evoked: true } : {}),
                ...(isDashCost ? { dashed: true } : {}),
                // CR 702.103a (issue #2388 producer census) — unreachable for
                // bestow (an Aura spell always targets, CR 303.4a); stamped
                // fail-closed. `applyBestowCharacteristics` below turns it
                // into the real characteristic change if it ever IS reached.
                ...(isBestowCost ? { bestowed: true } : {}),
                // CR 601.2 (issue #2473) — `announceCast` no-target +
                // alternative-cost immediate-commit branch. Uses the same
                // announcement-time constant as every deferred path, so the
                // one-mutation and the many-mutation flows can never disagree.
                ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
            };
            // CR 702.103b — see `finalizeTargetSelection`'s matching call.
            if (stackItem.bestowed) {
                delete stackItem.bestowed;
                applyBestowCharacteristics(stackItem);
            }
            // CR 702.37c (issue #2705) — "Put it onto the stack (as a face-down
            // spell with the same characteristics)". The turn-down happens
            // BEFORE the push and before `emitSpellCastEvent` below, so a
            // "whenever a player casts a spell" trigger sees the face-down 2/2
            // with no name — which is what the spell IS at that moment — and so
            // the projection can never observe a face-up morph spell on the
            // stack even for one intermediate state.
            if (isMorphCost) turnFaceDown(stackItem);
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
            state.singleShotAutoPass = args.keepPriority
                ? undefined
                : args.playerId;
            // CR 601.2i / 603.3 — cast triggers before the auto-pass drain
            // (see `commitPendingCast`).
            emitSpellCastEvent(state, stackItem);
            processPendingActionTriggers(state);
            drainAutoPasses(state);
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        // No targets needed — proceed to additional-cost picker (CR 118.8 /
        // 601.2f) or directly to mana payment / cast if no additional cost.
        // CR 702.34a — a Flashback cast pays the flashback cost from the
        // graveyard instead of the printed mana cost.
        const rawCost = castRawManaCost(state, cardInHand, castFromZone);

        const manaCost = rawCost ? normalizeManaCost(rawCost, { chosenX }) : {};
        // CR 702.33a — fold the optional Kicker cost into the total (before cost
        // modifiers, CR 601.2f). No-op when the caster didn't kick.
        foldKickerCosts(manaCost, cardDef, kickerPayments);
        // CR 702.27a — fold the optional Buyback cost into the total the same
        // way. No-op when the caster didn't pay it.
        foldBuybackCost(manaCost, cardDef, buybackPaid);
        // CR 601.3c / 601.2f — fold the MANDATORY conditional-flash surcharge
        // into the total when this cast is only legal because of it (Rout,
        // Twilight's Call, Saproling Symbiosis — the no-target half of the
        // Invasion cycle). No-op inside the caster's own sorcery window: the
        // {2} is never payable for nothing.
        foldFlashSurchargeCost(
            manaCost,
            cardDef.flashSurcharge,
            flashSurchargePaid
        );
        applyCostModifiers(
            manaCost,
            getCostModifiers(state, cardInHand, "spell")
        );
        // CR 107.4f — resolve this no-target cast's Phyrexian pips (Phyrexian
        // Metamorph's {U/P}): mana-paid pips fold into `manaCost`, life-paid pips
        // become `phyrexianPayLife`, deducted at commit (immediate below, or via
        // `pendingCast.payLife` on the deferred / sacrifice-park paths). No-op
        // for a non-Phyrexian cost.
        const phyrexianPayment = resolvePhyrexianCastPayment(
            player,
            cardInHand,
            rawCost,
            chosenX,
            args.phyrexianLifePips,
            state
        );
        for (const [c, n] of Object.entries(phyrexianPayment.manaAdditions)) {
            if (n && n > 0) manaCost[c] = (manaCost[c] ?? 0) + n;
        }
        // CR 702.33a / 118.4 — the LIFE leg of every paid Kicker joins the
        // Phyrexian life on this cast's single life payment (ADR 0079).
        //
        // CR 601.2b / 118.4 / 119.4 — so does the card's OWN "pay N life" /
        // "pay X life" additional cost. This term was MISSING: the targeted
        // commit (`finalizeTargetSelection`) has always folded it, but a
        // NON-targeting spell reaches this branch instead and paid nothing —
        // Toxic Deluge's "pay X life" (c13, `payXLife`) was validated as
        // affordable at announcement and then never charged. The two commit
        // paths owe the same cost, so they now compute it through the SAME
        // seam (`additionalCostLifePayment`) rather than two hand-written
        // copies; the caster-chosen `oneOf` life leg (Bitter Triumph's "pay 3
        // life") rides it too, via the already-flattened
        // `effectiveAdditionalCosts`.
        const phyrexianPayLife =
            phyrexianPayment.payLife +
            kickerLifeCost(cardDef, kickerPayments) +
            additionalCostLifePayment(effectiveAdditionalCosts, chosenX) +
            // CR 118.9-analog / 119.4 (issue #2398) — the life that REPLACES
            // the whole mana cost on a cast off the top of the library
            // (Bolas's Citadel). `castRawManaCost` already zeroed the mana
            // half. 0 for every other cast; the accumulator keeps its historic
            // name because it is this cast's single life payment, whatever
            // legs contributed to it.
            (libraryTopCastPayment(state, cardInHand, castFromZone)?.life ?? 0);
        // CR 601.2f / 118.5 — board-wide static NON-mana additional cost
        // (Drought). Gate on affordability at announcement; pip count comes from
        // the spell's PRINTED mana cost.
        assertStaticAdditionalCostAffordable(
            state,
            rawCost,
            cardInHand,
            player,
            "spell"
        );

        // CR 118.8 / 601.2f / 701.21a — assemble the cast's player-chosen
        // filtered sacrifices (own additional cost + Drought). Exile rides on
        // `additionalCost`; a non-fungible sacrifice or an exile cost parks.
        const { selection: ownSac, exilePicker } = buildCastSacrificeSelection(
            state,
            rawCost,
            cardInHand,
            player,
            effectiveAdditionalCosts,
            cardDef.name ?? "Sacrifice",
            castFromZone
        );
        // CR 702.33a / 601.2f — the NON-MANA legs of every paid Kicker (ADR 0079).
        // A permanent leg becomes the cast's `SacrificeSelection`, marked
        // `explicit` so it always parks for the caster's own pick; a hand leg
        // becomes the cast's hand picker.
        //
        // The cast has ONE selection slot, so a Kicker permanent leg and the
        // cast's own additional-cost sacrifice (its own, or a board-wide one
        // like Drought) cannot both be honoured — `?? ownSac` would silently
        // drop the latter, i.e. mispay a cost. Fail CLOSED instead (the same
        // answer `resolveKickerPayments` gives a mixed sacrifice/return
        // composition); no printed card reaches it. No leg-COUNT gate: a
        // mana-only Kicker yields one entry per payment while contributing
        // nothing to either picker, and both builders already return `undefined`
        // when nothing contributes.
        //
        // Defence-in-depth (issue #1986): the shared prelude above already ran
        // the identical check (`assertKickerAnnouncementLegal`) before reaching
        // this no-target branch at all, so a colliding composition can no
        // longer reach this line via the UI.
        assertKickerPermanentSlotFree(cardDef, kickerPayments, ownSac);
        const kickerPermSel = buildCastPermanentCostChoice(
            state,
            args.playerId,
            undefined,
            cardDef,
            kickerPayments,
            cardDef.name ?? "Kicker"
        );
        const castSac = resolveCastPermanentSelection(kickerPermSel, ownSac);
        // CR 118.8 / 701.9 / 702.81a — the card's OWN "discard a card"
        // additional cost AND a retrace cast's "discard a land card" join the
        // cast's single hand-cost picker, exactly as they do on the targeted
        // commit path (`finalizeTargetSelection`) — same authority, same list.
        // The retrace half is the issue #2358 review's finding 1: this path
        // built the picker from the declared additional cost alone, so a
        // retrace cast of a NON-targeting spell (Wrath of God under the Wrenn
        // and Six emblem) committed with `alternativeCostHandChoice`
        // `undefined` and discarded no land at all.
        const kickerHandChoice = buildCastHandCostChoice(
            player,
            undefined,
            cardDef,
            kickerPayments,
            args.cardInstanceId,
            castExtraHandCostLegs(effectiveAdditionalCosts, castSource)
        );
        // CR 702.34a / 118.5 — Flash of Insight's flashback-only additional
        // cost "Exile X blue cards from your graveyard". Applies ONLY on a
        // flashback cast (from the graveyard); X = the announced chosenX.
        // Validate the caster's own graveyard holds enough matching cards
        // (excluding the flashback card itself, CR 601.2a), then open the
        // picker so commit gates on it. A zero-X flashback cast has no exile
        // cost (the spell looks at 0 cards).
        const fbExileSpec =
            effectiveAdditionalCosts?.flashbackExileFromGraveyard;
        let castExileChoice: PendingCast["exileFromGraveyardChoice"];
        if (
            fbExileSpec &&
            castFromZone === "graveyard" &&
            chosenX !== undefined &&
            chosenX > 0
        ) {
            if (
                !canPayFlashbackExile(
                    player,
                    chosenX,
                    fbExileSpec.color,
                    args.cardInstanceId
                )
            ) {
                throw new Error(
                    "Not enough matching cards in your graveyard to pay the flashback cost"
                );
            }
            castExileChoice = {
                count: chosenX,
                ...(fbExileSpec.color !== undefined
                    ? { color: fbExileSpec.color }
                    : {}),
                excludeInstanceId: args.cardInstanceId,
            };
        }
        // CR 702.34a / 118.5 — the flashback-only "Exile a <colour> card from
        // your hand" cost (generalized `FlashbackCost.exileFromHand`). Applies
        // ONLY on a flashback cast; the caster exiles exactly ONE matching card
        // from their own HAND via the same picker (`zone: "hand"`). Reuses the
        // exile-from-graveyard choice slot — a card never has both. Affordability
        // is gated by getLegalActions; this re-check is defence in depth.
        const fbHandSpec =
            getFlashbackAdditionalCost(cardInHand)?.exileFromHand;
        if (fbHandSpec && castFromZone === "graveyard" && !castExileChoice) {
            const eligible = player.hand.filter((c) =>
                graveyardCardMatchesColor(c, fbHandSpec.color)
            );
            if (eligible.length < 1) {
                throw new Error(
                    "No matching card in your hand to pay the flashback cost"
                );
            }
            castExileChoice = {
                count: 1,
                ...(fbHandSpec.color !== undefined
                    ? { color: fbHandSpec.color }
                    : {}),
                excludeInstanceId: args.cardInstanceId,
                zone: "hand",
            };
        }
        // CR 702.138a — the ESCAPE additional cost "Exile N other cards from
        // your graveyard" (Uro / Phlage / Underworld Breach fixed count,
        // Nethergoyf variable "any number … with N+ card types among them").
        // Applies ONLY on an escape (graveyard) cast; the caster exiles the cost
        // cards from their OWN graveyard, never the escaping card itself
        // (CR 702.138a escape, "other cards"). Reuses the flashback exile picker slot.
        const escExileSpec =
            castFromZone === "graveyard"
                ? getEscapeExileSpec(state, cardInHand)
                : undefined;
        if (escExileSpec && !castExileChoice) {
            const others = player.graveyard.filter(
                (c) => c.id !== args.cardInstanceId
            );
            if ("minCardTypes" in escExileSpec) {
                // Nethergoyf — need enough OTHER cards to muster the card-type
                // threshold, else the escape cost can't be paid (CR 702.138a).
                if (
                    countDistinctCardTypes(others) < escExileSpec.minCardTypes
                ) {
                    throw new Error(
                        "Not enough card types in your graveyard to pay the escape cost"
                    );
                }
                castExileChoice = {
                    count: 1,
                    minCardTypes: escExileSpec.minCardTypes,
                    excludeInstanceId: args.cardInstanceId,
                };
            } else {
                if (others.length < escExileSpec.count) {
                    throw new Error(
                        "Not enough other cards in your graveyard to pay the escape cost"
                    );
                }
                castExileChoice = {
                    count: escExileSpec.count,
                    excludeInstanceId: args.cardInstanceId,
                };
            }
        }
        // CR 702.66 / 601.2g — Delve (`payWith`, ADR 0063): "Each card you
        // exile from your graveyard while casting this spell pays for {1}."
        // Modeled as a Model-2 PRE-PAYMENT pending choice — the caster exiles
        // 0..max graveyard cards through the generalized graveyard-exile
        // picker (variable-offset mode), each offsetting one GENERIC pip of
        // the ALREADY-REDUCED cost (CR 601.2f runs first), and
        // `solveSmartAutoTap` then covers whatever remains. Arena-style prompt
        // policy: `buildDelveExileChoice` returns undefined when delve can do
        // nothing (empty graveyard, or an all-coloured remainder), so no
        // pointless picker appears. Reuses the flashback/escape picker slot —
        // no delve card in the pool also carries one of those exile costs.
        // CR 702.51 / 601.2g (issue #1338) — Convoke takes the FIRST payWith
        // prompt (see the targeted path); the delve picker is built only after
        // the convoke pick reduces the cost (`recordConvokeCreaturePick`).
        const castConvokeChoice = spellHasConvoke(cardInHand)
            ? buildConvokeCreatureChoice(player, cardInHand, manaCost)
            : undefined;
        if (!castExileChoice && !castConvokeChoice) {
            castExileChoice = buildDelveExileChoice(
                player,
                cardInHand,
                manaCost,
                args.cardInstanceId,
                genericManaShortfall(player, cardInHand, manaCost, state)
            );
            // CR 601.2g (issue #1660) — collapse a fully-forced pick right
            // here at the commit seam (see `collapseForcedDelvePick`'s doc).
            // No convoke on this cast, so this is the ONLY leg.
            collapseForcedDelvePick(
                player,
                args.cardInstanceId,
                castExileChoice,
                manaCost
            );
        }

        const parkForSacrifice =
            !!exilePicker ||
            !!castExileChoice ||
            !!castConvokeChoice ||
            // CR 702.33a — a Kicker HAND leg always parks: the discard/exile is
            // applied by the deferred commit's existing hand-cost path, so the
            // immediate branch below never has to duplicate it. A forced pick is
            // pre-filled, so `tryAutoCommitPendingCast` resumes at once.
            !!kickerHandChoice ||
            (castSac !== undefined && !isSacrificeSelectionComplete(castSac));
        if (parkForSacrifice) {
            // Open pendingCast in cost-picker mode. Commit is gated on the
            // sacrifice choice (and exile pickedId) being complete, regardless
            // of mana coverage.
            state.pendingCast = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                manaCost,
                tappedLandIds: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(kickerPayments ? { kickerPayments } : {}),
                ...(buybackPaid ? { buybackPaid: true } : {}),
                // CR 107.4f — Phyrexian life rides to the deferred commit.
                ...(phyrexianPayLife > 0 ? { payLife: phyrexianPayLife } : {}),
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                // CR 601.2b / 118.8 — the record of WHICH additional-cost leg
                // this parked cast is paying (the cost itself is already folded
                // into `payLife` / `alternativeCostHandChoice` / the sacrifice
                // selection above).
                ...(args.additionalCostLegId
                    ? { additionalCostLegId: args.additionalCostLegId }
                    : {}),
                ...(exilePicker ? { additionalCost: exilePicker } : {}),
                ...(castSac ? { sacrificeSelection: castSac } : {}),
                ...(castConvokeChoice
                    ? { convokeCreatureChoice: castConvokeChoice }
                    : {}),
                ...(castExileChoice
                    ? { exileFromGraveyardChoice: castExileChoice }
                    : {}),
                ...(kickerHandChoice
                    ? { alternativeCostHandChoice: kickerHandChoice }
                    : {}),
                // CR 601.2 (issue #2473) — the announcement-time timing
                // snapshot rides to the deferred commit.
                ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
            };

            // CR 601.2g (issue #1660) — `castExileChoice` can come back from
            // the `collapseForcedDelvePick` call above already fully
            // resolved (a forced, zero-branch delve pick, `pickedCardIds`
            // pre-filled) — `buildDelveExileChoice` itself is a pure builder
            // that never resolves anything. There is nothing left for the
            // player to decide, so try to finish the cast right now instead
            // of leaving a picker-shaped `pendingCast` with no picker to
            // show. A no-op (stays parked) whenever mana isn't covered yet
            // or something ELSE genuinely still needs the player's input
            // (real sacrifice/hand choice, exile picker) —
            // `tryAutoCommitPendingCast` re-checks every gate itself.
            if (castExileChoice?.pickedCardIds) {
                tryAutoCommitPendingCast(state, args.playerId);
            }

            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        // If cost is zero or pool already covers it, commit immediately.
        // CR 106.6: a spell may also spend restriction-permitting mana —
        // creature mana (Metamorphosis) or artifact mana (Mishra's Workshop).
        if (
            Object.keys(manaCost).length === 0 ||
            isManaCostCovered(
                spendablePoolForSpell(
                    player,
                    cardDef.types,
                    args.cardInstanceId,
                    cardSupertypes
                ),
                manaCost,
                getManaSubstitutions(state, player.id)
            )
        ) {
            // CR 106.6 rider (issue #1559) — stamped onto the stack item below.
            let normalUsedRiderMana = false;
            // CR 106.4 / 702.44b (issue #2378) — this branch commits the cast in
            // ONE mutation because the pool already covered the cost (the
            // caster floated the mana at priority, `tapUntap`). It used to skip
            // the mana-spent capture the parked path does, so a Sunburst
            // permanent cast this way entered with zero counters.
            let normalNotedManaSpent: Record<string, number> | undefined;
            if (Object.keys(manaCost).length > 0) {
                const payment = payCastManaCost(
                    player,
                    manaCost,
                    cardDef,
                    getManaSubstitutions(state, player.id),
                    args.cardInstanceId
                );
                normalUsedRiderMana = payment.usedRiderMana;
                normalNotedManaSpent = payment.notedManaSpent;
                commitLandsForCost(player, manaCost);
            }
            // CR 107.4f — pay the Phyrexian pips chosen as life as the spell
            // moves to the stack (Phyrexian Metamorph's {U/P} for 2 life).
            if (phyrexianPayLife > 0) player.life -= phyrexianPayLife;
            // CR 702.139 (issue #1392) — debit Lurrus's once-per-turn use
            // now, at commit, when it EXCLUSIVELY enabled this cast (see the
            // matching comment in `tryAutoCommitPendingCast`).
            if (castSource.viaGraveyardPermanentPermission) {
                markGraveyardPermanentCastUsed(state, args.playerId);
            }
            // issue #1156 — a cross-player exile grant removes from the
            // ACTUAL exile owner, not the caster.
            const card = removeFromZone(
                castZoneOwner(state, player, args.cardInstanceId, castFromZone),
                args.cardInstanceId,
                castFromZone
            );
            // CR 601.2f / 118.5 / 701.21a — pay the auto-resolved filtered
            // sacrifice (Drought / fungible own cost) as the spell commits.
            const additionalSacrificeSnapshot = sacrificeSnapshotFromSelection(
                castSac,
                state
            );
            const stackItem: StackItem = {
                ...card,
                castById: args.playerId,
                ...(chosenX !== undefined ? { chosenX } : {}),
                ...(kickerPayments ? { kickerPayments } : {}),
                ...(buybackPaid ? { buybackPaid: true } : {}),
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                ...(additionalSacrificeSnapshot
                    ? { additionalSacrificeSnapshot }
                    : {}),
                // CR 106.6 rider (issue #1559) — see the matching comment on
                // the `tryAutoCommitPendingCast` stack item.
                ...(normalUsedRiderMana
                    ? { dynamicCantBeCountered: true }
                    : {}),
                // CR 106.4 / 202.3 / 702.44a (issue #2378) — the mana actually
                // spent, for Soul Burn's resolution and Sunburst's colour count.
                ...(normalNotedManaSpent
                    ? { notedManaSpent: normalNotedManaSpent }
                    : {}),
                // CR 601.2 (issue #2473) — `announceCast` no-target +
                // normal-cost immediate-commit branch. Same announcement-time
                // constant as every deferred path.
                ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
                ...graveyardCastStackFlags(state, card, castFromZone),
                ...reboundCastStackFlags(card, castFromZone),
            };
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
            state.singleShotAutoPass = args.keepPriority
                ? undefined
                : args.playerId;
            // CR 601.2i / 603.3 — cast triggers before the auto-pass drain
            // (see `commitPendingCast`).
            emitSpellCastEvent(state, stackItem);
            processPendingActionTriggers(state);
            drainAutoPasses(state);
        } else {
            // Enter payment phase for remaining mana
            state.pendingCast = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                manaCost,
                tappedLandIds: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(kickerPayments ? { kickerPayments } : {}),
                ...(buybackPaid ? { buybackPaid: true } : {}),
                // CR 107.4f — the Phyrexian life is paid at the deferred commit
                // (finalizePendingCast reads `pendingCast.payLife`).
                ...(phyrexianPayLife > 0 ? { payLife: phyrexianPayLife } : {}),
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                // CR 601.2b / 118.8 — see the matching field on the
                // sacrifice-park write above.
                ...(args.additionalCostLegId
                    ? { additionalCostLegId: args.additionalCostLegId }
                    : {}),
                // Auto-resolved sacrifice (complete) rides along so the
                // deferred commit applies the chosen ids (CR 701.21a).
                ...(castSac ? { sacrificeSelection: castSac } : {}),
                // CR 601.2 (issue #2473) — the announcement-time timing
                // snapshot rides to the deferred commit. THIS is the park the
                // Fertile Ground counterexample goes through: `tapForPayment`
                // resumes it in a mutation whose stack may hold a suspended
                // triggered mana ability (CR 605.4a).
                ...(castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
            };
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** One payment item for the batched `tapForPayment` (issue #1779 / PRD #1776
 *  T4). */
export type TapPaymentInput = {
    cardInstanceId: string;
    /** Required for sources with manaChoices (duals, Birds of Paradise, Black Lotus). */
    manaChoiceIndex?: number;
};

/** Step 2: tap one or more lands during payment to add mana, in ONE
 *  transaction (issue #1779 / PRD #1776 T4 — was one mutation per land).
 *  Applies each entry of `payments` IN ORDER, re-running the auto-commit
 *  check after each so a batch produces the IDENTICAL terminal state to the
 *  same calls made one at a time. Validation stays per-step: the FIRST
 *  illegal payment throws, which aborts the whole batch — nothing is
 *  persisted (`saveGameState` runs once, at the end).
 *
 *  CR correctness (issue #1779 review finding 1): the per-item tap MUST go
 *  through `tapSourceIntoPayment` — the SAME primitive
 *  `tapForActivationPayment` / `autoTapForPayment` / `autoTapForAttackTax`
 *  call and ~30 card test files exercise directly. An earlier revision of
 *  this loop reimplemented the tap mechanics inline (`applyOneTapPayment`)
 *  and silently dropped every inline rider: `isTapLockedBySummoningSickness`
 *  (CR 302.1), `manaChoiceRemovesCounters` / `payRemoveCounterCost` (CR
 *  122.6, Mana Battery), `armDelayedTriggerOnTap` (ADR 0040, Rainbow Vale),
 *  `applyDrawCardOnTap`, `recordLifePaidOnTap`, `realizeManaAbilityTapBonus`
 *  (Wild Growth) — and the unconditional self-damage rider (Ancient Tomb):
 *  tapping it through the divergent copy cost 0 life instead of 2 (CR
 *  605.1a / 106.4). There must be only ONE authority for this mechanic. */
export const tapForPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        payments: v.array(
            v.object({
                cardInstanceId: v.string(),
                manaChoiceIndex: v.optional(v.number()),
            })
        ),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        if (args.payments.length === 0) {
            throw new Error("payments must include at least one entry");
        }
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        for (const payment of args.payments) {
            if (!state.pendingCast) throw new Error("No spell being cast");
            if (state.pendingCast.playerId !== args.playerId) {
                throw new Error("Not your pending cast");
            }
            const player = getPlayer(state, args.playerId);
            const card = player.battlefield.find(
                (c) => c.id === payment.cardInstanceId
            );
            if (!card) throw new Error("Card not on battlefield");
            // CR 602.5b (issue #947) — an un-imprinted Chrome Mox (or any
            // source whose mana ability's `canActivate` currently fails) has
            // no usable mana ability at all; reject cleanly rather than
            // falling through to a mana-choice resolution that has nothing
            // to resolve.
            if (!hasManaAbility(card, state)) {
                throw new Error("Card has no mana ability to tap");
            }
            // Issue #1779 review finding 1 — the SHARED per-item tap
            // primitive (see the doc comment above), not a second copy of
            // its mechanics.
            tapSourceIntoPayment(
                state,
                player,
                card,
                payment.manaChoiceIndex,
                state.pendingCast.tappedLandIds
            );
            // Check if cost is now covered → auto-commit, exactly like the
            // per-call path did after every single tap.
            tryAutoCommitPendingCast(state, args.playerId);
            // A completed cast has nothing left to pay for; further batch
            // entries (over-supplied by a stale client plan) are simply
            // ignored rather than erroring an already-successful cast — see
            // the "batch vs. separate-call over-supply" decision covered by
            // `tapForPaymentBatch.test.ts` (issue #1779 review finding 4).
            if (!state.pendingCast) break;
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Untap a land during payment (undo). */
export const untapForPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        // Only lands tapped during this payment can be untapped
        const idx = state.pendingCast.tappedLandIds.indexOf(
            args.cardInstanceId
        );
        if (idx === -1) {
            throw new Error("This land was not tapped during this cast");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) {
            throw new Error("Cannot undo: source was sacrificed");
        }

        // CR 106.6 (issue #1559 review) — restriction-aware refund: reverses
        // the parallel `restrictedMana` deposit (with its rider) instead of
        // always assuming the fungible pool.
        if (card.chosenMana) {
            refundChosenManaOutput(player, card);
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (!manaColor) throw new Error("Card does not produce mana");
            refundFixedManaOutput(player, card, manaColor);
        }

        // CR 605.4 — refund the Wild-Growth-style bonus mana this tap added.
        refundTapBonusMana(player, card);
        card.isTapped = false;
        discardPermanentTappedEvent(state, card.id);
        state.pendingCast.tappedLandIds.splice(idx, 1);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Resolves the `CardDefinition` of the card a `PendingCast` is casting —
 *  shared lookup for the two Improvise mutations below (mirrors the inline
 *  lookup `tryAutoCommitPendingCast` already does for the same purpose). */
function castDefinitionForPendingCast(
    state: GameState,
    player: PlayerState,
    pc: PendingCast
): CardDefinition | undefined {
    const castSource = locateCastSource(state, player, pc.cardInstanceId);
    const castCard = castSource.card;
    return castCard
        ? (tryGetDefinition((castCard.card as { id: string }).id) ?? undefined)
        : undefined;
}

/** Tap an untapped ARTIFACT `card` toward the generic portion of `pc`'s cost
 *  (CR 702.126 — Improvise). Full validate+mutate, called by BOTH the
 *  `tapArtifactForImprovise` mutation below and the integration tests
 *  directly (mirrors `tapSourceIntoPayment`'s shape) — a test exercising this
 *  function IS the mutation's real behavior, not a hand-mirrored replica.
 *
 *  Unlike a mana-source tap, this does NOT add to the mana pool — it directly
 *  reduces `pc.manaCost.X` (the normalized generic cost, CR 702.126a "rather
 *  than pay that mana"), the same field the `reductionGeneric` cost-modifier
 *  clamp in `applyCostModifiers` reduces. `isManaCostCovered` /
 *  `tryAutoCommitPendingCast` need no Improvise-specific branch as a result —
 *  they just see a smaller generic requirement. */
export function tapArtifactIntoImprovisePayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    pc: PendingCast
): void {
    // CR 702.126a — Improvise applies only to a spell that declares the
    // keyword; the guard test (mechanicsRegistry.test.ts, Guard A) already
    // ensures every shipped card naming it is backed by this binding.
    const castDef = castDefinitionForPendingCast(state, player, pc);
    if (!castDef?.staticAbilities?.includes("improvise")) {
        throw new Error("This spell does not have improvise");
    }

    // CR 702.126a — "for each generic mana in this spell's total cost": an
    // Improvise tap can only ever offset GENERIC mana, never a colored pip,
    // so there must be generic cost left to redirect.
    const remainingGeneric = pc.manaCost.X ?? 0;
    if (remainingGeneric <= 0) {
        throw new Error("No generic cost remains to pay with Improvise");
    }

    // CR 702.126b — only an untapped artifact the caster controls is a legal
    // source; not necessarily a MANA-producing artifact (that distinction is
    // what makes Improvise different from just tapping a mana rock — it's
    // the artifact TYPE that qualifies it, not a mana ability). Summoning
    // sickness (CR 302.6) doesn't gate this: tapping for Improvise isn't
    // activating a {T} ability, the same principle Convoke (CR 702.51a)
    // applies to creatures.
    if (!card.types.includes("Artifact")) {
        throw new Error("Improvise can only tap an artifact");
    }
    if (card.isTapped) throw new Error("Card already tapped");

    card.isTapped = true;
    emitPermanentTapped(state, card, false);
    pc.improviseTappedArtifactIds = [
        ...(pc.improviseTappedArtifactIds ?? []),
        card.id,
    ];
    const reduced = remainingGeneric - 1;
    if (reduced > 0) pc.manaCost.X = reduced;
    else delete pc.manaCost.X;
}

/** Undo a tap `tapArtifactIntoImprovisePayment` made during THIS payment
 *  (CR 702.126). Mirrors `untapForPayment`: restores the {1} of generic cost
 *  the tap had covered and drops the queued tap event so no "becomes tapped"
 *  trigger fires for a tap backed out of before committing. */
export function untapArtifactFromImprovisePayment(
    state: GameState,
    card: CardInstanceState,
    pc: PendingCast
): void {
    const idx = (pc.improviseTappedArtifactIds ?? []).indexOf(card.id);
    if (idx === -1) {
        throw new Error(
            "This artifact was not tapped for Improvise during this cast"
        );
    }
    card.isTapped = false;
    discardPermanentTappedEvent(state, card.id);
    pc.improviseTappedArtifactIds!.splice(idx, 1);
    pc.manaCost.X = (pc.manaCost.X ?? 0) + 1;
}

/** Tap an untapped artifact to pay for {1} of the generic portion of the
 *  spell currently being cast (CR 702.126 — Improvise). Thin ctx/db wrapper
 *  around `tapArtifactIntoImprovisePayment` — see that function for the real
 *  logic. Each tap is immediate and freely reversible
 *  (`untapArtifactForImprovise`) until the cast commits or is
 *  cancelled/abandoned (`rollbackPendingCast`), mirroring the land-tap
 *  payment flow (`tapForPayment`/`untapForPayment`). */
export const tapArtifactForImprovise = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        const pc = state.pendingCast;
        if (!pc) throw new Error("No spell being cast");
        if (pc.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        tapArtifactIntoImprovisePayment(state, player, card, pc);

        // Check if cost is now covered → auto-commit
        tryAutoCommitPendingCast(state, args.playerId);
        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Untap an artifact tapped for Improvise during this payment (undo). Thin
 *  ctx/db wrapper around `untapArtifactFromImprovisePayment`. */
export const untapArtifactForImprovise = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        const pc = state.pendingCast;
        if (!pc) throw new Error("No spell being cast");
        if (pc.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) {
            throw new Error("Cannot undo: source left the battlefield");
        }

        untapArtifactFromImprovisePayment(state, card, pc);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** The single sacrifice selection currently awaiting `playerId`'s choice, and
 *  which in-flight container holds it (CR 701.21a). At most one is active. */
export function findActiveSacrificeSelection(
    state: GameState,
    playerId: string
): {
    sel: SacrificeSelection;
    container: "cast" | "activation" | "attack";
} | null {
    const pc = state.pendingCast;
    if (
        pc &&
        pc.playerId === playerId &&
        pc.sacrificeSelection &&
        !isSacrificeSelectionComplete(pc.sacrificeSelection)
    ) {
        return { sel: pc.sacrificeSelection, container: "cast" };
    }
    const pa = state.pendingActivation;
    if (
        pa &&
        pa.playerId === playerId &&
        pa.sacrificeSelection &&
        !isSacrificeSelectionComplete(pa.sacrificeSelection)
    ) {
        return { sel: pa.sacrificeSelection, container: "activation" };
    }
    const at = state.combat?.pendingAttackSacrifice;
    if (at && at.playerId === playerId && !isSacrificeSelectionComplete(at)) {
        return { sel: at, container: "attack" };
    }
    return null;
}

/** CR 701.21a — the sacrificing player picks one permanent to sacrifice. Routes
 *  to whichever in-flight action is awaiting this player's sacrifice choice
 *  (cast, activation, or attack-declaration tax — exactly one is active). When
 *  the choice completes, resumes the parked action. */
export function selectSacrificeOnState(
    state: GameState,
    args: { playerId: string; cardInstanceId: string }
): void {
    assertGameNotOver(state);

    // The container decides the Expected Input this pick belongs to
    // (ADR 0047). A cast/activation sacrifice is paid inside a priority
    // window (the payer holds priority), so it expects `priority`. The
    // attack-declaration land tax (CR 508.1c/1g) is a parked turn-based
    // action, not a priority window, so it expects `sacrifice` — the gate
    // then rejects any competing priority action (endTurn / passPriority /
    // casting) until the pick clears. Determining the container is
    // read-only, so it may precede the gate.
    const active = findActiveSacrificeSelection(state, args.playerId);
    if (!active) throw new Error("No sacrifice choice awaiting you");
    const { sel, container } = active;
    assertExpectedInput(state, {
        playerId: args.playerId,
        expect: container === "attack" ? "sacrifice" : "priority",
    });
    if (!isSacrificeCandidateLegal(state, sel, args.cardInstanceId)) {
        throw new Error("Selected permanent is not a legal sacrifice");
    }
    sel.picked.push(args.cardInstanceId);

    if (isSacrificeSelectionComplete(sel)) {
        if (container === "cast") {
            // tryAutoCommitPendingCast applies the selection + finalizes when
            // mana is also covered (else the player keeps tapping lands).
            tryAutoCommitPendingCast(state, args.playerId);
        } else if (container === "activation") {
            tryAutoCommitPendingActivation(state, args.playerId);
        } else {
            // Attack tax: apply and finalize the declaration (the cast /
            // activation resume paths apply internally; this one does not).
            applySacrificeSelection(state, sel);
            if (state.combat) {
                state.combat.pendingAttackSacrifice = undefined;
            }
            finalizeConfirmAttackers(state);
        }
    }
}

export const selectSacrifice = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        selectSacrificeOnState(state, {
            playerId: args.playerId,
            cardInstanceId: args.cardInstanceId,
        });

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** The generic-spend choice (CR 601.2g) currently awaiting `playerId`, and which
 *  in-flight park (cast / activation) holds it. At most one is active — mirrors
 *  `findActiveSacrificeSelection`. */
export function findActiveManaSpendChoice(
    state: GameState,
    playerId: string
): {
    choice: GenericSpendAmbiguity;
    container: "cast" | "activation";
} | null {
    const pc = state.pendingCast;
    if (pc && pc.playerId === playerId && pc.manaSpendChoice) {
        return { choice: pc.manaSpendChoice, container: "cast" };
    }
    const pa = state.pendingActivation;
    if (pa && pa.playerId === playerId && pa.manaSpendChoice) {
        return { choice: pa.manaSpendChoice, container: "activation" };
    }
    return null;
}

/** CR 601.2g — the player chooses which mana in their pool pays a generic cost
 *  when the choice is meaningful. `spendOrder` is a colour multiset, one entry
 *  per point of the owed generic: its length must equal `generic`, every element
 *  must be one of the parked `candidateColors`, and the multiset must be ⊆ the
 *  current pool. On a valid order the parked cast/activation resumes through the
 *  same finalize path (`tryAutoCommitPendingCast` / `tryAutoCommitPendingActivation`),
 *  spending mana in the chosen order and putting the spell/ability on the stack. */
export const resolveManaSpendChoice = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        spendOrder: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        // The choice is paid inside the payer's priority window (the parked cast
        // /activation holds priority), so it expects `priority` — same as the
        // cast/activation sacrifice pick (ADR 0047).
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        const active = findActiveManaSpendChoice(state, args.playerId);
        if (!active) throw new Error("No mana-spend choice awaiting you");
        const { choice, container } = active;

        // Validate the order against the parked choice + current pool (CR 601.2g).
        const player = getPlayer(state, args.playerId);
        validateManaSpendOrder(choice, args.spendOrder, player.manaPool);

        // Resume the parked finalize with the chosen order.
        if (container === "cast") {
            tryAutoCommitPendingCast(state, args.playerId, args.spendOrder);
        } else {
            tryAutoCommitPendingActivation(
                state,
                args.playerId,
                args.spendOrder
            );
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Cancel a pending cast: rollback all taps (CR 601.2 reversal). */
/** Picks a permanent to pay the spell's additional cost (CR 118.8 /
 *  601.2f). Only valid while pendingCast is in its additional-cost picker
 *  stage. On selection, attempts auto-commit; if mana isn't yet covered the
 *  player continues to tap lands and commit completes via tryAutoCommitPendingCast. */
export const selectAdditionalCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }
        const ac = state.pendingCast.additionalCost;
        if (!ac) {
            throw new Error("This spell has no additional cost picker");
        }
        if (ac.pickedId) {
            throw new Error("Additional cost already paid");
        }
        const player = getPlayer(state, args.playerId);
        const candidate = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!candidate) {
            throw new Error("Selected permanent not on your battlefield");
        }
        // Effective colours via the layer system, matching
        // `buildAdditionalCostPicker` — a `colors` filter (Natural Order's
        // "a green creature") must read the same colour the rest of the
        // engine sees, not the raw instance which carries no `colors` field.
        const candidateView = {
            ...candidate,
            colors: STATIC_EFFECT_CTX.getColors(candidate),
        };
        if (
            !matchesPermanentFilter(candidateView, ac.filter, {
                selfControllerId: args.playerId,
            })
        ) {
            throw new Error(
                "Selected permanent does not match the additional cost filter"
            );
        }
        ac.pickedId = args.cardInstanceId;

        // tryAutoCommitPendingCast clears pendingCast and emits SPELL_CAST
        // when it succeeds. If mana isn't yet covered, the cast remains in
        // pendingCast and the player completes payment via tapForPayment.
        tryAutoCommitPendingCast(state, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

export const cancelCast = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        rollbackPendingCast(state);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Tap a land during an activated-ability payment phase. Auto-commits the
 *  ability onto the stack when the mana cost is fully covered. */
export const tapForActivationPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        manaChoiceIndex: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        const pa = state.pendingActivation;
        if (!pa) throw new Error("No ability being activated");
        if (pa.playerId !== args.playerId) {
            throw new Error("Not your pending activation");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        tapSourceIntoPayment(
            state,
            player,
            card,
            args.manaChoiceIndex,
            pa.tappedLandIds
        );

        // If the pool now covers pendingActivation, pay mana, apply deferred
        // tap/sacrifice costs and push the ability on the stack.
        tryAutoCommitPendingActivation(state, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/**
 * Static Evaluation of the position a candidate auto-tap `plan` leaves behind,
 * from the paying player's perspective (issue #794, PRD #472 / ADR 0034). Pure
 * and synchronous: clones the paying player's view, applies the plan (marks the
 * tapped sources tapped, sets the leftover floating mana), and returns the
 * Brain's STATIC `evaluateAutoTapPosition` — NO ISMCTS search on this
 * authoritative payment path. Higher = a better resulting position (more
 * valuable dual-purpose / color-flexible sources left untapped). Feeds
 * `solveSmartAutoTap` as its primary plan scorer.
 */
export function scoreAutoTapPlanPosition(
    state: GameState,
    playerId: string,
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[],
    plan: AutoTapPlan
): number {
    const sim = structuredClone(state) as GameState;
    const simPlayer = sim.players.find((p) => p.id === playerId);
    if (!simPlayer) return evaluateAutoTapPosition(sim, playerId);
    const tapped = new Set(plan.map((s) => s.cardId));
    for (const perm of simPlayer.battlefield) {
        if (tapped.has(perm.id)) perm.isTapped = true;
    }
    // Floating mana still in the pool after the taps pay the cost (CR 601.2g) —
    // an over-producing tap (a dual spent for the "wrong" half) leaves usable
    // mana, which the `mana` term then values.
    simPlayer.manaPool = floatingAfterPlan(
        pool,
        cost,
        substitutions,
        sources,
        plan
    );
    return evaluateAutoTapPosition(sim, playerId);
}

/**
 * Auto-tap mana sources to pay the pending cast or activation in one action
 * (issue #154). Finds a minimal valid combination of untapped pure-mana
 * sources, taps them (reusing the manual single-tap path), and lets the
 * existing auto-commit move the spell/ability onto the stack. Throws if no
 * combination can cover the cost. Sacrifice/side-effect mana abilities and
 * summoning-sick dorks are excluded — those stay manual.
 */
export const autoTapForPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        const pending =
            state.pendingCast?.playerId === args.playerId
                ? state.pendingCast
                : state.pendingActivation?.playerId === args.playerId
                  ? state.pendingActivation
                  : undefined;
        if (!pending) throw new Error("No pending payment");

        const player = getPlayer(state, args.playerId);
        // CR 601.2f (issue #1338) — a can't-spend-mana cast (Hogaak) may tap NO
        // mana source: every pip is paid by the convoke / delve pickers, which
        // drive `manaCost` to zero, so auto-tap is a strict no-op. Guard here so
        // the client calling autoTapForPayment mid-cast never taps a land while
        // a picker is still open (which WOULD spend mana). Commit still fires
        // below via tryAutoCommitPendingCast once the pickers cover the cost.
        const castCard =
            state.pendingCast?.playerId === args.playerId
                ? locateCastSource(
                      state,
                      player,
                      state.pendingCast.cardInstanceId
                  ).card
                : undefined;
        const castCantSpendMana =
            !!castCard &&
            (tryGetDefinition((castCard.card as { id?: string }).id ?? "")
                ?.cantSpendManaToCast ??
                false);
        const substitutions = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(
            player.battlefield,
            manaGateBattlefields(state)
        );
        // Smart auto-tap (PRD #472, ADR 0034): among all minimal-tap plans that
        // cover the cost, prefer the one that best preserves the paying
        // player's other castable hand spells (their Demands). Reads the
        // *paying* player's own hand — no hidden-info leak, works for every
        // seat including the AI bot's own casts. The card being paid for is
        // excluded from the Demand set.
        // Timing-aware Demand filter (issue #475, CR 307 / 601.3a): sorcery-
        // speed hand spells count as preservable Demands only at sorcery timing
        // (own main, empty stack, holding priority); instant-speed spells count
        // in any window. Reuses the engine's canonical `isSorceryTiming` helper.
        // On-board activated-ability Demands (issue #476, CR 602.1): a
        // firebreathing creature's "{R}: +1/+0" and other mana-costed activated
        // abilities on the paying player's battlefield are also plays they
        // might still make this turn. Each is counted ONCE per (permanent,
        // ability) — repeatable activations don't multiply the Demand (PRD
        // user story 12) — and is timing-filtered the same way (sorcery-speed
        // abilities count only at sorcery timing).
        const sorceryTiming = isSorceryTiming(state);
        const demands: Demand[] = [
            ...buildHandSpellDemands(
                player.hand,
                pending.cardInstanceId,
                sorceryTiming
            ),
            ...buildBoardAbilityDemands(player.battlefield, {
                phase: state.phase,
                isControllersTurn: state.activePlayerId === player.id,
            }),
        ];
        // Prefer a minimal full plan. When the pure-mana sources can't cover
        // the whole cost (the rest must come from an excluded manual source,
        // e.g. Black Lotus — issue #321), fall back to the maximal-useful
        // partial plan: tap what we can toward the cost and leave the manual
        // remainder to the player rather than no-op + throw.
        // Self-source deprioritization (issue #544, CR 602.1): when paying an
        // activated ability's cost, don't tap the activating permanent's own
        // mana ability unless strictly necessary. Mishra's Factory `{1}:`
        // animate must leave the Factory untapped while another mana source can
        // cover the cost (otherwise the freshly-animated creature is tapped and
        // can't attack/block). Only a pendingActivation has a self-source — a
        // spell cast (pendingCast) has no on-battlefield source to spare.
        const selfSourceId =
            state.pendingActivation?.playerId === args.playerId
                ? state.pendingActivation.cardInstanceId
                : undefined;
        // Evaluation-scored plan selection (issue #794, PRD #472 / ADR 0034):
        // score each candidate minimal-tap plan by the Brain's STATIC
        // `evaluate()` of the position it leaves behind — a pure, synchronous
        // read, NO ISMCTS search on this authoritative payment path. Simulating
        // a plan means tapping its sources and applying the leftover floating
        // mana; `evaluateAutoTapPosition` then values the dual-purpose /
        // color-flexible sources it spares (Mishra's Factory, a dual land). The
        // closure captures a clone of the paying player's own perspective, so
        // it never leaks hidden information and works for every seat.
        const scorePlan = (plan: AutoTapPlan): number =>
            scoreAutoTapPlanPosition(
                state,
                player.id,
                player.manaPool,
                pending.manaCost,
                substitutions,
                sources,
                plan
            );
        const fullPlan = solveSmartAutoTap(
            player.manaPool,
            pending.manaCost,
            substitutions,
            sources,
            demands,
            selfSourceId,
            scorePlan
        );
        const plan = castCantSpendMana
            ? []
            : (fullPlan ??
              solveAutoTapPartial(
                  player.manaPool,
                  pending.manaCost,
                  substitutions,
                  sources
              ));

        for (const step of plan) {
            const card = player.battlefield.find((c) => c.id === step.cardId);
            if (!card) continue;
            tapSourceIntoPayment(
                state,
                player,
                card,
                step.manaChoiceIndex,
                pending.tappedLandIds
            );
        }

        // Commit only if the cost is now fully covered. A partial plan leaves
        // a deficit (manual source still owed) — keep the banner up so the
        // player can finish the payment by hand.
        if (state.pendingCast?.playerId === args.playerId) {
            tryAutoCommitPendingCast(state, args.playerId);
        } else {
            tryAutoCommitPendingActivation(state, args.playerId);
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Untap a land during activation payment (undo). */
export const untapForActivationPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        const pa = state.pendingActivation;
        if (!pa) throw new Error("No ability being activated");
        if (pa.playerId !== args.playerId) {
            throw new Error("Not your pending activation");
        }

        const idx = pa.tappedLandIds.indexOf(args.cardInstanceId);
        if (idx === -1) {
            throw new Error("This land was not tapped during this activation");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Cannot undo: source was sacrificed");

        untapSourceFromPayment(state, player, card);
        pa.tappedLandIds.splice(idx, 1);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Cancel a pending activation: rollback all taps. The source permanent is
 *  untouched because tap/sacrifice costs are deferred until commit. */
export const cancelActivation = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        const pa = state.pendingActivation;
        if (!pa) throw new Error("No ability being activated");
        if (pa.playerId !== args.playerId) {
            throw new Error("Not your pending activation");
        }

        rollbackPendingActivation(state);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Pick a permanent for an activated ability's filtered cost picker — either a
 *  "sacrifice a permanent matching <filter>" cost (CR 602.1 / 118.5) or a
 *  "tap N untapped permanents matching <filter> you control" cost (CR 602.1 /
 *  118.8 — Hand of Justice). For the tap-others picker the mutation is called
 *  once per chosen permanent; commit fires once `count` ids are picked. Mirrors
 *  selectAdditionalCost for the spell path. Commit fires via
 *  tryAutoCommitPendingActivation once the choice and the mana are both in. */
/** Pure core of `selectActivationCost` — records ONE pick on the live
 *  `pendingActivation.tapOtherChoice` and attempts the commit (CR 602.1 /
 *  118.8; CR 702.122a for the crew shape). Extracted so tests drive the REAL
 *  validation branch order rather than a hand-mirrored copy. */
export function selectActivationCostOnState(
    state: GameState,
    args: { playerId: string; cardInstanceId: string }
): void {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId: args.playerId,
        expect: "priority",
    });

    const pa = state.pendingActivation;
    if (!pa) throw new Error("No ability being activated");
    if (pa.playerId !== args.playerId) {
        throw new Error("Not your pending activation");
    }
    const player = getPlayer(state, args.playerId);
    const candidate = player.battlefield.find(
        (c) => c.id === args.cardInstanceId
    );
    if (!candidate) {
        throw new Error("Selected permanent not on your battlefield");
    }

    // CR 602.1 / 118.8 — tap-other-creatures picker (Hand of Justice's fixed
    // three; CR 702.122a Crew N's "any number with total power N or greater").
    // One call per chosen permanent; each must match the filter, be untapped,
    // not be the source, and not already be picked.
    const toc = pa.tapOtherChoice;
    if (!toc) {
        // CR 701.21a — the ability's sacrifice cost migrated to the unified
        // sacrifice picker (selectSacrifice). selectActivationCost now handles
        // only the tap-other cost.
        throw new Error("This ability has no tap cost picker");
    }
    if (isTapOtherPaid(state, player, toc)) {
        throw new Error("Tap cost already paid");
    }
    if (candidate.id === pa.cardInstanceId) {
        throw new Error("Cannot tap the ability's own source");
    }
    if (candidate.isTapped) {
        throw new Error("Selected permanent is already tapped");
    }
    if (toc.pickedIds.includes(candidate.id)) {
        throw new Error("Permanent already selected to tap");
    }
    const view = {
        ...candidate,
        colors: STATIC_EFFECT_CTX.getColors(candidate),
    };
    if (
        !matchesPermanentFilter(view, toc.filter, {
            selfControllerId: player.id,
        })
    ) {
        throw new Error(
            "Selected permanent does not match the tap cost filter"
        );
    }
    toc.pickedIds.push(candidate.id);
    // CR 702.122a — keep the running crew total on the picker so the client can
    // render "N more power" without re-deriving effective power (and each
    // crewing creature's `crewPowerBonus`) itself.
    if (toc.totalPower !== undefined) {
        toc.pickedPower = tapOtherPickedPower(state, player, toc.pickedIds);
    }
    tryAutoCommitPendingActivation(state, args.playerId);
}

export const selectActivationCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        selectActivationCostOnState(state, {
            playerId: args.playerId,
            cardInstanceId: args.cardInstanceId,
        });
        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Records the player's pick for an "exile N cards from a single graveyard"
 *  activation cost (CR 602.1 / 118.5 / 406 — Night Soil). Validates that all
 *  picked cards sit in the SAME graveyard (`graveyardOwnerId`), that the count
 *  matches the cost exactly, and that each card satisfies the optional type
 *  filter. Mirrors `selectActivationCost`: it only records the pick (the cards
 *  move graveyard → exile at commit, so cancelling leaves the graveyard
 *  untouched), then drives tryAutoCommitPendingActivation once the pick and the
 *  mana are both in. */
export function selectActivationExileCostOnState(
    state: GameState,
    args: {
        playerId: string;
        graveyardOwnerId: string;
        cardInstanceIds: string[];
    }
): void {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId: args.playerId,
        expect: "priority",
    });

    const pa = state.pendingActivation;
    if (!pa) throw new Error("No ability being activated");
    if (pa.playerId !== args.playerId) {
        throw new Error("Not your pending activation");
    }
    const ec = pa.exileFromGraveyardChoice;
    if (!ec) {
        throw new Error("This ability has no exile-from-graveyard cost");
    }
    if (ec.pickedCardIds) {
        throw new Error("Exile cost already paid");
    }
    if (args.cardInstanceIds.length !== ec.count) {
        throw new Error(
            `Must exile exactly ${ec.count} cards from a single graveyard`
        );
    }
    // CR 118.5 — the whole cost must come from ONE graveyard.
    if (new Set(args.cardInstanceIds).size !== args.cardInstanceIds.length) {
        throw new Error("Duplicate card selected for the exile cost");
    }
    // CR 118.5 — `owner: "you"` restricts the source to the activating
    // player's OWN graveyard (Grim Lavamancer "your graveyard").
    if (ec.owner === "you" && args.graveyardOwnerId !== pa.playerId) {
        throw new Error("This cost must be paid from your own graveyard");
    }
    const owner = state.players.find((p) => p.id === args.graveyardOwnerId);
    if (!owner) throw new Error("Graveyard owner not in this game");
    for (const id of args.cardInstanceIds) {
        const card = owner.graveyard.find((c) => c.id === id);
        if (!card) {
            throw new Error("Selected card is not in the chosen graveyard");
        }
        if (!graveyardCardMatchesExileCost(card, ec.cardType)) {
            throw new Error(
                "Selected card does not match the exile cost filter"
            );
        }
    }
    ec.pickedGraveyardOwnerId = args.graveyardOwnerId;
    ec.pickedCardIds = [...args.cardInstanceIds];

    // Commit fires here when the mana is also covered; otherwise the player
    // taps the remaining mana via tapForActivationPayment.
    tryAutoCommitPendingActivation(state, args.playerId);
}

export const selectActivationExileCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        graveyardOwnerId: v.string(),
        cardInstanceIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        selectActivationExileCostOnState(state, {
            playerId: args.playerId,
            graveyardOwnerId: args.graveyardOwnerId,
            cardInstanceIds: args.cardInstanceIds,
        });

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Records the player's pick for a "discard a card matching <filter>"
 *  activation cost (CR 602.1 / 118.3 — Survival of the Fittest "Discard a
 *  creature card"). Validates that the pick count matches the cost exactly
 *  and that each card is in the activator's OWN hand and matches the filter
 *  (the same `handCardMatchesFilter` matcher `activateAbility` uses
 *  up-front). Mirrors `selectActivationExileCost`: it only RECORDS the pick
 *  — the cards move hand → graveyard at commit (via the shared
 *  `discardToGraveyard` choke point, CR 614 / 701.8), so cancelling leaves
 *  the hand untouched — then drives `tryAutoCommitPendingActivation` once the
 *  pick and the mana are both in. */
export function selectActivationDiscardCostOnState(
    state: GameState,
    args: { playerId: string; cardInstanceIds: string[] }
): void {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId: args.playerId,
        expect: "priority",
    });

    const pa = state.pendingActivation;
    if (!pa) throw new Error("No ability being activated");
    if (pa.playerId !== args.playerId) {
        throw new Error("Not your pending activation");
    }
    const dc = pa.discardFilterChoice;
    if (!dc) {
        throw new Error("This ability has no discard-a-card cost");
    }
    if (dc.pickedCardIds) {
        throw new Error("Discard cost already paid");
    }
    if (args.cardInstanceIds.length !== dc.count) {
        throw new Error(`Must discard exactly ${dc.count} card(s)`);
    }
    if (new Set(args.cardInstanceIds).size !== args.cardInstanceIds.length) {
        throw new Error("Duplicate card selected for the discard cost");
    }
    const player = getPlayer(state, args.playerId);
    for (const id of args.cardInstanceIds) {
        const card = player.hand.find((c) => c.id === id);
        if (!card) {
            throw new Error("Selected card is not in your hand");
        }
        if (!handCardMatchesFilter(card, dc.filter)) {
            throw new Error(
                "Selected card does not match the discard cost filter"
            );
        }
    }
    dc.pickedCardIds = [...args.cardInstanceIds];

    // Commit fires here when the mana is also covered; otherwise the player
    // taps the remaining mana via tapForActivationPayment.
    tryAutoCommitPendingActivation(state, args.playerId);
}

export const selectActivationDiscardCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        selectActivationDiscardCostOnState(state, {
            playerId: args.playerId,
            cardInstanceIds: args.cardInstanceIds,
        });

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Records the player's picks for a FLASHBACK "exile X <colour> cards from your
 *  graveyard" cost (CR 702.34a / 118.5 — Flash of Insight). Validates that the
 *  pick count equals the announced X, that every card is in the caster's OWN
 *  graveyard, matches the colour filter (CR 105.2), is not a duplicate, and is
 *  not the flashback card itself (CR 601.2a). Only RECORDS the pick — the
 *  cards move graveyard → exile at cast commit (`tryAutoCommitPendingCast`), so
 *  cancelling leaves the graveyard untouched. Pure (no ctx) so it is unit-tested
 *  directly, mirroring the flashback capability suite (issue #944). */
export function recordCastExileCostPick(
    state: GameState,
    playerId: string,
    cardInstanceIds: string[]
): void {
    const pc = state.pendingCast;
    if (!pc) throw new Error("No spell being cast");
    if (pc.playerId !== playerId) throw new Error("Not your pending cast");
    const ec = pc.exileFromGraveyardChoice;
    if (!ec) throw new Error("This spell has no exile-from-graveyard cost");
    if (ec.pickedCardIds) throw new Error("Exile cost already paid");
    if (ec.offsetGeneric) {
        // CR 702.66 (Delve) — the `payWith` variable-offset mode (CR 601.2g,
        // ADR 0063): ANY number of cards in `min..max`. `min` is the shortfall
        // the caster's mana can't cover, `max` is min(graveyard, generic
        // remaining). Zero is a legal answer whenever nothing is forced.
        const { min, max } = ec.offsetGeneric;
        if (cardInstanceIds.length < min) {
            throw new Error(
                `Must exile at least ${min} card(s) from your graveyard to pay for this spell`
            );
        }
        if (cardInstanceIds.length > max) {
            throw new Error(
                `Can't exile more than ${max} card(s) from your graveyard for this spell`
            );
        }
    } else if (ec.minCardTypes === undefined) {
        // Fixed-count exile cost (Flashback X; escape fixed count — Uro/Phlage).
        if (cardInstanceIds.length !== ec.count) {
            throw new Error(
                `Must exile exactly ${ec.count} card(s) from your graveyard`
            );
        }
    } else if (cardInstanceIds.length < 1) {
        // CR 702.138a (Nethergoyf) — "any number … with N+ card types among
        // them": at least one card, validated for card-type coverage below.
        throw new Error("Must exile at least one card from your graveyard");
    }
    if (new Set(cardInstanceIds).size !== cardInstanceIds.length) {
        throw new Error("Duplicate card selected for the exile cost");
    }
    const player = getPlayer(state, playerId);
    // CR 702.34a / 118.5 — the cost cards come from the caster's graveyard
    // (default, Flash of Insight) or their hand (`zone: "hand"`, the exile-a-
    // card-from-hand flashback cost). The picked cards move `zone` → exile at
    // commit.
    const sourceZone = ec.zone ?? "graveyard";
    const sourceCards = sourceZone === "hand" ? player.hand : player.graveyard;
    for (const id of cardInstanceIds) {
        if (id === ec.excludeInstanceId) {
            // CR 601.2a — the flashback card can't pay for its own cost.
            throw new Error(
                "Can't exile the flashback card itself to pay its cost"
            );
        }
        const card = sourceCards.find((c) => c.id === id);
        if (!card) {
            throw new Error(`Selected card is not in your ${sourceZone}`);
        }
        if (!graveyardCardMatchesColor(card, ec.color)) {
            throw new Error(
                "Selected card does not match the exile cost filter"
            );
        }
    }
    // CR 702.138a escape (Nethergoyf) — the exiled OTHER cards must collectively carry
    // at least `minCardTypes` distinct card types.
    if (ec.minCardTypes !== undefined) {
        const picked = cardInstanceIds
            .map((id) => sourceCards.find((c) => c.id === id))
            .filter((c): c is CardInstanceState => c !== undefined);
        if (countDistinctCardTypes(picked) < ec.minCardTypes) {
            throw new Error(
                `Exiled cards must have at least ${ec.minCardTypes} card types among them`
            );
        }
    }
    ec.pickedCardIds = [...cardInstanceIds];
    // CR 702.66b — each card exiled for delve pays for {1}: apply the payment
    // NOW against this cast's remaining GENERIC cost, so `isManaCostCovered`
    // and the auto-tap solver both see the reduced remainder and cover only
    // what is genuinely left (CR 601.2g ordering: reduce → payWith → mana).
    // Mirrors the Improvise clamp; never touches a coloured pip. The cards
    // themselves don't move until commit, so cancelling leaves the graveyard
    // untouched (`rollbackPendingCast` drops the whole pendingCast).
    if (ec.offsetGeneric) {
        applyGenericOffset(pc.manaCost, cardInstanceIds.length);
    }
}

/** Records the player's pick for a FLASHBACK "exile X blue cards from your
 *  graveyard" cast cost (CR 702.34a / 118.5 — Flash of Insight). Mirrors
 *  `selectActivationExileCost` on the cast path: it validates + records the
 *  pick (the cards move graveyard → exile at commit), then drives
 *  `tryAutoCommitPendingCast` once the pick and the mana are both in. */
export const selectCastExileCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        recordCastExileCostPick(state, args.playerId, args.cardInstanceIds);

        // Commit fires here when the mana is also covered; otherwise the player
        // taps the remaining mana via tapForCastPayment.
        tryAutoCommitPendingCast(state, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 702.51a / 601.2g (`payWith`, ADR 0063 — issue #1338) — records the
 *  player's Convoke creature picks. Validates each id is an UNTAPPED CREATURE
 *  the caster controls (a creature tapped for convoke is not paying a `{T}`
 *  cost, so summoning sickness is irrelevant — CR 602.5a), that the count is in
 *  `min..max`, and that the chosen creatures can COLOUR-COVER the spell's
 *  coloured + guild-hybrid pips (the shared greedy `coverColoredAndHybridPips`).
 *  Then reduces this cast's remaining cost — deleting each single-colour pip
 *  convoke paid and offsetting the generic by the creatures left over — and,
 *  when the spell ALSO has delve (Hogaak), opens the delve picker on the REDUCED
 *  cost (CR 601.2g ordering: convoke → delve → mana). Only RECORDS the pick; the
 *  creatures are TAPPED at cast commit (`tryAutoCommitPendingCast`), so
 *  cancelling leaves them untapped. Pure (no ctx) so it is unit-tested directly,
 *  mirroring `recordCastExileCostPick`. */
export function recordConvokeCreaturePick(
    state: GameState,
    playerId: string,
    creatureInstanceIds: string[]
): void {
    const pc = state.pendingCast;
    if (!pc) throw new Error("No spell being cast");
    if (pc.playerId !== playerId) throw new Error("Not your pending cast");
    const cc = pc.convokeCreatureChoice;
    if (!cc) throw new Error("This spell has no convoke cost");
    if (cc.pickedCreatureIds) throw new Error("Convoke already paid");
    if (creatureInstanceIds.length < cc.min) {
        throw new Error(
            `Must tap at least ${cc.min} creature(s) to convoke this spell`
        );
    }
    if (creatureInstanceIds.length > cc.max) {
        throw new Error(
            `Can't tap more than ${cc.max} creature(s) to convoke this spell`
        );
    }
    if (new Set(creatureInstanceIds).size !== creatureInstanceIds.length) {
        throw new Error("Duplicate creature selected for convoke");
    }
    const player = getPlayer(state, playerId);
    const picked: CardInstanceState[] = [];
    for (const id of creatureInstanceIds) {
        const creature = player.battlefield.find((c) => c.id === id);
        if (!creature) {
            throw new Error("Selected creature is not on your battlefield");
        }
        if (!isCreature(creature)) {
            throw new Error("Selected permanent is not a creature");
        }
        if (creature.isTapped) {
            throw new Error("Selected creature is already tapped");
        }
        picked.push(creature);
    }
    // CR 702.51a — assign the tapped creatures to the coloured + hybrid pips
    // (colour-matched by the shared greedy); the rest each pay {1} generic.
    const coloredPips = cc.coloredPips ?? {};
    const leftover = coverColoredAndHybridPips(
        picked.map((c) => creatureConvokeColors(c)),
        coloredPips,
        cc.hybridPips
    );
    if (leftover === null) {
        throw new Error(
            "The tapped creatures can't cover this spell's coloured mana"
        );
    }
    // Remove the single-colour pips convoke paid, then offset the generic by the
    // creatures left over (each pays {1}, CR 702.51a) — never below zero.
    for (const [color, n] of Object.entries(coloredPips)) {
        if (n && n > 0) {
            const left = Math.max(0, (pc.manaCost[color] ?? 0) - n);
            if (left > 0) pc.manaCost[color] = left;
            else delete pc.manaCost[color];
        }
    }
    // CR 202.1a (issue #1738) — the guild-hybrid pips the greedy just covered
    // are paid by those creatures, so they leave the remaining cost too. This
    // was a silent no-op while `normalizeManaCost` dropped hybrid pips; now
    // that the cost actually OWES them, skipping this step would ask a
    // convoked Hogaak to pay {B/G}{B/G} with mana it may not spend at all
    // (CR 601.2f), stranding the cast.
    for (const pip of cc.hybridPips) {
        const key = hybridCostKey(pip[0], pip[1]);
        const left = Math.max(0, (pc.manaCost[key] ?? 0) - 1);
        if (left > 0) pc.manaCost[key] = left;
        else delete pc.manaCost[key];
    }
    applyGenericOffset(pc.manaCost, leftover);
    cc.pickedCreatureIds = [...creatureInstanceIds];
    // CR 601.2g — convoke has now reduced the cost; open the delve picker on the
    // REMAINING generic (Hogaak carries both). Arena prompt policy applies: the
    // picker is undefined when nothing generic is left (all convoked).
    const castCard = locateCastSource(state, player, pc.cardInstanceId).card;
    if (castCard && spellHasDelve(castCard) && !pc.exileFromGraveyardChoice) {
        // CR 601.2g ordering (ADR 0063) — this is the SECOND leg of a chained
        // payWith pick: `recordConvokeCreaturePick` is a pure record step, and
        // its own caller hasn't had a chance to attempt
        // `tryAutoCommitPendingCast` yet. `buildDelveExileChoice` is a pure
        // builder — it never collapses a fully-forced pick itself (see its
        // own doc, and `collapseForcedDelvePick`'s doc for why that
        // collapse belongs at the COMMIT seam, not here). The caller of THIS
        // function (`applyConvokeCreatureSelection`) runs `collapseForcedDelvePick`
        // right after this record step, before its own
        // `tryAutoCommitPendingCast` — keeping this function a clean,
        // composable record step that never pays costs behind its caller's
        // back, the same discipline `recordCastExileCostPick` and the
        // sacrifice/hand-choice pickers already follow.
        const delveChoice = buildDelveExileChoice(
            player,
            castCard,
            pc.manaCost,
            pc.cardInstanceId,
            genericManaShortfall(player, castCard, pc.manaCost, state)
        );
        if (delveChoice) pc.exileFromGraveyardChoice = delveChoice;
    }
}

/** CR 702.51a (issue #1660) — pure core of the `selectConvokeCreatures`
 *  mutation: records the convoke creature picks, collapses a fully-forced
 *  delve pick opened as the chained SECOND leg (right after the record step
 *  and before the commit attempt, so `recordConvokeCreaturePick` itself
 *  stays a clean record step — see its doc and `collapseForcedDelvePick`'s
 *  doc for why the collapse belongs at this seam), then drives
 *  `tryAutoCommitPendingCast`: once convoke (and any subsequent delve pick)
 *  covers the cost, the spell is put on the stack; otherwise the caster
 *  completes the remaining payment. Mutates `state` in place. Extracted out
 *  of the mutation for the same reason `finalizeTargetSelection` was
 *  extracted out of `selectTarget` — so the pure sequence is directly unit-
 *  testable instead of only reachable through the mutation handler. */
export function applyConvokeCreatureSelection(
    state: GameState,
    playerId: string,
    creatureInstanceIds: string[]
): void {
    recordConvokeCreaturePick(state, playerId, creatureInstanceIds);

    // CR 601.2g (issue #1660) — this is the commit seam for the SECOND
    // (delve) leg of a chained convoke → delve payWith pick: collapse a
    // fully-forced delve pick HERE, right after the pure record step and
    // before the commit attempt, so `recordConvokeCreaturePick` itself
    // stays a clean record step (see `collapseForcedDelvePick`'s doc).
    const pcAfterConvoke = state.pendingCast;
    if (pcAfterConvoke?.exileFromGraveyardChoice) {
        collapseForcedDelvePick(
            getPlayer(state, playerId),
            pcAfterConvoke.cardInstanceId,
            pcAfterConvoke.exileFromGraveyardChoice,
            pcAfterConvoke.manaCost
        );
    }

    tryAutoCommitPendingCast(state, playerId);
}

export const selectConvokeCreatures = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        creatureInstanceIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        applyConvokeCreatureSelection(
            state,
            args.playerId,
            args.creatureInstanceIds
        );

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Records the player's picks for an ALTERNATIVE-cost HAND leg (CR 118.9 —
 *  Force of Will's "exile a blue card", Foil's "discard an Island card and
 *  another card"). Validates the picks satisfy the alt cost's requirements from
 *  distinct hand cards (never the cast card itself), then only RECORDS them —
 *  the cards move hand → exile / graveyard at cast commit
 *  (`tryAutoCommitPendingCast`), so cancelling leaves the hand untouched. Pure
 *  (no ctx) so it is unit-tested directly. */
export function recordCastAlternativeHandCostPick(
    state: GameState,
    playerId: string,
    cardInstanceIds: string[]
): void {
    const pc = state.pendingCast;
    if (!pc) throw new Error("No spell being cast");
    if (pc.playerId !== playerId) throw new Error("Not your pending cast");
    const ah = pc.alternativeCostHandChoice;
    if (!ah) throw new Error("This spell has no alternative-cost hand leg");
    if (ah.pickedCardIds) throw new Error("Alternative cost already paid");
    const player = getPlayer(state, playerId);
    validateAlternativeHandCostPicks(player, ah, cardInstanceIds);
    ah.pickedCardIds = [...cardInstanceIds];
}

/** Records the player's pick for an ALTERNATIVE-cost HAND leg (CR 118.9 — Force
 *  of Will / Foil). Mirrors `selectCastExileCost`: validates + records the pick
 *  (the cards move hand → exile / graveyard at commit), then drives
 *  `tryAutoCommitPendingCast` (alt costs zero the mana, so this commits at
 *  once). */
export const selectCastAlternativeHandCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        recordCastAlternativeHandCostPick(
            state,
            args.playerId,
            args.cardInstanceIds
        );

        tryAutoCommitPendingCast(state, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** One target-selection item for the batched `selectTargets` (issue #1779 /
 *  PRD #1776 T4). */
export type TargetSelectionInput = {
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
    /** Owner of the zone the target lives in. Required for non-battlefield
     *  zones (e.g. "graveyard-card") so the same instance id is unambiguous;
     *  ignored for battlefield/player/spell targets. */
    targetPlayerId?: string;
    /** Divide-as-you-choose amount (CR 601.2d / 120.4) assigned to THIS
     *  target — the points of damage / counters this target receives. Only
     *  meaningful for a spell whose `targetRequirement.divideAsChosen` is
     *  set; must be ≥ 1 and not exceed the remaining budget. Omitted for
     *  non-divide spells (the engine auto-divides ≥1-each on finalize). */
    amount?: number;
};

/** Core per-item apply logic for target selection (CR 601.2c). Extracted out
 *  of `selectTarget` so the batched `selectTargets` mutation can apply a
 *  whole ordered array within ONE transaction (issue #1779 / PRD #1776 T4):
 *  each call mutates `state` in place and THROWS on the first illegal target,
 *  which the caller's loop lets propagate — nothing persists until the
 *  caller's single `saveGameState`, so an illegal element aborts the WHOLE
 *  batch, never a partial apply. Re-reads `state.pendingTarget` fresh on
 *  every call, so a batch that spans a multi-group advance (CR 601.2c,
 *  Fumarole) or finalizes mid-array is handled identically to the same calls
 *  made one at a time. */
export function applyOneTargetSelection(
    state: GameState,
    playerId: string,
    input: TargetSelectionInput
): void {
    if (!state.pendingTarget)
        throw new Error("No target selection in progress");
    if (state.pendingTarget.playerId !== playerId) {
        throw new Error("Not your pending target selection");
    }

    const target: {
        type: "permanent" | "player" | "spell" | "graveyard-card";
        id: string;
        playerId?: string;
    } = {
        type: input.targetType,
        id: input.targetId,
        ...(input.targetPlayerId ? { playerId: input.targetPlayerId } : {}),
    };

    // Validate the target exists and matches the requirement
    const pt = state.pendingTarget;
    const reqTypes = Array.isArray(pt.targetType)
        ? pt.targetType
        : [pt.targetType];
    const wantsAny = reqTypes.includes("any");

    if (input.targetType === "graveyard-card") {
        // CR 109.2 / 400.7: graveyard-zone target. The chooser names a
        // specific player's graveyard via `targetPlayerId`; the engine
        // validates that the card sits there and matches the requested
        // CardType filter (structural — ADR 0068's `StructuralKey`).
        if (pt.zone !== "graveyard") {
            throw new Error("This spell does not target a graveyard card");
        }
        if (!input.targetPlayerId) {
            throw new Error("targetPlayerId required for graveyard target");
        }
        const owner = state.players.find((p) => p.id === input.targetPlayerId);
        if (!owner) throw new Error("Invalid graveyard owner");
        const matchedCard = owner.graveyard.find(
            (c) => c.id === input.targetId
        );
        if (!matchedCard) throw new Error("Invalid graveyard target");
        const wantsAnyCard = reqTypes.includes("card");
        const cardTypes = reqTypes.filter(
            (t) =>
                t !== "player" &&
                t !== "any" &&
                t !== "spell" &&
                t !== "spell-or-permanent" &&
                t !== "card"
        );
        if (
            !wantsAnyCard &&
            !cardTypes.some((t) => matchedCard.types.includes(t as never))
        ) {
            throw new Error("Card type mismatch for graveyard target");
        }
        // CR 109.3 / 102.1 / 202.3 / 109.1 — every CARD-kind filter
        // (`controller` — the graveyard's OWNER, anti-spoof #904's
        // card-flavored twin — `mvFilter`, `excludeTypes` — issue #1378's
        // "nonland permanent card" gate — `subtypeFilter`/`excludeSubtypes` —
        // issue #1950's "target Zombie card" gate — and `colorFilterAny` —
        // issue #1950 review round 2's "target white or black creature
        // card" gate), routed through the SINGLE shared authority — the
        // target-filter registry (ADR 0068 / issue #1410, T3). `getLegalTargets`
        // runs the SAME `checkCardTargetFilters` per candidate, so the
        // offered set and the accepted set can't diverge. This ALSO fixes a
        // real latent gap: this branch never implemented `controller:
        // "active"` before this slice, while `getLegalTargets` already did.
        // `pickCardFilterValues` (issue #1950 review round 2, MINOR 5) reads
        // `pt` keyed off `CARD_FILTER_KEYS` — a FUTURE key registered there
        // is picked up here by construction, closing the hand-maintained-
        // literal drift that let BLOCKER 2 / MAJOR 4 both slip through.
        const cardFilterCtx: TargetFilterCtx = {
            state,
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            chooserId: playerId,
            activePlayerId: state.activePlayerId,
        };
        const cardFilterViolation = checkCardTargetFilters(
            cardFilterCtx,
            matchedCard,
            pickCardFilterValues(pt)
        );
        if (cardFilterViolation) throw new Error(cardFilterViolation);
    } else if (input.targetType === "permanent") {
        const wantsSpellOrPermanent = reqTypes.includes("spell-or-permanent");
        const permanentTypes = reqTypes.filter(
            (t) =>
                t !== "player" &&
                t !== "any" &&
                t !== "spell" &&
                t !== "spell-or-permanent" &&
                t !== "card"
        );
        // CR 115.4 / 120.3: "any target" only matches damageable permanents.
        let matchedCard: CardInstanceState | null = null;
        for (const p of state.players) {
            for (const c of p.battlefield) {
                if (c.id !== input.targetId) continue;
                const matchesAny =
                    wantsAny &&
                    DAMAGEABLE_PERMANENT_TYPES.some((t) => c.types.includes(t));
                const matchesExplicit = permanentTypes.some((t) =>
                    c.types.includes(t as never)
                );
                if (matchesAny || wantsSpellOrPermanent || matchesExplicit)
                    matchedCard = c;
            }
        }
        if (!matchedCard) throw new Error("Invalid target");
        // CR 109.1 / 115 / 202 / 205 / 613 / 701.26 / 109.3 / 102.1 —
        // every PERMANENT-kind filter (including `controller`, anti-spoof
        // #904), routed through the SINGLE shared authority — the
        // target-filter registry (ADR 0068 / issue #1408). `getLegalTargets`
        // runs the SAME `checkPermanentTargetFilters` per candidate, so
        // the offered set and the accepted set can't diverge (subtype/
        // supertype/type-exclude/color/tapped/combat-role/keyword/
        // exclude-instance/power/toughness/mv/controller) — the Phelia
        // bug class. The VALUES fed to that authority are derived from
        // the `PendingTarget` by iterating `PERMANENT_FILTER_KEYS`
        // (`permanentFilterValuesFromCarrier`), not spelled out field by
        // field: `PermanentFilterValues` is a `Partial<>`, so a
        // hand-written map could — and did — drop a key with `tsc` at
        // exit 0 and the whole targeting suite green, re-opening the very
        // divergence the shared authority closes (issue #1824 review).
        // A filter added to the registry now reaches this site with no
        // edit here at all. The OFFERED half is derived from the same key
        // list by `lowerPermanentFilters` (`getLegalTargets`, `gre/rules.ts`)
        // and CARRIED through `pendingTargetFiltersFromRequirement`'s call to
        // the same lowerer — so neither half of the pair is hand-written and
        // a new filter key cannot reach one side but not the other.
        // CR 601.2c same-controller cross-slot constraint (issue #1104,
        // Barrin's Spite) — the sibling's live controllerId from what's
        // already in `pt.selected`, resolved through the SAME
        // `siblingControllerIdFor` helper `getLegalTargets` uses (ADR
        // 0068 "lower once, check everywhere" — the offered set and the
        // accepted set can't diverge).
        const siblingControllerId = siblingControllerIdFor(
            state,
            pt.sameController,
            pt.selected
        );
        const filterCtx: TargetFilterCtx = {
            state,
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            chooserId: playerId,
            activePlayerId: state.activePlayerId,
            siblingControllerId,
        };
        const filterViolation = checkPermanentTargetFilters(
            filterCtx,
            matchedCard,
            permanentFilterValuesFromCarrier(pt)
        );
        if (filterViolation) throw new Error(filterViolation);
        // CR 702.16b / 611 — the source whose target-selection is in progress.
        // The RAW `kind` goes in: the absent-kind default (an ordinary cast
        // omits it) lives inside `pendingTargetingSource`, so the accepted set,
        // the offered set and the client's gate share ONE resolution of it
        // (issue #2296 review).
        // The ACCEPTED set applies the same quality gates as the offered set
        // (CR 702.16b protection, CR 611 `cantBeTargeted` guards) — and it
        // derives them from the SAME `pendingTargetingSource` the offered set
        // uses (`legalActions.ts`'s enumerator, `raiseTriggerTargetSelection`'s
        // engine path). ONE call, not five parallel `getPendingTargetSource*`
        // reads: while each dimension was fetched separately, the two sides
        // could — and did — disagree on one of them per `kind` (the offered
        // side dropped CR 205.4a supertypes for triggers; the accepted side
        // then kept CR 113.3 `isSpell` as `kind !== "ability"`, which calls a
        // TRIGGERED ability a spell). Issue #1120 review rounds 1 and 2.
        const targetingSource = pendingTargetingSource(
            state,
            pt.cardInstanceId,
            pt.kind
        );
        // CR 702.16b — the colour form, the CR 702.16k player quality (issue
        // #1748) for which the targeting player IS the source's controller,
        // the CR 702.16a CHARACTERISTIC quality (issue #1120) read off the
        // source's live types/supertypes, and the CR 702.16a SPELL-RESTRICTED
        // quality (issue #2296) read off the CR 112.1 spell bit. Projected
        // through `protectionSourceFromTargeting` — the SAME single projection
        // `getLegalTargets` (the offered set) uses — rather than hand-assembled
        // here, so the accepted set cannot drop a dimension the offered set
        // honours.
        if (
            isProtectedFrom(
                matchedCard,
                protectionSourceFromTargeting(targetingSource, pt.playerId)
            )
        ) {
            throw new Error("Target has protection from this source");
        }
        // CR 611 — a continuous `permanent-guard` (Guardian Beast / shroud)
        // may bar targeting entirely. Mirror of the getLegalTargets gate.
        // The source's card types (CR 109.5), subtypes ("Aura spells"), and
        // spell-vs-ability (CR 113.3 "spells only" — Lurker) narrow filtered
        // guards.
        if (
            isGuardedAgainst(state, matchedCard, "cantBeTargeted", {
                types: targetingSource.types,
                subtypes: targetingSource.subtypes,
                // CR 113.3 — cast and (copy-)retarget are spells; an
                // activated OR triggered ability is not.
                isSpell: targetingSource.isSpell,
                // CR 702.11b — the source's controller (the selecting
                // player). Hexproof bars only an opponent-controlled source;
                // the permanent's own controller can still target it.
                controllerId: playerId,
            })
        ) {
            throw new Error(
                "Target can't be the target of spells or abilities"
            );
        }
    } else if (input.targetType === "player") {
        if (!wantsAny && !reqTypes.includes("player")) {
            throw new Error("Must target a permanent");
        }
        if (pt.colorFilter || pt.colorFilterAny) {
            throw new Error("Players have no color");
        }
        const found = state.players.find((p) => p.id === input.targetId);
        if (!found) throw new Error("Invalid player target");
        // CR 109.3 / 102.1 / 506.2 — every PLAYER-kind filter
        // (`controller` — Word of Command's "target opponent", anti-
        // spoof #904's player-flavored twin — and
        // `playerAttackedThisTurn` — Fire and Brimstone), routed through
        // the SINGLE shared authority — the target-filter registry
        // (ADR 0068 / issue #1410, T3). `getLegalTargets` runs the SAME
        // `checkPlayerTargetFilters` per candidate, so the offered set
        // and the accepted set can't diverge. This ALSO fixes a real
        // latent gap: this branch never implemented `controller:
        // "active"` before this slice, while `getLegalTargets` already
        // did.
        const playerFilterCtx: TargetFilterCtx = {
            state,
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            chooserId: playerId,
            activePlayerId: state.activePlayerId,
        };
        //
        // The forward set comes from `playerFilterValuesFromCarrier`, which
        // iterates `PLAYER_FILTER_KEYS` — the very list
        // `checkPlayerTargetFilters` loops. It used to be a hand-written map
        // literal (complete at 2/2, but fail-OPEN for the NEXT key, exactly as
        // the spell branch's was before issue #1956).
        const playerFilterViolation = checkPlayerTargetFilters(
            playerFilterCtx,
            found,
            playerFilterValuesFromCarrier(pt)
        );
        if (playerFilterViolation) throw new Error(playerFilterViolation);
        // CR 702.18 (applied to a player via CR 115.4) — a shrouded
        // player can't be the target of spells or abilities. Mirror of
        // the permanent branch's `isGuardedAgainst` gate above; no
        // source narrowing (shroud bars every source, including the
        // guarded player's own). Always-on gate (ADR 0068) — stays
        // outside the registry.
        if (playerHasShroud(state, found.id)) {
            throw new Error(
                "Target can't be the target of spells or abilities"
            );
        }
        // CR 702.16b/i (applied to a player via CR 115.4) — a player with
        // protection from everything can't be the target of any spell or
        // ability (The One Ring, issue #674). The SAME predicate
        // `getLegalTargets` gates the offered set with, so offered and
        // accepted can't diverge. No source narrowing: protection from
        // EVERYTHING bars every source, the protected player's own
        // included. Always-on gate (ADR 0068) — outside the registry.
        if (playerHasProtectionFromEverything(state, found.id)) {
            throw new Error(
                "Target can't be the target of spells or abilities"
            );
        }
    } else {
        // "spell" target (CR 114.1): must match a stack item.
        if (
            !reqTypes.includes("spell") &&
            !reqTypes.includes("spell-or-permanent")
        ) {
            throw new Error("This spell does not target a spell");
        }
        const spell = state.stack.find((s) => s.id === input.targetId);
        if (!spell) throw new Error("Invalid spell target");
        // CR 113 / 114.1 / 109.2 / 109.3 / 202.2 / 202.3 / 208.2 / 601.2c /
        // 701.7 / 702 — EVERY spell-kind filter, routed through the SINGLE
        // shared authority: the target-filter registry (ADR 0068 / issue
        // #1409, T2). `getLegalTargets` runs the SAME
        // `checkSpellTargetFilters` per candidate, so the offered set and the
        // accepted set can't diverge — the spell-flavored half of the Phelia
        // bug class.
        //
        // The forward set comes from `spellFilterValuesFromCarrier`, which
        // iterates `SPELL_FILTER_KEYS` — the very list
        // `checkSpellTargetFilters` loops. It used to be a hand-written map
        // literal (complete at 14/14, but fail-OPEN for the NEXT key: a
        // filter carried onto the `PendingTarget` and understood by the check
        // would simply never be handed over, and `selectTarget` would accept
        // a target `getLegalTargets` never offered). Forwarded set and
        // checked set are now the same set by construction (issue #1956).
        const spellFilterCtx: TargetFilterCtx = {
            state,
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            chooserId: playerId,
            activePlayerId: state.activePlayerId,
        };
        const spellFilterViolation = checkSpellTargetFilters(
            spellFilterCtx,
            spell,
            spellFilterValuesFromCarrier(pt)
        );
        if (spellFilterViolation) throw new Error(spellFilterViolation);
    }

    // CR 601.2c — reject a target already chosen under THIS SAME requirement
    // (Magma Burst's kicked "another target"; Dust to Dust's "two target
    // artifacts"). Fail CLOSED: a repeat pick is illegal by rule for every
    // multi-slot requirement, not a card-specific restriction. Mirrors
    // `getLegalTargets`'s offered-set exclusion (`isAlreadySelectedTarget`,
    // `targetFilters.ts`) so the offered and accepted sets can never diverge
    // (ADR 0068).
    if (isAlreadySelectedTarget(target, pt.selected)) {
        throw new Error("That target has already been chosen for this spell");
    }

    pt.selected.push(target);

    // CR 601.2d / 120.4 — divide-as-you-choose: record the amount assigned
    // to this target. Validate ≥ 1 and that the running total never exceeds
    // the spell's budget. When the caller omits an amount the engine
    // auto-divides ≥1-each at finalize, so the field stays optional.
    if (pt.divideTotal !== undefined && input.amount !== undefined) {
        if (input.amount < 1) {
            throw new Error("Each target must receive at least 1");
        }
        const amounts = pt.divideAmounts ?? {};
        const priorSum = Object.values(amounts).reduce((a, b) => a + b, 0);
        if (priorSum + input.amount > pt.divideTotal) {
            throw new Error("Assigned amount exceeds the spell's total");
        }
        amounts[`${target.type}:${target.id}`] = input.amount;
        pt.divideAmounts = amounts;
    }

    // CR 601.2d — a divide-as-you-choose spell auto-finalizes once the whole
    // budget has been assigned, even before the (open-ended) max target
    // count is hit: there are no points left to give a further target.
    const divideBudgetSpent =
        pt.divideTotal !== undefined &&
        pt.divideAmounts !== undefined &&
        Object.values(pt.divideAmounts).reduce((a, b) => a + b, 0) >=
            pt.divideTotal;

    const maxReached =
        pendingTargetCountMaxReached(pt.count, pt.selected.length) ||
        divideBudgetSpent;
    if (maxReached) {
        // CR 601.2c — advance to the next independent target group
        // (Fumarole) when one is queued; otherwise finalize.
        advanceTargetGroupOrFinalize(state, pt, playerId);
    }
}

/** Select a target for a spell being announced (CR 601.2c). */
export const selectTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        targetType: v.union(
            v.literal("permanent"),
            v.literal("player"),
            v.literal("spell"),
            v.literal("graveyard-card")
        ),
        targetId: v.string(),
        /** Owner of the zone the target lives in. Required for non-
         *  battlefield zones (e.g. "graveyard-card") so the same instance id
         *  is unambiguous; ignored for battlefield/player/spell targets. */
        targetPlayerId: v.optional(v.string()),
        /** Divide-as-you-choose amount (CR 601.2d / 120.4) assigned to THIS
         *  target — the points of damage / counters this target receives. Only
         *  meaningful for a spell whose `targetRequirement.divideAsChosen` is
         *  set; must be ≥ 1 and not exceed the remaining budget. Omitted for
         *  non-divide spells (the engine auto-divides ≥1-each on finalize). */
        amount: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "target",
        });

        applyOneTargetSelection(state, args.playerId, {
            targetType: args.targetType,
            targetId: args.targetId,
            targetPlayerId: args.targetPlayerId,
            amount: args.amount,
        });

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Batched form of `selectTarget` (issue #1779 / PRD #1776 T4): apply a full
 *  ordered array of target selections in ONE transaction/round-trip instead
 *  of one mutation per target — the CR 601.2d divide-as-you-choose buffer
 *  (`useDivideBuffer`) and the vs-AI bot executor (which already knows the
 *  whole target set before dispatch) both drive this instead of looping
 *  `selectTarget`. Preserves per-target divide-as-you-choose amounts and
 *  multi-group advance (CR 601.2c, Fumarole) exactly like the same calls made
 *  one at a time — see `applyOneTargetSelection`. Validation stays per-step:
 *  the FIRST illegal target throws and aborts the whole batch (nothing is
 *  persisted — `saveGameState` runs once, at the end). */
export const selectTargets = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        targets: v.array(
            v.object({
                targetType: v.union(
                    v.literal("permanent"),
                    v.literal("player"),
                    v.literal("spell"),
                    v.literal("graveyard-card")
                ),
                targetId: v.string(),
                targetPlayerId: v.optional(v.string()),
                amount: v.optional(v.number()),
            })
        ),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        if (args.targets.length === 0) {
            throw new Error("targets must include at least one entry");
        }
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "target",
        });

        // Issue #1779 review finding 6 — a batch entry answers the ONE
        // pending target selection the caller opened this batch against.
        // Finalizing that selection can immediately raise a NEW
        // `pendingTarget` (a chained targeted trigger,
        // `raiseTriggerTargetSelection`, CR 603.3d) — a DIFFERENT prompt the
        // batch never knew about. A single-call `selectTarget` can't hit
        // this bug (each call re-reads state fresh from the client's OWN
        // request for THAT prompt); the batch loop must pin the identity of
        // the selection it started against and REJECT a surplus entry
        // rather than silently answering whatever prompt happens to be live
        // next — misapplying it to the wrong selection.
        const openedPendingTarget = state.pendingTarget;
        for (const target of args.targets) {
            if (state.pendingTarget !== openedPendingTarget) {
                throw new Error(
                    "Target selection was already completed by an earlier entry in this batch"
                );
            }
            applyOneTargetSelection(state, args.playerId, target);
            // A finalized target selection has nothing left to assign;
            // further batch entries (over-supplied by a stale client plan)
            // are ignored rather than erroring an already-successful
            // selection.
            if (!state.pendingTarget) break;
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Finalize target selection for spells with a variable number of targets
 *  (CR 601.2c). Legal once at least `min` targets have been chosen. Fixed-N
 *  target requirements auto-advance in selectTarget and do not need this. */
export const confirmTargets = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "target",
        });

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        const pt = state.pendingTarget;
        if (pt.selected.length < minTargetCount(pt.count)) {
            throw new Error(
                `At least ${minTargetCount(pt.count)} target(s) required`
            );
        }
        // CR 601.2c — a variable-count group in a multi-group spell advances to
        // the next group here; a single-group spell finalizes.
        advanceTargetGroupOrFinalize(state, pt, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 603.3c/603.3d — resolve a cancel of a `kind:"trigger"` pending target.
 *  A triggered ability chooses its target(s) as it goes on the stack; it is
 *  NOT part of a cast to abort. Cancelling must never leave the trigger on the
 *  stack with `targets: undefined` to resolve doing nothing — an emblem's
 *  "deal 5 damage to any target" would silently deal 0. A MANDATORY target
 *  (min > 0) that the player declines removes the trigger from the stack
 *  entirely (CR 603.3c — no legal target chosen); an "up to" target (min 0)
 *  resolves with no target (`targets: []`). Then chain to any other
 *  still-untargeted trigger of the same batch; otherwise a fresh priority
 *  round begins with the active player. Pure over `GameState` for testability. */
export function cancelTriggerTargetSelection(state: GameState): void {
    const pt = state.pendingTarget;
    if (!pt || pt.kind !== "trigger") return;
    const min = typeof pt.count === "number" ? pt.count : pt.count.min;
    if (min > 0) {
        const idx = state.stack.findIndex((s) => s.id === pt.cardInstanceId);
        if (idx !== -1) state.stack.splice(idx, 1);
    } else {
        const trig = state.stack.find((s) => s.id === pt.cardInstanceId);
        if (trig) trig.targets = [];
    }
    state.pendingTarget = undefined;
    // Despite its name this also runs the CR 603.3c MODE announcement for any
    // still-un-announced modal trigger left on the stack (issue #2461).
    if (!raiseTriggerTargetSelection(state)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
    }
}

/** Cancel target selection and abort the cast. */
export const cancelTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "target",
        });

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        const cancelKind = state.pendingTarget.kind;

        // CR 603.3c/603.3d — a triggered ability chooses its target(s) as it
        // goes on the stack; a triggered target is NOT part of a cast to abort.
        if (cancelKind === "trigger") {
            cancelTriggerTargetSelection(state);
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        // CR 707.10b / 115.7 — declining a copy-retarget OR an original-spell
        // retarget (Reflecting Mirror) is not aborting a cast: the targeted
        // spell stays on the stack with its current targets and a fresh
        // priority round begins (the copying / retargeting effect has already
        // resolved).
        const wasRetarget =
            cancelKind === "copy-retarget" || cancelKind === "retarget";
        state.pendingTarget = undefined;
        if (wasRetarget) {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 508.1a (issue #1220) — assert `planeswalkerId` is a legal per-attacker
 *  attack target: a planeswalker the DEFENDING player controls (the only
 *  non-player thing an attacker may attack). Throws otherwise. Extracted from
 *  the `toggleAttacker` mutation so the boundary rule is unit-testable. */
export function assertLegalAttackTarget(
    defenderBattlefield: CardInstanceState[],
    planeswalkerId: string
): void {
    const pw = defenderBattlefield.find((c) => c.id === planeswalkerId);
    if (!pw || !isPlaneswalker(pw)) {
        throw new Error(
            "Attack target must be a planeswalker the defending player controls"
        );
    }
}

/** Toggle a creature in/out of the attacker selection (visible to both clients
 *  in real-time). When `planeswalkerId` is supplied, the creature attacks that
 *  planeswalker (CR 508.1a, issue #1220) rather than the defending player:
 *  - selecting a creature with `planeswalkerId` declares it attacking the PW;
 *  - re-supplying `planeswalkerId` for an already-declared attacker retargets it
 *    (or clears the target back to the player when it already attacks that PW);
 *  - omitting `planeswalkerId` toggles declaration as before (target = player). */
export const toggleAttacker = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        planeswalkerId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        if (state.phase !== "DECLARE_ATTACKERS") {
            throw new Error("Not in DECLARE_ATTACKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player can declare attackers");
        }
        if (!state.combat || state.combat.confirmed) {
            throw new Error("Attacker selection is not open");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        const defenderBattlefield = getPlayer(
            state,
            getOpponentId(state, args.playerId)
        ).battlefield;

        // CR 508.1a (issue #1220) — validate an optional planeswalker attack
        // target: it must be a planeswalker the DEFENDING player controls. Its
        // presence routes this attacker's combat damage to the planeswalker's
        // loyalty instead of the defending player.
        if (args.planeswalkerId !== undefined) {
            assertLegalAttackTarget(defenderBattlefield, args.planeswalkerId);
        }

        const idx = state.combat.attackerIds.indexOf(args.cardInstanceId);
        if (idx !== -1 && args.planeswalkerId !== undefined) {
            // Already-declared attacker + a planeswalker target: retarget it
            // (CR 508.1a). If it already attacks that same planeswalker, clear
            // the target back to the defending player (toggle-off); otherwise
            // point it at the planeswalker. Never a deselection.
            const targets = state.combat.attackTargets ?? {};
            if (targets[args.cardInstanceId] === args.planeswalkerId) {
                delete targets[args.cardInstanceId];
            } else {
                targets[args.cardInstanceId] = args.planeswalkerId;
            }
            state.combat.attackTargets =
                Object.keys(targets).length > 0 ? targets : undefined;
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }
        if (idx !== -1) {
            // CR 508.1d: can't deselect a creature required to attack
            if (mustAttack(card, state, defenderBattlefield)) {
                throw new Error(
                    `${getDefinition(card.card.id as string).name} must attack this combat if able`
                );
            }
            state.combat.attackerIds.splice(idx, 1);
            // Drop any planeswalker attack target for the deselected attacker.
            if (state.combat.attackTargets?.[args.cardInstanceId]) {
                delete state.combat.attackTargets[args.cardInstanceId];
                if (Object.keys(state.combat.attackTargets).length === 0) {
                    state.combat.attackTargets = undefined;
                }
            }
            // CR 702.22f: a deselected attacker leaves any band it was in.
            // Drop the now-stale member and discard bands that fall below a
            // legal size (need 2+ members, 1+ with banding).
            if (state.combat.bands) {
                state.combat.bands = state.combat.bands
                    .map((b) => ({
                        ...b,
                        memberIds: b.memberIds.filter(
                            (id) => id !== args.cardInstanceId
                        ),
                    }))
                    .filter((b) => {
                        if (b.memberIds.length < 2) return false;
                        const members = b.memberIds
                            .map((id) =>
                                player.battlefield.find((c) => c.id === id)
                            )
                            .filter((c): c is NonNullable<typeof c> => !!c);
                        // CR 702.22c / 702.22j — the surviving members must
                        // still form a legal band (plain or bands-with-other).
                        return isLegalBandComposition(members);
                    });
                if (state.combat.bands.length === 0) {
                    state.combat.bands = undefined;
                }
            }
        } else {
            // Select — must be eligible
            const validation = validateAttackerEligibility(
                card,
                defenderBattlefield,
                state
            );
            if (!validation.eligible) {
                throw new Error(validation.reason);
            }
            // CR 508.1a — a battlefield-wide cap on how many creatures may be
            // declared as attackers each combat (Caverns of Despair at two,
            // Dueling Grounds at one). The cap is global regardless of who
            // controls the source; reject the selection that would push the
            // count past it. The whole-set twin of this check runs at confirm
            // (`validateDeclaredAttackers`).
            const attackerCap = getAttackerCapEffect(state);
            if (
                attackerCap !== undefined &&
                state.combat.attackerIds.length >= attackerCap.max
            ) {
                throw new Error(attackerCap.oracleText);
            }
            state.combat.attackerIds.push(args.cardInstanceId);
            // CR 508.1a (issue #1220) — record the planeswalker this attacker is
            // attacking, if one was chosen at declaration. Absence = the
            // defending player.
            if (args.planeswalkerId !== undefined) {
                state.combat.attackTargets = {
                    ...(state.combat.attackTargets ?? {}),
                    [args.cardInstanceId]: args.planeswalkerId,
                };
            }
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Group selected attackers into a band (CR 702.22c). A band must hold 2+
 *  attackers, at least one with banding and at most one without, and no
 *  attacker may belong to more than one band. */
export const createBand = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        memberIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        if (state.phase !== "DECLARE_ATTACKERS") {
            throw new Error("Not in DECLARE_ATTACKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player can form bands");
        }
        if (!state.combat || state.combat.confirmed) {
            throw new Error("Attacker selection is not open");
        }
        if (args.memberIds.length < 2) {
            throw new Error("A band needs at least two creatures");
        }
        if (new Set(args.memberIds).size !== args.memberIds.length) {
            throw new Error("A band cannot list the same creature twice");
        }

        const player = getPlayer(state, args.playerId);
        const members = args.memberIds.map((id) => {
            if (!state.combat!.attackerIds.includes(id)) {
                throw new Error("All band members must be declared attackers");
            }
            const card = player.battlefield.find((c) => c.id === id);
            if (!card) throw new Error("Band member not on battlefield");
            return card;
        });

        // CR 702.22c: 1+ creature with banding, at most 1 without.
        if (!isLegalBandComposition(members)) {
            throw new Error(
                "A band needs a creature with banding and at most one creature without"
            );
        }

        // No member may already belong to another band.
        const existing = state.combat.bands ?? [];
        for (const b of existing) {
            if (b.memberIds.some((id) => args.memberIds.includes(id))) {
                throw new Error("A creature can only be in one band");
            }
        }

        const bandId = `band-${[...args.memberIds].sort().join(":")}`;
        state.combat.bands = [
            ...existing,
            { bandId, memberIds: [...args.memberIds] },
        ];

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Disband a previously declared band (CR 702.22c — band declaration is part
 *  of the still-open attacker declaration and can be revised). */
export const removeBand = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        bandId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        if (state.phase !== "DECLARE_ATTACKERS") {
            throw new Error("Not in DECLARE_ATTACKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player can form bands");
        }
        if (!state.combat || state.combat.confirmed) {
            throw new Error("Attacker selection is not open");
        }

        state.combat.bands = (state.combat.bands ?? []).filter(
            (b) => b.bandId !== args.bandId
        );
        if (state.combat.bands.length === 0) state.combat.bands = undefined;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Finalize the attacker declaration once every combat-declaration cost is paid
 *  (CR 508): tap and mark the attackers, open blocker declaration, fire the
 *  "when creatures attack" triggers, and hand priority to the active player.
 *  Shared by the inline path (fungible/no tax) and the selectSacrifice resume
 *  path (attack sacrifice tax chosen). */
/** Charges `rawCost` to `controllerId` by auto-tapping their mana sources
 *  (generic/fungible; CR 605.1a taps produce mana into the pool, CR 601.2g pays
 *  from it) and committing lands used for the cost. Throws `reason` when the
 *  cost cannot be covered — the caller's mutation clone is discarded, so no
 *  partial state persists. Used by the pay-to-block bypass (Hipparion
 *  `bypassCost`, `collectBlockBypassCharges`). The per-attacker mana attack tax
 *  no longer auto-taps here — it parks on `combat.pendingAttackManaTax` and the
 *  attacking player pays it via a prompt (`beginAttackManaTax` /
 *  `autoTapForAttackTax`, #1053/#1066). Pure apart from mutating `state`. */
function chargeManaCostOrThrow(
    state: GameState,
    controllerId: string,
    rawCost: ManaCost,
    reason: string
): void {
    const payer = getPlayer(state, controllerId);
    const subs = getManaSubstitutions(state, controllerId);
    const sources = buildAutoTapSources(
        payer.battlefield,
        manaGateBattlefields(state)
    );
    const cost = normalizeManaCost(rawCost);
    const plan = solveSmartAutoTap(payer.manaPool, cost, subs, sources);
    if (plan === null) {
        throw new Error(reason);
    }
    // Execute the plan: tap the chosen sources and add their mana to the pool
    // (CR 605.1a), then pay the cost from the pool (CR 601.2g).
    const tappedIds = new Set(plan.map((step) => step.cardId));
    for (const src of payer.battlefield) {
        if (tappedIds.has(src.id)) src.isTapped = true;
    }
    const produced = manaFromPlan(sources, plan);
    for (const color of Object.keys(produced)) {
        const v = produced[color as keyof typeof produced];
        if (v) {
            payer.manaPool[color] = (payer.manaPool[color] ?? 0) + v;
        }
    }
    payManaCost(payer.manaPool, cost, subs);
    commitLandsForCost(payer, cost);
}

export function finalizeConfirmAttackers(state: GameState): void {
    const player = getPlayer(state, state.activePlayerId);
    const combat = state.combat;
    if (!combat) return;
    // Tap and mark each attacker (vigilance creatures don't tap)
    for (const attackerId of combat.attackerIds) {
        const card = player.battlefield.find((c) => c.id === attackerId);
        if (card) {
            if (!card.staticAbilities.includes("vigilance")) {
                // CR 708.9 / ADR 0013 — a face-down attacker turns up as it
                // taps to attack.
                tapPermanent(state, card);
            }
            // Shared helper (`gre/combat.ts`, issue #1195) — sets BOTH
            // `combat.attackerIds` membership (already true here; idempotent)
            // AND `isAttacking` together, the single sync point every
            // combat-scoped read depends on.
            markAttacking(state, card);
            // CR 506.3 — the shared declaration record: per-card
            // `hasAttackedThisTurn` plus the game-level
            // `creatureAttackedThisTurn` (issue #1944).
            recordAttackerDeclared(state, card);
        }
    }
    combat.confirmed = true;
    combat.blockerAssignments = {};
    combat.blockersConfirmed = false;
    // ADR 0012 — fire "when creatures attack" triggers (Raging River).
    emitAttackersDeclaredEvents(state);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    drainAutoPasses(state);
}

/** Aggregate a list of mana costs into a single ManaCost (CR 508.1c/1g — one
 *  charge per taxed attacker per taxing source). Each cost is normalized (a
 *  numeric `{X}` folded into generic), then summed per colour; the total generic
 *  lands in `generic`. Colourless-generic-only in practice (attack taxes are all
 *  `{N}`), but colour-safe. Returns `{}` when every charge is zero (Domain-0
 *  Collective Restraint), which the caller reads as "no tax". */
function aggregateManaCosts(costs: ManaCost[]): ManaCost {
    const total: Record<string, number> = {};
    for (const c of costs) {
        for (const [k, v] of Object.entries(normalizeManaCost(c))) {
            if (typeof v === "number" && v > 0) total[k] = (total[k] ?? 0) + v;
        }
    }
    const result: ManaCost = {};
    for (const [k, v] of Object.entries(total)) {
        if (v <= 0) continue;
        // normalizeManaCost stores the whole generic total under key "X".
        if (k === "X") result.generic = (result.generic ?? 0) + v;
        else (result as Record<string, number>)[k] = v;
    }
    return result;
}

/** CR 508.1c/1g — park the per-attacker MANA attack tax (Propaganda / Ghostly
 *  Prison / Collective Restraint) so the attacking player PAYS it via a prompt
 *  (auto-tap or manual land taps) instead of the engine silently auto-tapping.
 *  Aggregates every taxed-attacker charge into one payment on
 *  `combat.pendingAttackManaTax`. Returns true when a payment was parked (the
 *  caller saves and returns, suspending the declaration); false when there is no
 *  tax (or it aggregates to zero — Domain 0), in which case the declaration
 *  continues to the sacrifice tax + finalize. */
export function beginAttackManaTax(state: GameState): boolean {
    const combat = state.combat;
    if (!combat) return false;
    const charges = collectAttackManaTax(state);
    if (charges.length === 0) return false;
    // The directed "creatures can't attack YOU" tax is always paid by the
    // attacking (active) player, so all charges share one payer. A future
    // multi-payer tax would need per-payer prompts — flag rather than mis-charge.
    if (new Set(charges.map((c) => c.controllerId)).size > 1) {
        throw new Error("Multi-payer attack mana tax is not supported");
    }
    const cost = aggregateManaCosts(charges.map((c) => c.cost));
    // Domain-0 Collective Restraint (every {X} = 0) — the attack is free.
    if (Object.keys(normalizeManaCost(cost)).length === 0) return false;
    combat.pendingAttackManaTax = {
        playerId: charges[0].controllerId,
        cost,
        reason: charges[0].reason,
        tappedLandIds: [],
    };
    return true;
}

/** CR 508.1c/1g / 701.21a — the per-attacker land-SACRIFICE attack tax (Flooded
 *  Woodlands, Reclamation) plus the finalize. Factored out of confirmAttackers so
 *  both the inline path and the mana-tax resume path (`tryCommitAttackManaTax`)
 *  run the identical continuation. Returns true when the declaration parked on a
 *  real sacrifice choice (`combat.pendingAttackSacrifice` — the caller saves and
 *  waits); false once the attack was finalized. Throws when the payer has too few
 *  lands to pay (the declaration is illegal — pre-existing Flooded Woodlands
 *  behavior, unchanged). */
function applyAttackSacrificeTaxAndFinalize(state: GameState): boolean {
    const combat = state.combat;
    if (!combat) return false;
    const charges = collectAttackSacrificeTax(state);
    if (charges.length > 0) {
        // The attack-tax cards tax the attacking (active) player, so all
        // charges share one controller. A future multi-payer tax would need a
        // per-payer selection — flag it rather than silently paying one.
        if (new Set(charges.map((c) => c.controllerId)).size > 1) {
            throw new Error(
                "Multi-payer attack sacrifice tax is not supported"
            );
        }
        const payerId = charges[0].controllerId;
        const landFilter: PermanentFilter = { types: ["Land"] };
        const totalNeeded = charges.reduce((a, ch) => a + ch.count, 0);
        if (
            sacrificeCandidates(state, payerId, landFilter).length < totalNeeded
        ) {
            throw new Error(charges[0].reason);
        }
        const sel: SacrificeSelection = {
            playerId: payerId,
            reason: charges[0].reason,
            requirements: buildSacrificeRequirements(
                charges.map((ch) => ({ filter: landFilter, count: ch.count }))
            ),
            picked: [],
        };
        autoResolveFungible(state, sel);
        if (!isSacrificeSelectionComplete(sel)) {
            // Park the choice; selectSacrifice resumes finalizeConfirmAttackers.
            combat.pendingAttackSacrifice = sel;
            return true;
        }
        applySacrificeSelection(state, sel);
    }
    finalizeConfirmAttackers(state);
    return false;
}

/** If the payer's mana pool now covers the parked attack mana tax, pay it (CR
 *  601.2g), commit the lands tapped for it, clear the parking, and RESUME the
 *  declaration through the sacrifice-tax + finalize continuation. Returns true
 *  when it committed (nothing further to pay). No-op / false while the pool is
 *  short — the player keeps tapping (or cancels). */
export function tryCommitAttackManaTax(state: GameState): boolean {
    const combat = state.combat;
    const pending = combat?.pendingAttackManaTax;
    if (!combat || !pending) return false;
    const payer = getPlayer(state, pending.playerId);
    const subs = getManaSubstitutions(state, pending.playerId);
    const cost = normalizeManaCost(pending.cost);
    if (!isManaCostCovered(payer.manaPool, cost, subs)) return false;
    payManaCost(payer.manaPool, cost, subs);
    commitLandsForCost(payer, cost);
    combat.pendingAttackManaTax = undefined;
    applyAttackSacrificeTaxAndFinalize(state);
    return true;
}

/** Lock in the attacker selection, tap attackers, and pass priority. */
export const confirmAttackers = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });

        if (state.phase !== "DECLARE_ATTACKERS") {
            throw new Error("Not in DECLARE_ATTACKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player can confirm attackers");
        }
        if (!state.combat) {
            throw new Error("Attacker selection is not open");
        }
        // Idempotent re-fire guard: a fast double-press (Space×2) queues two
        // confirmAttackers mutations. The first locks in the selection
        // (`combat.confirmed`) and passes priority; the second used to throw an
        // uncaught 500 ("Attacker selection is not open") that froze the client
        // until refresh. Confirming is idempotent — once the selection is
        // confirmed the desired end-state already holds, so the redundant call
        // is a benign no-op instead of a fatal error.
        if (state.combat.confirmed) {
            return;
        }

        const player = getPlayer(state, args.playerId);

        // CR 508.1c/508.1d: normalize the player's selection into the legal
        // declaration — fold in every eligible creature required to attack,
        // capped by the battlefield-wide declared-attacker cap (CR 508.1a),
        // which as a RESTRICTION outranks the requirements. `foldAttackRequirements`
        // (`gre/combat.ts`) is the one authority the bot's move enumeration
        // shares, so the mutation can never accept a declaration the enumerator
        // considers illegal. A voluntary attacker that would crowd a must-attack
        // creature out of the last slot is dropped here — it was never part of a
        // legal declaration.
        const defenderBattlefield = getPlayer(
            state,
            getOpponentId(state, args.playerId)
        ).battlefield;
        const foldedAttackers = foldAttackRequirements(
            state.combat.attackerIds,
            getRequiredAttackerIds(
                player.battlefield,
                state,
                defenderBattlefield,
                state.allCreaturesMustAttack
            ),
            getAttackerCapEffect(state)?.max
        );
        const droppedAttackers = state.combat.attackerIds.filter(
            (id) => !foldedAttackers.includes(id)
        );
        state.combat.attackerIds = foldedAttackers;
        if (droppedAttackers.length > 0) {
            // A dropped attacker takes its planeswalker attack target (CR
            // 508.1a) and its band membership (CR 702.22f) with it — the same
            // cleanup the deselect branch of `toggleAttacker` performs.
            if (state.combat.attackTargets) {
                for (const id of droppedAttackers) {
                    delete state.combat.attackTargets[id];
                }
                if (Object.keys(state.combat.attackTargets).length === 0) {
                    state.combat.attackTargets = undefined;
                }
            }
            if (state.combat.bands) {
                state.combat.bands = state.combat.bands
                    .map((b) => ({
                        ...b,
                        memberIds: b.memberIds.filter(
                            (id) => !droppedAttackers.includes(id)
                        ),
                    }))
                    .filter((b) => {
                        if (b.memberIds.length < 2) return false;
                        const members = b.memberIds
                            .map((id) =>
                                player.battlefield.find((c) => c.id === id)
                            )
                            .filter((c): c is NonNullable<typeof c> => !!c);
                        return isLegalBandComposition(members);
                    });
                if (state.combat.bands.length === 0) {
                    state.combat.bands = undefined;
                }
            }
        }

        // CR 508.1c-d — count-aware attack restrictions (Errantry "can only
        // attack alone", Orcish Conscripts "can't attack unless at least two
        // other creatures attack"). These read the COMPLETE declared-attacker
        // set, so they are enforced here at confirm rather than per-attacker at
        // selection (the mirror of validateMinimumBlockers).
        const declaredAttackCheck = validateDeclaredAttackers(state);
        if (!declaredAttackCheck.ok) {
            throw new Error(declaredAttackCheck.reason);
        }

        // CR 508.1c/1g — per-attacker MANA attack tax directed at the taxing
        // player (Propaganda / Ghostly Prison / Windborn Muse / Collective
        // Restraint, #1053/#1066). Each attacker declared against a taxing player
        // forces its controller to pay {X}. Rather than silently auto-tapping the
        // payer's lands (or throwing when unpayable — the reported bug), the
        // declaration PARKS on `combat.pendingAttackManaTax` and the player pays
        // via a prompt (Auto-tap or manual land taps), mirroring a cast payment.
        // Charged BEFORE the land-sacrifice tax; the two never park at once (the
        // mana tax resumes into the sacrifice tax once paid).
        if (beginAttackManaTax(state)) {
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        // CR 508.1c/1g / 701.21a — per-attacker sacrifice-a-land attack tax
        // (Flooded Woodlands, Reclamation, #733) then finalize. Parks on a real
        // sacrifice choice (`combat.pendingAttackSacrifice`) or finalizes inline.
        if (applyAttackSacrificeTaxAndFinalize(state)) {
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 508.1c/1g — pay the parked attack MANA tax (Propaganda / Collective
 *  Restraint) by AUTO-TAPPING the payer's mana sources toward it. When the pool
 *  then covers the cost the declaration resumes and finalizes; a partial plan
 *  leaves the banner up so the player finishes by hand (or cancels). The
 *  attack-side analogue of `autoTapForPayment`. */
export const autoTapForAttackTax = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "attack-mana-tax",
        });

        const pending = state.combat?.pendingAttackManaTax;
        if (!pending || pending.playerId !== args.playerId) {
            throw new Error("No attack tax to pay");
        }

        const player = getPlayer(state, args.playerId);
        const subs = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(
            player.battlefield,
            manaGateBattlefields(state)
        );
        const cost = normalizeManaCost(pending.cost);
        // Prefer a minimal full plan; fall back to the maximal-useful partial
        // (a manual source like Black Lotus still owed) so we tap what we can.
        const plan =
            solveSmartAutoTap(player.manaPool, cost, subs, sources) ??
            solveAutoTapPartial(player.manaPool, cost, subs, sources);
        for (const step of plan) {
            const card = player.battlefield.find((c) => c.id === step.cardId);
            if (!card || card.isTapped) continue;
            tapSourceIntoPayment(
                state,
                player,
                card,
                step.manaChoiceIndex,
                pending.tappedLandIds
            );
        }

        // Commit + resume the declaration only if the cost is now fully covered.
        tryCommitAttackManaTax(state);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 508.1c/1g — tap ONE mana source by hand toward the parked attack mana tax
 *  (the manual analogue of `tapForPayment`). Auto-commits + resumes the
 *  declaration once the pool covers the cost. */
export const tapForAttackTax = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        /** Required for sources with manaChoices (duals, Birds, Black Lotus). */
        manaChoiceIndex: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "attack-mana-tax",
        });

        const pending = state.combat?.pendingAttackManaTax;
        if (!pending || pending.playerId !== args.playerId) {
            throw new Error("No attack tax to pay");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        tapSourceIntoPayment(
            state,
            player,
            card,
            args.manaChoiceIndex,
            pending.tappedLandIds
        );
        tryCommitAttackManaTax(state);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 508.1c/1g — untap a source tapped for the attack mana tax (undo one tap,
 *  the analogue of `untapForPayment`). */
export const untapForAttackTax = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "attack-mana-tax",
        });

        const pending = state.combat?.pendingAttackManaTax;
        if (!pending || pending.playerId !== args.playerId) {
            throw new Error("No attack tax to pay");
        }

        const idx = pending.tappedLandIds.indexOf(args.cardInstanceId);
        if (idx === -1) {
            throw new Error("This land was not tapped during this tax");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Cannot undo: source was sacrificed");

        untapSourceFromPayment(state, player, card);
        pending.tappedLandIds.splice(idx, 1);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 508.1c/1g — cancel the whole attacker declaration rather than pay the
 *  parked mana tax. Untaps every source tapped for the tax (refunding its mana),
 *  clears the parking, and empties the declared-attacker set so the active player
 *  returns to attacker selection. No attacker was tapped or marked attacking yet
 *  (that happens only at finalize), so nothing else needs undoing. */
export const cancelAttackTax = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "attack-mana-tax",
        });

        const combat = state.combat;
        const pending = combat?.pendingAttackManaTax;
        if (!combat || !pending || pending.playerId !== args.playerId) {
            throw new Error("No attack tax to cancel");
        }

        const player = getPlayer(state, args.playerId);
        for (const cardId of pending.tappedLandIds) {
            const card = player.battlefield.find((c) => c.id === cardId);
            if (card) untapSourceFromPayment(state, player, card);
        }
        combat.pendingAttackManaTax = undefined;
        // Return to attacker selection: drop the declared attackers/bands. The
        // active player still holds priority at DECLARE_ATTACKERS, so they can
        // re-declare (or decline to attack).
        combat.attackerIds = [];
        combat.bands = undefined;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Who declares this combat's blocks (CR 509.1). Normally the defending
 *  player; under Melee (`meleeCombat`, #669) the ATTACKING (active) player
 *  drives the block declaration instead. The blocking creatures are always the
 *  defender's — only the chooser changes. */
function getBlockDeclarerId(state: GameState): string {
    return state.meleeCombat
        ? state.activePlayerId
        : getOpponentId(state, state.activePlayerId);
}

/** Select a blocker (or deselect/unassign if already selected/assigned). */
export const selectBlocker = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "blockers",
        });

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        // Melee (CR 509.1 variant, #669) — under `meleeCombat` the ATTACKING
        // (active) player declares blocks; otherwise the defending player does.
        if (args.playerId !== getBlockDeclarerId(state)) {
            throw new Error("You can't declare blockers right now");
        }

        // The blocking creatures are always the DEFENDING player's, even when
        // Melee routes the declaration to the attacker.
        const defenderId = getOpponentId(state, state.activePlayerId);

        // If this card is already assigned as a blocker, unassign it
        if (state.combat.blockerAssignments[args.cardInstanceId]?.length > 0) {
            delete state.combat.blockerAssignments[args.cardInstanceId];
            if (state.combat.pendingBlockerId === args.cardInstanceId) {
                state.combat.pendingBlockerId = undefined;
            }
        } else if (state.combat.pendingBlockerId === args.cardInstanceId) {
            // If it's the current pending, deselect
            state.combat.pendingBlockerId = undefined;
        } else {
            // Select as pending: validate it's an eligible creature
            const player = getPlayer(state, defenderId);
            const card = player.battlefield.find(
                (c) => c.id === args.cardInstanceId
            );
            if (!card) throw new Error("Card not on battlefield");
            const types = card.types;
            if (!types.includes("Creature")) {
                throw new Error("Only creatures can block");
            }
            if (card.isTapped) throw new Error("Tapped creatures cannot block");
            state.combat.pendingBlockerId = args.cardInstanceId;
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Assign the pending blocker to an attacker. */
export const assignBlockerTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        attackerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "blockers",
        });

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        // Melee (#669) — the attacker assigns blocks under `meleeCombat`.
        if (args.playerId !== getBlockDeclarerId(state)) {
            throw new Error("You can't assign blockers right now");
        }
        if (!state.combat.pendingBlockerId) {
            throw new Error("No blocker selected");
        }
        if (!state.combat.attackerIds.includes(args.attackerId)) {
            throw new Error("Target is not an attacker");
        }

        // Evasion checks (CR 509.1b): flying (CR 702.9) + landwalk (CR 702.14).
        const activePlayer = getPlayer(state, state.activePlayerId);
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === args.attackerId
        );
        // The blocking creatures are the DEFENDING player's, even when Melee
        // routes the declaration to the attacker.
        const defender = getPlayer(
            state,
            getOpponentId(state, state.activePlayerId)
        );
        const blocker = defender.battlefield.find(
            (c) => c.id === state.combat!.pendingBlockerId
        );
        if (attacker && blocker) {
            const check = validateBlockerEligibility(
                attacker,
                blocker,
                defender.battlefield,
                state
            );
            if (!check.eligible) {
                throw new Error(check.reason);
            }
        }

        const blockerId = state.combat.pendingBlockerId;
        const existing = state.combat.blockerAssignments[blockerId] ?? [];
        // CR 509.1a — a battlefield-wide cap on how many creatures may be
        // declared as blockers each combat (Caverns of Despair at two, Dueling
        // Grounds at one). The cap counts distinct blocking creatures, not
        // blocking assignments; a creature already blocking may still take a
        // second attacker (Two-Headed Giant) without consuming a new slot.
        // Reject only a NEW blocker that would push the count past the cap.
        const blockerCap = getBlockerCapEffect(state);
        if (
            blockerCap !== undefined &&
            existing.length === 0 &&
            Object.keys(state.combat.blockerAssignments).filter(
                (id) => (state.combat!.blockerAssignments[id] ?? []).length > 0
            ).length >= blockerCap.max
        ) {
            throw new Error(blockerCap.oracleText);
        }
        const maxAttackers = blocker ? getMaxBlockTargets(blocker) : 1;
        if (existing.length >= maxAttackers) {
            throw new Error(
                `This creature can only block ${maxAttackers} attacker${maxAttackers > 1 ? "s" : ""}`
            );
        }
        state.combat.blockerAssignments[blockerId] = [
            ...existing,
            args.attackerId,
        ];
        state.combat.pendingBlockerId = undefined;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Confirm blocker declarations. */
export const confirmBlockers = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "blockers",
        });

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        // Melee (#669) — the attacker confirms blocks under `meleeCombat`.
        if (args.playerId !== getBlockDeclarerId(state)) {
            throw new Error("You can't confirm blockers right now");
        }

        // CR 509.1c: auto-assign must-block requirements (Lure, Blaze of Glory)
        // CR 509.1a/509.1c — `foldBlockRequirements` (`gre/combat.ts`) is the
        // one authority: it adds every must-block assignment the declared-
        // blocker cap leaves room for, gives an already-blocking creature a
        // further attacker for free (the cap counts creatures, not
        // assignments), and — when the cap is full — drops a VOLUNTARY blocker
        // to make room rather than silently skipping the requirement.
        foldBlockRequirements(state);

        // CR 509.1b / 702.111 — minimum-blocker thresholds (menace). A
        // declaration where a menace attacker is blocked by exactly one creature
        // is illegal; this can only be judged once the full block set is known
        // (after must-block auto-assignment above), so it is enforced here at
        // confirm time rather than per-blocker at assignment time.
        const minBlockerCheck = validateMinimumBlockers(state);
        if (!minBlockerCheck.ok) {
            throw new Error(minBlockerCheck.reason);
        }

        // CR 509.1b — count-aware block restrictions (Orcish Conscripts "can't
        // block unless at least two other creatures block"). Judged over the
        // COMPLETE declared-blocker set, so enforced here at confirm.
        const declaredBlockCheck = validateDeclaredBlockers(state);
        if (!declaredBlockCheck.ok) {
            throw new Error(declaredBlockCheck.reason);
        }

        // CR 509.1b — pay-to-block bypass costs (Hipparion "can't block
        // creatures with power 3 or greater unless you pay {1}"). The cost is
        // charged once per qualifying block; the engine auto-taps the blocking
        // player's mana sources (generic-only). If a charge can't be paid, the
        // block declaration is rejected and the player must reassign.
        for (const charge of collectBlockBypassCharges(state)) {
            chargeManaCostOrThrow(
                state,
                charge.controllerId,
                charge.cost,
                charge.reason
            );
        }

        // CR 509.1a — mark each assigned blocker (and re-materialize the
        // condition-bearing statics that read `isBlocking`, e.g. Snow Devil's
        // conditional first strike) BEFORE anything downstream reads
        // `staticAbilities`: `drainAutoPasses` below can run all the way into
        // `advancePhase`'s CR 510.4 first-strike-step skip decision without an
        // intervening SBA pass (issue #1826).
        markDeclaredBlockers(state);

        state.combat.pendingBlockerId = undefined;
        state.combat.blockersConfirmed = true;
        recordBlockedAttackers(state);
        // Melee (#669) — untap and remove from combat every attacker that ended
        // up unblocked this combat. No-op unless `meleeCombat` is set.
        applyMeleeUnblockedRider(state);
        emitBlockersConfirmedEvents(state);

        // CR 509.2 — active player gets priority immediately after blockers
        // are declared. The historic damage-assignment-order turn-based
        // action was removed: per CR 510.1c/d the attacking player divides
        // combat damage freely among multiple blockers during the combat
        // damage step.
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Set damage distribution for an attacker with multiple blockers. */
export const setDamageAssignment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        // Combat-damage source: an attacker or, under banding, a blocker.
        // `attackerId` kept as the field name for wire compatibility.
        attackerId: v.string(),
        assignments: v.any(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
            anyPlayer: true,
        });

        if (
            state.phase !== "FIRST_STRIKE_DAMAGE" &&
            state.phase !== "COMBAT_DAMAGE"
        ) {
            throw new Error("Not in a combat damage step");
        }
        if (!state.combat || state.combat.damageConfirmed !== false) {
            throw new Error("Damage assignment is not open");
        }

        const sourceId = args.attackerId;
        // CR 702.22j-k: the assigner is recorded per source. Without banding
        // this is always the active player (the attacker's controller).
        const assignerId = state.combat.damageAssignerIds?.[sourceId];
        if (!assignerId) {
            throw new Error(`${sourceId} has no damage to assign`);
        }
        if (args.playerId !== assignerId) {
            throw new Error(
                "Only the player who controls the banding creature assigns this damage"
            );
        }

        const assignments = args.assignments as Record<string, number>;

        // Locate the source on either battlefield.
        let source: CardInstanceState | undefined;
        for (const p of state.players) {
            const f = p.battlefield.find((c) => c.id === sourceId);
            if (f) {
                source = f;
                break;
            }
        }
        if (!source) throw new Error("Damage source not on battlefield");

        // CR 510.1c: the assignable budget is the source's combat damage, i.e.
        // its EFFECTIVE power after the layer pipeline (CR 613.4, including
        // temporary P/T mods from combat tricks). Reading the raw base `power`
        // field ignores buffs like Giant Growth and wrongly rejects legal
        // assignments.
        const power = Math.max(0, getEffectivePower(state, source));
        const total = Object.values(assignments).reduce((sum, n) => sum + n, 0);
        if (total > power) {
            throw new Error(
                `Damage total (${total}) exceeds source power (${power})`
            );
        }

        const hasTrample = source.staticAbilities.includes("trample");
        const activePlayerId = state.activePlayerId;
        const defenderId = getOpponentId(state, activePlayerId);
        const graph = getEffectiveBlockGraph(state);
        const isAttacker = state.combat.attackerIds.includes(sourceId);
        // Legal targets: an attacker hits its blockers (or the defender with
        // trample); a blocker hits the band members it is blocking.
        const legalTargets = new Set(
            isAttacker
                ? (graph.blockersByAttacker[sourceId] ?? [])
                : (graph.attackersByBlocker[sourceId] ?? [])
        );

        // CR 702.19b — trample excess goes to "the player, planeswalker, or
        // battle the creature is attacking", which is ONE object: per
        // CR 702.19f a creature without trample-over-planeswalkers attacking a
        // planeswalker may assign NONE of its combat damage to the defending
        // player. So the sink is the attacked planeswalker when it is still on
        // the battlefield, else the defending player — the same id the seed
        // builders put in the pre-filled default (`attackTargetExcessSink`), so
        // the assigner can always edit its own default.
        const excessSinkIds = isAttacker
            ? [attackTargetExcessSink(state, sourceId, defenderId)]
            : [];

        for (const targetId of Object.keys(assignments)) {
            if (isAttacker && excessSinkIds.includes(targetId)) {
                if (!hasTrample) {
                    throw new Error(
                        "Only creatures with trample can assign damage to the defending player"
                    );
                }
                continue;
            }
            if (!legalTargets.has(targetId)) {
                throw new Error(
                    `${targetId} is not a legal damage target for ${sourceId}`
                );
            }
        }

        // CR 702.19b — "The attacking creature's controller need not assign
        // lethal damage to all those blocking creatures but in that case can't
        // assign any damage to the player or planeswalker it's attacking."
        // Deliberate under-assignment is therefore LEGAL on its own; it is only
        // the PAIR (a blocker below its lethal threshold AND damage to the
        // sink) that is rejected. The thresholds come from the same shared
        // helper the seed builders use, so the modal's pre-filled default can
        // never be rejected here. `state.combat.damageAssignments` is this
        // step's map (the damage step rebuilds it wholesale on entry), which is
        // the "damage from other creatures that's being assigned during the
        // same combat damage step" the threshold subtracts.
        const violation = damageAssignmentLethalViolation(
            state,
            sourceId,
            assignments,
            excessSinkIds
        );
        if (violation) {
            throw new Error(
                `${violation.blockerId} must be assigned lethal damage (${violation.threshold}) before damage is assigned to the player or planeswalker`
            );
        }

        if (!state.combat.damageAssignments) {
            state.combat.damageAssignments = {};
        }
        state.combat.damageAssignments[sourceId] = assignments;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Confirm one assigner's portion of combat damage. Damage applies once every
 *  distinct assigner has confirmed (CR 702.22j-k can split authority between
 *  the attacking and defending players). */
export const confirmDamage = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
            anyPlayer: true,
        });

        if (
            state.phase !== "FIRST_STRIKE_DAMAGE" &&
            state.phase !== "COMBAT_DAMAGE"
        ) {
            throw new Error("Not in a combat damage step");
        }
        if (!state.combat || state.combat.damageConfirmed !== false) {
            throw new Error("Damage assignment is not open");
        }

        const assignerIds = state.combat.damageAssignerIds ?? {};
        const distinctAssigners = new Set(Object.values(assignerIds));
        if (!distinctAssigners.has(args.playerId)) {
            throw new Error("You have no combat damage to assign");
        }

        const confirmedBy = new Set(
            state.combat.damageAssignmentConfirmedBy ?? []
        );
        confirmedBy.add(args.playerId);
        state.combat.damageAssignmentConfirmedBy = [...confirmedBy];

        // Wait for every distinct assigner before applying damage.
        const remaining = outstandingDamageAssigner(state.combat);
        if (remaining) {
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        const kind =
            state.phase === "FIRST_STRIKE_DAMAGE" ? "first-strike" : "regular";
        applyAllCombatDamage(state, state.combat.damageAssignments ?? {}, kind);
        state.combat.damageConfirmed = true;
        state.combat.damageAssignerIds = undefined;
        state.combat.damageAssignmentConfirmedBy = undefined;

        // Check SBA after combat damage (CR 704.5)
        checkStateBasedActions(state);

        if (!state.gameOver) {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

export const passPriority = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.priorityPlayerId !== args.playerId) {
            // A pass issued while this player does not hold priority is a
            // harmless misclick — the player mashed Space/Pass while the
            // opponent was acting (ADR 0047 "waiting for another player").
            // Silent no-op instead of a server error surfaced to the console.
            // Must run BEFORE assertExpectedInput, whose wrong-player throw
            // would otherwise shadow this benign case and log a server error.
            return;
        }

        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });
        assertNoPendingChoices(state);

        // CR 103.5: no priority is given during the pre-game mulligan phase.
        if (state.phase === "MULLIGAN") {
            throw new Error("Cannot pass priority during mulligan phase");
        }

        // Passing priority while a mana payment is still open abandons it
        // (CR 601.2 / 602.2): roll back the tapped lands and clear the banner
        // before the priority change so no stale pendingCast lingers.
        abandonPendingPayment(state, args.playerId);

        // Cannot pass priority before confirming attackers
        if (
            state.phase === "DECLARE_ATTACKERS" &&
            state.combat &&
            !state.combat.confirmed
        ) {
            throw new Error("Must declare attackers before passing priority");
        }

        // Cannot pass priority before confirming blockers
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            !state.combat.blockersConfirmed
        ) {
            throw new Error("Must declare blockers before passing priority");
        }

        // Cannot pass priority before confirming damage assignments
        if (
            (state.phase === "FIRST_STRIKE_DAMAGE" ||
                state.phase === "COMBAT_DAMAGE") &&
            state.combat &&
            state.combat.damageConfirmed === false
        ) {
            throw new Error(
                "Must assign combat damage before passing priority"
            );
        }

        state.passCount += 1;

        if (state.passCount >= 2 && state.stack.length > 0) {
            // Both players passed consecutively — resolve top of stack (CR 117.3d)
            resolveTopOfStack(state);
            if ((state.pendingChoices?.length ?? 0) > 0) {
                // Resolution suspended awaiting player choices (CR 608.2) — this
                // also covers the reflexive Madness cast-choice (CR 702.35a),
                // which resolveTopOfStack pushes as a blocking pending choice.
                // Hand priority to the chooser; the gate on passPriority and
                // other priority-driven mutations prevents any action other
                // than submitResolutionChoice.
                state.priorityPlayerId = state.pendingChoices![0].playerId;
            } else if (state.pendingTarget) {
                // Resolution requested a copy-retarget (CR 707.10b, Fork).
                // Hand priority to the chooser; only target-selection
                // mutations are legal until they choose or decline.
                state.priorityPlayerId = state.pendingTarget.playerId;
            } else {
                state.priorityPlayerId = state.activePlayerId;
                state.passCount = 0;
            }
        } else if (state.passCount >= 2 && state.stack.length === 0) {
            // Both passed with empty stack → advance phase/step
            advancePhase(state);
        } else {
            // Pass priority to opponent
            state.priorityPlayerId = getOpponentId(state, args.playerId);
        }

        // If the new priority holder has autoPass, keep draining
        drainAutoPasses(state);

        // Check SBA for game-ending conditions (CR 704.5)
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Atomic, client-buffered submission of the head pending choice (CR 608.2,
 *  ADR 0007). The chooser accumulates picks locally and submits the full
 *  list once. Validates identity (`stackItemId` + `step` + `choiceId` +
 *  `playerId`), zone membership, dedup, and count within `[min, max]`
 *  before dispatching to the existing finalize paths.
 *
 *  Slice #80 handles `discard-hand` only; other kinds (`untap-pick`,
 *  `mulligan-bottom`) still flow through `submitResolutionChoice` until
 *  their migration slices land. */
export const submitResolutionChoice = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        stackItemId: v.string(),
        step: v.number(),
        choiceId: v.string(),
        cardInstanceIds: v.array(v.string()),
        // `order-top` (scry/surveil) only — the un-kept looked-at cards sent to
        // the choice's destination. Omitted for every other choice kind.
        secondZoneIds: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });

        applyPendingChoiceSubmit(state, {
            playerId: args.playerId,
            stackItemId: args.stackItemId,
            step: args.step,
            choiceId: args.choiceId,
            cardInstanceIds: args.cardInstanceIds,
            secondZoneIds: args.secondZoneIds,
        });

        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Submits a yes/no decision to a pending `may-pay` choice (CR 117.3a / 118.4).
 *  When `accept` is true and the choice carries a mana cost, the cost is
 *  validated against the player's mana pool and paid; if the pool can't
 *  cover, the call throws (forcing the player to either tap mana abilities
 *  before submitting or decline). Lands tapped to make mana for this
 *  payment go through the normal `tapForPayment` flow. */
export const submitMayPay = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        accept: v.boolean(),
        // CR 701.21a — the payer's chosen sacrifice victim id(s) when the
        // may-pay's sacrifice leg admits a real choice. Omitted for a plain
        // yes/no may-pay or an auto-resolving single-candidate sacrifice.
        sacrificeIds: v.optional(v.array(v.string())),
        // CR 701.9 / 118.3 (issue #899) — the payer's chosen hand card id(s)
        // when the may-pay's discard leg admits a real choice. Omitted for a
        // plain yes/no may-pay or an auto-resolving discard.
        discardIds: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });

        applyMayPaySubmit(state, {
            playerId: args.playerId,
            accept: args.accept,
            sacrificeIds: args.sacrificeIds,
            discardIds: args.discardIds,
        });

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Answers a suspended `land-entry-tapped` pay-choice (CR 614.12, ADR 0051 —
 *  shock lands). `accept: true` pays the cost (e.g. 2 life) so the land enters
 *  untapped; `false` declines and it enters tapped. Completes the entry that
 *  `applyPlayLand` suspended before the zone move. Separate entry point from
 *  `submitMayPay` because a played land has no stack item to resume through. */
export const submitLandEntryChoice = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        accept: v.boolean(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });

        applyLandEntrySubmit(state, {
            playerId: args.playerId,
            accept: args.accept,
        });

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** CR 702.35a — declines a reflexive `madness-cast` choice: puts the exiled
 *  card into its owner's graveyard immediately. The ACCEPT ("Cast") is NOT here
 *  — the client fires the ordinary `announceCast` on the exiled card, which
 *  consumes the choice and runs the normal cast flow. This mutation is the
 *  decline-only counterpart, mirroring `submitLandEntryChoice`. */
export const submitMadnessDecline = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });
        const head = state.pendingChoices?.[0];
        if (
            !head ||
            head.kind !== "madness-cast" ||
            head.playerId !== args.playerId
        ) {
            throw new Error("No madness cast choice to decline");
        }

        declineMadness(state);
        // CR 117.3c — the reflexive ability is done; priority returns to the
        // active player. Drain any standing auto-pass so the game settles (and,
        // during a CR 514.3 cleanup window, leaves CLEANUP to the next turn).
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** CR 702.88c — declines a reflexive `rebound-cast` choice: the card "remains
 *  exiled" — NO zone change, unlike Madness's decline (which bins to the
 *  graveyard). The ACCEPT ("Cast") is NOT here — the client fires the
 *  ordinary `announceCast` on the exiled card, which consumes the choice and
 *  runs the normal (free) cast flow. This mutation is the decline-only
 *  counterpart, mirroring `submitMadnessDecline`. */
export const submitReboundDecline = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });
        const head = state.pendingChoices?.[0];
        if (
            !head ||
            head.kind !== "rebound-cast" ||
            head.playerId !== args.playerId
        ) {
            throw new Error("No rebound cast choice to decline");
        }

        declineRebound(state);
        // CR 117.3c — the reflexive ability is done; priority returns to the
        // active player. Drain any standing auto-pass so the game settles (and,
        // during a CR 514.3 cleanup window, leaves CLEANUP to the next turn).
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Answers a suspended `draw-replacement` choice (CR 614, ADR 0061 — Zur's
 *  Weirding). `accept: true` pays the life cost so the revealed would-be-drawn
 *  card goes to its owner's graveyard; `false` declines and the drawing player
 *  draws it. Separate entry point from `submitMayPay` because the turn-based
 *  draw step has no stack item to resume through (mirrors `submitLandEntryChoice`). */
export const submitDrawReplacementPay = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        accept: v.boolean(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });
        const head = state.pendingChoices?.[0];
        if (
            !head ||
            head.kind !== "draw-replacement" ||
            head.playerId !== args.playerId
        ) {
            throw new Error("No draw-replacement pay choice to answer");
        }

        finalizeDrawReplacementPay(state, args.accept);
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Submits a named card to a pending `name-card` choice (CR 202.3 / 701.x
 *  "chooses a card name"). The name is validated against the card registry —
 *  naming a card that isn't implemented is rejected (the client surfaces the
 *  throw as a toast). On success the canonical name is committed into the
 *  stack item and resolution resumes. Used by Petra Sphinx. */
export const submitNameCard = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardName: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });

        applyNameCardSubmit(state, {
            playerId: args.playerId,
            cardName: args.cardName,
        });

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Acknowledges a suspended `random-reveal` flip (CR 705.2, ADR 0023). Carries
 *  NO choice data — only "the animation finished, resume". The outcome was
 *  drawn once and persisted on the suspended step; this mutation validates the
 *  queue head, removes it, and re-enters resolution so the consequence is
 *  applied. The chooser's client fires this automatically when the coin
 *  animation ends; the same generic mutation serves coins and future dice. */
export const submitRandomRevealAck = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        stackItemId: v.string(),
        choiceId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "choice",
        });

        applyRandomRevealAck(state, {
            playerId: args.playerId,
            stackItemId: args.stackItemId,
            choiceId: args.choiceId,
        });

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Declare keep / mulligan during the pre-game mulligan phase (CR 103.5,
 *  London mulligan). Sequential per round in turn order from the starting
 *  player. Once every still-unlocked player has declared this round, the
 *  mulligan engine executes the round (mull players reshuffle + redraw 7,
 *  keep players lock). When all players are locked, bottoming PendingChoices
 *  are enqueued for any player who took at least one mulligan; their picks
 *  are applied via `submitResolutionChoice` (kind "mulligan-bottom"). */
export const declareMulligan = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        decision: v.union(v.literal("keep"), v.literal("mull")),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.phase !== "MULLIGAN") {
            throw new Error("Mulligan declarations only legal during MULLIGAN");
        }
        if (!state.mulligan) {
            throw new Error("Mulligan state missing");
        }
        if (state.mulligan.bottoming) {
            throw new Error("Cannot declare mulligan during bottoming");
        }

        recordDeclaration(state, args.playerId, args.decision);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** Set auto-pass: automatically pass priority for the rest of this turn.
 *  When the caller does NOT currently hold priority the request is recorded
 *  as a queued intent (`queuedEndTurn`) that fires via `drainAutoPasses` the
 *  moment priority next lands on them — pressing Enter is never a no-op. */
export const endTurn = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.phase === "MULLIGAN") {
            throw new Error("Cannot end turn during mulligan phase");
        }

        // Validate identity even on the queue path so a bad playerId is rejected.
        getPlayer(state, args.playerId);

        if (state.priorityPlayerId !== args.playerId) {
            // No priority: register a standing intent instead of acting now.
            // It will be promoted to a rest-of-turn auto-pass when priority
            // next reaches the player (see drainAutoPasses).
            const queued = state.queuedEndTurn ?? [];
            if (!queued.includes(args.playerId)) {
                queued.push(args.playerId);
            }
            state.queuedEndTurn = queued;

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
            return;
        }

        assertNoPendingChoices(state);

        // CR 508.1c/1g / 701.21a — a parked attack-declaration land tax
        // (Flooded Woodlands) is a turn-based action mid-flight, not a priority
        // window: endTurn must NOT sail past it (it would auto-pass through the
        // rest of the turn, silently abandoning the mandatory sacrifice and
        // letting the attack proceed unpaid — the exact bug this guards). The
        // attacking player must finish the pick via selectSacrifice first.
        const attackSac = state.combat?.pendingAttackSacrifice;
        if (attackSac && !isSacrificeSelectionComplete(attackSac)) {
            throw new Error(
                "Finish paying the attack cost (sacrifice a land) before ending the turn"
            );
        }

        // Ending the turn while a mana payment is still open abandons it
        // (the exact bug this guards: pressing Enter with the PaymentBanner up
        // must not leave a stale pendingCast that a later auto-tap commits on
        // the opponent's turn). Roll back the taps before auto-passing.
        abandonPendingPayment(state, args.playerId);

        // Add player to autoPass list
        const autoPassPlayers = state.autoPassPlayers ?? [];
        if (!autoPassPlayers.includes(args.playerId)) {
            autoPassPlayers.push(args.playerId);
        }
        state.autoPassPlayers = autoPassPlayers;

        // Immediately pass priority (and keep resolving as long as auto-pass applies)
        drainAutoPasses(state);

        // Check SBA after auto-pass drain (may have resolved combat damage)
        checkStateBasedActions(state);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

/** Cancel auto-pass: stop auto-passing the next time priority returns. Priority
 *  is NOT reclaimed from the opponent — they keep holding it until they act. */
export const cancelAutoPass = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        // It writes no result, but clearing the OPPONENT's auto-pass /
        // queued end-turn (and bumping `seq`) is the same act-as-another-seat
        // class as the rest. The clear-only semantics below are unchanged:
        // priority is never reclaimed from the opponent.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const autoPassPlayers = state.autoPassPlayers ?? [];
        const queuedEndTurn = state.queuedEndTurn ?? [];
        const wasAutoPass = autoPassPlayers.includes(args.playerId);
        const wasSingleShot = state.singleShotAutoPass === args.playerId;
        const wasQueued = queuedEndTurn.includes(args.playerId);
        if (!wasAutoPass && !wasSingleShot && !wasQueued) return;

        if (wasAutoPass) {
            const remaining = autoPassPlayers.filter(
                (id) => id !== args.playerId
            );
            state.autoPassPlayers =
                remaining.length > 0 ? remaining : undefined;
        }
        if (wasSingleShot) {
            state.singleShotAutoPass = undefined;
        }
        if (wasQueued) {
            const remaining = queuedEndTurn.filter(
                (id) => id !== args.playerId
            );
            state.queuedEndTurn = remaining.length > 0 ? remaining : undefined;
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** CR 104.3a: a player can concede the game at any time. That player loses.
 *
 *  SECURITY (issue #1645 review): a concede WRITES A RESULT — through
 *  `finalizeGameOver` it can decide a Match and, for a round pairing, a
 *  standings row. So the caller must own the seat they named: `getPlayer`
 *  proves the seat is in THIS game, `assertSeatOwnership` proves it is THEIRS.
 *  Without the second check any authenticated user could concede on behalf of
 *  their opponent (or of a stranger's game entirely). */
export const concede = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        getPlayer(state, args.playerId);
        assertSeatOwnership(args.playerId, user._id);
        // The per-GAME twin of `forfeitMatch`'s bot-seat gate. Without it a
        // Bo3 pairing is still a per-Game sweep: concede the bot's seat once
        // per Game and `finalizeGameOver` → `recordLimitedPairingResult`
        // writes the 2-0 with nothing played. Ordinary bot plays are
        // untouched — the Brain never concedes, and this gate exists on no
        // other mutation.
        //
        // The gate resolves the binding from the owning MATCH, never from the
        // `games` row (issue #1645 review): the Match is the authority and the
        // `games` row is only a mirror of it, so a gate keyed off the mirror
        // evaporates the moment a writer forgets to copy a field — which is
        // exactly what happened for every Bo3 Game 2+ (`buildNextGameForMatch`
        // dropped `limitedPairing`, so `assertNotEventBotSeat` no-oped from G2
        // on while the standings write, reading the Match, still landed). The
        // mirror is fixed too, but nothing depends on it staying in sync.
        const game = await ctx.db.get(args.gameId);
        const match = game?.matchId ? await ctx.db.get(game.matchId) : null;
        // Legacy games predate `matchId` (schema.ts) — fall back to the row.
        const bindingDoc = match ?? game;
        if (bindingDoc) assertNotEventBotSeat(bindingDoc, args.playerId);
        const winnerId = getOpponentId(state, args.playerId);

        state.gameOver = {
            winnerId,
            loserId: args.playerId,
            reason: "concede",
        };

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, state);
    },
});

export const drawCard = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            // CR 704.5b: attempting to draw from empty library
            player.hasDrawnFromEmpty = true;
            checkStateBasedActions(state);

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
            await finalizeGameOver(ctx, args.gameId, nextSeq, state);
            return;
        }

        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

export const mill = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        moveCard(player, player.library[0].id, "library", "graveyard");

        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

export const exileFromLibrary = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        const player = getPlayer(state, args.playerId);

        if (player.library.length === 0) {
            throw new Error("Library is empty");
        }

        moveCard(player, player.library[0].id, "library", "exile");

        const nextSeq = gameState.seq + 1;

        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/**
 * The PURE activation path (CR 602 — activating an activated ability), lifted
 * verbatim out of the `activateAbility` mutation below so it can be driven
 * WITHOUT a Convex `ctx`: the blade suite's engine-real `setup` steps need to
 * reach a position whose pending decision is produced by a real activation
 * (ADR 0070 §4 — a fetchland's live search-library choice), and a hand-built
 * approximation of that path is exactly the silent-divergence class the ADR
 * rejects.
 *
 * THE MUTATION CALLS THIS FUNCTION — there is no second copy. Everything the
 * mutation still owns is I/O: fetch the row, clone the state, persist. Every
 * legality check, every cost payment, every stack push lives here.
 *
 * Mutates `state` in place. The three former early-return points (targeted
 * ability → `pendingTarget`; deferred payment → `pendingActivation`; committed
 * → stack) all persisted the SAME `seq + 1` snapshot, so collapsing them into
 * a plain `return` costs nothing: the caller saves once, whichever way it
 * returned. Throws on any illegal activation, exactly as before.
 */
/** CR 700.2 / 602.2b (issue #1341) — validates the mode an activation
 *  announced. A modal ability MUST name one of its declared modes; a
 *  non-modal ability must name none. Returns the chosen `AbilityMode`, or
 *  undefined when the ability is not modal. Mirrors `announceCast`'s modal
 *  prelude so the two announcement paths can't drift. */
function resolveActivationMode(
    ability: ActivatedAbility,
    chosenModeId: string | undefined
): AbilityMode | undefined {
    if (!ability.modes || ability.modes.length === 0) {
        if (chosenModeId) {
            throw new Error(
                "Ability is not modal — chosenModeId must not be supplied"
            );
        }
        return undefined;
    }
    if (!chosenModeId) {
        throw new Error("Modal ability — must choose a mode at announcement");
    }
    const mode = ability.modes.find((m) => m.id === chosenModeId);
    if (!mode) {
        throw new Error(
            `Unknown mode id "${chosenModeId}" for ability "${ability.id}"`
        );
    }
    return mode;
}

export function activateAbilityOnState(
    state: GameState,
    args: {
        playerId: string;
        cardInstanceId: string;
        abilityId: string;
        /** If true, the activator keeps priority after the ability hits the stack. */
        keepPriority?: boolean;
        /** Value chosen for X at activation time (CR 107.3 / 601.2b). */
        chosenX?: number;
        /** CR 700.2 / 602.2b (issue #1341) — the mode chosen at announcement
         *  for a MODAL activated ability (Umezawa's Jitte). Required when the
         *  ability declares `modes`, rejected when it does not. */
        chosenModeId?: string;
    }
): void {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId: args.playerId,
        expect: "priority",
    });
    assertNoPendingChoices(state);

    if (state.priorityPlayerId !== args.playerId) {
        throw new Error("You don't have priority");
    }
    if (state.pendingCast) {
        throw new ConvexError("Another spell is already being cast");
    }
    if (state.pendingActivation) {
        throw new ConvexError("Another ability is already being activated");
    }

    const player = getPlayer(state, args.playerId);
    // CR 602.1 — by default only the source's controller activates an
    // activated ability, so look on the activator's own battlefield first.
    // For "any player may activate" abilities (CR 113.3c, Ifh-Bíff Efreet)
    // the source can live on another player's battlefield; fall back to a
    // global search and gate it on the resolved ability's flag below.
    let card = player.battlefield.find((c) => c.id === args.cardInstanceId);
    if (!card) {
        for (const p of state.players) {
            const found = p.battlefield.find(
                (c) => c.id === args.cardInstanceId
            );
            if (found) {
                card = found;
                break;
            }
        }
    }
    // CR 113.6 / 602.5b — a graveyard-source activated ability (Ashen
    // Ghoul's `activateFromGraveyard`). When the source is on no
    // battlefield, look for it in a graveyard; the `activateFromGraveyard`
    // flag on the resolved ability gates whether it may be activated there.
    let fromGraveyard = false;
    if (!card) {
        for (const p of state.players) {
            const found = p.graveyard.find((c) => c.id === args.cardInstanceId);
            if (found) {
                card = found;
                fromGraveyard = true;
                break;
            }
        }
    }
    // CR 113.6 / 702.29a — a hand-source activated ability (Cycling's
    // `activateFromHand`). When the source is on no battlefield and in no
    // graveyard, look for it in a hand; the `activateFromHand` flag on the
    // resolved ability gates whether it may be activated there. Only the
    // owner's OWN hand is searched (a card is never in an opponent's hand
    // from this player's perspective, and CR 702.29a scopes it to "your
    // hand").
    let fromHand = false;
    if (!card) {
        const found = player.hand.find((c) => c.id === args.cardInstanceId);
        if (found) {
            card = found;
            fromHand = true;
        }
    }
    if (!card) throw new Error("Card not on battlefield");

    const cardId = (card.card as { id?: string }).id;
    if (!cardId) throw new Error("Card has no definition");

    const resolved = resolveActivatedAbility(card, args.abilityId);
    if (!resolved) throw new Error("Ability not found");
    const ability = resolved.ability;
    // CR 113.6 — the source is in a graveyard: legal only for an ability
    // that opts in via `activateFromGraveyard`, and only its owner may
    // activate it (CR 602.1 — "from YOUR graveyard"). The battlefield
    // controller-only checks below are skipped for this branch.
    if (fromGraveyard) {
        if (!ability.activateFromGraveyard) {
            throw new Error(
                "This ability can't be activated from the graveyard"
            );
        }
        if (card.ownerId !== args.playerId) {
            throw new Error("You do not own this card");
        }
    } else if (fromHand) {
        // CR 113.6 / 702.29a — the source is in a hand: legal only for an
        // ability that opts in via `activateFromHand` (Cycling), and only
        // its owner may activate it (CR 702.29a — "from your hand"). The
        // battlefield controller-only checks below are skipped.
        if (!ability.activateFromHand) {
            throw new Error("This ability can't be activated from your hand");
        }
        if (card.ownerId !== args.playerId) {
            throw new Error("You do not own this card");
        }
    } else if (ability.activateFromHand || ability.activateFromGraveyard) {
        // CR 113.6 / 702.29a — the source was located on the battlefield
        // (neither `fromHand` nor `fromGraveyard`), but this ability
        // functions ONLY from the hand (Cycling) or graveyard (Ashen
        // Ghoul). A permanent can never pay its discard-this / graveyard
        // cost, so activating it here is illegal — reject before any cost
        // is locked. The client already omits it from the battlefield menu
        // (`getStackAbilities`); this is the authoritative backstop.
        throw new Error("This ability can't be activated from the battlefield");
    } else if (ability.activatableByEnchantedController) {
        // CR 602.1 — "Only the controller of the enchanted creature may
        // activate this ability" (FEM Merseine). The Aura's host decides
        // who may activate, regardless of who controls the Aura.
        const hostId = card.attachedTo;
        const host = hostId
            ? state.players
                  .flatMap((p) => p.battlefield)
                  .find((c) => c.id === hostId)
            : undefined;
        if (!host || host.controllerId !== args.playerId) {
            throw new Error(
                "Only the controller of the enchanted creature may activate this ability"
            );
        }
    } else if (ability.activatableByOpponentsOnly) {
        if (card.controllerId === args.playerId) {
            throw new Error("Only your opponents may activate this ability");
        }
    } else if (
        // CR 602.1 — enforce the controller-only default unless the ability
        // is explicitly "any player may activate". `card.controllerId` is
        // the source's controller; only that player may activate otherwise.
        !ability.activatableByAnyPlayer &&
        card.controllerId !== args.playerId
    ) {
        throw new Error("You do not control this permanent");
    }
    const grantedSourceCardId = resolved.grantedSourceCardId;
    if (!ability.useStack) {
        throw new Error("Use tapUntap for mana abilities");
    }
    // CR 602.1 / 605.1a (issue #1124) — a turn-scoped "can't activate
    // abilities that aren't mana abilities" lock (Abeyance). Every ability
    // reaching this point is non-mana (the check above already rejected
    // `useStack: false`), so no separate mana-ability exemption is needed.
    if (state.cannotActivateAbilitiesThisTurn?.includes(args.playerId)) {
        throw new Error(
            "You can't activate abilities that aren't mana abilities this turn"
        );
    }
    // CR 602.5 — phase-restricted activated abilities ("activate only
    // during combat" etc.) are illegal outside their declared phase
    // allow-list. Mirrors spell-level `castPhaseRestriction`.
    if (
        ability.activationPhaseRestriction &&
        !ability.activationPhaseRestriction.includes(state.phase)
    ) {
        throw new Error("Ability cannot be activated during this phase");
    }
    // CR 602.5 / 606.3 — timing legality (controller-turn-only,
    // once-per-turn, "activate only as a sorcery") and loyalty legality are
    // gated HERE, in the shared prelude, so BOTH the targeted and the
    // non-targeted path enforce them identically. They used to live only in
    // the non-targeted branch (loyalty was duplicated into the targeted one),
    // which let a targeted `sorcerySpeedOnly` ability — Equip is the canonical
    // shape — open a `pendingTarget` at instant speed. The timing check then
    // fired far downstream in `finalizeTargetSelection`, throwing AFTER the
    // prompt was already persisted: the game sat forever on
    // `expectedInput.kind === "target"` and every subsequent `passPriority`
    // bounced off `assertExpectedInput` (ADR 0047). Any new activation gate
    // belongs in this prelude, not in one of the two branches.
    assertActivationTimingLegal(state, card, ability);
    assertLoyaltyActivationLegal(state, card, ability);

    // CR 602.2b: if the ability has targets, choose them before paying
    // costs. Mana availability is deferred to finalizeTargetSelection
    // (which enters pendingActivation when the pool doesn't cover the
    // cost — mirrors the spell announceCast flow).
    // CR 700.2 / 602.2b (issue #1341) — a MODAL activated ability locks its
    // mode in FIRST (CR 601.2b, before targets), and only the chosen mode's
    // requirement is declared (CR 700.2d). Mirrors `announceCast`'s modal
    // prelude for spells.
    const chosenMode = resolveActivationMode(ability, args.chosenModeId);
    const baseTargetReq = chosenMode
        ? chosenMode.targetRequirement
        : ability.getTargetRequirement
          ? ability.getTargetRequirement(card, state)
          : ability.targetRequirement;
    // CR 612.6 — a color-targeted ability follows its source's active
    // color-word changes (Sleight of Mind on a Circle of Protection
    // retargets its "<color> source of your choice"). The substituted
    // filter flows into both getLegalTargets and the stored pendingTarget.
    // Both merges the primary requirement gets (CR 612.6 colour substitution
    // and the CR 601.2c reflexive self-exclude below) are folded into ONE
    // shared helper (`effectiveRequirementForSource`, `gre/rules.ts`) so the
    // ADDITIONAL target groups (issue #2361) cannot silently skip a merge
    // the primary receives — an extra group declaring `targetIsAnother` or a
    // `colorFilter` must behave identically to a primary that declares it —
    // AND so the CR 608.2b resolution-time re-check
    // (`resolvingTargetRequirement`, `gre/state.ts`, issue #1853 round 3) can
    // reconstruct the IDENTICAL effective requirement instead of drifting
    // from this announcement-time computation.
    const effectiveRequirement = (req: TargetRequirement): TargetRequirement =>
        effectiveRequirementForSource(req, card, card.id);
    // Reflexive self-EXCLUDE (issue #2399) — "ANOTHER target nonlegendary
    // creature you control" (Reflection of Kiki-Jiki). An activated ability's
    // source is always the on-battlefield `card` itself (unlike a triggered
    // ability's separately-tracked `triggerSourceId`), so the same merge
    // `triggerTargetLegality` does for triggers applies here, through the SAME
    // shared helper. The merge lands on `effectiveTargetReq`, which flows into
    // BOTH `getLegalTargets` below and the stored `pendingTarget` filters that
    // `applyOneTargetSelection` re-validates every pick against.
    const effectiveTargetReq = baseTargetReq
        ? effectiveRequirement(baseTargetReq)
        : baseTargetReq;
    if (effectiveTargetReq) {
        if (state.pendingTarget) {
            throw new Error("Target selection is in progress");
        }
        if (ability.cost.tap && card.isTapped) {
            throw new Error("Card is already tapped");
        }
        // CR 302.1 — creatures with summoning sickness cannot pay a {T}
        // cost on an activated ability (mana or otherwise).
        if (ability.cost.tap && isTapLockedBySummoningSickness(card)) {
            throw new Error("Creature has summoning sickness");
        }
        if (ability.cost.removeCounter) {
            const have = card.counters?.[ability.cost.removeCounter.type] ?? 0;
            if (have < ability.cost.removeCounter.count) {
                throw new Error("Not enough counters to pay activation cost");
            }
        }
        // CR 119.4 — a life-payment cost is illegal unless the player has
        // at least that much life. Validated up-front on the targeted path
        // too, before entering pendingTarget.
        if (
            ability.cost.life !== undefined &&
            player.life < ability.cost.life
        ) {
            throw new Error("Not enough life");
        }
        if (
            ability.canActivate !== undefined &&
            !ability.canActivate(card, state)
        ) {
            throw new Error("Ability cannot be activated right now");
        }
        // CR 107.3 / 601.2b — chosenX must accompany abilities with X in
        // their mana cost. Stashed on pendingTarget; finalizeTargetSelection
        // forwards it to pendingActivation / the stack item.
        const targetHasXInCost =
            ability.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        // CR 107.3 — Reflecting Mirror derives X from the targeted spell's
        // mana value rather than letting the player choose it. The value
        // can only be computed once the spell target is known, so it is
        // resolved in finalizeTargetSelection, not here.
        const xIsDerived = ability.cost.xFromTargetSpellMv !== undefined;
        if (
            targetHasXInCost &&
            !xIsDerived &&
            (args.chosenX === undefined || args.chosenX < 0)
        ) {
            throw new Error("This ability requires a chosen X value");
        }
        const targetChosenX =
            targetHasXInCost && !xIsDerived ? args.chosenX : undefined;
        // CR 202.2 / 702.16b: the source's colors come from the
        // permanent owning the activated ability.
        // Issue #1378 — the activating permanent's LIVE effective power (CR
        // 613 layer 7c), for a `mvFilter` bound of `"sourcePower"`. Read the
        // same way the ability's own `dealDamage`-style effects would
        // (`getEffectivePower`); an activated ability's source is always the
        // on-battlefield `card` itself (unlike a triggered ability's
        // separately-tracked `triggerSourceId`).
        const abilitySourcePower = getEffectivePower(state, card);
        const legal = getLegalTargets(
            state,
            effectiveTargetReq,
            // CR 113.3 — the source is an activated ability, not a spell. All
            // five characteristics come from the ONE factory, so no dimension
            // (notably CR 205.4a supertypes, for a protection quality) can be
            // dropped here.
            targetingSourceFromCard(card, false),
            args.playerId,
            targetChosenX,
            [],
            abilitySourcePower
        );
        let abilityCount = resolveTargetCount(
            effectiveTargetReq.count,
            targetChosenX
        );
        // CR 602.2b / 601.2c — mirrors the cast path's identical check
        // (`legalTargets.length < required` above): activating with a
        // `count >= 2` requirement and fewer legal candidates than that
        // (e.g. Sorrow's Path / General Jarkeld's `count: 2` with only ONE
        // legal blocking creature on the board) must be rejected up front,
        // not accepted on `legal.length !== 0` and then dead-end mid-
        // selection with a second target slot nothing can fill (the CR
        // 601.2c distinct-targets fix, issue #1951 review round 2, is what
        // makes the dead-end reachable: a repeat pick used to silently
        // paper over the shortfall).
        //
        // CR 601.2c — a min-0 requirement ("up to one" / "up to N", Teferi,
        // Time Raveler's -3 "Return up to one target artifact, creature, or
        // enchantment... Draw a card", Sorin, Lord of Innistrad's -6, Minsc
        // & Boo's +1) is legal to activate with ZERO legal targets on the
        // board — same rule the cast path's `required` reorder above
        // enforces. `abilityRequired` must therefore be resolved BEFORE
        // deciding whether an empty legal-target set is fatal, not after an
        // unconditional throw on `legal.length === 0`: that ordering used to
        // reject Teferi's -3 outright on an empty board, losing its
        // unconditional "Draw a card" rider (issue #2369 review round 2).
        const abilityRequired = minTargetCount(abilityCount);
        if (legal.length < abilityRequired) {
            throw new Error(
                legal.length === 0
                    ? "No legal targets available"
                    : "Not enough legal targets"
            );
        }
        // CR 601.2c via CR 602.2b (issue #2361) — additional INDEPENDENT
        // target groups, the ability-level twin of the cast path's
        // `additionalRequirements` block above. Each group's legality is
        // checked HERE, at activation, which is where Oko, Thief of Crowns'
        // "target creature an opponent controls with power 3 or less"
        // restriction bites (the −5's power filter is an announce-time target
        // restriction, not a resolution-time re-check). `AbilityMode` has no
        // per-mode twin of this field, so unlike the cast path there is no
        // `chosenMode ??` leg to prefer.
        const abilityAdditionalRequirements = (
            ability.additionalTargetRequirements ?? []
        ).map(effectiveRequirement);
        for (const extra of abilityAdditionalRequirements) {
            const extraLegal = getLegalTargets(
                state,
                extra,
                targetingSourceFromCard(card, false),
                args.playerId,
                targetChosenX,
                [],
                abilitySourcePower
            );
            if (
                extraLegal.length <
                minTargetCount(resolveTargetCount(extra.count, targetChosenX))
            ) {
                throw new Error("Not enough legal targets");
            }
        }
        // CR 601.2d / 120.4 — divide-as-you-choose budget for an activated
        // ability (Arc Mage). Mirrors the spell-cast path: resolve the total
        // against the chosen X, cap an open-ended `{ min }` count at the
        // total (each target needs ≥ 1 point), and carry the total on
        // pendingTarget so the client drives the per-target stepper UI.
        const abilityDivideTotal = effectiveTargetReq.divideAsChosen
            ? resolveDivideTotal(
                  effectiveTargetReq.divideAsChosen.total,
                  targetChosenX
              )
            : undefined;
        if (
            abilityDivideTotal !== undefined &&
            typeof abilityCount === "object" &&
            abilityCount.max === undefined
        ) {
            abilityCount = {
                min: abilityCount.min,
                max: abilityDivideTotal,
            };
        }
        state.pendingTarget = {
            playerId: args.playerId,
            cardInstanceId: card.id,
            targetType: effectiveTargetReq.type,
            count: abilityCount,
            selected: [],
            keepPriority: args.keepPriority,
            kind: "ability",
            abilityId: args.abilityId,
            // CR 700.2c (issue #1341) — the mode is locked BEFORE targets, so
            // it rides the pendingTarget and is forwarded to the stack item /
            // pendingActivation at finalization.
            ...(chosenMode ? { chosenModeId: chosenMode.id } : {}),
            ...(abilityDivideTotal !== undefined
                ? { divideTotal: abilityDivideTotal }
                : {}),
            ...(effectiveTargetReq.divideAsChosen?.kind
                ? { divideKind: effectiveTargetReq.divideAsChosen.kind }
                : {}),
            ...(targetChosenX !== undefined ? { chosenX: targetChosenX } : {}),
            ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            // Same shared filter builder as the spell-cast path
            // (`pendingTargetFiltersFromRequirement`), so the three
            // pending-target builders can never drift (CR 601.2c) — this
            // includes `spellStackKind` for a "counter target ability"
            // activated ability (CR 113 / 701.5a).
            ...pendingTargetFiltersFromRequirement(
                effectiveTargetReq,
                targetChosenX,
                abilitySourcePower
            ),
            // CR 601.2c (issue #2361) — queue the additional independent
            // target groups. `selectTarget` / `confirmTargets` reach the SAME
            // generic `advanceTargetGroupOrFinalize` the cast path uses (it
            // reads `pendingTarget` without caring about `kind`), which swaps
            // in the next group's filters via
            // `applyRequirementToPendingTarget` and only finalizes once the
            // queue is empty — so nothing downstream needed an ability-side
            // twin.
            ...(abilityAdditionalRequirements.length > 0
                ? { remainingRequirements: abilityAdditionalRequirements }
                : {}),
        };

        return;
    }

    // Pay costs (CR 602.1). Up-front checks before we mutate anything:
    if (ability.cost.tap && card.isTapped) {
        throw new Error("Card is already tapped");
    }
    // CR 302.1 — creatures with summoning sickness cannot pay a {T} cost.
    if (ability.cost.tap && isTapLockedBySummoningSickness(card)) {
        throw new Error("Creature has summoning sickness");
    }
    // CR 122.6 — counter-removal cost: source must have enough counters
    // of the declared type. Validated up-front so we never enter a
    // pendingActivation that can't be paid.
    if (ability.cost.removeCounter) {
        const have = card.counters?.[ability.cost.removeCounter.type] ?? 0;
        if (have < ability.cost.removeCounter.count) {
            throw new Error("Not enough counters to pay activation cost");
        }
    }
    // CR 118.3 — "discard the last card you drew this turn" additional
    // cost (Jandor's Ring): the player must have drawn a card this turn
    // that is still in hand. Validated up-front so we never enter a
    // pendingActivation that can't be paid.
    if (ability.cost.discardLastDrawn && !canPayDiscardLastDrawn(player)) {
        throw new Error("No card drawn this turn left to discard");
    }
    // CR 118.3 — "discard a card at random" cost (Coral Helm): illegal with
    // an empty hand. Validated up-front.
    if (ability.cost.discardAtRandom && player.hand.length === 0) {
        throw new Error("No card in hand to discard");
    }
    // CR 602.1 / 118.3 — "discard a card matching <filter>" cost
    // (Survival of the Fittest): illegal unless at least `count` matching
    // cards are in the activating player's hand. Validated up-front so we
    // never enter a pendingActivation that can't be paid.
    if (ability.cost.discardFilter) {
        const candidates = player.hand.filter((c) =>
            handCardMatchesFilter(c, ability.cost.discardFilter!.filter)
        );
        if (candidates.length < ability.cost.discardFilter.count) {
            throw new Error(
                "Not enough matching cards in hand to pay the discard cost"
            );
        }
    }
    // CR 119.4 — a life-payment cost is illegal unless the player has at
    // least that much life. Validated up-front so we never enter a
    // pendingActivation that can't be paid (fetch lands: {T}, Pay 1 life,
    // Sacrifice — the life leg was previously unpaid on the stack path).
    if (ability.cost.life !== undefined && player.life < ability.cost.life) {
        throw new Error("Not enough life");
    }
    // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>": the
    // activation is illegal if no matching permanent is on the activating
    // player's battlefield. Validated up-front so we never enter a
    // pendingActivation that can't be paid.
    if (ability.cost.sacrificeFilter) {
        const candidates = player.battlefield.filter((c) =>
            // Layered view, matching `sacrificeCandidates` (issue #1209).
            matchesPermanentFilter(
                effectivePermanentView(state, c),
                ability.cost.sacrificeFilter!,
                {
                    selfControllerId: player.id,
                    // CR 109.2 (issue #2367) — "Sacrifice ANOTHER artifact":
                    // the source is not a legal payment for its own cost.
                    selfInstanceId: card.id,
                    supertypesOf: liveSupertypesOf,
                }
            )
        );
        // CR 602.1 / 118.5 (issue #2398) — "Sacrifice TEN nonland permanents"
        // (Bolas's Citadel): the gate is a COUNT, not mere existence.
        if (candidates.length < (ability.cost.sacrificeFilterCount ?? 1)) {
            throw new Error("No legal permanent to pay the sacrifice cost");
        }
    }
    // CR 602.1 / 118.5 — "exile N cards from a single graveyard" (Night
    // Soil): illegal unless one graveyard holds enough matching cards.
    // Validated up-front so we never enter an unpayable pendingActivation.
    if (ability.cost.exileFromGraveyard) {
        const { count, cardType, owner } = ability.cost.exileFromGraveyard;
        if (
            !canPayExileFromGraveyard(
                state,
                count,
                cardType,
                owner === "you" ? player.id : undefined
            )
        ) {
            throw new Error(
                "No single graveyard has enough cards to pay the exile cost"
            );
        }
    }
    // CR 602.1 / 118.8 — "tap N untapped permanents matching <filter> you
    // control": illegal unless at least N matching untapped permanents
    // (other than the source) are available.
    if (ability.cost.tapOtherFilter) {
        const candidates = tapOtherCandidates(
            player,
            card.id,
            ability.cost.tapOtherFilter.filter
        );
        if (
            !canPayTapOtherCost(
                ability.cost.tapOtherFilter,
                candidates.map((c) => tapOtherContribution(state, c))
            )
        ) {
            throw new Error(
                "Not enough untapped permanents to pay the tap cost"
            );
        }
    }
    // CR 602.5 — activated abilities may declare a custom precondition
    // (e.g. Clockwork Beast: "Activate only if it has fewer than seven
    // +1/+0 counters on it.") read against current source state.
    if (
        ability.canActivate !== undefined &&
        !ability.canActivate(card, state)
    ) {
        throw new Error("Ability cannot be activated right now");
    }
    // CR 107.3 / 601.2b — chosenX is required for abilities whose mana
    // cost has X. Validate up-front; pass to normalizeManaCost so the
    // generic portion includes X * (the chosen value).
    const hasXInCost =
        ability.cost.mana?.X !== undefined &&
        typeof ability.cost.mana.X === "string";
    if (hasXInCost && (args.chosenX === undefined || args.chosenX < 0)) {
        throw new Error("This ability requires a chosen X value");
    }
    const chosenX = hasXInCost ? args.chosenX : undefined;
    const manaCost = resolveAbilityManaCost(state, card, ability, {
        chosenX,
    });
    if (manaCost) {
        applyCostModifiers(manaCost, getCostModifiers(state, card, "ability"));
    }
    // CR 601.2f / 118.5 — board-wide static NON-mana additional cost
    // (Drought). Gate on affordability at announcement; pip count comes from
    // the ability's PRINTED activation cost.
    assertStaticAdditionalCostAffordable(
        state,
        ability.cost.mana,
        card,
        player,
        "ability"
    );

    // Enter a pendingActivation payment phase that mirrors pendingCast
    // when (a) mana isn't yet covered, OR (b) the ability has a
    // sacrifice-a-filtered-permanent cost that still needs a choice
    // (CR 602.1 / 118.5). In the payment phase the player taps lands and
    // picks the sacrifice (selectActivationCost); auto-commit applies the
    // deferred tap/sacrifice and pushes the ability on the stack.
    // Tap/sacrifice are DEFERRED so cancel leaves the source untouched.
    // CR 106.6 (issue #728) — restricted mana eligible for an ability of THIS
    // source (Soldevi Machinist's artifact-ability mana) counts toward
    // coverage, exactly as `spendablePoolForSpell` does at the cast path.
    const abilitySourceTypes = card.types;
    const manaUncovered =
        !!manaCost &&
        !isManaCostCovered(
            spendablePoolForAbility(player, abilitySourceTypes),
            manaCost,
            getManaSubstitutions(state, player.id)
        );
    // CR 602.1 / 118.5 / 701.21a — unified filtered sacrifice (own cost +
    // Drought). A non-fungible board defers so the player chooses; a
    // fungible board auto-resolves and commits inline.
    const activationSac = buildActivationSacrificeSelection(
        state,
        ability,
        card,
        player,
        tryGetDefinition((card.card as { id?: string }).id ?? "")?.name ??
            "Sacrifice"
    );
    const needsSacrificeChoice =
        !!activationSac && !isSacrificeSelectionComplete(activationSac);
    const needsExileChoice = !!ability.cost.exileFromGraveyard;
    const needsTapOtherChoice = !!ability.cost.tapOtherFilter;
    const needsDiscardChoice = !!ability.cost.discardFilter;
    if (
        manaUncovered ||
        needsSacrificeChoice ||
        needsExileChoice ||
        needsTapOtherChoice ||
        needsDiscardChoice
    ) {
        const pending = buildPendingActivation({
            playerId: args.playerId,
            cardInstanceId: card.id,
            abilityId: args.abilityId,
            ability,
            manaCost,
            chosenX,
            ...(chosenMode ? { chosenModeId: chosenMode.id } : {}),
            keepPriority: args.keepPriority,
            grantedSourceCardId,
            fromGraveyard,
            fromHand,
            ...(activationSac ? { sacrificeSelection: activationSac } : {}),
        });
        state.pendingActivation = pending;
        // CR 302.1 — a {T}-cost ability still needs the source untapped at
        // commit; deferral keeps it untapped now, so re-check at commit.
        // When mana is already covered and the source has a {T} cost but no
        // sacrifice choice, this branch isn't reached (mana covered path).
        // tryAutoCommitPendingActivation handles the eventual commit (after
        // the sacrifice pick) including when mana is already covered.
        tryAutoCommitPendingActivation(state, args.playerId);

        return;
    }

    // Mana already covered (or no mana cost) — commit immediately.
    if (ability.cost.tap) {
        card.isTapped = true;
    }
    // CR 106.10 — noted-mana battery (Jeweled Amulet / Ice Cauldron):
    // snapshot the pool before payment so the per-colour delta becomes the
    // mana noted on the source at resolve (mirrors the deferred-commit and
    // targeted-ability paths).
    const poolBeforePayment =
        ability.noteManaSpent && manaCost ? { ...player.manaPool } : undefined;
    if (manaCost) {
        payManaCostForAbility(
            player,
            manaCost,
            abilitySourceTypes,
            getManaSubstitutions(state, player.id)
        );
        commitLandsForCost(player, manaCost);
    }
    const notedManaSpent = poolBeforePayment
        ? manaSpentDelta(poolBeforePayment, player.manaPool)
        : undefined;
    if (ability.cost.removeCounter) {
        payRemoveCounterCost(card, ability.cost.removeCounter);
    }
    if (ability.cost.discardLastDrawn) {
        payDiscardLastDrawn(state, player);
    }
    if (ability.cost.discardAtRandom) {
        payDiscardAtRandomCost(state, player.id, ability.cost.discardAtRandom);
    }
    // CR 119.4 — pay the life cost (fetch lands: "Pay 1 life"). Validated
    // up-front; deducted here as the ability goes on the stack.
    if (ability.cost.life !== undefined) {
        player.life -= ability.cost.life;
    }
    // CR 606.4 — pay a non-targeted loyalty ability's signed loyalty cost as
    // it goes on the stack (Liliana's "+1", Garruk's "-4"). No-op otherwise.
    payLoyaltyCost(card, ability);
    if (ability.cost.sacrifice) {
        removePermanentTo(state, card.id, "graveyard", "sacrifice");
    }
    // CR 702.29a / 118.3 — the Cycling "Discard this card" cost: discard the
    // source from hand as the ability commits, routed through the shared
    // choke point so CARD_DISCARDED fires (Marauding Mako). Runs BEFORE the
    // stack-item clone below (the card object persists after the move).
    // CR 702.29c — `cyclingCost` marks a cycling/typecycling cost payment on the
    // one CARD_DISCARDED event; an ordinary discard-this cost stays unmarked.
    if (ability.cost.discardThis) {
        discardToGraveyard(
            state,
            player.id,
            card.id,
            ability.cost.cyclingCost ? "cycling" : undefined
        );
    }
    // CR 118.1 / 601.2h — the "Exile this card/permanent" activation cost, paid
    // as the ability commits: graveyard → exile for an Eternalize-shaped
    // ability, battlefield → exile for a permanent's own self-exile cost
    // (Feldon's Cane). Runs BEFORE the stack-item clone below (the card object
    // persists after the move, so the item keeps CR 608.2h last-known
    // information).
    if (ability.cost.exileThis) {
        payExileThisCost(
            state,
            player,
            card.id,
            !!ability.activateFromGraveyard
        );
    }
    // CR 601.2f / 118.5 / 701.21a — apply the auto-resolved filtered
    // sacrifice (Drought / fungible own cost) as the ability commits.
    const immediateSacSnapshot = sacrificeSnapshotFromSelection(
        activationSac,
        state
    );

    // Put ability on stack (clone card state as a virtual stack item)
    const stackItem: StackItem = buildActivatedAbilityStackItem(card, {
        castById: args.playerId,
        abilityId: args.abilityId,
        ...(chosenMode ? { chosenModeId: chosenMode.id } : {}),
        ...(chosenX !== undefined ? { chosenX } : {}),
        ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
        ...(immediateSacSnapshot
            ? { additionalSacrificeSnapshot: immediateSacSnapshot }
            : {}),
        ...(notedManaSpent ? { notedManaSpent } : {}),
    });
    state.stack.push(stackItem);
    recordActivation(state, card, args.abilityId, !!ability.cost.tap);
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, args.playerId);
    state.singleShotAutoPass = args.keepPriority ? undefined : args.playerId;
    // CR 603.3 — flush ABILITY_ACTIVATED queued by recordActivation so the
    // "non-tap ability activated" punisher lands on top of the freshly
    // pushed ability (resolves first). No-op for {T} abilities. Runs BEFORE
    // the auto-pass drain, which may otherwise reach two consecutive passes
    // and start resolving the ability before its own trigger is placed (see
    // `commitPendingCast`).
    processPendingActionTriggers(state);
    drainAutoPasses(state);
}

/** Activate a non-mana ability on a permanent (CR 602.2). Pays costs and puts ability on stack. */
export const activateAbility = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        abilityId: v.string(),
        /** If true, the activator keeps priority after the ability hits the stack. */
        keepPriority: v.optional(v.boolean()),
        /** Value chosen for X at activation time for abilities with X in
         *  their mana cost (CR 107.3 / 601.2b). Ignored for abilities without
         *  X in their cost. */
        chosenX: v.optional(v.number()),
        /** CR 700.2 / 602.2b (issue #1341) — the mode chosen at announcement
         *  for a MODAL activated ability (Umezawa's Jitte). Required when the
         *  ability declares `modes`, rejected otherwise. */
        chosenModeId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        // The whole rules path lives in `activateAbilityOnState` (above); the
        // mutation is I/O only. No copy of it survives here.
        activateAbilityOnState(state, args);

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

export const tapUntap = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        manaChoiceIndex: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
            allowManaForMayPay: true,
        });
        // CR 117.3a / 605.3b — while answering a may-pay choice, the player
        // may activate mana abilities to make the mana the cost requires.
        // Other pending-choice kinds (keep-permanents, etc.) still freeze
        // priority and reject mana ability activation.
        const mayPayHead = state.pendingChoices?.[0];
        const isMayPayPaymentWindow =
            mayPayHead?.kind === "may-pay" &&
            mayPayHead.playerId === args.playerId;
        assertNoPendingChoices(state, {
            allowManaForMayPay: { playerId: args.playerId },
        });
        const player = getPlayer(state, args.playerId);

        // Cannot manually tap/untap during a payment phase — must go through
        // the specific payment mutation so pendingCast/pendingActivation
        // bookkeeping stays consistent.
        if (state.pendingCast) {
            throw new Error("Use tapForPayment/untapForPayment during casting");
        }
        if (state.pendingActivation) {
            throw new Error(
                "Use tapForActivationPayment/untapForActivationPayment during ability activation"
            );
        }

        // CR 605.3b: a mana ability can be activated only while the player
        // has priority (or while paying a mana cost — handled above).
        // Mana payment for an active may-pay choice also qualifies.
        if (
            !isMayPayPaymentWindow &&
            state.priorityPlayerId !== args.playerId
        ) {
            throw new Error("Cannot activate mana ability without priority");
        }

        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");

        // CR 602.5b (issue #947) — gate on the ability's own `canActivate`
        // precondition so an un-imprinted Chrome Mox (or any source whose
        // mana ability currently fails its gate) reads as having no mana
        // ability at all, not merely one with an empty choice list.
        if (!hasManaAbility(card, state)) {
            throw new Error("Card has no mana ability to tap/untap");
        }

        const ability = getActivatedManaAbility(card, state);
        // CR 605.1a / 606 — a NON-tap mana ability whose cost is mana
        // (Farrelite Priest "{1}: Add {W}") has no tap toggle to flip: it can be
        // activated repeatedly and may carry a side effect (a conditional
        // delayed sacrifice). `tapUntap` only models tap-based sources, so route
        // these through `activateManaAbility`, which pays the mana cost, runs
        // the ability's `resolve`, and records the per-turn activation count.
        //
        // `!cost.sacrifice` (issue #2021): a cost that is mana AND sacrifice
        // with no {T} (the five Invasion Attendants' "{1}, Sacrifice this
        // creature: Add {U}{B}{R}.", Coal Golem's "{3}") is NOT one of those —
        // `activateManaAbility` rejects `cost.sacrifice` outright, so sending
        // it there made the two mutations bounce it between them and left the
        // ability unactivatable by any route. It belongs here, on the
        // sacrifice branch below.
        if (
            ability &&
            !ability.cost.tap &&
            ability.cost.mana &&
            !ability.cost.sacrifice
        ) {
            throw new Error(
                "Use activateManaAbility for non-tap mana abilities"
            );
        }
        const isSacrifice = ability?.cost.sacrifice === true;
        const wasTapped = card.isTapped;

        // Sacrifice abilities are one-way — cannot "untap"
        if (isSacrifice && wasTapped) {
            throw new Error("Cannot untap a sacrifice ability");
        }

        // CR 302.1 — creatures with summoning sickness cannot activate an
        // ability whose cost includes {T}. Untap (refunding floating mana)
        // is allowed since it reverses an earlier activation, not a fresh one.
        const requiresTap =
            !!getBasicLandMana(card) || ability?.cost.tap === true;
        if (!wasTapped && requiresTap && isTapLockedBySummoningSickness(card)) {
            throw new Error("Creature has summoning sickness");
        }

        // CR 605.1a (issue #2021) — the tap-less "Sacrifice this: Add …"
        // activation. Handled here, ahead of the tap-shaped branches below:
        // those look the produced mana up through `getActivatedManaColor`,
        // which only ever matches a `cost.tap` ability, so this shape used to
        // fall through them and sacrifice the source for ZERO mana. One-way,
        // so it returns before any of the untap/refund bookkeeping.
        const fixedSacrifice = getFixedSacrificeManaAbility(card);
        if (fixedSacrifice) {
            activateFixedSacrificeManaAbility(
                state,
                player,
                card,
                fixedSacrifice
            );
            // CR 603.2/603.3 — flush what the sacrifice and the mana queued
            // (the source's own dies trigger, a Mana Flare-style watcher).
            // Same flush the tap branches run below; no SBA pass, because a
            // mana ability resolves without one (CR 605.3a).
            processPendingActionTriggers(state);
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        // Block untap if mana was spent on a cast
        if (wasTapped && card.manaCommitted) {
            throw new Error("Cannot untap: mana already spent");
        }

        // CR 603.3 — a triggered ability cannot be undone once put on the
        // stack. If this source's most-recent tap-for-mana caused any
        // triggered ability to go on the stack (its own "becomes tapped"
        // self-damage like City of Brass, or a third-party Manabarbs watching
        // land taps), the tap is a commitment: refunding the mana and
        // untapping the source while the trigger's effect (lost life, etc.)
        // stays applied would produce a state with no legal MTG equivalent.
        // Mirrors the `manaCommitted` guard above; class-wide, set at the
        // trigger-flush site below and cleared at the untap step / on spend.
        if (wasTapped && card.tapTriggerCommitted) {
            throw new Error("Cannot untap: tap trigger already on the stack");
        }

        // Track produced mana so we can carry it on the PERMANENT_TAPPED event
        // (CR 605.2 / 603.2 — Mana Flare reads `manaProduced` to add the
        // matching color). Set on the tap branches, undefined on untap.
        let producedThisActivation: ManaCost | undefined;

        // CR 106.4 / 605.1a — snapshot the controller's life before the mana
        // ability resolves so a tap can record how much life its self-damage /
        // life-cost riders (painland ping, Ancient Tomb, Mana Confluence) took.
        // Every rider on the activator routes through `player.life`, so the
        // post-rider delta is the real life paid (after CR 614 replacement /
        // CR 615 prevention) — restored verbatim if the tap is later undone.
        const lifeBeforeTap = player.life;

        // CR 605.1a / 305.6 — the ability that actually produced the mana this
        // tap. Defaults to the source's single activated mana ability (fixed
        // branch); the multi-option branch overwrites it with the CHOSEN
        // option's ability, or `null` when the player picked an intrinsic
        // basic-land-subtype option (any land under Urborg). The shared tap
        // riders below (unconditional self-damage, life/discard cost, delayed
        // trigger) read this so they fire only for the ability that was used.
        let tapAbility: ActivatedAbility | null = ability;

        // CR 601.2g / 605.3a — a mana ability with its own MANA cost leg (Mana
        // Cylix "{1}, {T}: Add one mana of any color", Chromatic Star, Fire
        // Sprites) gets the same auto-tap convenience every other costed play
        // has: float the mana it needs from the player's other sources instead
        // of rejecting the tap. Runs BEFORE either branch pays
        // (`applyManaAbilityManaCost`) and only on a TAP — an untap toggle
        // refunds the cost instead. Keyed off `ability`, the source's single
        // activated mana ability, which for every shipped filter IS the ability
        // that carries the cost; a hypothetical card whose SECOND mana ability
        // were the costed one would simply not be pre-funded here and fall
        // through to the payment check as before.
        if (!wasTapped) {
            autoTapForManaAbilityCost(state, player, card, ability);
        }

        // Determine mana to add/remove
        if (
            manaTapNeedsChoice(
                card,
                player.id,
                manaTapBattlefields(state),
                ability
            )
        ) {
            // 2+ mana-tap options: the source's own ability and/or one per basic
            // land subtype it has (Urborg), or a single board-conditional
            // chooser (Fellwar Stone). The activator picks which to activate.
            if (!wasTapped) {
                if (args.manaChoiceIndex === undefined) {
                    throw new Error("Must choose a mana color");
                }
                // CR 106.1 / 305.6 — resolve the submitted index against the
                // unified option list (activated abilities + intrinsic basic-
                // land subtypes), keeping the chosen option's provenance so the
                // riders below (and the shared tap riders) fire only for the
                // ability that produced the mana. A basic-subtype pick has none.
                const resolved = resolveManaTapChoice(
                    card,
                    player.id,
                    manaTapBattlefields(state),
                    args.manaChoiceIndex
                );
                if (!resolved) {
                    throw new Error(MANA_CHOICE_REJECTION);
                }
                const effAbility = resolved.ability;
                const choiceIndex = resolved.choiceIndex;
                tapAbility = effAbility;
                // CR 614 — Deep Water rewrites a land's produced mana to {U}.
                const chosen = applyLandManaReplacement(
                    state,
                    player.id,
                    card,
                    resolved.mana
                );

                // CR 122.6 / 605.1a — Mana Battery: the ability-LOCAL choice
                // index is the number of charge counters this activation removes
                // ("Remove any number of charge counters: Add 1 + N mana").
                // Validate and pay the scaling counter cost up-front so we never
                // half-apply the tap. Snapshotted so an untap (before the mana
                // is spent) restores the counters.
                const counterType = effAbility?.manaChoiceRemovesCounters;
                const removeCounters =
                    counterType !== undefined &&
                    choiceIndex !== undefined &&
                    choiceIndex > 0;
                if (removeCounters) {
                    const have = card.counters?.[counterType] ?? 0;
                    if (have < choiceIndex) {
                        throw new Error("Not enough counters for this choice");
                    }
                    payRemoveCounterCost(card, {
                        type: counterType,
                        count: choiceIndex,
                    });
                }

                const optIsSacrifice = effAbility?.cost.sacrifice === true;
                // CR 605.1a / 601.2f — pay the MANA portion of the activation
                // cost (Mana Cylix / Celestial Prism / Standing Stones "{N},
                // {T}: Add one mana of any color") FIRST, before any source
                // mutation, so an unaffordable activation throws with nothing
                // changed. The payment tap (`tapSourceIntoPayment`) has always
                // done this; the PRIORITY tap did not, which made every one of
                // these filters a free ramp source.
                applyManaAbilityManaCost(player, effAbility, card);
                // CR 605.2 — emit before any sacrifice path moves the card off
                // the battlefield, so the event still carries the source's
                // pre-sacrifice types/subtypes.
                emitPermanentTapped(state, card, true, chosen);
                producedThisActivation = chosen;

                // Pay cost: tap (+ sacrifice if required). CR 603.6 / 700.4 —
                // the sacrifice goes through `removePermanentTo` so the source's
                // leave-the-battlefield / dies trigger (Chromatic Star's draw)
                // fires: it queues `PERMANENT_LEFT`, which the trigger pass below
                // (`processPendingActionTriggers`) drains onto the stack after
                // the mana ability has resolved (mana already added).
                if (optIsSacrifice) {
                    removePermanentTo(state, card.id, "graveyard", "sacrifice");
                } else {
                    card.isTapped = true;
                    // Remember the exact mana produced so untap can refund it.
                    // Fixed-color abilities use manaProduced and don't need this.
                    card.chosenMana = chosen;
                    if (removeCounters) {
                        card.manaCounterRemoval = {
                            type: counterType,
                            count: choiceIndex,
                        };
                    }
                }

                // Add chosen mana to pool. CR 106.6 / ADR 0042 — a choice mana
                // ability with a `manaRestriction` (Adarkar Unicorn — "Spend
                // this mana only to pay cumulative upkeep costs") floats its
                // output in the parallel `restrictedMana` pool, not the fungible
                // pool, so it pays only the costs the restriction permits. A
                // basic-subtype pick (effAbility null) has no restriction.
                const choiceRestriction = effAbility?.manaRestriction;
                // CR 106.6 rider (issue #1559, Delighted Halfling) — carried
                // alongside `manaRestriction` onto the deposited unit.
                const choiceRider = effAbility?.manaCantBeCounteredRider;
                for (const [color, amount] of Object.entries(chosen)) {
                    if (
                        color !== "X" &&
                        typeof amount === "number" &&
                        amount > 0
                    ) {
                        if (choiceRestriction) {
                            addRestrictedManaToPool(
                                player,
                                color,
                                amount,
                                choiceRestriction,
                                undefined,
                                choiceRider
                            );
                        } else {
                            player.manaPool[
                                color as keyof typeof player.manaPool
                            ] =
                                (player.manaPool[
                                    color as keyof typeof player.manaPool
                                ] ?? 0) + amount;
                        }
                    }
                }
                // CR 605.1a / 120 — painland coloured-tap self-damage rider
                // (Adarkar Wastes et al.): a coloured choice (not {C}) pings the
                // controller for 1; the painless {C} choice does not. Fires for
                // the chosen ability only (a basic-subtype pick has no rider).
                applyColoredTapSelfDamage(
                    state,
                    effAbility,
                    card,
                    player.id,
                    chosen
                );
                // CR 605.1a / 122.1 — depletion-dual tap-for-mana rider (Land
                // Cap et al.): every tap for mana puts one depletion counter on
                // the source. Fires for the chosen ability only.
                applyDepletionCounterOnTap(effAbility, card);
            } else {
                // Untap: refund exactly the mana that was chosen on tap.
                // CR 106.6 (issue #1559 review) — restriction-aware refund via
                // the shared `refundChosenManaOutput` (also used by the
                // payment-tap untap paths): `ability` above is only the FIRST
                // mana ability `getActivatedManaAbility` finds on this card, so
                // a card whose RESTRICTED ability is NOT that first one
                // (Delighted Halfling: "{T}: Add {C}." is found first, but the
                // second, distinct ability is the one that floats restricted
                // mana) would otherwise reverse the wrong pool — the helper
                // re-resolves the ability that ACTUALLY produced the snapshot
                // by matching its exact shape against every non-useStack mana
                // ability's declared output. No-op when `card.chosenMana` is
                // unset (legacy pre-chosenMana instances).
                refundChosenManaOutput(player, card);
                // CR 122.6 — untapping before the mana is spent reverses the
                // whole activation, so the charge counters removed to pay the
                // scaling cost are restored to the source.
                if (card.manaCounterRemoval) {
                    const { type, count } = card.manaCounterRemoval;
                    const next = { ...(card.counters ?? {}) };
                    next[type] = (next[type] ?? 0) + count;
                    card.counters = next;
                    card.manaCounterRemoval = undefined;
                }
                // CR 106.4 / 122.1 — untapping a depletion-dual to refund
                // unspent mana reverses the whole activation, including the
                // depletion counter it put on itself when tapped for mana.
                reverseDepletionCounterOnUntap(ability, card);
                card.chosenMana = undefined;
                // CR 605.4 — also refund the Wild-Growth-style bonus mana this
                // tap added (else it stays floating: the infinite-mana leak).
                refundTapBonusMana(player, card);
                card.isTapped = false;
            }
        } else {
            // Fixed mana ability (lands, Mox, Sol Ring). CR 605.1a — a
            // fixed-output mana ability whose cost includes "Sacrifice this"
            // (ADR 0039, Basal Thrull "{T}, Sacrifice this: Add {B}{B}") is a
            // one-way activation: `isSacrifice && wasTapped` was already
            // rejected above, so here `wasTapped` is always false. We keep the
            // permanent on the battlefield only long enough to read its mana
            // output, then move it to the graveyard instead of tapping it.
            //
            // CR 605.1a / 601.2f — pay the MANA portion of the activation cost
            // (Fire Sprites "{G}, {T}: Add {R}") FIRST, before any source
            // mutation, so an unaffordable activation throws with nothing
            // changed. Tap only — an untap toggle reverses the cost below.
            if (!wasTapped) applyManaAbilityManaCost(player, ability, card);
            if (!isSacrifice) card.isTapped = !card.isTapped;
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (manaColor) {
                // CR 106.1 / 605.1a — board-conditional output (Urza trio) is
                // computed from the controller's battlefield at tap time. On
                // untap we refund the exact snapshotted `chosenMana` amount
                // (the board may have changed since the tap), falling back to a
                // fresh computation only for legacy/untracked instances.
                const isDynamic = !!getDynamicManaProduced(
                    card,
                    player.battlefield
                );
                const refundAmount =
                    isDynamic && wasTapped && card.chosenMana
                        ? (card.chosenMana[manaColor] ?? 0)
                        : getFixedManaAmount(
                              card,
                              manaColor,
                              player.battlefield
                          );
                const amount = wasTapped
                    ? refundAmount
                    : getFixedManaAmount(card, manaColor, player.battlefield);
                // CR 106.6 — Mishra's Workshop produces mana spendable only on
                // artifact spells; it floats in a parallel `restrictedMana`
                // pool rather than the fungible pool. Refund (untap, blocked
                // unless `!manaCommitted`, so the full amount is still
                // floating) removes it from the same pool.
                const restriction = getActivatedManaRestriction(card);
                if (restriction) {
                    if (!wasTapped) {
                        addRestrictedManaToPool(
                            player,
                            manaColor,
                            amount,
                            restriction
                        );
                        producedThisActivation = {
                            [manaColor]: amount,
                        } as ManaCost;
                        emitPermanentTapped(
                            state,
                            card,
                            true,
                            producedThisActivation
                        );
                    } else {
                        reverseRestrictedManaFromPool(
                            player,
                            manaColor,
                            amount,
                            restriction
                        );
                    }
                } else if (!wasTapped) {
                    // CR 614 — Deep Water rewrites a land's produced mana to
                    // {U}. When the colour is rewritten we must snapshot
                    // `chosenMana` so the untap path refunds the {U} actually
                    // added rather than the land's native colour.
                    const added = applyLandManaReplacement(
                        state,
                        player.id,
                        card,
                        {
                            [manaColor]: amount,
                        } as ManaCost
                    );
                    const replaced = added[manaColor] === undefined;
                    if (isDynamic || replaced) {
                        card.chosenMana = added;
                    }
                    for (const [color, count] of Object.entries(added)) {
                        if (
                            color !== "X" &&
                            typeof count === "number" &&
                            count > 0
                        ) {
                            const key = color as keyof typeof player.manaPool;
                            player.manaPool[key] =
                                (player.manaPool[key] ?? 0) + count;
                        }
                    }
                    producedThisActivation = added;
                    emitPermanentTapped(
                        state,
                        card,
                        true,
                        producedThisActivation
                    );
                } else {
                    // Untap refund: prefer the snapshotted `chosenMana` (set
                    // when the output was dynamic or rewritten by Deep Water),
                    // else refund the land's native colour.
                    const refund =
                        card.chosenMana ??
                        ({
                            [manaColor]: amount,
                        } as ManaCost);
                    for (const [color, count] of Object.entries(refund)) {
                        if (
                            color !== "X" &&
                            typeof count === "number" &&
                            count > 0
                        ) {
                            const key = color as keyof typeof player.manaPool;
                            player.manaPool[key] = Math.max(
                                0,
                                (player.manaPool[key] ?? 0) - count
                            );
                        }
                    }
                    if (isDynamic || card.chosenMana)
                        card.chosenMana = undefined;
                    // CR 605.4 — also refund the Wild-Growth-style bonus mana
                    // this tap added (else it stays floating: the infinite-mana
                    // leak on tap/untap).
                    refundTapBonusMana(player, card);
                }
            }
            // CR 605.1a / ADR 0039 — pay the "Sacrifice this" portion of a
            // fixed-output sacrifice mana ability (Basal Thrull). Done after
            // the mana is produced and the PERMANENT_TAPPED event is emitted
            // (above), so leaves-the-battlefield triggers see the mana already
            // added. One-way: there is no untap branch for a sacrificed source.
            // CR 603.6 / 700.4 — `removePermanentTo` queues `PERMANENT_LEFT` so
            // the source's leave-the-battlefield / dies trigger fires (drained by
            // the trigger pass below); a raw `moveCard` would skip it.
            if (isSacrifice && !wasTapped) {
                removePermanentTo(state, card.id, "graveyard", "sacrifice");
            }
        }

        // CR 106.4 / 605.1a — untapping to refund unspent mana reverses the
        // WHOLE mana-ability activation, so restore the life the controller
        // paid on the tap (painland coloured-tap ping, Ancient Tomb, Mana
        // Confluence). Symmetric with the mana / charge-counter refund in the
        // untap branches above. Reachable only on an untap toggle (`wasTapped`,
        // no `producedThisActivation`) that passed the `manaCommitted` and
        // `tapTriggerCommitted` guards near the top — so the mana is unspent and
        // no becomes-tapped trigger has committed, exactly the window where the
        // whole tap (its life ping included) can still be undone. Unlike City of
        // Brass, whose becomes-tapped trigger sets `tapTriggerCommitted` and is
        // rejected before reaching here.
        if (wasTapped && !producedThisActivation) {
            restoreLifePaidOnUntap(player, card);
            // CR 106.4 / 601.2f — the cost-side sibling: refund the mana the
            // activation's own mana cost took (Mana Cylix's {1}), or the untap
            // toggle burns it. Same window/guards as the life refund above.
            restoreManaPaidOnUntap(player, card);
        }

        // CR 603.7a / ADR 0040 — a tap mana ability may declare a delayed-
        // trigger rider (`armsDelayedTriggerOnTap`). When the source was just
        // tapped for mana (`producedThisActivation` is set, i.e. this was a tap,
        // not an untap), arm the named delayed trigger from the source card's
        // `delayedTriggers[]`, with the activating player as the trigger's
        // controller (CR 113.7) and the source instance id in the payload.
        // Drives Rainbow Vale's "An opponent gains control of this land at the
        // beginning of the next end step." The mana-ability `effect` context
        // only exposes `addMana`, so this declarative seam carries the side
        // effect that needs the delayed-trigger machinery.
        if (producedThisActivation) {
            armDelayedTriggerOnTap(state, tapAbility, card, args.playerId);
        }

        // CR 605.1a / 120 — unconditional fixed-mana self-damage rider
        // (Ancient Tomb): every tap for mana pings the controller regardless
        // of the mana produced. `producedThisActivation` is set on both the
        // manaChoices and the fixed-output branches above, so this single
        // site covers whichever branch this ability took — this was a tap,
        // not an untap (no ping on untap/refund).
        if (producedThisActivation) {
            applyUnconditionalTapSelfDamage(
                state,
                tapAbility,
                card,
                args.playerId
            );
        }

        // CR 605.1a / 118.4 — tap mana ability life-payment cost (Mana
        // Confluence, Horizon Canopy, the MH1 Horizon-land cycle). Same
        // `producedThisActivation` gate as the rider above — paid on tap,
        // never refunded on untap.
        if (producedThisActivation) {
            applyManaAbilityLifeCost(state, tapAbility, args.playerId);
        }

        // CR 605.1a / 118.3 — tap mana ability discard-at-random cost
        // (Lion's Eye Diamond). Same `producedThisActivation` gate as above.
        if (producedThisActivation) {
            applyManaAbilityDiscardCost(state, tapAbility, args.playerId);
        }

        // CR 605.1a / 121.1 — mana-ability draw rider (Chromatic Sphere: "{1},
        // {T}, Sacrifice this artifact: Add one mana of any color. Draw a
        // card."). Same `producedThisActivation` gate as the riders above —
        // this single site covers whichever branch (choice or fixed) the
        // ability took, whether it sacrificed its source or not. Runs BEFORE
        // the trigger flush below so a "whenever you draw a card" watcher
        // (Sheoldred, Underworld Dreams) sees the draw land first.
        if (producedThisActivation) {
            applyDrawCardOnTap(state, tapAbility, args.playerId);
        }

        // CR 106.4 / 605.1a — record the life the controller actually lost to
        // this tap-for-mana's self-damage / life-cost riders (painland ping,
        // Ancient Tomb, Mana Confluence). The trigger flush below never changes
        // life (triggers go on the stack unresolved), so the delta captured
        // here is complete. Snapshotted so an untap-toggle that reverses the
        // whole activation (before the mana is spent, and only while no becomes-
        // tapped trigger has committed) restores it — the life-side sibling of
        // the mana / charge-counter refund. Always reassigned on a tap so a
        // stale value from an earlier activation can never leak forward.
        if (producedThisActivation) {
            recordLifePaidOnTap(card, lifeBeforeTap, player.life);
        }

        // CR 603.2 — flush the PERMANENT_TAPPED event into a trigger pass so
        // Manabarbs / Mana Flare / Wild Growth land on the stack right after
        // the mana ability resolves. Skip on untap (no event was emitted).
        if (producedThisActivation) {
            // CR 603.3 — a triggered ability, once put on the stack, cannot be
            // undone. Detect class-wide whether THIS tap-for-mana caused any
            // triggered ability to be put on the stack (City of Brass's own
            // "becomes tapped: deal 1 to you", or a third-party Manabarbs that
            // watches every land tap): compare the stack size across the
            // trigger flush. If it grew, the tap is irreversible — flag the
            // source so the standalone untap-toggle refuses to untap it
            // (checked at the untap branch above). Untapping would refund the
            // mana and untap the land while the trigger's effect (e.g. lost
            // life) stays applied — a state with no legal MTG equivalent.
            const stackSizeBeforeTriggers = state.stack.length;
            // CR 605.4 — snapshot the pool so the extra mana a Wild-Growth-style
            // triggered MANA ability adds off-stack during this flush can be
            // attributed to THIS tap and recorded on the source, so the
            // untap-toggle refunds it too (otherwise the bonus stays floating —
            // the infinite-mana leak on tap/untap).
            const poolBeforeTriggers = { ...player.manaPool };
            processPendingActionTriggers(state);
            markTapTriggerCommitment(state, card, stackSizeBeforeTriggers);
            const bonus: Record<string, number> = {};
            for (const [color, after] of Object.entries(player.manaPool)) {
                if (color === "X" || typeof after !== "number") continue;
                const delta =
                    after -
                    (poolBeforeTriggers[
                        color as keyof typeof poolBeforeTriggers
                    ] ?? 0);
                if (delta > 0) bonus[color] = delta;
            }
            card.tapBonusMana =
                Object.keys(bonus).length > 0 ? (bonus as ManaCost) : undefined;
        }

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** CR 605.1a / 613.4 (issue #1179) — resolves a NON-tap mana ability's
 *  runtime CHOICE (Vivi Ornitier's "any combination of {U} and/or {R}") against
 *  the unified `getEffectiveManaChoices` list and adds the CHOSEN `ManaCost`
 *  directly to the controller's pool — mirrors `tapSourceIntoPayment`'s
 *  bypass-the-closure pattern: the ability's own `effect`/`resolve` never
 *  runs. Returns null when the source has no choice-based non-tap mana
 *  ability at all (caller falls back to the fixed-effect path); throws when a
 *  choice exists but `manaChoiceIndex` is missing/out of range. Increments
 *  the per-turn activation count BEFORE adding mana (CR 602.5 — so a repeat
 *  activation this turn is rejected by the caller's `assertActivationTimingLegal`)
 *  and flushes the ABILITY_ACTIVATED trigger the increment queues (CR
 *  603.2/603.3). Exported as a standalone primitive — like
 *  `tapSourceIntoPayment` — so an integration test can drive the REAL
 *  resolution path directly (no convex-test harness in this repo). */
export function resolveNonTapManaChoice(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    abilityId: string,
    manaChoiceIndex: number | undefined
): ManaCost | null {
    const manaChoices = getEffectiveManaChoices(
        card,
        player.id,
        manaTapBattlefields(state)
    );
    if (!manaChoices) return null;
    if (manaChoiceIndex === undefined) {
        throw new Error("Must choose a mana color");
    }
    const chosen = manaChoices[manaChoiceIndex];
    if (!chosen) {
        throw new Error("Invalid mana choice");
    }
    recordActivation(state, card, abilityId, false);
    for (const [color, amount] of Object.entries(chosen)) {
        if (color !== "X" && typeof amount === "number" && amount > 0) {
            player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
        }
    }
    processPendingActionTriggers(state);
    return chosen;
}

/** Activate a NON-tap mana ability whose cost is mana (CR 605.1a / 605.3c —
 *  Farrelite Priest "{1}: Add {W}"). Unlike `tapUntap`, the source is not a tap
 *  toggle: the ability has no {T} component, may be activated repeatedly, and
 *  may carry a side effect (a conditional delayed sacrifice). It resolves
 *  immediately without using the stack (CR 605.3c): we synthesize a transient
 *  stack item, run the ability's `resolve` via the engine's normal resolution
 *  path so it gets a full `SpellContext` (`addMana`, `getActivationCount`,
 *  `scheduleDelayedTrigger`), then pop it — it never persists on the stack and
 *  never passes priority or runs an SBA pass. `recordActivation` increments the
 *  per-turn activation count BEFORE the resolve runs, so `getActivationCount`
 *  inside `resolve` includes the current activation (CR 602.5). Legal while the
 *  player has priority OR while paying a mana cost (CR 605.3b). */
export const activateManaAbility = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        abilityId: v.string(),
        // CR 605.1a / 605.3c (issue #1179) — resolves against the unified
        // `getEffectiveManaChoices` list for a non-tap mana ability that
        // offers a runtime colour/amount CHOICE (Vivi Ornitier's {U}/{R}
        // split). Mirrors the TAP path's `manaChoiceIndex`
        // (`tapSourceIntoPayment` / `tapUntap`).
        manaChoiceIndex: v.optional(v.number()),
        // CR 602.1 / 118.8 (issue #2371) — every permanent the caller is
        // choosing to tap to pay a `cost.tapOtherFilter` component (Urza,
        // Lord High Artificer's "Tap an untapped artifact you control: Add
        // {U}."). Ignored/unused when the ability has no `tapOtherFilter`
        // cost. See `payTapOtherAbilityCost`.
        tapOtherIds: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
            allowManaForMayPay: true,
        });

        // CR 117.3a / 605.3b — answering a may-pay choice opens a mana-payment
        // window; otherwise other pending choices freeze priority.
        const mayPayHead = state.pendingChoices?.[0];
        const isMayPayPaymentWindow =
            mayPayHead?.kind === "may-pay" &&
            mayPayHead.playerId === args.playerId;
        assertNoPendingChoices(state, {
            allowManaForMayPay: { playerId: args.playerId },
        });

        const player = getPlayer(state, args.playerId);

        // CR 605.3b — a mana ability is legal while the player has priority or
        // while paying a mana cost (cast/activation/may-pay window).
        const isInPayment =
            state.pendingCast?.playerId === args.playerId ||
            state.pendingActivation?.playerId === args.playerId;
        const hasPriority = state.priorityPlayerId === args.playerId;
        if (!hasPriority && !isInPayment && !isMayPayPaymentWindow) {
            throw new Error("Cannot activate mana ability without priority");
        }

        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");
        if (card.controllerId !== args.playerId) {
            throw new Error("You do not control this permanent");
        }

        const resolved = resolveActivatedAbility(card, args.abilityId);
        if (!resolved) throw new Error("Ability not found");
        const ability = resolved.ability;
        if (ability.useStack) {
            throw new Error("Use activateAbility for stack abilities");
        }
        // This path is for non-tap mana abilities only — a mana-cost ability
        // (Farrelite Priest "{1}: Add {W}") or a free "{0}:" ability (Vivi
        // Ornitier). Tap and sacrifice mana abilities (lands, mana rocks,
        // Lotus Petal) go through `tapUntap` / `tapSourceIntoPayment`'s
        // unified mana-tap options list instead (CR 605.1a — see the mirrored
        // `!ability.cost.tap && !ability.cost.sacrifice` gate in
        // `getManaTapOptionsDetailed`).
        if (ability.cost.tap || ability.cost.sacrifice) {
            throw new Error("Use tapUntap for tap mana abilities");
        }
        // CR 602.5 — phase-restricted templates are illegal outside their phase.
        if (
            ability.activationPhaseRestriction &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            throw new Error("Ability cannot be activated during this phase");
        }
        // CR 602.5b — controller-turn-only / once-per-turn timing (Vivi
        // Ornitier: "Activate only during your turn and only once each
        // turn."). Mirrors the check every other activation entry point runs
        // before cost lock.
        assertActivationTimingLegal(state, card, ability);

        // CR 602.1 / 118.8 (issue #2371) — "tap an untapped artifact you
        // control" as this ability's own cost component (Urza, Lord High
        // Artificer). Paid BEFORE the (possibly empty) `cost.mana` below, same
        // relative order `tapSourceIntoPayment` uses elsewhere (narrow cost,
        // then mana) — Urza's ability declares no `cost.mana` at all, so this
        // is the whole cost. See `payTapOtherAbilityCost`'s own doc comment
        // for why this can't reuse the STACK-ability `tapOtherChoice` picker.
        if (ability.cost.tapOtherFilter) {
            payTapOtherAbilityCost(
                state,
                player,
                card.id,
                ability.cost.tapOtherFilter,
                args.tapOtherIds ?? []
            );
        }

        const manaCost = normalizeManaCost(ability.cost.mana ?? {});
        if (
            !isManaCostCovered(
                player.manaPool,
                manaCost,
                getManaSubstitutions(state, player.id)
            )
        ) {
            throw new Error("Not enough mana");
        }
        payManaCost(
            player.manaPool,
            manaCost,
            getManaSubstitutions(state, player.id)
        );
        commitLandsForCost(player, manaCost);

        // CR 605.1a / 613.4 (issue #1179) — a non-tap mana ability that
        // declares `manaChoices` / `getManaChoices` (Vivi Ornitier's runtime
        // {U}/{R} split, board-conditional on her CURRENT effective power)
        // offers a CHOICE the activator must resolve; `null` means this
        // ability has no choice (Farrelite Priest), so fall through to the
        // fixed-effect stack path below.
        const chosen = resolveNonTapManaChoice(
            state,
            player,
            card,
            args.abilityId,
            args.manaChoiceIndex
        );
        if (chosen) {
            // CR 605.3b / 602.1 (issue #2420) — this activation may itself be
            // FUNDING a pending cast's or activation's mana cost (Urza's
            // `tapOtherFilter` leg, Farrelite Priest's pure `cost.mana` —
            // both routed through this mutation by the bot's `tapPlan`
            // executor, never `tapForPayment`/`tapForActivationPayment`).
            // Every OTHER payment mutation re-checks and auto-commits after
            // adding pool mana (`tapForPayment`, `tapForActivationPayment`);
            // without the same check here a fully-covered pending cast/
            // activation whose LAST leg was this ability would never commit —
            // a silent bot freeze (CLAUDE.md "Bot never freezes a game").
            // Both are no-ops when the corresponding pending record is absent
            // or not yet covered.
            tryAutoCommitPendingCast(state, args.playerId);
            tryAutoCommitPendingActivation(state, args.playerId);
            await saveGameState(
                ctx,
                args.gameId,
                gameState.seq + 1,
                state,
                gameState
            );
            return;
        }

        // CR 605.3c — resolve immediately without the stack. Synthesize a
        // transient stack item so `resolveTopOfStack` builds a full
        // SpellContext for the source, run the resolve, then pop. The item is
        // pushed and immediately resolved within this single mutation, so it is
        // never observable on the stack and never grants priority.
        const stackItem: StackItem = buildActivatedAbilityStackItem(card, {
            castById: args.playerId,
            abilityId: args.abilityId,
            ...(resolved.grantedSourceCardId
                ? { grantedSourceCardId: resolved.grantedSourceCardId }
                : {}),
        });
        state.stack.push(stackItem);
        // Increment BEFORE resolving so getActivationCount inside resolve()
        // counts this activation (CR 602.5). A mana cost (no {T}) emits
        // ABILITY_ACTIVATED.
        recordActivation(state, card, args.abilityId, false);
        resolveTopOfStack(state);
        // Flush any ABILITY_ACTIVATED / mana-add triggers queued during the
        // immediate resolve (CR 603.2/603.3).
        processPendingActionTriggers(state);

        // See the matching comment above the OTHER `saveGameState` in this
        // mutation (issue #2420) — same reasoning, the fixed-effect path.
        tryAutoCommitPendingCast(state, args.playerId);
        tryAutoCommitPendingActivation(state, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Activate an ability that was granted to a player by an effect (e.g.
 *  Channel's "Pay 1 life: Add {C}." — CR 113.1). Mirrors activateAbility
 *  but scoped to player-granted templates rather than battlefield cards.
 *  Mana abilities (useStack:false) resolve immediately; stack abilities
 *  push to the stack. */
export const activatePlayerAbility = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        grantedAbilityInstanceId: v.string(),
        keepPriority: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // SECURITY (issue #1645 review): seat-addressed mutation — the
        // caller must own the handle they name. See `assertCallerOwnsSeat`.
        await assertCallerOwnsSeat(ctx, args.playerId);
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, {
            playerId: args.playerId,
            expect: "priority",
        });
        assertNoPendingChoices(state);

        const player = getPlayer(state, args.playerId);
        const instance = player.grantedAbilities?.find(
            (g) => g.id === args.grantedAbilityInstanceId
        );
        if (!instance) throw new Error("Granted ability not found");

        const sourceCard = getDefinition(instance.sourceCardId);
        const ability = sourceCard.activatedAbilities?.find(
            (a) => a.id === instance.abilityId
        );
        if (!ability) throw new Error("Ability template not found");
        // CR 602.5 — phase-restricted templates are equally illegal when
        // activated via a player-scoped grant.
        if (
            ability.activationPhaseRestriction &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            throw new Error("Ability cannot be activated during this phase");
        }

        // CR 605.3a — mana abilities can be activated (a) when the player has
        // priority, or (b) while paying a mana cost of a spell/ability. Mirror
        // tapUntap / tapForPayment timing: allow either gate.
        const hasPriority = state.priorityPlayerId === args.playerId;
        const isInPayment =
            state.pendingCast?.playerId === args.playerId ||
            state.pendingActivation?.playerId === args.playerId;
        if (!ability.useStack) {
            if (!hasPriority && !isInPayment) {
                throw new Error(
                    "Cannot activate mana ability without priority"
                );
            }
        } else {
            if (!hasPriority) throw new Error("You don't have priority");
            if (state.pendingCast) {
                throw new ConvexError("Another spell is already being cast");
            }
            if (state.pendingActivation) {
                throw new ConvexError(
                    "Another ability is already being activated"
                );
            }
        }

        // Player-scoped grants have no source permanent — tap/sacrifice costs
        // are not meaningful here. Reject templates that require them.
        if (ability.cost.tap) {
            throw new Error(
                "Granted ability cannot require tap (no source permanent)"
            );
        }
        if (ability.cost.sacrifice) {
            throw new Error(
                "Granted ability cannot require sacrifice (no source permanent)"
            );
        }

        if (ability.cost.mana) {
            const manaCost = normalizeManaCost(ability.cost.mana);
            if (
                !isManaCostCovered(
                    player.manaPool,
                    manaCost,
                    getManaSubstitutions(state, player.id)
                )
            ) {
                throw new Error("Not enough mana");
            }
            payManaCost(
                player.manaPool,
                manaCost,
                getManaSubstitutions(state, player.id)
            );
            commitLandsForCost(player, manaCost);
        }

        // CR 119.4 — a player can't pay more life than they have.
        if (ability.cost.life !== undefined) {
            if (player.life < ability.cost.life) {
                throw new Error("Not enough life");
            }
        }

        if (!ability.useStack) {
            // Mana abilities resolve immediately (CR 605.3c) — no SBA pass.
            // Pay life after mana, then run the effect via a minimal context
            // exposing only addMana (ActivatedAbilityContext).
            if (ability.cost.life !== undefined) {
                player.life -= ability.cost.life;
            }
            ability.effect?.({
                addMana: (amount) => {
                    for (const [color, count] of Object.entries(amount)) {
                        if (
                            color !== "X" &&
                            typeof count === "number" &&
                            count > 0
                        ) {
                            const key = color as keyof typeof player.manaPool;
                            player.manaPool[key] =
                                (player.manaPool[key] ?? 0) + count;
                        }
                    }
                },
            });
        } else {
            // Stack path: synthesize a stack item carrying the template's
            // source card reference. Not exercised by Channel yet, but kept
            // for future granted stack abilities.
            if (ability.cost.life !== undefined) {
                player.life -= ability.cost.life;
            }
            const stackItem: StackItem = {
                id: `granted-${instance.id}`,
                card: { id: instance.sourceCardId },
                controllerId: args.playerId,
                ownerId: args.playerId,
                zone: "stack",
                types: sourceCard.types,
                subtypes: sourceCard.subtypes ?? [],
                staticAbilities: [],
                isTapped: false,
                castById: args.playerId,
                abilityId: instance.abilityId,
            };
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
            state.singleShotAutoPass = args.keepPriority
                ? undefined
                : args.playerId;
            drainAutoPasses(state);
        }

        // If a pendingCast or pendingActivation is now payable thanks to the
        // freshly produced mana, auto-commit it (mirrors tapForPayment).
        const committedCast = tryAutoCommitPendingCast(state, args.playerId);
        if (!committedCast) {
            tryAutoCommitPendingActivation(state, args.playerId);
        }

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/**
 * Debug: patch any value in the game state by dot-separated path.
 *
 * Admin-only debug mutation (issue #1679, same CLAUDE.md privileged-mutation
 * convention as `debugSetupScenario` #768 / `debugBo3Sideboard` #1679): it
 * writes to an ARBITRARY path of ANY game's state selected purely from a
 * client-supplied `gameId`, with no seat argument to hang
 * `assertSeatOwnership` on. Without the gate, a non-admin, non-seat caller
 * can drive it directly (e.g. `{ path: "players.0.life", value: 0 }`) against
 * another user's live game — and because the SBA sweep on the next legitimate
 * action is the delivery mechanism for game-over consequences (CR-driven,
 * see `assertCallerOwnsSeat`'s docstring in `gameLifecycle.ts`, issue #1645),
 * that single write can force a real Match/standings outcome. `assertIsAdmin`
 * runs FIRST, before any state is read or touched.
 */
export const debugPatchState = mutation({
    args: {
        gameId: v.id("games"),
        path: v.string(),
        value: v.any(),
    },
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);

        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as Record<
            string,
            unknown
        >;
        const keys = args.path.split(".");
        let target: Record<string, unknown> = state;

        for (let i = 0; i < keys.length - 1; i++) {
            target = target[keys[i]] as Record<string, unknown>;
            if (!target) throw new Error(`Invalid path: ${args.path}`);
        }

        target[keys[keys.length - 1]] = args.value;

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/**
 * Debug: reset game — rebuild initial state from the game record.
 *
 * Admin-only debug mutation (issue #1679, same convention as
 * `debugPatchState` / `debugSetupScenario` #768 / `debugBo3Sideboard`): it
 * rebuilds an ARBITRARY game's state and its owning Match/standings from a
 * client-supplied `gameId` alone, with no seat argument to hang
 * `assertSeatOwnership` on. `assertIsAdmin` runs FIRST, before any state is
 * read or touched.
 */
export const debugResetGame = mutation({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);

        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");

        const existing = await getLatestGameState(ctx, args.gameId);

        const idCounter: { nextInstanceId?: number } = {};
        // Decklists live in `gameDecks` (issue #2506) — a reset rebuilds the
        // libraries, so this is one of the paths that must hydrate in full.
        const seats = await hydrateGameSeats(ctx, game);
        const playersState = seats.map((p) =>
            buildPlayerState(p as PlayerInput, idCounter)
        );
        // CR 500.1: starting player begins their first turn at game start.
        playersState[0].turnsTaken = 1;
        const rngSeed = freshSeed();
        const initialState: GameState = {
            players: playersState,
            stack: [],
            turn: 1,
            activePlayerId: playersState[0].id,
            priorityPlayerId: playersState[0].id,
            passCount: 0,
            phase: "UNTAP" as Phase,
            rngSeed,
            rngCounter: 0,
            nextInstanceId: idCounter.nextInstanceId,
        };
        for (const player of initialState.players) {
            seededShuffle(initialState, player.library);
            for (let i = 0; i < STARTING_HAND_SIZE; i++)
                drawCardFromLibrary(player);
        }
        initialState.phase = "MULLIGAN" as Phase;
        initialState.mulligan = makeMulliganState(initialState);
        initialState.priorityPlayerId = initialState.mulligan.declaringPlayerId;

        await saveGameState(ctx, args.gameId, 0, initialState, existing);

        // Reset game status in case it was finished
        await ctx.db.patch(args.gameId, {
            status: "playing",
            winner: undefined,
            updatedAt: Date.now(),
        });

        // Reset the owning Match too (ADR 0029): a Bo1 finishes its Match when
        // the Game ends, so restarting the Game must reopen the Match — clear
        // the winner, zero the scores, flip back to "playing".
        if (game.matchId) {
            const match = await ctx.db.get(game.matchId);
            if (match) {
                await ctx.db.patch(game.matchId, {
                    status: "playing",
                    winner: undefined,
                    players: match.players.map((p) => ({
                        ...p,
                        score: 0,
                        ready: false,
                    })),
                    updatedAt: Date.now(),
                });
            }
        }
    },
});

/**
 * Debug: force the current (solo) Match into the Bo3 between-Games Sideboarding
 * flow in one click (PRD #387 user story 35 / #397). Promotes the owning Match
 * to `bestOf: 3`, records a Game-1 result for the SECOND seat (so the score is
 * 0–1 and the human's `-p1` seat is the play/draw chooser per CR 103.4), routes
 * the Match to "sideboarding", and writes a `gameOver` onto the current Game
 * state so the board surfaces the Game-Over interstitial → "Continue to
 * Sideboarding". From there the whole between-Games flow (swap editor, ready
 * gate, play/draw choice, next-Game build) is exercisable end-to-end.
 *
 * Solo-only: it drives both seats from one client, matching the Debug panel's
 * solo-mode workflow. The pure transition reuses `recordGameResult` so the debug
 * path can't drift from production.
 *
 * Admin-only debug mutation (issue #1679, same CLAUDE.md privileged-mutation
 * convention as `debugSetupScenario` #768): it force-finishes a Game/Match
 * selected purely from a client-supplied `gameId`, with no seat argument to
 * hang `assertSeatOwnership` on, and it is reachable ONLY from the Debug
 * panel (`src/components/debug/debug-panel.tsx`) via `useMutation`, so it
 * cannot become an `internalMutation` (unreachable from a browser client).
 * `assertIsAdmin` runs FIRST, before any Match/Game state is touched.
 */
export const debugBo3Sideboard = mutation({
    args: { gameId: v.id("games") },
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);

        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        if (!game.matchId) throw new Error("Game has no owning Match");
        const match = await ctx.db.get(game.matchId);
        if (!match) throw new Error("Match not found");

        // The second seat "wins" Game 1 — for a solo Match this is `-p2`, so the
        // human's `-p1` seat becomes the play/draw chooser (loser, CR 103.4).
        const winnerSeat = match.players[1] ?? match.players[0];
        const loserSeat = match.players.find((p) => p.id !== winnerSeat.id);

        // Promote to Bo3 first, then route through the SAME pure transition the
        // production game-over path uses, so the debug state is realistic.
        const bo3: Doc<"matches"> = { ...match, bestOf: 3 };
        const patch = recordGameResult(bo3, winnerSeat.id);
        const now = Date.now();
        await ctx.db.patch(game.matchId, {
            bestOf: 3,
            ...(patch ?? {}),
            updatedAt: now,
        });

        // Mark the current Game finished and stamp `gameOver` so the board opens
        // the interstitial Game-Over dialog (→ Continue to Sideboarding).
        const existing = await getLatestGameState(ctx, args.gameId);
        if (existing) {
            const state = structuredClone(existing.state) as GameState;
            state.gameOver = {
                winnerId: winnerSeat.id,
                loserId: loserSeat?.id ?? winnerSeat.id,
                reason: "concede",
            };
            await saveGameState(
                ctx,
                args.gameId,
                existing.seq,
                state,
                existing
            );
        }
        await ctx.db.patch(args.gameId, {
            status: "finished",
            winner: winnerSeat.id,
            updatedAt: now,
        });
    },
});

/** Returns all available card names for the debug scenario builder. */
export const debugListCards = query({
    handler: () => getAllCardNames(),
});

/**
 * Debug: set up a board scenario for testing.
 * Each entry places a card (by name) on a player's battlefield.
 * Optionally sets the phase and clears hands/stack.
 */
export const debugSetupScenario = mutation({
    args: {
        gameId: v.id("games"),
        /** Cards to place. "me" = player 1, "opp" = player 2. */
        cards: v.array(
            v.object({
                name: v.string(),
                owner: v.union(v.literal("me"), v.literal("opp")),
                /** CR 111 / 707.2 — place a TOKEN instead of a card: `name` is
                 *  then a key in the token catalogue
                 *  (`convex/cards/tokenCatalogue.ts`, e.g. "Treasure",
                 *  "Soldier (1/1 W)") and the token is created through the
                 *  engine's `createTokenPermanents`, art and all. Battlefield
                 *  only (CR 111.7). */
                token: v.optional(v.boolean()),
                zone: v.optional(
                    v.union(
                        v.literal("hand"),
                        v.literal("battlefield"),
                        v.literal("library"),
                        v.literal("graveyard"),
                        v.literal("exile")
                    )
                ),
                tapped: v.optional(v.boolean()),
                count: v.optional(v.number()),
                /** Position within the library, counted from the TOP (index 0,
                 *  where `drawCard` reads): `1` = top, `2` = second from top;
                 *  negatives count from the bottom (`-1` = bottom). Library zone
                 *  only. Default: bottom (appended). With `count > 1` the copies
                 *  are placed consecutively starting at this position. */
                position: v.optional(v.number()),
                /** Attach this Aura/Equipment to another battlefield permanent by
                 *  card name (CR 303.4 / 701.3 — sets `attachedTo`). Host looked
                 *  up on the owner's battlefield first, then the opponent's; first
                 *  match wins. Battlefield only. */
                attachedTo: v.optional(v.string()),
                /** Marked damage (CR 120.3) on a battlefield creature. */
                damageMarked: v.optional(v.number()),
                /** Place this card face down (CR 708.2, ADR 0013): a 2/2
                 *  colourless vanilla creature whose real identity is hidden
                 *  from the opponent. Battlefield only. */
                faceDown: v.optional(v.boolean()),
                /** Exile this card FACE DOWN (impulse-draw, CR 406.3,
                 *  ADR 0026 slice 6): a card in the exile pile whose identity
                 *  is known only to its controller (`knownTo`). Exile zone
                 *  only. */
                faceDownExile: v.optional(v.boolean()),
                /** Grant "me" a play-from-exile permission on this exiled card
                 *  (CR 601.3e / 608.2g, #946): an impulse "you may play that
                 *  card this turn" window (Headliner Scarlett / Expressive
                 *  Iteration). Sets `castableFromExileBy` + a this-turn expiry so
                 *  a Play (land) / Cast (spell) affordance appears, revoked at
                 *  the next cleanup. Exile zone only; combine with
                 *  `faceDownExile` for the true impulse look. */
                castableFromExile: v.optional(v.boolean()),
                /** CR 305.9 (issue #1689) — only when this is ALSO set does
                 *  `castableFromExile` grant the LAND-INCLUSIVE shape
                 *  (Headliner Scarlett / Expressive Iteration: "you may PLAY
                 *  that card"); omitted/false stages the cast-only shape (Ice
                 *  Cauldron / Robber of the Rich / Ragavan), under which a
                 *  land in exile has no legal play OR cast. Exile zone only. */
                castableFromExileIncludesLand: v.optional(v.boolean()),
                /** Pre-seed counters (CR 122) on a battlefield permanent —
                 *  e.g. `{ "+1/+1": 3 }` for Triskelion or `{ doom: 2 }` for
                 *  Armageddon Clock. Keyed by counter type. Battlefield only. */
                counters: v.optional(v.record(v.string(), v.number())),
                /** Mark this battlefield creature as having attacked during its
                 *  controller's previous turn (CR 508.1) — sets
                 *  `attackedDuringLastTurn` so self attack-restrictions
                 *  ("can't attack if it attacked during your last turn",
                 *  Giant Turtle #490) fire immediately. Battlefield only. */
                attackedLastTurn: v.optional(v.boolean()),
                /** Mark this battlefield permanent as having entered this turn
                 *  (CR 302.6) — sets `isSummoningSick`. For a manland (Mishra's
                 *  Factory) this makes animation the same turn read
                 *  summoning-sick: the animated creature can't attack and can't
                 *  pay {T}. Battlefield default is `false`. #545. */
                summoningSick: v.optional(v.boolean()),
                /** Make this battlefield permanent a COPY of another card by
                 *  name (CR 707.2 — Clone, Copy Artifact, Vesuvan Doppelganger).
                 *  `name` is the copy's printed identity (preserved in
                 *  `copiedFrom`); `copyOf` is the copied object it presents. The
                 *  card-preview then shows both faces (Current + Original).
                 *  Battlefield only. */
                copyOf: v.optional(v.string()),
            })
        ),
        phase: v.optional(v.string()),
        /** Give each player this many basic lands. The land TYPES match the
         *  colours of the cards placed in the scenario (CR 202.2) — a mono-red
         *  board seeds Mountains, a UW board alternates Islands and Plains — so
         *  the placed cards are actually castable. Colourless/empty → Plains.
         *  Default 0. */
        landCount: v.optional(v.number()),
        /** Fill each player's library with this many basic lands, colour-matched
         *  to the placed cards like `landCount`. Default: unchanged. */
        libraryCount: v.optional(v.number()),
        /** Override the turn number. Default: unchanged (turn 1 of a fresh solo
         *  game skips the draw step — set ≥2 to exercise draw-step effects). */
        turn: v.optional(v.number()),
        /** Mark "me"'s last placed hand card as the card drawn this turn
         *  (`lastDrawnCardId`), so abilities with a "discard the last card you
         *  drew this turn" cost (Jandor's Ring) are one-click activatable. */
        markLastDrawn: v.optional(v.boolean()),
        /** Pin the seeded PRNG (CR 705 / ADR 0023). Resets `rngSeed` and zeroes
         *  `rngCounter` so the NEXT random draw is deterministic — e.g. a coin
         *  flip (Bottle of Suleiman) lands WIN with seed 1 / LOSE with seed 7.
         *  Default: unchanged. */
        rngSeed: v.optional(v.number()),
        /** Seed poison counters (CR 122) on a player. A player reaching ten or
         *  more loses the game (CR 704.5c). Absent / zero leaves no poison. */
        poison: v.optional(
            v.object({
                me: v.optional(v.number()),
                opp: v.optional(v.number()),
            })
        ),
        /** Seed starting life totals (CR 119.1, issue #2147) — pins a
         *  life-dependent decision (chump-block vs. race, a lethal check)
         *  instead of opening at the default 20. Mirrors `poison`'s per-seat,
         *  both-optional shape exactly. MUST stay in lock-step with
         *  `scenarioSpecValidator` (`convex/debugScenarioSpec.ts`) — both live
         *  load paths (`debug-db-scenarios.tsx`, `useScenarioTestGame.ts`)
         *  spread a normalized spec straight into this mutation's args, so a
         *  field present there and absent here throws
         *  `ArgumentValidationError` before the handler runs. */
        life: v.optional(
            v.object({
                me: v.optional(v.number()),
                opp: v.optional(v.number()),
            })
        ),
        /** Seed experience counters (CR 122.1, issue #1969) on a player. No
         *  rule removes them and no SBA reads them; they exist for the cards
         *  that count them (Otharri, Suns' Glory), so seeding them is how a
         *  scenario starts at a SCALED state. Absent / zero leaves none. */
        experience: v.optional(
            v.object({
                me: v.optional(v.number()),
                opp: v.optional(v.number()),
            })
        ),
        /** CR 702.139c / ADR 0064 (issue #1392) — directly declare a
         *  companion into `owner`'s slot, bypassing the normal sideboard/
         *  maindeck auto-declare (`selectCompanion`, game init) that a
         *  scenario's synthetic board never runs through. `used: true`
         *  exercises the "already summoned" state; default `false`. */
        companion: v.optional(
            v.object({
                name: v.string(),
                owner: v.optional(v.union(v.literal("me"), v.literal("opp"))),
                used: v.optional(v.boolean()),
            })
        ),
    },
    handler: async (ctx, args) => {
        // Admin-only debug board setup (CLAUDE.md privileged-mutation
        // convention, issue #768). `assertIsAdmin` runs FIRST — non-admins
        // are rejected server-side before any state is touched: an arbitrary
        // logged-in caller could otherwise overwrite any game's board.
        await assertIsAdmin(ctx);

        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        // The actual state-construction logic lives in the pure
        // `buildStateFromScenario` (issue #1424, PRD #1423) so it's callable
        // from a vitest test with no Convex runtime AND from this mutation —
        // `args` (minus `gameId`) already matches the `ScenarioSpec` shape
        // it takes.
        const state = buildStateFromScenario(
            gameState.state as GameState,
            args
        );

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/**
 * List the code-side blade-scenario registry (issue #1432, PRD #1423):
 * metadata only (`label`/`tier`/`note`), never the `spec` — the browser
 * loader below resolves the `spec` server-side by label, so the registry —
 * not the client — stays the sole source of what gets applied to a board.
 * Admin-gated like every other debug endpoint (issue #768).
 */
export const debugListBladeScenarios = query({
    args: {},
    returns: v.array(
        v.object({
            label: v.string(),
            tier: v.union(v.literal("must"), v.literal("stretch")),
            note: v.optional(v.string()),
        })
    ),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        return BLADE_SCENARIOS.map((s) => ({
            label: s.label,
            tier: s.tier,
            note: s.note,
        }));
    },
});

/**
 * READ-ONLY browser loader for a blade scenario (issue #1432, PRD #1423).
 * Loads one entry's position into the CURRENT solo game so a developer can
 * eyeball it, through `resolveBladeLoadState`
 * (`convex/gre/ai/blade/runner.ts`) — which resolves `label` against the
 * code-side registry, then normalizes the CURRENT game's snapshot onto the
 * same starting position `buildBladeBaseState` produces (active/priority
 * player = the "me" seat, starting life, every turn-/game-scoped field back
 * to its start-of-game value — see that function's doc comment for the full
 * list), then applies the entry's `spec` through the same
 * `buildStateFromScenario` the DB-backed scenario loader
 * (`debugSetupScenario` above) and the blade test harness both use. Without
 * that normalization, a live game's turn/life/counter state would leak into
 * the loaded position, diverging it from the one the blade harness actually
 * built and the entry's `expect` was written against (issue #1432 review,
 * both rounds).
 *
 * Deliberately NOT the `debugScenarios` DB path: `label` only selects an
 * entry from the code-side registry — the client never supplies a `spec` —
 * so there is no DB row to write, edit, or delete. A blade entry is a
 * regression assertion that lives in git with the engine change it guards
 * (PRD #1423), never DB-seeded.
 */
export const debugLoadBladeScenario = mutation({
    args: {
        gameId: v.id("games"),
        label: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        // Admin-only debug board setup (CLAUDE.md privileged-mutation
        // convention, issue #768) — same gate as `debugSetupScenario`.
        await assertIsAdmin(ctx);

        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        // Label lookup + state build both live in `resolveBladeLoadState`
        // (`gre/ai/blade/runner.ts`) — this handler is a thin wrapper around
        // it (ctx / admin gate / fetch / persist only), so the pure-function
        // test suite in `convex/__tests__/debugLoadBladeScenario.test.ts`
        // exercises the exact code this mutation runs (issue #1432 review
        // round 2, finding #1).
        const state = resolveBladeLoadState(
            gameState.state as GameState,
            args.label
        );

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
        return null;
    },
});

// --- Manual Mode mutations (ADR 0080 S2) ------------------------------------

type VerbResult = { state: ManualGameState; log: ManualLogEntry };

async function manualVerbHandler(
    ctx: MutationCtx,
    gameId: GenericId<"games">,
    apply: (state: ManualGameState) => VerbResult
): Promise<void> {
    const game = await ctx.db.get(gameId);
    if (!game) throw new ConvexError("Game not found");
    if (game.mode !== "manual") throw new ConvexError("Not a manual game");
    const user = await getCurrentUser(ctx);
    if (!gameBelongsToUser(game, user._id))
        throw new ConvexError("Not a player in this game");

    const existing = await getLatestManualState(ctx, gameId);
    if (!existing) throw new Error("Manual state not found");

    const state = existing.state as ManualGameState;
    // Self-repair for games started before cards carried their name (see
    // `backfillManualCardNames`): the decklists moved to `gameDecks` (issue
    // #2506), so this is now one point lookup per seat rather than free.
    const nameByPrintId = new Map<string, string>();
    for (const player of await hydrateGameSeats(ctx, game)) {
        for (const card of player.deck.cards) {
            if (!nameByPrintId.has(card.cardId))
                nameByPrintId.set(card.cardId, card.cardName);
        }
    }
    backfillManualCardNames(state, nameByPrintId);

    const result = apply(state);

    await saveManualState(
        ctx,
        gameId,
        existing.seq + 1,
        result.state,
        existing
    );
    await appendManualLog(ctx, gameId, result.log);
}

export const manualMoveCard = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        toZone: v.union(
            v.literal("library"),
            v.literal("hand"),
            v.literal("battlefield"),
            v.literal("graveyard"),
            v.literal("exile")
        ),
        index: v.optional(v.number()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualMoveCardFn(state, args.instanceId, args.toZone, args.index)
        );
        return null;
    },
});

export const manualSetTapped = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        tapped: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetTappedFn(state, args.instanceId, args.tapped)
        );
        return null;
    },
});

export const manualUntapAll = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualUntapAllFn(state, args.playerId)
        );
        return null;
    },
});

export const manualAdjustLife = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        delta: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualAdjustLifeFn(state, args.playerId, args.delta)
        );
        return null;
    },
});

export const manualAdjustCounter = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        type: v.string(),
        delta: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualAdjustCounterFn(state, args.instanceId, args.type, args.delta)
        );
        return null;
    },
});

export const manualSetFaceDown = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        faceDown: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetFaceDownFn(state, args.instanceId, args.faceDown)
        );
        return null;
    },
});

export const manualSetLane = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        lane: v.union(v.literal("main"), v.literal("combat")),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetLaneFn(state, args.instanceId, args.lane)
        );
        return null;
    },
});

export const manualSetBackColumn = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        column: v.union(v.literal("left"), v.literal("right")),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetBackColumnFn(state, args.instanceId, args.column)
        );
        return null;
    },
});

export const manualAttach = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        targetId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualAttachFn(state, args.instanceId, args.targetId)
        );
        return null;
    },
});

export const manualSetArrow = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        targetId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetArrowFn(state, args.instanceId, args.targetId)
        );
        return null;
    },
});

export const manualClearArrows = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualClearArrowsFn(state, args.playerId)
        );
        return null;
    },
});

export const manualClearArrow = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualClearArrowFn(state, args.instanceId)
        );
        return null;
    },
});

export const manualDraw = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualDrawFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualMill = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualMillFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualExileTop = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualExileTopFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualPeek = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        n: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualPeekFn(state, args.playerId, args.n)
        );
        return null;
    },
});

export const manualShuffle = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualShuffleFn(state, args.playerId)
        );
        return null;
    },
});

export const manualCreateToken = mutation({
    args: {
        gameId: v.id("games"),
        cardId: v.string(),
        controllerId: v.string(),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualCreateTokenFn(
                state,
                args.cardId,
                args.controllerId,
                args.playerId
            )
        );
        return null;
    },
});

export const manualRoll = mutation({
    args: {
        gameId: v.id("games"),
        sides: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualRollFn(state, args.sides)
        );
        return null;
    },
});

export const manualSetNote = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        text: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetNoteFn(state, args.instanceId, args.text)
        );
        return null;
    },
});

export const manualSetPhase = mutation({
    args: {
        gameId: v.id("games"),
        phase: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetPhaseFn(state, args.phase)
        );
        return null;
    },
});

export const manualSetActivePlayer = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualSetActivePlayerFn(state, args.playerId)
        );
        return null;
    },
});

export const manualEndTurn = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualEndTurnFn(state, args.playerId)
        );
        return null;
    },
});

// `manualConcede` — a mutation that ran `manualConcedeFn` and stopped there —
// was DELETED here. It stamped `concededBy` on the manual state and nothing,
// client or server, ever read that field, so the board's Concede button
// dispatched a write that ended no game: the whole visible symptom of the QA
// report. There is exactly one concede in Manual Mode and it is
// `manualConcedeMatch` below, which finishes the game row too.

/**
 * Concede and finalize the WHOLE manual Match (ADR 0080 S12), regardless of
 * `bestOf` — the ADR 0080 S12 twin of the `forfeitMatch` mutation for GRE
 * Matches, and reuses the same pure transition (`computeForfeitMatch`) for
 * exactly that reason. The conceding player's opponent is awarded the games
 * they still need to win and the Match is marked "finished".
 *
 * Deliberately NOT `recordGameResult` (#2400 review round 2): that transition
 * only ends the CURRENT Game, and for a Bo3 mid-Match it advances the Match to
 * "sideboarding" — still an `ACTIVE_MATCH_STATUSES` member, so
 * `findActiveMatchForUser` still finds it. `manualConcedeMatch` has exactly
 * two callers today (the lobby's "Concede Match" banner and the Scenarios
 * admin panel's active-game dialog) and both mean "abandon the whole Match so
 * I'm free to start something else" — never "advance to the next Bo3 game",
 * which has its own explicit action (`continueManualMatch`).
 *
 * `computeForfeitMatch` returning `null` (the seat named isn't actually in
 * this Match) fails CLOSED — the mutation throws instead of silently
 * attributing the win/loss to the wrong seat, the same fail-closed shape
 * `forfeitMatch` already has.
 *
 * The manual state persists for the completed game — the log is the only
 * artefact worth reading.
 */
export const manualConcedeMatch = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualConcedeFn(state, args.playerId)
        );

        const now = Date.now();
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new ConvexError("Game not found");
        if (!game.matchId) throw new Error("Game has no Match");

        const match = await ctx.db.get(game.matchId);
        if (!match) throw new Error("Match not found");
        if (match.status === "finished") return;

        const patch = computeForfeitMatch(match, args.playerId);
        if (!patch) throw new Error("Seat not found in this match");

        // Mark the game row finished BEFORE the match patch, so the status
        // subscription sees a finished game with a winner.
        await ctx.db.patch(args.gameId, {
            status: "finished",
            winner: patch.winner,
            updatedAt: now,
        });

        await ctx.db.patch(game.matchId, { ...patch, updatedAt: now });

        // Clean up manualStates — the game is over, and the log is the only
        // artefact worth keeping (ADR 0080 S12 open decision).
        const manualRows = await ctx.db
            .query("manualStates")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const row of manualRows) await ctx.db.delete(row._id);
    },
});

/**
 * Start the next game of a Tabletop Bo3 Match (ADR 0080 S12). Reshuffles both
 * decks, draws 7, resets life to 20 — no coin toss, no sideboarding. The Match
 * must be in "sideboarding" status.
 */
export const continueManualMatch = mutation({
    args: {
        matchId: v.id("matches"),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");
        if (!matchBelongsToUser(match, user._id))
            throw new Error("You are not part of this match");
        if (match.status !== "sideboarding")
            throw new Error("Match is not awaiting the next game");

        const now = Date.now();
        const gameNumber = (match.currentGameNumber ?? 1) + 1;

        // Build the next game's inputs from the Match's stored decks.
        // The Match deck copies live in `matchDecks` now (issue #2506) — the
        // next Game's library is built from them, so this path hydrates.
        const seats = buildNextGameSeats({
            players: await hydrateMatchPlayers(ctx, match),
        });
        const gameId = await insertGameWithDecks(ctx, {
            name: `Tabletop game ${gameNumber}`,
            matchId: args.matchId,
            gameNumber,
            status: "playing",
            players: toGamePlayers(seats),
            solo: true,
            mode: "manual",
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(args.matchId, {
            status: "playing",
            currentGameId: gameId,
            currentGameNumber: gameNumber,
            updatedAt: now,
        });

        // Fresh manual state from the stored decks.
        const initial = setupManualGame(
            seats.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                deck: p.deck.cards,
            }))
        );

        await saveManualState(ctx, gameId, 0, initial, null);
        await appendManualLog(ctx, gameId, {
            text: `Game ${gameNumber} started`,
            timestamp: now,
        });

        return { gameId, gameNumber };
    },
});

export const manualReveal = mutation({
    args: {
        gameId: v.id("games"),
        instanceId: v.string(),
        toPlayerIds: v.array(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualRevealFn(state, args.instanceId, args.toPlayerIds)
        );
        return null;
    },
});

export const manualRevealHand = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        toPlayerIds: v.array(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await manualVerbHandler(ctx, args.gameId, (state) =>
            manualRevealHandFn(state, args.playerId, args.toPlayerIds)
        );
        return null;
    },
});
