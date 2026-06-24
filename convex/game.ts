import { v, type GenericId } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { auth, getCurrentUser } from "./auth";
import { mutation, query } from "./_generated/server";
import {
    getAllCardNames,
    getCardById,
    getCardByName,
    getInstanceManaCost,
    tryGetCardById,
} from "./cards";
import {
    type CardInstanceState,
    type GameState,
    type PendingActivation,
    type PendingTarget,
    type PlayerState,
    type StackItem,
    getPlayer,
    getOpponentId,
    drawCard as drawCardFromLibrary,
    matchesPermanentFilter,
    moveCard,
    removeFromZone,
    removePermanentTo,
    applySourceStaticEffects,
    getBasicLandMana,
    payManaCost,
    payManaCostForSpell,
    spendablePoolForSpell,
    addRestrictedManaToPool,
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
    emitSpellCastEvent,
    emitPermanentTapped,
    emitAbilityActivated,
    discardPermanentTappedEvent,
    processPendingActionTriggers,
    allocInstanceId,
    tapPermanent,
    exileFaceDownCard,
} from "./gre/state";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
    solveAutoTapPartial,
    type Demand,
} from "./gre/autoTap";
import {
    buildBoardAbilityDemands,
    buildHandSpellDemands,
} from "./gre/autoTapDemands";
import { isGuardedAgainst } from "./gre/permanentGuard";
import { assertDeckLegal } from "./formats";
import type {
    ActivatedAbility,
    CardType,
    Color,
    ManaCost,
    PermanentFilter,
    SpellMode,
} from "./cards/types";
import {
    assertLegalAction,
    getLegalTargets,
    getPendingTargetSourceColors,
    getPendingTargetSourceTypes,
    getPendingTargetSourceSubtypes,
    hasColor,
    isProtectedFromColors,
    matchesMvFilter,
    resolveMvFilter,
    spellWouldDestroyLandControlledBy,
} from "./gre/rules";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./gre/layers";
import { projectFullState, projectPublicState } from "./gameProjections";
import { computeSoloViewerId } from "./soloViewer";
import { compactState, expandState } from "./gre/serialize";
import { turnFaceDown } from "./gre/faceDown";
import { substituteColorFilter } from "./gre/textChanges";
import {
    advancePhase,
    drainAutoPasses,
    applyAllCombatDamage,
    emitBlockersConfirmedEvents,
    emitAttackersDeclaredEvents,
    isSorceryTiming,
} from "./gre/phases";
import { freshSeed, seededShuffle } from "./gre/rng";
import {
    finalizeMulligan,
    makeMulliganState,
    recordDeclaration,
} from "./gre/mulligan";
import type { Phase } from "./gre/types";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    applyLandManaReplacement,
    getActivatedManaAbility,
    getActivatedManaColor,
    getActivatedManaRestriction,
    getDynamicManaProduced,
    getEffectiveManaChoices,
    getFixedManaAmount,
    hasManaAbility,
    isTapLockedBySummoningSickness,
    manaValue,
} from "./gre/constants";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    getRequiredAttackerIds,
    mustAttack,
    getRequiredBlockerAssignments,
    getMaxBlockTargets,
    getAttackerCap,
    getBlockerCap,
    validateMinimumBlockers,
} from "./gre/combat";
import {
    getEffectiveBlockGraph,
    outstandingDamageAssigner,
    isLegalBandComposition,
    recordBlockedAttackers,
} from "./gre/banding";
import { checkStateBasedActions } from "./gre/sba";
import { applyPlayLand } from "./gre/playLand";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
    applyNameCardSubmit,
    applyRandomRevealAck,
} from "./gre/pendingChoiceSubmit";
import { gameBelongsToUser } from "./gameLifecycle";
import {
    allSeatsReady,
    applySideboard,
    botIsChooser,
    botSeatId,
    buildNextGameSeats,
    findActiveMatchForUser,
    forfeitMatch as computeForfeitMatch,
    matchBelongsToUser,
    nextGameActivePlayerId,
    recordGameResult,
    snapshotDeck,
    type MatchPlayer,
    type PlayDrawChoice,
} from "./matches";

export const STARTING_HAND_SIZE = 7;

/** Thrown by create/join when the user already occupies an active game (#155). */
const ACTIVE_GAME_MESSAGE =
    "You already have an active game. Finish or leave it before starting another.";

type DeckInput = {
    id: string;
    name: string;
    format: string;
    cards: { cardId: string; cardName: string }[];
    sideboard?: { cardId: string; cardName: string }[];
};

type PlayerInput = {
    id: string;
    name: string;
    bgColor: string;
    deck: DeckInput;
};

function buildPlayerState(
    player: PlayerInput,
    counter: { nextInstanceId?: number }
): PlayerState {
    const instances = player.deck.cards.map((deckCard) => {
        const def = getCardById(deckCard.cardId);
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
    };
}

/** Builds the fresh initial GameState for a Game: shuffles each library, draws
 *  opening hands, and enters the mulligan phase (CR 103.5). Shared by every
 *  create/join path (and, later, the Bo3 next-Game build) so the init is
 *  identical everywhere. `activePlayerId` defaults to the first player. */
function buildInitialGameState(
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
): Promise<Doc<"game_states"> | null> {
    const doc = await ctx.db
        .query("game_states")
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
    existing: Doc<"game_states"> | null
) {
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
        return;
    }

    await ctx.db.insert("game_states", {
        gameId,
        seq,
        state: stored,
        updatedAt: Date.now(),
    });
}

/** If SBA detected game over, persist the result to the games table AND record
 *  it into the owning Match (PRD #387 / ADR 0029): bump the winner's score and,
 *  for a Bo1, immediately finish the Match. (Bo3 routes to "sideboarding" — a
 *  later slice builds the next Game; #392 only ever finishes Bo1 here.) */
async function finalizeGameOver(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
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
    if (patch) await ctx.db.patch(game.matchId, { ...patch, updatedAt: now });
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

export function tapSourceIntoPayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    manaChoiceIndex: number | undefined,
    tappedLandIds: string[]
): void {
    if (card.isTapped) throw new Error("Card already tapped");
    // CR 302.1 — creatures with summoning sickness cannot pay a {T} cost.
    // Lands and other non-creature mana sources are unaffected.
    if (isTapLockedBySummoningSickness(card)) {
        throw new Error("Creature has summoning sickness");
    }
    const ability = getActivatedManaAbility(card);

    if (ability?.manaChoices || ability?.getManaChoices) {
        if (manaChoiceIndex === undefined) {
            throw new Error("Must choose a mana color");
        }
        // CR 106.1 — resolve the effective choice list (board-conditional
        // `getManaChoices`, e.g. Fellwar Stone, takes precedence over the static
        // `manaChoices`) so the index the client submitted indexes the same list.
        const choices = getEffectiveManaChoices(
            card,
            player.id,
            state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        );
        const rawChosen = choices?.[manaChoiceIndex];
        if (!rawChosen) throw new Error("Invalid mana choice");
        // CR 614 — Deep Water rewrites a land's produced mana to {U} before it
        // reaches the pool, so the event and refund snapshot the {U} actually
        // added (no-op for non-lands / players without the effect).
        const chosen = applyLandManaReplacement(
            state,
            player.id,
            card,
            rawChosen
        );

        // CR 122.6 / 605.1a — Mana Battery tapped as a payment source: the
        // chosen index is the number of charge counters removed this activation.
        const counterType = ability.manaChoiceRemovesCounters;
        if (counterType !== undefined && manaChoiceIndex > 0) {
            const have = card.counters?.[counterType] ?? 0;
            if (have < manaChoiceIndex) {
                throw new Error("Not enough counters for this choice");
            }
            payRemoveCounterCost(card, {
                type: counterType,
                count: manaChoiceIndex,
            });
        }

        const isSacrifice = ability.cost.sacrifice === true;
        // CR 605.2 — emit "tapped for mana" before the sacrifice path moves
        // the card off the battlefield, so the event carries the permanent's
        // pre-sacrifice types/subtypes for trigger predicates.
        emitPermanentTapped(state, card, true, chosen);
        if (isSacrifice) {
            moveCard(player, card.id, "battlefield", "graveyard");
        } else {
            card.isTapped = true;
            card.chosenMana = chosen;
            if (counterType !== undefined && manaChoiceIndex > 0) {
                card.manaCounterRemoval = {
                    type: counterType,
                    count: manaChoiceIndex,
                };
            }
        }
        for (const [color, amount] of Object.entries(chosen)) {
            if (color !== "X" && typeof amount === "number" && amount > 0) {
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        }
        // CR 603.7a / ADR 0040 — arm a control-change-on-tap rider (Rainbow
        // Vale) when this source is tapped for mana during a payment.
        if (!isSacrifice) armDelayedTriggerOnTap(state, ability, card, player.id);
        tappedLandIds.push(card.id);
        return;
    }

    const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
    if (!manaColor) throw new Error("Card does not produce mana");
    // ADR 0039 / CR 605.1a — a fixed-output "Sacrifice this" mana ability
    // (Basal Thrull) sacrifices the source instead of tapping it. One-way: the
    // sacrificed source is never in `tappedLandIds` as an untappable entry.
    const isSacrifice = ability?.cost.sacrifice === true;
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
    for (const [color, count] of Object.entries(added)) {
        if (color !== "X" && typeof count === "number" && count > 0) {
            player.manaPool[color] = (player.manaPool[color] ?? 0) + count;
        }
    }
    // CR 605.2 — emit "tapped for mana" before the sacrifice moves the card off
    // the battlefield, so leaves-the-battlefield triggers see the mana added and
    // the event carries the permanent's pre-sacrifice characteristics.
    emitPermanentTapped(state, card, true, added);
    // ADR 0039 / CR 605.1a — pay the "Sacrifice this" portion of a fixed-output
    // sacrifice mana ability (Basal Thrull). One-way: the sacrificed source is
    // never recorded in `tappedLandIds` (there is no untap/refund branch for it).
    if (isSacrifice) {
        moveCard(player, card.id, "battlefield", "graveyard");
    } else {
        // CR 603.7a / ADR 0040 — arm a control-change-on-tap rider when a
        // fixed-output tap mana source is tapped during a payment.
        armDelayedTriggerOnTap(state, ability, card, player.id);
        tappedLandIds.push(card.id);
    }
}

/** Reverses a single tap recorded in `tappedLandIds` — refunds the mana and
 *  untaps the source. Shared by untapForPayment and untapForActivationPayment. */
function untapSourceFromPayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): void {
    discardPermanentTappedEvent(state, card.id);
    if (card.chosenMana) {
        for (const [color, amount] of Object.entries(card.chosenMana)) {
            if (color !== "X" && typeof amount === "number" && amount > 0) {
                player.manaPool[color] = Math.max(
                    0,
                    (player.manaPool[color] ?? 0) - amount
                );
            }
        }
        card.chosenMana = undefined;
    } else {
        const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
        if (!manaColor) throw new Error("Card does not produce mana");
        const amount = getFixedManaAmount(card, manaColor);
        player.manaPool[manaColor] = Math.max(
            0,
            (player.manaPool[manaColor] ?? 0) - amount
        );
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
    card.isTapped = false;
}

/** Look up a sacrifice-cost candidate on the activator's own battlefield by
 *  instance id (CR 602.1 — costs are paid from the activating player's
 *  resources). Returns undefined if it has vanished between selection and
 *  commit. */
function findSacrificeCandidate(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): CardInstanceState | undefined {
    const player = getPlayer(state, playerId);
    return player.battlefield.find((c) => c.id === cardInstanceId);
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

/** True iff at least ONE player's graveyard holds `count` cards matching
 *  `cardType` (CR 118.5 — the whole cost must be paid from a SINGLE graveyard;
 *  it cannot be split across two). Gates activation legality for an
 *  `exileFromGraveyard` cost (Night Soil). */
function canPayExileFromGraveyard(
    state: GameState,
    count: number,
    cardType?: CardType
): boolean {
    return state.players.some(
        (p) =>
            p.graveyard.filter((c) =>
                graveyardCardMatchesExileCost(c, cardType)
            ).length >= count
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
        });
    });
}

/** Pre-sacrifice mana value of a permanent (CR 202.3). Read at commit so a
 *  mana-value-derived effect (Priest of Yawgmoth) sees the sacrificed
 *  permanent's printed cost. X in a printed cost counts as 0. */
function sacrificedManaValue(perm: CardInstanceState): number {
    const cardId = (perm.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : undefined;
    return def?.manaCost
        ? Object.entries(def.manaCost).reduce<number>(
              (acc, [, v]) => acc + (typeof v === "number" ? v : 0),
              0
          )
        : 0;
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
    const hostCost = (hostCardId ? tryGetCardById(hostCardId) : undefined)
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

/** If the activator's pool now covers pendingActivation, pay mana, apply the
 *  deferred tap/sacrifice costs on the source, push the ability on the stack,
 *  and swap priority. Mirrors tryAutoCommitPendingCast for abilities. Returns
 *  the source card name on commit, or null if nothing was committed. */
export function tryAutoCommitPendingActivation(
    state: GameState,
    playerId: string
): { cardInstanceId: string; abilityId: string; cardName?: string } | null {
    const pa = state.pendingActivation;
    if (!pa || pa.playerId !== playerId) return null;

    // CR 602.2 — an activated ability may only be put on the stack while its
    // controller has priority. Same defense as tryAutoCommitPendingCast: a
    // payment left dangling after priority moves away must not auto-commit on
    // the opponent's turn.
    if (state.priorityPlayerId !== playerId) return null;

    const player = getPlayer(state, playerId);
    if (
        !isManaCostCovered(
            player.manaPool,
            pa.manaCost,
            getManaSubstitutions(state, player.id)
        )
    )
        return null;
    // CR 602.1 / 118.5 — commit is blocked until the "sacrifice a permanent
    // matching <filter>" cost has been picked (selectActivationCost). Mirrors
    // pendingCast.additionalCost gating.
    if (pa.sacrificeChoice && !pa.sacrificeChoice.pickedId) {
        return null;
    }
    // CR 602.1 / 118.5 — commit is blocked until the "exile N cards from a
    // single graveyard" cost has been picked (selectActivationExileCost).
    if (
        pa.exileFromGraveyardChoice &&
        !pa.exileFromGraveyardChoice.pickedCardIds
    ) {
        return null;
    }
    // CR 602.1 / 118.8 — commit is blocked until all N "tap an untapped
    // permanent matching <filter> you control" picks are in (Hand of Justice).
    if (
        pa.tapOtherChoice &&
        pa.tapOtherChoice.pickedIds.length < pa.tapOtherChoice.count
    ) {
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
    if (!card) {
        // Source vanished (e.g. removed by an opposing effect). Drop the
        // payment silently — lands stay tapped (same policy as cancelCast for
        // sacrificed sources).
        state.pendingActivation = undefined;
        return null;
    }

    payManaCost(
        player.manaPool,
        pa.manaCost,
        getManaSubstitutions(state, player.id)
    );
    commitLandsForCost(player, pa.manaCost);

    // Deferred non-mana costs (CR 602.1) — applied now so cancellation leaves
    // the source untouched.
    if (pa.tapSource) {
        if (card.isTapped) {
            throw new Error("Source became tapped during payment");
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
        payDiscardLastDrawn(player);
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
    if (pa.sacrificeSource) {
        removePermanentTo(state, card.id, "graveyard", "sacrifice");
    }
    // CR 602.1 / 118.5 — sacrifice the chosen filtered permanent and snapshot
    // its pre-sacrifice mana value for the stack item (Priest of Yawgmoth).
    let activationSacrificeSnapshot: StackItem["additionalSacrificeSnapshot"];
    if (pa.sacrificeChoice?.pickedId) {
        const sacrificed = findSacrificeCandidate(
            state,
            playerId,
            pa.sacrificeChoice.pickedId
        );
        if (!sacrificed) {
            // Picked permanent vanished between selection and commit — drop
            // the activation silently (lands stay tapped, mirroring the
            // vanished-source policy above and cancelCast).
            state.pendingActivation = undefined;
            return null;
        }
        activationSacrificeSnapshot = {
            cardInstanceId: sacrificed.id,
            mv: sacrificedManaValue(sacrificed),
            ...(sacrificed.subtypes && sacrificed.subtypes.length > 0
                ? { subtypes: [...sacrificed.subtypes] }
                : {}),
        };
        removePermanentTo(state, sacrificed.id, "graveyard", "sacrifice");
    }
    // CR 602.1 / 118.5 / 406 — pay the "exile N cards from a single graveyard"
    // cost: move each picked card from that owner's graveyard to their exile.
    // Re-check presence at commit (vanished-card policy): if any picked card
    // is no longer in the chosen graveyard, drop the activation silently.
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

    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId: pa.abilityId,
        ...(pa.targets && pa.targets.length > 0 ? { targets: pa.targets } : {}),
        ...(pa.chosenX !== undefined ? { chosenX: pa.chosenX } : {}),
        ...(pa.grantedSourceCardId
            ? { grantedSourceCardId: pa.grantedSourceCardId }
            : {}),
        ...(activationSacrificeSnapshot
            ? { additionalSacrificeSnapshot: activationSacrificeSnapshot }
            : {}),
    };
    state.stack.push(stackItem);
    recordActivation(state, card, pa.abilityId, !!pa.tapSource);

    const keepPriority = pa.keepPriority;
    state.pendingActivation = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;
    drainAutoPasses(state);

    // CR 603.2 — flush PERMANENT_TAPPED events queued during payment so
    // mana-tap triggers (Manabarbs / Mana Flare / Wild Growth) land on top
    // of the freshly-pushed activated ability.
    processPendingActionTriggers(state);

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
        if (card.chosenMana) {
            for (const [color, amount] of Object.entries(card.chosenMana)) {
                if (color !== "X" && typeof amount === "number" && amount > 0) {
                    player.manaPool[color] = Math.max(
                        0,
                        (player.manaPool[color] ?? 0) - amount
                    );
                }
            }
            card.chosenMana = undefined;
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (manaColor) {
                const amount = getFixedManaAmount(card, manaColor);
                player.manaPool[manaColor] = Math.max(
                    0,
                    (player.manaPool[manaColor] ?? 0) - amount
                );
            }
        }
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

export function tryAutoCommitPendingCast(
    state: GameState,
    playerId: string
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
    const castCard = player.hand.find(
        (c) => c.id === state.pendingCast!.cardInstanceId
    );
    const castDef = castCard
        ? tryGetCardById((castCard.card as { id: string }).id)
        : undefined;
    const castTypes = castDef?.types ?? [];
    if (
        !isManaCostCovered(
            spendablePoolForSpell(player, castTypes),
            state.pendingCast.manaCost,
            getManaSubstitutions(state, player.id)
        )
    ) {
        return null;
    }
    // CR 117.9 / 601.2f: commit is blocked until the additional cost has
    // been picked. The player completes payment via selectAdditionalCost.
    const ac = state.pendingCast.additionalCost;
    if (ac && !ac.pickedId) {
        return null;
    }

    payManaCostForSpell(
        player,
        state.pendingCast.manaCost,
        castTypes,
        getManaSubstitutions(state, player.id)
    );
    commitLandsForCost(player, state.pendingCast.manaCost);

    // Pay the picked permanent's additional cost (CR 117.9): sacrifice it
    // (`kind: "sacrifice"`) or exile it (`kind: "exile"`, Soul Exchange).
    // Snapshot its mana value AND subtypes onto the stack item — the resolve
    // reads them via SpellContext.getAdditionalSacrificeMv /
    // getAdditionalCostSubtypes ("+2/+2 counter if the exiled creature was a
    // Thrull").
    let additionalSacrificeSnapshot: StackItem["additionalSacrificeSnapshot"];
    if (ac?.pickedId) {
        const sacrificed = player.battlefield.find((c) => c.id === ac.pickedId);
        if (!sacrificed) {
            // Picked permanent vanished between selection and commit —
            // refuse to push the spell, drop pendingCast silently. Lands
            // already tapped stay tapped (mirrors cancelCast policy).
            state.pendingCast = undefined;
            return null;
        }
        const sacCardId = (sacrificed.card as { id?: string }).id;
        const sacDef = sacCardId ? tryGetCardById(sacCardId) : undefined;
        const mv = sacDef?.manaCost
            ? Object.entries(sacDef.manaCost).reduce<number>(
                  (acc, [, v]) => acc + (typeof v === "number" ? v : 0),
                  0
              )
            : 0;
        additionalSacrificeSnapshot = {
            cardInstanceId: sacrificed.id,
            mv,
            ...(sacrificed.subtypes && sacrificed.subtypes.length > 0
                ? { subtypes: [...sacrificed.subtypes] }
                : {}),
        };
        if (ac.kind === "exile") {
            // CR 406 — exiled as an additional cost; not a sacrifice, so no
            // sacrifice cause is passed to leave-the-battlefield triggers.
            removePermanentTo(state, sacrificed.id, "exile");
        } else {
            removePermanentTo(state, sacrificed.id, "graveyard", "sacrifice");
        }
    }

    const spellCard = removeFromZone(
        player,
        state.pendingCast.cardInstanceId,
        "hand"
    );
    const pendingTargets = (state.pendingCast as Record<string, unknown>)
        .targets as StackItem["targets"] | undefined;
    const pendingChosenX = state.pendingCast.chosenX;
    const pendingChosenModeId = state.pendingCast.chosenModeId;
    const stackItem: StackItem = {
        ...spellCard,
        castById: playerId,
        ...(pendingTargets ? { targets: pendingTargets } : {}),
        ...(pendingChosenX !== undefined ? { chosenX: pendingChosenX } : {}),
        ...(pendingChosenModeId ? { chosenModeId: pendingChosenModeId } : {}),
        ...(additionalSacrificeSnapshot ? { additionalSacrificeSnapshot } : {}),
    };
    state.stack.push(stackItem);

    const cardName = (spellCard.card as { name?: string }).name;
    const keepPriority = state.pendingCast.keepPriority;
    state.pendingCast = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;
    drainAutoPasses(state);

    // CR 601.2i — the spell is now on the stack. Emit SPELL_CAST and run a
    // trigger pass so abilities like Verduran Enchantress and the sphere
    // cycle land on top before either player gets priority.
    emitSpellCastEvent(state, stackItem);
    processPendingActionTriggers(state);

    return { cardInstanceId: spellCard.id, cardName };
}

// --- Queries ---

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
        const game = await ctx.db.get(args.gameId);
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
            game?.solo === true && game?.vsAi !== true
                ? computeSoloViewerId({
                      activePlayerId: state.activePlayerId,
                      priorityPlayerId:
                          state.priorityPlayerId ?? state.activePlayerId,
                      phase: state.phase,
                      combat: state.combat,
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

/** Returns the game record (status, players). */
export const getGame = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.gameId);
    },
});

/** Returns the unique set of card IDs across both players' decks for a game.
 *  Used by the client to preload all card images at game start. */
export const getGameCardIds = query({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const game = await ctx.db.get(args.gameId);
        if (!game) return [];
        const ids = new Set<string>();
        for (const p of game.players) {
            for (const c of p.deck.cards) ids.add(c.cardId);
        }
        return Array.from(ids);
    },
});

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
            (g) => !g.players.some((p) => p.id === userId)
        );
        return Promise.all(
            mine.map(async (g) => {
                // The Match owns `bestOf`; a waiting Game always has a matchId
                // (createGame inserts both). Default to Bo1 if the Match is gone.
                const match = g.matchId ? await ctx.db.get(g.matchId) : null;
                return { ...g, bestOf: (match?.bestOf ?? 1) as 1 | 3 };
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
});

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
        const user = await getCurrentUser(ctx);
        // #155 (match-scoped, ADR 0029): at most one active match per user.
        // Guard runs server-side so it holds against double-click / two-tab
        // races (Convex OCC retries the loser, which then sees the new match
        // and is rejected here).
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        // Authoritative deck legality gate (ADR 0036): reject an illegal deck
        // before any Match/Game row is written.
        assertDeckLegal(args.deck);
        const now = Date.now();

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[0],
            deck: args.deck,
        };

        // The Match opens "waiting" for an opponent; joinGame completes it and
        // builds Game 1. The waiting game row carries the matchId up front.
        const matchId = await ctx.db.insert("matches", {
            bestOf: args.bestOf ?? 1,
            status: "waiting",
            players: buildMatchPlayers([player]),
            currentGameNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await ctx.db.insert("games", {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "waiting",
            players: toGamePlayers([player]),
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

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
        // Bo1 | Bo3 (PRD #387). Defaults to Bo1.
        bestOf: bestOfValidator,
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        // #155 (match-scoped): one active match per user (see createGame).
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        const deck2 = args.deck2 ?? args.deck;
        // Authoritative deck legality gate (ADR 0036): both seats' decks must be
        // legal before the solo/vs-AI Match starts.
        assertDeckLegal(args.deck);
        if (args.deck2) assertDeckLegal(args.deck2);

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

        // Solo/vs-AI: both seats exist immediately, so the Match is "playing"
        // and Game 1 is built up front (PRD #387). Bo1 by default.
        const matchId = await ctx.db.insert("matches", {
            bestOf: args.bestOf ?? 1,
            status: "playing",
            players: buildMatchPlayers(allPlayers),
            currentGameNumber: 1,
            solo: true,
            vsAi: args.vsAi === true ? true : undefined,
            createdAt: now,
            updatedAt: now,
        });

        const gameId = await ctx.db.insert("games", {
            name: args.name,
            matchId,
            gameNumber: 1,
            status: "playing",
            players: toGamePlayers(allPlayers),
            solo: true,
            vsAi: args.vsAi === true ? true : undefined,
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(matchId, { currentGameId: gameId });

        const initialState = buildInitialGameState(allPlayers);
        await saveGameState(ctx, gameId, 0, initialState, null);

        return gameId;
    },
});

export const joinGame = mutation({
    args: {
        gameId: v.id("games"),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        // #155 (match-scoped): reject joining when the user already occupies
        // another active match (their own waiting room or an in-progress match).
        if (await findActiveMatchForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        if (game.status !== "waiting") throw new Error("Game is not open");
        if (game.players.length >= 2) throw new Error("Game is full");
        if (game.players.some((p) => p.id === user._id))
            throw new Error("Cannot join a game you are already in");
        // Authoritative deck legality gate (ADR 0036): the joiner's deck must be
        // legal for its declared format before the Match flips to "playing".
        assertDeckLegal(args.deck);

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[1],
            deck: args.deck,
        };
        const allPlayers = [...game.players, player];
        const now = Date.now();

        // Complete the owning Match: add the joiner's deck snapshot and flip it
        // to "playing" (PRD #387). The waiting Match was created by createGame.
        if (game.matchId) {
            const match = await ctx.db.get(game.matchId);
            if (match) {
                await ctx.db.patch(game.matchId, {
                    status: "playing",
                    players: [...match.players, ...buildMatchPlayers([player])],
                    updatedAt: now,
                });
            }
        }

        // Update game record
        await ctx.db.patch(args.gameId, {
            status: "playing",
            players: toGamePlayers(allPlayers),
            updatedAt: now,
        });

        const initialState = buildInitialGameState(allPlayers);
        await saveGameState(ctx, args.gameId, 0, initialState, null);
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
        return {
            gameId: game._id,
            matchId: match._id,
            name: game.name,
            status: game.status,
            solo: game.solo === true,
            vsAi: game.vsAi === true,
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
        if (game.status !== "waiting")
            throw new Error("Cannot leave a game in progress; concede instead");
        // Delete any state snapshots first, then the orphan waiting room and its
        // owning waiting Match (ADR 0029) so the user is free to start another.
        const states = await ctx.db
            .query("game_states")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const s of states) await ctx.db.delete(s._id);
        await ctx.db.delete(args.gameId);
        if (game.matchId) {
            const match = await ctx.db.get(game.matchId);
            if (match && match.status === "waiting")
                await ctx.db.delete(game.matchId);
        }
    },
});

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
    const seats = buildNextGameSeats(match);
    const nextGameNumber = match.currentGameNumber + 1;

    const resolvedChoice: PlayDrawChoice = botIsChooser(match)
        ? "play"
        : (choice ?? "play");
    const activePlayerId = nextGameActivePlayerId(match, resolvedChoice);

    const gameId = await ctx.db.insert("games", {
        name: match.solo ? `${nickname}'s solo game` : `${nickname}'s game`,
        matchId: match._id,
        gameNumber: nextGameNumber,
        status: "playing",
        players: seats,
        solo: match.solo === true ? true : undefined,
        vsAi: match.vsAi === true ? true : undefined,
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

        // Pure validation + apply (size-lock + pool preservation). Throws on an
        // illegal swap, rolling the mutation back atomically.
        const nextDeck = applySideboard(seat.deck, {
            maindeck: args.maindeck,
            sideboard: args.sideboard,
        });

        const players = match.players.map((p, i) =>
            i === seatIdx ? { ...p, deck: nextDeck } : p
        );
        await ctx.db.patch(args.matchId, { players, updatedAt: Date.now() });
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

        // Idempotent: an already-finished Match needs nothing.
        if (match.status === "finished") return;

        const patch = computeForfeitMatch(match, args.playerId);
        if (!patch) throw new Error("Seat not found in this match");

        const now = Date.now();
        await ctx.db.patch(args.matchId, { ...patch, updatedAt: now });

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);
        const player = getPlayer(state, args.playerId);

        // Validate: card must be in hand and "play" must be legal
        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!cardInHand) throw new Error("Card not in hand");
        if (!args.skipValidation) {
            assertLegalAction(state, player, cardInHand, "play");
        }

        // Shared canonical play-land core (CR 305.2 land-drop tracking,
        // CR 302.6 summoning-sickness clock, CR 603.6a ETB triggers, CR 704
        // SBAs). Identical sequence to the Bot's `applyMoveForSearch`
        // play-land case — both call `applyPlayLand` so the authoritative and
        // simulated paths cannot drift. (Pre-fix this mutation skipped
        // `markEnteredThisTurn`, so a Mishra's Factory played and animated the
        // same turn could illegally attack — issue: manland summoning sickness.)
        applyPlayLand(state, player, args.cardInstanceId);

        const nextSeq = gameState.seq + 1;

        // Insert new snapshot (don't overwrite previous)
        await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
    },
});

/** Resolves an activated ability id on a battlefield card. Returns the
 *  template and, when the ability was granted to this permanent by another
 *  card (CR 113.1, e.g. Zombie Master's "{B}: Regenerate ~" grant), the
 *  granting card def id. Returns null if no matching ability exists. */
function resolveActivatedAbility(
    card: CardInstanceState,
    abilityId: string
): {
    ability: NonNullable<
        ReturnType<typeof getCardById>["activatedAbilities"]
    >[number];
    grantedSourceCardId?: string;
} | null {
    const cardId = (card.card as { id?: string }).id;
    // CR 613.1f — a permanent that "loses all abilities" (Titania's Song) has
    // no native activated abilities while suppressed. Abilities granted by
    // another source (`grantedActivatedAbilities`) are not the permanent's own
    // and are unaffected.
    const suppressed = (card.abilitiesSuppressedBy?.length ?? 0) > 0;
    if (cardId && !suppressed) {
        const native = getCardById(cardId).activatedAbilities?.find(
            (a) => a.id === abilityId
        );
        if (native) return { ability: native };
    }
    const grant = card.grantedActivatedAbilities?.find(
        (g) => g.abilityId === abilityId
    );
    if (grant) {
        const tmpl = getCardById(grant.sourceCardId).grantTemplates?.find(
            (a) => a.id === abilityId
        );
        if (tmpl) {
            return { ability: tmpl, grantedSourceCardId: grant.sourceCardId };
        }
    }
    return null;
}

/** Throws a descriptive Error if the activated ability's CR 602.5 timing
 *  restrictions (controller-turn-only, once-per-turn cap) are violated
 *  against the current state. Called by every activation entry point before
 *  cost lock so the rejection is surfaced before any mutation. */
function assertActivationTimingLegal(
    state: GameState,
    card: CardInstanceState,
    ability: { id: string; controllerTurnOnly?: boolean; oncePerTurn?: boolean }
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
}

/** Records one activation of `abilityId` against `card` for the current turn
 *  (CR 602.5 — `oncePerTurn` enforcement) and emits the cluster-B
 *  `ABILITY_ACTIVATED` event for non-{T} abilities (CR 602.1). Initialises the
 *  counter map on first activation. Called at every activation commit site —
 *  the single shared anchor, so every path (immediate, targeted, deferred
 *  payment) fires the event exactly once.
 *
 *  The event is emitted only when the ability has NO {T} component: a {T}
 *  ability already emitted `PERMANENT_TAPPED` from its tap, and the two events
 *  are complements (see `AbilityActivatedEvent` doc). Passing `taps` makes the
 *  gate explicit at every call site. */
function recordActivation(
    state: GameState,
    card: CardInstanceState,
    abilityId: string,
    taps: boolean
): void {
    const map: Record<string, number> = card.activationsThisTurn ?? {};
    map[abilityId] = (map[abilityId] ?? 0) + 1;
    card.activationsThisTurn = map;
    // CR 602.1 — non-{T} activated abilities emit ABILITY_ACTIVATED so
    // "tapped or non-tap ability activated" punishers (Haunting Wind,
    // Powerleech, Artifact Possession) can react. {T} abilities are covered by
    // PERMANENT_TAPPED instead, avoiding a double trigger.
    if (!taps) {
        emitAbilityActivated(state, card, abilityId);
    }
}

/** Minimum number of targets required for a TargetRequirement.count value.
 *  Fixed N → N; range → min. Used to validate confirmTargets (CR 601.2c). */
function minTargetCount(count: number | { min: number; max?: number }): number {
    return typeof count === "number" ? count : count.min;
}

/** Resolves the literal `"X"` target-count form to a fixed number using the
 *  cast's `chosenX` (CR 107.3 / 601.2c). Returns the input unchanged for
 *  numeric / range counts. Used only on the cast path — activated abilities
 *  don't carry chosenX, so passing `"X"` without chosenX throws. */
function resolveTargetCount(
    count: number | "X" | { min: number; max?: number },
    chosenX: number | undefined
): number | { min: number; max?: number } {
    if (count === "X") {
        if (chosenX === undefined) {
            throw new Error('Target count "X" requires chosenX');
        }
        return chosenX;
    }
    return count;
}

/** True when the selected targets have reached the maximum allowed for this
 *  requirement. Fixed N → selected >= N; range → selected >= max (undefined
 *  max means no upper limit, so this never triggers auto-advance). */
function isTargetCountMaxReached(
    count: number | { min: number; max?: number },
    selected: number
): boolean {
    if (typeof count === "number") return selected >= count;
    if (count.max === undefined) return false;
    return selected >= count.max;
}

/** Finalizes target selection and either places the spell on the stack (if
 *  the caster can already pay) or transitions into the payment phase.
 *  Mutates `state` in place. Handles chosenX propagation and the per-target
 *  additional generic cost modifier (CR 601.2f). Exported for integration
 *  tests that exercise the real cost/target commit path (e.g. Reflecting
 *  Mirror's derived-X + retarget finalization). */
export function finalizeTargetSelection(
    state: GameState,
    pt: PendingTarget,
    playerId: string
): void {
    const targets = [...pt.selected];
    const cardInstanceId = pt.cardInstanceId;
    const keepPriority = pt.keepPriority;
    const chosenX = pt.chosenX;
    const chosenModeId = pt.chosenModeId;
    const kind = pt.kind ?? "cast";
    const abilityId = pt.abilityId;
    state.pendingTarget = undefined;

    // Copy-retarget branch (CR 707.10b — Fork's "you may choose new targets
    // for the copy"). The targets are written onto the spell COPY already on
    // the stack; nothing is cast and no cost is paid. After the choice, the
    // resolving spell (Fork) has finished, so a fresh priority round begins
    // with the active player and the copy on top of the stack.
    if (kind === "copy-retarget") {
        const copy = state.stack.find((s) => s.id === cardInstanceId);
        if (copy) copy.targets = targets;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
        return;
    }

    // Retarget branch (CR 114.6 — Reflecting Mirror's "change the target of
    // target spell"). The new target is written onto the ORIGINAL spell already
    // on the stack (not a copy). The resolving Reflecting Mirror ability has
    // finished, so a fresh priority round begins with the active player and the
    // retargeted spell still on the stack.
    if (kind === "retarget") {
        const spell = state.stack.find((s) => s.id === cardInstanceId);
        if (spell) spell.targets = targets;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
        return;
    }

    const player = getPlayer(state, playerId);

    // Activated-ability targeting branch (CR 602.2b). Targets were chosen
    // first; costs are paid NOW. If mana isn't in the pool, enter a
    // pendingActivation payment phase — the already-selected targets ride
    // along and are re-applied at commit.
    if (kind === "ability") {
        if (!abilityId) throw new Error("pendingTarget.abilityId missing");
        const card = player.battlefield.find((c) => c.id === cardInstanceId);
        if (!card) throw new Error("Ability source not on battlefield");
        const resolved = resolveActivatedAbility(card, abilityId);
        if (!resolved) throw new Error("Ability not found");
        const ability = resolved.ability;
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
                matchesPermanentFilter(c, ability.cost.sacrificeFilter!)
            );
            if (candidates.length === 0) {
                throw new Error("No legal permanent to pay the sacrifice cost");
            }
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard": illegal
        // unless one graveyard holds enough matching cards.
        if (ability.cost.exileFromGraveyard) {
            const { count, cardType } = ability.cost.exileFromGraveyard;
            if (!canPayExileFromGraveyard(state, count, cardType)) {
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
            if (candidates.length < ability.cost.tapOtherFilter.count) {
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
        assertActivationTimingLegal(state, card, ability);

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
                ? tryGetCardById(spellCardId)
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

        // Enter pendingActivation (deferred commit) when mana isn't covered OR
        // the ability has a "sacrifice a permanent matching <filter>" cost that
        // still needs a player choice (CR 602.1 / 118.5). In the latter case we
        // always defer to selectActivationCost even when mana is covered, so
        // the player picks the sacrifice before the targeted ability commits.
        const manaUncovered =
            !!manaCost &&
            !isManaCostCovered(
                player.manaPool,
                manaCost,
                getManaSubstitutions(state, player.id)
            );
        if (
            manaUncovered ||
            ability.cost.sacrificeFilter ||
            ability.cost.exileFromGraveyard ||
            ability.cost.tapOtherFilter
        ) {
            state.pendingActivation = {
                playerId,
                cardInstanceId: card.id,
                abilityId,
                manaCost: manaCost ?? {},
                tappedLandIds: [],
                tapSource: !!ability.cost.tap,
                sacrificeSource: !!ability.cost.sacrifice,
                ...(ability.cost.removeCounter
                    ? { removeCounterCost: { ...ability.cost.removeCounter } }
                    : {}),
                ...(ability.cost.sacrificeFilter
                    ? {
                          sacrificeChoice: {
                              filter: ability.cost.sacrificeFilter,
                          },
                      }
                    : {}),
                ...(ability.cost.exileFromGraveyard
                    ? {
                          exileFromGraveyardChoice: {
                              count: ability.cost.exileFromGraveyard.count,
                              ...(ability.cost.exileFromGraveyard.cardType !==
                              undefined
                                  ? {
                                        cardType:
                                            ability.cost.exileFromGraveyard
                                                .cardType,
                                    }
                                  : {}),
                          },
                      }
                    : {}),
                ...(ability.cost.tapOtherFilter
                    ? {
                          tapOtherChoice: {
                              filter: ability.cost.tapOtherFilter.filter,
                              count: ability.cost.tapOtherFilter.count,
                              pickedIds: [],
                          },
                      }
                    : {}),
                ...(ability.cost.discardAtRandom
                    ? { discardAtRandomCount: ability.cost.discardAtRandom }
                    : {}),
                ...(abilityChosenX !== undefined
                    ? { chosenX: abilityChosenX }
                    : {}),
                keepPriority,
                targets,
                ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            };
            // If mana was already covered (choice-only deferral), commit fires
            // once selectActivationCost sets the pickedId / completes the picks.
            tryAutoCommitPendingActivation(state, playerId);
            return;
        }

        // Commit immediately.
        if (ability.cost.tap) card.isTapped = true;
        if (manaCost) {
            payManaCost(
                player.manaPool,
                manaCost,
                getManaSubstitutions(state, player.id)
            );
            commitLandsForCost(player, manaCost);
        }
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
        if (ability.cost.sacrifice) {
            removePermanentTo(state, card.id, "graveyard", "sacrifice");
        }

        const stackItem: StackItem = {
            ...structuredClone(card),
            zone: "stack" as const,
            castById: playerId,
            abilityId,
            targets,
            ...(abilityChosenX !== undefined
                ? { chosenX: abilityChosenX }
                : {}),
            ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
        };
        state.stack.push(stackItem);
        recordActivation(state, card, abilityId, !!ability.cost.tap);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, playerId);
        state.singleShotAutoPass = keepPriority ? undefined : playerId;
        drainAutoPasses(state);
        // CR 603.3 — flush ABILITY_ACTIVATED queued by recordActivation so the
        // "non-tap ability activated" punisher lands on top of the freshly
        // pushed ability (resolves first). No-op for {T} abilities.
        processPendingActionTriggers(state);
        return;
    }

    // Spell cast branch (CR 601.2c).
    const cardInHand = player.hand.find((c) => c.id === cardInstanceId);
    if (!cardInHand) throw new Error("Card not in hand");
    const cardDef = getCardById((cardInHand.card as { id: string }).id);

    const rawCost = getInstanceManaCost(cardInHand);
    const extraPer = cardDef.additionalGenericPerExtraTarget ?? 0;
    const additionalGeneric =
        extraPer > 0 ? Math.max(0, targets.length - 1) * extraPer : 0;
    const manaCost = rawCost
        ? normalizeManaCost(rawCost, { chosenX, additionalGeneric })
        : {};
    applyCostModifiers(manaCost, getCostModifiers(state, cardInHand, "spell"));

    // CR 601.2c → 601.2f — targets have just been chosen; now the additional
    // cost is paid. A spell with both a target and an additional cost (FEM Soul
    // Exchange: target a graveyard creature, then exile a creature you control)
    // must open the additional-cost picker BEFORE mana, even when the pool
    // already covers the mana — otherwise the spell would commit without the
    // extra cost being paid. The picker carries the targets along on
    // pendingCast so the resolve still sees them (CR 117.9 / 601.2f).
    const postTargetPicker = buildAdditionalCostPicker(
        cardDef.additionalCosts,
        player
    );
    if (postTargetPicker) {
        state.pendingCast = {
            playerId,
            cardInstanceId,
            manaCost,
            tappedLandIds: [],
            keepPriority,
            chosenX,
            ...(chosenModeId ? { chosenModeId } : {}),
            additionalCost: postTargetPicker,
        };
        (state.pendingCast as Record<string, unknown>).targets = targets;
        return;
    }

    // CR 106.6: a spell may also spend restriction-permitting mana —
    // creature mana (Metamorphosis) or artifact mana (Mishra's Workshop) —
    // in addition to the fungible pool. Eligibility is decided from the
    // spell's card types in restrictionAllowsSpell.
    if (
        Object.keys(manaCost).length === 0 ||
        isManaCostCovered(
            spendablePoolForSpell(player, cardDef.types),
            manaCost,
            getManaSubstitutions(state, player.id)
        )
    ) {
        if (Object.keys(manaCost).length > 0) {
            payManaCostForSpell(
                player,
                manaCost,
                cardDef.types,
                getManaSubstitutions(state, player.id)
            );
            commitLandsForCost(player, manaCost);
        }
        const card = removeFromZone(player, cardInstanceId, "hand");
        const stackItem: StackItem = {
            ...card,
            castById: playerId,
            targets,
            ...(chosenX !== undefined ? { chosenX } : {}),
            ...(chosenModeId ? { chosenModeId } : {}),
        };
        state.stack.push(stackItem);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, playerId);
        state.singleShotAutoPass = keepPriority ? undefined : playerId;
        drainAutoPasses(state);
        emitSpellCastEvent(state, stackItem);
        processPendingActionTriggers(state);
    } else {
        state.pendingCast = {
            playerId,
            cardInstanceId,
            manaCost,
            tappedLandIds: [],
            keepPriority,
            chosenX,
            ...(chosenModeId ? { chosenModeId } : {}),
        };
        // Targets ride along on pendingCast until payment completes.
        (state.pendingCast as Record<string, unknown>).targets = targets;
    }
}

/** Builds the additional-cost picker descriptor for a spell's
 *  `additionalCosts` (CR 117.9 / 601.2f), validating up-front that the caster
 *  controls at least one legal permanent (the cast is illegal otherwise). Both
 *  the `sacrificeFilter` (sacrifice) and `exileFilter` (exile — Soul Exchange)
 *  forms route through the same picker; the `kind` decides whether the picked
 *  permanent is sacrificed or exiled at commit. Returns `undefined` when the
 *  card has no additional cost. */
function buildAdditionalCostPicker(
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
    const candidates = player.battlefield.filter((c) =>
        matchesPermanentFilter(c, filter, { selfControllerId: player.id })
    );
    if (candidates.length === 0) {
        throw new Error("No legal permanent to pay the additional cost");
    }
    return { kind, filter };
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
        /** Mode chosen for modal spells (CR 700.2 / 700.2c). Required when
         *  the card defines `modes`. */
        chosenModeId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);
        const player = getPlayer(state, args.playerId);

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }
        if (state.pendingCast) {
            throw new Error("Another spell is already being cast");
        }
        if (state.pendingActivation) {
            throw new Error("An ability is already being activated");
        }
        if (state.pendingTarget) {
            throw new Error("Target selection is in progress");
        }

        const cardInHand = player.hand.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!cardInHand) throw new Error("Card not in hand");
        assertLegalAction(state, player, cardInHand, "cast");

        const cardDef = getCardById((cardInHand.card as { id: string }).id);

        // Validate X is provided iff the cost contains a string X (CR 107.3).
        const hasX =
            typeof (cardDef.manaCost as { X?: unknown } | undefined)?.X ===
            "string";
        if (hasX && (args.chosenX === undefined || args.chosenX < 0)) {
            throw new Error("Must choose X (≥ 0) for this spell");
        }
        const chosenX = hasX ? args.chosenX : undefined;

        // Modal spell — caster locks in a mode at announcement (CR 700.2c).
        // The chosen mode's targetRequirement / resolve drive the rest of
        // the announcement and resolution flow.
        let chosenMode: SpellMode | undefined;
        if (cardDef.modes && cardDef.modes.length > 0) {
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

        // For modal spells, the chosen mode's targetRequirement drives target
        // selection (CR 700.2d). Falls back to the card-level requirement for
        // non-modal spells.
        const activeTargetRequirement =
            chosenMode?.targetRequirement ?? cardDef.targetRequirement;

        // Check if the card requires targets (CR 601.2c). When `count: "X"`
        // resolves to 0 (X chosen as 0), the spell takes no targets — fall
        // through to the no-target cast path (CR 107.3, e.g. Volcanic
        // Eruption with X=0 destroys 0 Mountains and deals 0 damage).
        const resolvedCount = activeTargetRequirement
            ? resolveTargetCount(activeTargetRequirement.count, chosenX)
            : undefined;
        const requiresTargets =
            activeTargetRequirement !== undefined &&
            (typeof resolvedCount !== "number" || resolvedCount > 0);

        if (activeTargetRequirement && requiresTargets) {
            // CR 202.2 / 702.16b: source colors derived from the casting
            // card's mana cost, so getLegalTargets can exclude permanents
            // with protection from any of those colors.
            const sourceColors = STATIC_EFFECT_CTX.getColors(cardInHand);
            const legalTargets = getLegalTargets(
                state,
                activeTargetRequirement,
                sourceColors,
                args.playerId,
                chosenX,
                cardInHand.types,
                cardInHand.subtypes,
                // Casting from hand — the source is a spell (CR 113.3).
                true
            );
            if (legalTargets.length === 0) {
                throw new Error("No legal targets available");
            }
            // CR 601.2c: must be able to choose enough legal targets.
            const required = minTargetCount(resolvedCount!);
            if (legalTargets.length < required) {
                throw new Error("Not enough legal targets");
            }
            const subtypeFilter = activeTargetRequirement.subtypeFilter
                ? Array.isArray(activeTargetRequirement.subtypeFilter)
                    ? activeTargetRequirement.subtypeFilter
                    : [activeTargetRequirement.subtypeFilter]
                : undefined;
            const excludeSubtypes = activeTargetRequirement.excludeSubtypes
                ? Array.isArray(activeTargetRequirement.excludeSubtypes)
                    ? activeTargetRequirement.excludeSubtypes
                    : [activeTargetRequirement.excludeSubtypes]
                : undefined;
            const resolvedMvFilter = resolveMvFilter(
                activeTargetRequirement.mvFilter,
                chosenX
            );
            // Enter target selection phase before mana payment
            state.pendingTarget = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                targetType: activeTargetRequirement.type,
                count: resolvedCount!,
                selected: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                ...(activeTargetRequirement.zone
                    ? { zone: activeTargetRequirement.zone }
                    : {}),
                ...(activeTargetRequirement.controller
                    ? { controller: activeTargetRequirement.controller }
                    : {}),
                ...(subtypeFilter ? { subtypeFilter } : {}),
                ...(activeTargetRequirement.powerFilter
                    ? { powerFilter: activeTargetRequirement.powerFilter }
                    : {}),
                ...(activeTargetRequirement.toughnessFilter
                    ? {
                          toughnessFilter:
                              activeTargetRequirement.toughnessFilter,
                      }
                    : {}),
                ...(excludeSubtypes ? { excludeSubtypes } : {}),
                ...(resolvedMvFilter ? { mvFilter: resolvedMvFilter } : {}),
                ...(activeTargetRequirement.spellTypeFilter
                    ? {
                          spellTypeFilter: Array.isArray(
                              activeTargetRequirement.spellTypeFilter
                          )
                              ? activeTargetRequirement.spellTypeFilter
                              : [activeTargetRequirement.spellTypeFilter],
                      }
                    : {}),
                ...(activeTargetRequirement.playerAttackedThisTurn
                    ? { playerAttackedThisTurn: true }
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

        // No targets needed — proceed to additional-cost picker (CR 117.9 /
        // 601.2f) or directly to mana payment / cast if no additional cost.
        const rawCost = getInstanceManaCost(cardInHand);

        const manaCost = rawCost ? normalizeManaCost(rawCost, { chosenX }) : {};
        applyCostModifiers(
            manaCost,
            getCostModifiers(state, cardInHand, "spell")
        );

        const additionalCostPicker = buildAdditionalCostPicker(
            cardDef.additionalCosts,
            player
        );
        if (additionalCostPicker) {
            // Open pendingCast in additional-cost picker mode. Commit is
            // gated on the pickedId being set, regardless of mana coverage.
            state.pendingCast = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                manaCost,
                tappedLandIds: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
                additionalCost: additionalCostPicker,
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

        // If cost is zero or pool already covers it, commit immediately.
        // CR 106.6: a spell may also spend restriction-permitting mana —
        // creature mana (Metamorphosis) or artifact mana (Mishra's Workshop).
        if (
            Object.keys(manaCost).length === 0 ||
            isManaCostCovered(
                spendablePoolForSpell(player, cardDef.types),
                manaCost,
                getManaSubstitutions(state, player.id)
            )
        ) {
            if (Object.keys(manaCost).length > 0) {
                payManaCostForSpell(
                    player,
                    manaCost,
                    cardDef.types,
                    getManaSubstitutions(state, player.id)
                );
                commitLandsForCost(player, manaCost);
            }
            const card = removeFromZone(player, args.cardInstanceId, "hand");
            const stackItem: StackItem = {
                ...card,
                castById: args.playerId,
                ...(chosenX !== undefined ? { chosenX } : {}),
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
            };
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, args.playerId);
            state.singleShotAutoPass = args.keepPriority
                ? undefined
                : args.playerId;
            drainAutoPasses(state);
            emitSpellCastEvent(state, stackItem);
            processPendingActionTriggers(state);
        } else {
            // Enter payment phase for remaining mana
            state.pendingCast = {
                playerId: args.playerId,
                cardInstanceId: args.cardInstanceId,
                manaCost,
                tappedLandIds: [],
                keepPriority: args.keepPriority,
                chosenX,
                ...(args.chosenModeId
                    ? { chosenModeId: args.chosenModeId }
                    : {}),
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

/** Step 2: tap a land during payment to add mana. Auto-commits when cost is covered. */
export const tapForPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
        /** Required for sources with manaChoices (duals, Birds of Paradise, Black Lotus). */
        manaChoiceIndex: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (!state.pendingCast) throw new Error("No spell being cast");
        if (state.pendingCast.playerId !== args.playerId) {
            throw new Error("Not your pending cast");
        }

        const player = getPlayer(state, args.playerId);
        const card = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!card) throw new Error("Card not on battlefield");
        if (card.isTapped) throw new Error("Card already tapped");

        const ability = getActivatedManaAbility(card);

        if (ability?.manaChoices || ability?.getManaChoices) {
            // Choice-based source (dual lands, Birds of Paradise, Black Lotus,
            // or a board-conditional chooser like Fellwar Stone).
            if (args.manaChoiceIndex === undefined) {
                throw new Error("Must choose a mana color");
            }
            // CR 106.1 — board-conditional `getManaChoices` takes precedence so
            // the client and server reference the same option list/index.
            const choices = getEffectiveManaChoices(
                card,
                player.id,
                state.players.map((p) => ({
                    playerId: p.id,
                    battlefield: p.battlefield,
                }))
            );
            const rawChosen = choices?.[args.manaChoiceIndex];
            if (!rawChosen) throw new Error("Invalid mana choice");
            // CR 614 — Deep Water rewrites a land's produced mana to {U}.
            const chosen = applyLandManaReplacement(
                state,
                player.id,
                card,
                rawChosen
            );

            const isSacrifice = ability.cost.sacrifice === true;
            // CR 605.2 — emit "tapped for mana" before any sacrifice path
            // moves the card off the battlefield, so the event still carries
            // the permanent's pre-sacrifice types/subtypes.
            emitPermanentTapped(state, card, true, chosen);
            if (isSacrifice) {
                // Move to graveyard instead of tapping. Cannot be undone via
                // untapForPayment — sacrifice is a one-way payment.
                moveCard(player, card.id, "battlefield", "graveyard");
            } else {
                card.isTapped = true;
                card.chosenMana = chosen;
            }

            for (const [color, amount] of Object.entries(chosen)) {
                if (color !== "X" && typeof amount === "number" && amount > 0) {
                    player.manaPool[color] =
                        (player.manaPool[color] ?? 0) + amount;
                }
            }
            state.pendingCast.tappedLandIds.push(card.id);
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (!manaColor) throw new Error("Card does not produce mana");

            // ADR 0039 / CR 605.1a — a fixed-output "Sacrifice this" mana
            // ability (Basal Thrull) sacrifices the source instead of tapping
            // it. One-way: it is never pushed as an untappable tappedLand entry.
            const isSacrifice = ability?.cost.sacrifice === true;
            if (!isSacrifice) card.isTapped = true;
            // CR 106.1 / 605.1a — board-conditional output (Urza trio) computed
            // from the controller's battlefield and snapshotted onto
            // `chosenMana` so untap refunds the exact amount added.
            const amount = getFixedManaAmount(
                card,
                manaColor,
                player.battlefield
            );
            // CR 614 — Deep Water rewrites a land's produced mana to {U}.
            const added = applyLandManaReplacement(state, player.id, card, {
                [manaColor]: amount,
            } as ManaCost);
            if (
                !isSacrifice &&
                (getDynamicManaProduced(card, player.battlefield) ||
                    added[manaColor] === undefined)
            ) {
                card.chosenMana = added;
            }
            for (const [color, count] of Object.entries(added)) {
                if (color !== "X" && typeof count === "number" && count > 0) {
                    player.manaPool[color] =
                        (player.manaPool[color] ?? 0) + count;
                }
            }
            emitPermanentTapped(state, card, true, added);
            if (isSacrifice) {
                moveCard(player, card.id, "battlefield", "graveyard");
            } else {
                state.pendingCast.tappedLandIds.push(card.id);
            }
        }

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

/** Untap a land during payment (undo). */
export const untapForPayment = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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

        if (card.chosenMana) {
            for (const [color, amount] of Object.entries(card.chosenMana)) {
                if (color !== "X" && typeof amount === "number" && amount > 0) {
                    player.manaPool[color] = Math.max(
                        0,
                        (player.manaPool[color] ?? 0) - amount
                    );
                }
            }
            card.chosenMana = undefined;
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (!manaColor) throw new Error("Card does not produce mana");
            const amount = getFixedManaAmount(card, manaColor);
            player.manaPool[manaColor] = Math.max(
                0,
                (player.manaPool[manaColor] ?? 0) - amount
            );
        }

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

/** Cancel a pending cast: rollback all taps (CR 601.2 reversal). */
/** Picks a permanent to pay the spell's additional cost (CR 117.9 /
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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        if (
            !matchesPermanentFilter(candidate, ac.filter, {
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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        const pending =
            state.pendingCast?.playerId === args.playerId
                ? state.pendingCast
                : state.pendingActivation?.playerId === args.playerId
                  ? state.pendingActivation
                  : undefined;
        if (!pending) throw new Error("No pending payment");

        const player = getPlayer(state, args.playerId);
        const substitutions = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(player.battlefield);
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
        const fullPlan = solveSmartAutoTap(
            player.manaPool,
            pending.manaCost,
            substitutions,
            sources,
            demands,
            selfSourceId
        );
        const plan =
            fullPlan ??
            solveAutoTapPartial(
                player.manaPool,
                pending.manaCost,
                substitutions,
                sources
            );

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
export const selectActivationCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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

        // CR 602.1 / 118.8 — tap-other-creatures picker (Hand of Justice). One
        // call per chosen permanent; each must match the filter, be untapped,
        // not be the source, and not already be picked.
        const toc = pa.tapOtherChoice;
        if (toc) {
            if (toc.pickedIds.length >= toc.count) {
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

        const sc = pa.sacrificeChoice;
        if (!sc) {
            throw new Error("This ability has no sacrifice cost picker");
        }
        if (sc.pickedId) {
            throw new Error("Sacrifice cost already paid");
        }
        if (!matchesPermanentFilter(candidate, sc.filter)) {
            throw new Error(
                "Selected permanent does not match the sacrifice cost filter"
            );
        }
        sc.pickedId = args.cardInstanceId;

        // tryAutoCommitPendingActivation pushes the ability on the stack and
        // clears pendingActivation when the mana is also covered. If mana is
        // still owed, the activation stays pending and the player completes
        // payment via tapForActivationPayment.
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

/** Records the player's pick for an "exile N cards from a single graveyard"
 *  activation cost (CR 602.1 / 118.5 / 406 — Night Soil). Validates that all
 *  picked cards sit in the SAME graveyard (`graveyardOwnerId`), that the count
 *  matches the cost exactly, and that each card satisfies the optional type
 *  filter. Mirrors `selectActivationCost`: it only records the pick (the cards
 *  move graveyard → exile at commit, so cancelling leaves the graveyard
 *  untouched), then drives tryAutoCommitPendingActivation once the pick and the
 *  mana are both in. */
export const selectActivationExileCost = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        graveyardOwnerId: v.string(),
        cardInstanceIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        if (
            new Set(args.cardInstanceIds).size !== args.cardInstanceIds.length
        ) {
            throw new Error("Duplicate card selected for the exile cost");
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

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

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
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        const target: {
            type: "permanent" | "player" | "spell" | "graveyard-card";
            id: string;
            playerId?: string;
        } = {
            type: args.targetType,
            id: args.targetId,
            ...(args.targetPlayerId ? { playerId: args.targetPlayerId } : {}),
        };

        // Validate the target exists and matches the requirement
        const pt = state.pendingTarget;
        const reqTypes = Array.isArray(pt.targetType)
            ? pt.targetType
            : [pt.targetType];
        const wantsAny = reqTypes.includes("any");

        if (args.targetType === "graveyard-card") {
            // CR 109.2 / 400.7: graveyard-zone target. The chooser names a
            // specific player's graveyard via `targetPlayerId`; the engine
            // validates that the card sits there, matches the requested
            // CardType filter, and that the graveyard's owner satisfies the
            // controller-relationship constraint ("you" / "opponent" / any).
            if (pt.zone !== "graveyard") {
                throw new Error("This spell does not target a graveyard card");
            }
            if (!args.targetPlayerId) {
                throw new Error("targetPlayerId required for graveyard target");
            }
            const owner = state.players.find(
                (p) => p.id === args.targetPlayerId
            );
            if (!owner) throw new Error("Invalid graveyard owner");
            const controllerFilter = pt.controller ?? "any";
            if (controllerFilter === "you" && owner.id !== args.playerId) {
                throw new Error("Must target a card in your graveyard");
            }
            if (controllerFilter === "opponent" && owner.id === args.playerId) {
                throw new Error("Must target a card in opponent's graveyard");
            }
            const matchedCard = owner.graveyard.find(
                (c) => c.id === args.targetId
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
        } else if (args.targetType === "permanent") {
            const wantsSpellOrPermanent =
                reqTypes.includes("spell-or-permanent");
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
                    if (c.id !== args.targetId) continue;
                    const matchesAny =
                        wantsAny &&
                        DAMAGEABLE_PERMANENT_TYPES.some((t) =>
                            c.types.includes(t)
                        );
                    const matchesExplicit = permanentTypes.some((t) =>
                        c.types.includes(t as never)
                    );
                    if (matchesAny || wantsSpellOrPermanent || matchesExplicit)
                        matchedCard = c;
                }
            }
            if (!matchedCard) throw new Error("Invalid target");
            // CR 205.3: subtype-restricted choice (e.g. "target Mountains").
            if (pt.subtypeFilter && pt.subtypeFilter.length > 0) {
                const matchedSubtype = pt.subtypeFilter.some((s) =>
                    matchedCard!.subtypes.includes(s)
                );
                if (!matchedSubtype) {
                    throw new Error(
                        `Target must be ${pt.subtypeFilter.join(" or ")}`
                    );
                }
            }
            // CR 202.2: color-restricted choice (e.g. Circle of Protection).
            if (
                pt.colorFilter &&
                !hasColor(matchedCard, pt.colorFilter as Color)
            ) {
                throw new Error(`Target must be ${pt.colorFilter}`);
            }
            // CR 202.2: OR-over-colors choice ("a black or red source" —
            // Greater Realm of Preservation). Legal iff at least one color.
            if (
                pt.colorFilterAny &&
                !pt.colorFilterAny.some((c) =>
                    hasColor(matchedCard, c as Color)
                )
            ) {
                throw new Error(
                    `Target must be ${pt.colorFilterAny.join(" or ")}`
                );
            }
            // CR 613 layer 7c: power-bounded target (Dwarven Warriors).
            if (pt.powerFilter) {
                const power = getEffectivePower(state, matchedCard);
                if (
                    pt.powerFilter.min !== undefined &&
                    power < pt.powerFilter.min
                ) {
                    throw new Error(
                        `Target must have power ≥ ${pt.powerFilter.min}`
                    );
                }
                if (
                    pt.powerFilter.max !== undefined &&
                    power > pt.powerFilter.max
                ) {
                    throw new Error(
                        `Target must have power ≤ ${pt.powerFilter.max}`
                    );
                }
            }
            // CR 613 layer 7c: toughness-bounded target (Stone Giant).
            if (pt.toughnessFilter) {
                const toughness = getEffectiveToughness(state, matchedCard);
                if (
                    pt.toughnessFilter.min !== undefined &&
                    toughness < pt.toughnessFilter.min
                ) {
                    throw new Error(
                        `Target must have toughness ≥ ${pt.toughnessFilter.min}`
                    );
                }
                if (
                    pt.toughnessFilter.max !== undefined &&
                    toughness > pt.toughnessFilter.max
                ) {
                    throw new Error(
                        `Target must have toughness ≤ ${pt.toughnessFilter.max}`
                    );
                }
            }
            // CR 205.3: exclude subtypes (Nettling Imp's "non-Wall").
            if (pt.excludeSubtypes && pt.excludeSubtypes.length > 0) {
                if (
                    pt.excludeSubtypes.some((s) =>
                        matchedCard!.subtypes.includes(s)
                    )
                ) {
                    throw new Error(
                        `Target must not be ${pt.excludeSubtypes.join(" or ")}`
                    );
                }
            }
            // CR 202.3: mvFilter narrows by mana value (X already resolved
            // upstream in resolveMvFilter).
            if (pt.mvFilter) {
                const cardId = (matchedCard.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                const mv =
                    def && def.manaCost
                        ? Object.entries(def.manaCost).reduce<number>(
                              (acc, [, v]) =>
                                  acc + (typeof v === "number" ? v : 0),
                              0
                          )
                        : 0;
                if (!matchesMvFilter(pt.mvFilter, mv)) {
                    throw new Error(
                        "Target does not match the required mana value"
                    );
                }
            }
            // CR 702.16b: a permanent with protection from [color] can't be
            // targeted by a spell/ability whose source has that color.
            const sourceColors = getPendingTargetSourceColors(
                state,
                pt.cardInstanceId,
                pt.kind ?? "cast"
            );
            if (isProtectedFromColors(matchedCard, sourceColors)) {
                throw new Error("Target has protection from this source");
            }
            // CR 611 — a continuous `permanent-guard` (Guardian Beast / shroud)
            // may bar targeting entirely. Mirror of the getLegalTargets gate.
            // The source's card types (CR 109.5), subtypes ("Aura spells"), and
            // spell-vs-ability (CR 113.3 "spells only") narrow filtered guards.
            const guardSourceKind = pt.kind ?? "cast";
            const sourceTypes = getPendingTargetSourceTypes(
                state,
                pt.cardInstanceId,
                guardSourceKind
            );
            const sourceSubtypes = getPendingTargetSourceSubtypes(
                state,
                pt.cardInstanceId,
                guardSourceKind
            );
            if (
                isGuardedAgainst(state, matchedCard, "cantBeTargeted", {
                    types: sourceTypes,
                    subtypes: sourceSubtypes,
                    // copy-retarget is a spell copy; cast is a spell; ability
                    // is not (CR 113.3).
                    isSpell: guardSourceKind !== "ability",
                })
            ) {
                throw new Error(
                    "Target can't be the target of spells or abilities"
                );
            }
        } else if (args.targetType === "player") {
            if (!wantsAny && !reqTypes.includes("player")) {
                throw new Error("Must target a permanent");
            }
            if (pt.colorFilter || pt.colorFilterAny) {
                throw new Error("Players have no color");
            }
            const found = state.players.find((p) => p.id === args.targetId);
            if (!found) throw new Error("Invalid player target");
            // CR 115 — "target opponent" / "target player you control": enforce
            // the controller-relationship filter for player targets (Word of
            // Command targets an opponent). Mirrors the graveyard-card branch.
            const playerControllerFilter = pt.controller ?? "any";
            if (
                playerControllerFilter === "you" &&
                found.id !== args.playerId
            ) {
                throw new Error("Must target yourself");
            }
            if (
                playerControllerFilter === "opponent" &&
                found.id === args.playerId
            ) {
                throw new Error("Must target an opponent");
            }
            // CR 506.2 — "target player who attacked this turn" (Fire and
            // Brimstone): the chosen player must control a creature flagged as
            // having attacked this turn.
            if (
                pt.playerAttackedThisTurn &&
                !found.battlefield.some((c) => c.hasAttackedThisTurn)
            ) {
                throw new Error("Target player did not attack this turn");
            }
        } else {
            // "spell" target (CR 114.1): must match a stack item.
            if (
                !reqTypes.includes("spell") &&
                !reqTypes.includes("spell-or-permanent")
            ) {
                throw new Error("This spell does not target a spell");
            }
            const spell = state.stack.find((s) => s.id === args.targetId);
            if (!spell) throw new Error("Invalid spell target");
            // CR 114.1 + spellTypeFilter (Fork: "instant or sorcery spell"):
            // abilities aren't spells, and a spell must match the requested
            // card type(s).
            if (pt.spellTypeFilter && pt.spellTypeFilter.length > 0) {
                const isAbility =
                    !!spell.abilityId ||
                    !!spell.triggeredAbilityId ||
                    !!spell.delayedTriggerId;
                if (
                    isAbility ||
                    !pt.spellTypeFilter.some((t) => spell.types.includes(t))
                ) {
                    throw new Error(
                        "Target is not a spell of the required type"
                    );
                }
            }
            if (pt.colorFilter && !hasColor(spell, pt.colorFilter as Color)) {
                throw new Error(`Target must be ${pt.colorFilter}`);
            }
            // CR 202.2: OR-over-colors choice (Greater Realm of Preservation).
            if (
                pt.colorFilterAny &&
                !pt.colorFilterAny.some((c) => hasColor(spell, c as Color))
            ) {
                throw new Error(
                    `Target must be ${pt.colorFilterAny.join(" or ")}`
                );
            }
            if (pt.mvFilter) {
                const cardId = (spell.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                const baseMv =
                    def && def.manaCost
                        ? Object.entries(def.manaCost).reduce<number>(
                              (acc, [, v]) =>
                                  acc + (typeof v === "number" ? v : 0),
                              0
                          )
                        : 0;
                const mv = baseMv + (spell.chosenX ?? 0);
                if (!matchesMvFilter(pt.mvFilter, mv)) {
                    throw new Error(
                        "Target does not match the required mana value"
                    );
                }
            }
            // CR 114.6 / 115.10 — Reflecting Mirror: the chosen spell must have
            // exactly one target, and that target must be the activating player.
            if (pt.spellSingleTargetingController) {
                const isAbility =
                    !!spell.abilityId ||
                    !!spell.triggeredAbilityId ||
                    !!spell.delayedTriggerId;
                const tgts = spell.targets ?? [];
                if (
                    isAbility ||
                    tgts.length !== 1 ||
                    tgts[0].type !== "player" ||
                    tgts[0].id !== pt.playerId
                ) {
                    throw new Error(
                        "Target spell must have a single target that is you"
                    );
                }
            }
            // CR 114.1 + 701.7 — Equinox: the chosen spell must be one that
            // would destroy a land the activating player controls.
            if (
                pt.spellWouldDestroyLandYouControl &&
                !spellWouldDestroyLandControlledBy(state, spell, pt.playerId)
            ) {
                throw new Error(
                    "Target spell would not destroy a land you control"
                );
            }
        }

        pt.selected.push(target);

        const maxReached = isTargetCountMaxReached(
            pt.count,
            pt.selected.length
        );
        if (maxReached) {
            finalizeTargetSelection(state, pt, args.playerId);
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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        finalizeTargetSelection(state, pt, args.playerId);

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});

/** Cancel target selection and abort the cast. */
export const cancelTarget = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (!state.pendingTarget)
            throw new Error("No target selection in progress");
        if (state.pendingTarget.playerId !== args.playerId) {
            throw new Error("Not your pending target selection");
        }

        // CR 707.10b / 114.6 — declining a copy-retarget OR an original-spell
        // retarget (Reflecting Mirror) is not aborting a cast: the targeted
        // spell stays on the stack with its current targets and a fresh
        // priority round begins (the copying / retargeting effect has already
        // resolved).
        const retargetKind = state.pendingTarget.kind;
        const wasRetarget =
            retargetKind === "copy-retarget" || retargetKind === "retarget";
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

/** Toggle a creature in/out of the attacker selection (visible to both clients in real-time). */
export const toggleAttacker = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        const idx = state.combat.attackerIds.indexOf(args.cardInstanceId);
        if (idx !== -1) {
            // CR 508.1d: can't deselect a creature required to attack
            if (mustAttack(card, defenderBattlefield)) {
                throw new Error(
                    `${getCardById(card.card.id as string).name} must attack this combat if able`
                );
            }
            state.combat.attackerIds.splice(idx, 1);
            // CR 702.21e: a deselected attacker leaves any band it was in.
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
                        // CR 702.21e / 702.22j — the surviving members must
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
            // Caverns of Despair (CR 508.1a) — no more than two creatures can
            // be declared as attackers each combat. The cap is global; reject
            // the declaration that would push the count past it.
            const attackerCap = getAttackerCap(state);
            if (
                attackerCap !== undefined &&
                state.combat.attackerIds.length >= attackerCap
            ) {
                throw new Error(
                    `No more than ${attackerCap} creatures can attack each combat (Caverns of Despair)`
                );
            }
            state.combat.attackerIds.push(args.cardInstanceId);
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

/** Group selected attackers into a band (CR 702.21e). A band must hold 2+
 *  attackers, at least one with banding and at most one without, and no
 *  attacker may belong to more than one band. */
export const createBand = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        memberIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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

        // CR 702.21e: 1+ creature with banding, at most 1 without.
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

/** Disband a previously declared band (CR 702.21e — band declaration is part
 *  of the still-open attacker declaration and can be revised). */
export const removeBand = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        bandId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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

/** Lock in the attacker selection, tap attackers, and pass priority. */
export const confirmAttackers = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.phase !== "DECLARE_ATTACKERS") {
            throw new Error("Not in DECLARE_ATTACKERS phase");
        }
        if (args.playerId !== state.activePlayerId) {
            throw new Error("Only the active player can confirm attackers");
        }
        if (!state.combat || state.combat.confirmed) {
            throw new Error("Attacker selection is not open");
        }

        const player = getPlayer(state, args.playerId);

        // CR 508.1d: auto-include any eligible creature required to attack
        // that the player didn't manually select.
        const defenderBattlefield = getPlayer(
            state,
            getOpponentId(state, args.playerId)
        ).battlefield;
        for (const requiredId of getRequiredAttackerIds(
            player.battlefield,
            defenderBattlefield,
            state.allCreaturesMustAttack
        )) {
            if (!state.combat.attackerIds.includes(requiredId)) {
                state.combat.attackerIds.push(requiredId);
            }
        }

        // Tap and mark each attacker (vigilance creatures don't tap)
        for (const attackerId of state.combat.attackerIds) {
            const card = player.battlefield.find((c) => c.id === attackerId);
            if (card) {
                if (!card.staticAbilities.includes("vigilance")) {
                    // CR 708.9 / ADR 0013 — a face-down attacker turns up as it
                    // taps to attack.
                    tapPermanent(state, card);
                }
                card.isAttacking = true;
                card.hasAttackedThisTurn = true;
            }
        }

        state.combat.confirmed = true;
        state.combat.blockerAssignments = {};
        state.combat.blockersConfirmed = false;
        // ADR 0012 — fire "when creatures attack" triggers (Raging River).
        emitAttackersDeclaredEvents(state);
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

/** Select a blocker (or deselect/unassign if already selected/assigned). */
export const selectBlocker = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        if (args.playerId === state.activePlayerId) {
            throw new Error("Only the defending player can declare blockers");
        }

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
            const player = getPlayer(state, args.playerId);
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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        if (args.playerId === state.activePlayerId) {
            throw new Error("Only the defending player can assign blockers");
        }
        if (!state.combat.pendingBlockerId) {
            throw new Error("No blocker selected");
        }
        if (!state.combat.attackerIds.includes(args.attackerId)) {
            throw new Error("Target is not an attacker");
        }

        // Evasion checks (CR 509.1b): flying (CR 702.9) + landwalk (CR 702.13).
        const activePlayer = getPlayer(state, state.activePlayerId);
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === args.attackerId
        );
        const defender = getPlayer(state, args.playerId);
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
        // Caverns of Despair (CR 509.1a) — no more than two creatures can be
        // declared as blockers each combat. The cap counts distinct blocking
        // creatures, not blocking assignments; a creature already blocking may
        // still take a second attacker (Two-Headed Giant) without consuming a
        // new slot. Reject only a NEW blocker that would push the count past
        // the cap.
        const blockerCap = getBlockerCap(state);
        if (
            blockerCap !== undefined &&
            existing.length === 0 &&
            Object.keys(state.combat.blockerAssignments).filter(
                (id) => (state.combat!.blockerAssignments[id] ?? []).length > 0
            ).length >= blockerCap
        ) {
            throw new Error(
                `No more than ${blockerCap} creatures can block each combat (Caverns of Despair)`
            );
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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        if (state.phase !== "DECLARE_BLOCKERS") {
            throw new Error("Not in DECLARE_BLOCKERS phase");
        }
        if (!state.combat || state.combat.blockersConfirmed) {
            throw new Error("Blocker selection is not open");
        }
        if (args.playerId === state.activePlayerId) {
            throw new Error("Only the defending player can confirm blockers");
        }

        const player = getPlayer(state, args.playerId);

        // CR 509.1c: auto-assign must-block requirements (Lure, Blaze of Glory)
        const activePlayer = getPlayer(state, state.activePlayerId);
        const required = getRequiredBlockerAssignments(
            activePlayer.battlefield,
            player.battlefield,
            state.combat.attackerIds,
            state.combat.blockerAssignments,
            state
        );
        for (const [blockerId, attackerIds] of Object.entries(required)) {
            const existing = state.combat.blockerAssignments[blockerId] ?? [];
            state.combat.blockerAssignments[blockerId] = [
                ...existing,
                ...attackerIds,
            ];
        }

        // CR 509.1b / 702.111 — minimum-blocker thresholds (menace). A
        // declaration where a menace attacker is blocked by exactly one creature
        // is illegal; this can only be judged once the full block set is known
        // (after must-block auto-assignment above), so it is enforced here at
        // confirm time rather than per-blocker at assignment time.
        const minBlockerCheck = validateMinimumBlockers(state);
        if (!minBlockerCheck.ok) {
            throw new Error(minBlockerCheck.reason);
        }

        // Mark each assigned blocker
        for (const blockerId of Object.keys(state.combat.blockerAssignments)) {
            const card = player.battlefield.find((c) => c.id === blockerId);
            if (card) card.isBlocking = true;
        }

        state.combat.pendingBlockerId = undefined;
        state.combat.blockersConfirmed = true;
        recordBlockedAttackers(state);
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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        // CR 702.21j-k: the assigner is recorded per source. Without banding
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

        for (const targetId of Object.keys(assignments)) {
            if (isAttacker && targetId === defenderId) {
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
 *  distinct assigner has confirmed (CR 702.21j-k can split authority between
 *  the attacking and defending players). */
export const confirmDamage = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);

        // CR 103.5: no priority is given during the pre-game mulligan phase.
        if (state.phase === "MULLIGAN") {
            throw new Error("Cannot pass priority during mulligan phase");
        }

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
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
                // Resolution suspended awaiting player choices (CR 608.2).
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
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        applyPendingChoiceSubmit(state, {
            playerId: args.playerId,
            stackItemId: args.stackItemId,
            step: args.step,
            choiceId: args.choiceId,
            cardInstanceIds: args.cardInstanceIds,
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
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        applyMayPaySubmit(state, {
            playerId: args.playerId,
            accept: args.accept,
        });

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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

/** CR 104.3a: a player can concede the game at any time. That player loses. */
export const concede = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

        getPlayer(state, args.playerId);
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
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);

        if (state.priorityPlayerId !== args.playerId) {
            throw new Error("You don't have priority");
        }
        if (state.pendingCast) {
            throw new Error("Another spell is already being cast");
        }
        if (state.pendingActivation) {
            throw new Error("Another ability is already being activated");
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
        if (!card) throw new Error("Card not on battlefield");

        const cardId = (card.card as { id?: string }).id;
        if (!cardId) throw new Error("Card has no definition");

        const resolved = resolveActivatedAbility(card, args.abilityId);
        if (!resolved) throw new Error("Ability not found");
        const ability = resolved.ability;
        // CR 602.1 — "only your opponents may activate this ability" (Clergy of
        // the Holy Nimbus): the source's controller may NOT activate it; any
        // other player may. Checked before the controller-only default below.
        if (ability.activatableByEnchantedController) {
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
                throw new Error(
                    "Only your opponents may activate this ability"
                );
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
        // CR 602.5 — phase-restricted activated abilities ("activate only
        // during combat" etc.) are illegal outside their declared phase
        // allow-list. Mirrors spell-level `castPhaseRestriction`.
        if (
            ability.activationPhaseRestriction &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            throw new Error("Ability cannot be activated during this phase");
        }

        // CR 602.2b: if the ability has targets, choose them before paying
        // costs. Mana availability is deferred to finalizeTargetSelection
        // (which enters pendingActivation when the pool doesn't cover the
        // cost — mirrors the spell announceCast flow).
        const baseTargetReq = ability.getTargetRequirement
            ? ability.getTargetRequirement(card, state)
            : ability.targetRequirement;
        // CR 612.6 — a color-targeted ability follows its source's active
        // color-word changes (Sleight of Mind on a Circle of Protection
        // retargets its "<color> source of your choice"). The substituted
        // filter flows into both getLegalTargets and the stored pendingTarget.
        const effectiveTargetReq =
            baseTargetReq && baseTargetReq.colorFilter !== undefined
                ? {
                      ...baseTargetReq,
                      colorFilter: substituteColorFilter(
                          card,
                          baseTargetReq.colorFilter
                      ),
                  }
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
                const have =
                    card.counters?.[ability.cost.removeCounter.type] ?? 0;
                if (have < ability.cost.removeCounter.count) {
                    throw new Error(
                        "Not enough counters to pay activation cost"
                    );
                }
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
            const abilitySourceColors = STATIC_EFFECT_CTX.getColors(card);
            const legal = getLegalTargets(
                state,
                effectiveTargetReq,
                abilitySourceColors,
                args.playerId,
                targetChosenX,
                card.types,
                card.subtypes,
                // Source is an activated ability, not a spell (CR 113.3).
                false
            );
            if (legal.length === 0) {
                throw new Error("No legal targets available");
            }
            const abilityCount = resolveTargetCount(
                effectiveTargetReq.count,
                targetChosenX
            );
            const abilitySubtypeFilter = effectiveTargetReq.subtypeFilter
                ? Array.isArray(effectiveTargetReq.subtypeFilter)
                    ? effectiveTargetReq.subtypeFilter
                    : [effectiveTargetReq.subtypeFilter]
                : undefined;
            const abilityExcludeSubtypes = effectiveTargetReq.excludeSubtypes
                ? Array.isArray(effectiveTargetReq.excludeSubtypes)
                    ? effectiveTargetReq.excludeSubtypes
                    : [effectiveTargetReq.excludeSubtypes]
                : undefined;
            state.pendingTarget = {
                playerId: args.playerId,
                cardInstanceId: card.id,
                targetType: effectiveTargetReq.type,
                count: abilityCount,
                colorFilter: effectiveTargetReq.colorFilter,
                // CR 202.2 — OR-over-colors choice (Greater Realm of
                // Preservation: "a black or red source"). Propagated so
                // selectTarget can enforce the multi-color restriction.
                ...(effectiveTargetReq.colorFilterAny
                    ? { colorFilterAny: effectiveTargetReq.colorFilterAny }
                    : {}),
                selected: [],
                keepPriority: args.keepPriority,
                kind: "ability",
                abilityId: args.abilityId,
                ...(targetChosenX !== undefined
                    ? { chosenX: targetChosenX }
                    : {}),
                ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
                ...(effectiveTargetReq.zone
                    ? { zone: effectiveTargetReq.zone }
                    : {}),
                ...(effectiveTargetReq.controller
                    ? { controller: effectiveTargetReq.controller }
                    : {}),
                ...(abilitySubtypeFilter
                    ? { subtypeFilter: abilitySubtypeFilter }
                    : {}),
                ...(effectiveTargetReq.powerFilter
                    ? { powerFilter: effectiveTargetReq.powerFilter }
                    : {}),
                ...(effectiveTargetReq.toughnessFilter
                    ? { toughnessFilter: effectiveTargetReq.toughnessFilter }
                    : {}),
                ...(abilityExcludeSubtypes
                    ? { excludeSubtypes: abilityExcludeSubtypes }
                    : {}),
                ...(effectiveTargetReq.spellTypeFilter
                    ? {
                          spellTypeFilter: Array.isArray(
                              effectiveTargetReq.spellTypeFilter
                          )
                              ? effectiveTargetReq.spellTypeFilter
                              : [effectiveTargetReq.spellTypeFilter],
                      }
                    : {}),
                ...(effectiveTargetReq.spellSingleTargetingController
                    ? { spellSingleTargetingController: true }
                    : {}),
                ...(effectiveTargetReq.spellWouldDestroyLandYouControl
                    ? { spellWouldDestroyLandYouControl: true }
                    : {}),
                ...(() => {
                    const resolved = resolveMvFilter(
                        effectiveTargetReq.mvFilter,
                        targetChosenX
                    );
                    return resolved ? { mvFilter: resolved } : {};
                })(),
            };

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
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
        // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>": the
        // activation is illegal if no matching permanent is on the activating
        // player's battlefield. Validated up-front so we never enter a
        // pendingActivation that can't be paid.
        if (ability.cost.sacrificeFilter) {
            const candidates = player.battlefield.filter((c) =>
                matchesPermanentFilter(c, ability.cost.sacrificeFilter!)
            );
            if (candidates.length === 0) {
                throw new Error("No legal permanent to pay the sacrifice cost");
            }
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard" (Night
        // Soil): illegal unless one graveyard holds enough matching cards.
        // Validated up-front so we never enter an unpayable pendingActivation.
        if (ability.cost.exileFromGraveyard) {
            const { count, cardType } = ability.cost.exileFromGraveyard;
            if (!canPayExileFromGraveyard(state, count, cardType)) {
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
            if (candidates.length < ability.cost.tapOtherFilter.count) {
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
        assertActivationTimingLegal(state, card, ability);
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
            applyCostModifiers(
                manaCost,
                getCostModifiers(state, card, "ability")
            );
        }

        // Enter a pendingActivation payment phase that mirrors pendingCast
        // when (a) mana isn't yet covered, OR (b) the ability has a
        // sacrifice-a-filtered-permanent cost that still needs a choice
        // (CR 602.1 / 118.5). In the payment phase the player taps lands and
        // picks the sacrifice (selectActivationCost); auto-commit applies the
        // deferred tap/sacrifice and pushes the ability on the stack.
        // Tap/sacrifice are DEFERRED so cancel leaves the source untouched.
        const manaUncovered =
            !!manaCost &&
            !isManaCostCovered(
                player.manaPool,
                manaCost,
                getManaSubstitutions(state, player.id)
            );
        const needsSacrificeChoice = !!ability.cost.sacrificeFilter;
        const needsExileChoice = !!ability.cost.exileFromGraveyard;
        const needsTapOtherChoice = !!ability.cost.tapOtherFilter;
        if (
            manaUncovered ||
            needsSacrificeChoice ||
            needsExileChoice ||
            needsTapOtherChoice
        ) {
            const pending: PendingActivation = {
                playerId: args.playerId,
                cardInstanceId: card.id,
                abilityId: args.abilityId,
                manaCost: manaCost ?? {},
                tappedLandIds: [],
                tapSource: !!ability.cost.tap,
                sacrificeSource: !!ability.cost.sacrifice,
                ...(ability.cost.removeCounter
                    ? { removeCounterCost: { ...ability.cost.removeCounter } }
                    : {}),
                ...(ability.cost.discardLastDrawn
                    ? { discardLastDrawnSource: true }
                    : {}),
                ...(ability.cost.discardAtRandom
                    ? { discardAtRandomCount: ability.cost.discardAtRandom }
                    : {}),
                ...(ability.cost.sacrificeFilter
                    ? {
                          sacrificeChoice: {
                              filter: ability.cost.sacrificeFilter,
                          },
                      }
                    : {}),
                ...(ability.cost.exileFromGraveyard
                    ? {
                          exileFromGraveyardChoice: {
                              count: ability.cost.exileFromGraveyard.count,
                              ...(ability.cost.exileFromGraveyard.cardType !==
                              undefined
                                  ? {
                                        cardType:
                                            ability.cost.exileFromGraveyard
                                                .cardType,
                                    }
                                  : {}),
                          },
                      }
                    : {}),
                ...(ability.cost.tapOtherFilter
                    ? {
                          tapOtherChoice: {
                              filter: ability.cost.tapOtherFilter.filter,
                              count: ability.cost.tapOtherFilter.count,
                              pickedIds: [],
                          },
                      }
                    : {}),
                ...(chosenX !== undefined ? { chosenX } : {}),
                keepPriority: args.keepPriority,
                ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            };
            state.pendingActivation = pending;
            // CR 302.1 — a {T}-cost ability still needs the source untapped at
            // commit; deferral keeps it untapped now, so re-check at commit.
            // When mana is already covered and the source has a {T} cost but no
            // sacrifice choice, this branch isn't reached (mana covered path).
            // tryAutoCommitPendingActivation handles the eventual commit (after
            // the sacrifice pick) including when mana is already covered.
            tryAutoCommitPendingActivation(state, args.playerId);

            const nextSeq = gameState.seq + 1;
            await saveGameState(ctx, args.gameId, nextSeq, state, gameState);
            return;
        }

        // Mana already covered (or no mana cost) — commit immediately.
        if (ability.cost.tap) {
            card.isTapped = true;
        }
        if (manaCost) {
            payManaCost(
                player.manaPool,
                manaCost,
                getManaSubstitutions(state, player.id)
            );
            commitLandsForCost(player, manaCost);
        }
        if (ability.cost.removeCounter) {
            payRemoveCounterCost(card, ability.cost.removeCounter);
        }
        if (ability.cost.discardLastDrawn) {
            payDiscardLastDrawn(player);
        }
        if (ability.cost.discardAtRandom) {
            payDiscardAtRandomCost(
                state,
                player.id,
                ability.cost.discardAtRandom
            );
        }
        if (ability.cost.sacrifice) {
            removePermanentTo(state, card.id, "graveyard", "sacrifice");
        }

        // Put ability on stack (clone card state as a virtual stack item)
        const stackItem: StackItem = {
            ...structuredClone(card),
            zone: "stack" as const,
            castById: args.playerId,
            abilityId: args.abilityId,
            ...(chosenX !== undefined ? { chosenX } : {}),
            ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
        };
        state.stack.push(stackItem);
        recordActivation(state, card, args.abilityId, !!ability.cost.tap);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, args.playerId);
        state.singleShotAutoPass = args.keepPriority
            ? undefined
            : args.playerId;
        drainAutoPasses(state);
        // CR 603.3 — flush ABILITY_ACTIVATED queued by recordActivation so the
        // "non-tap ability activated" punisher lands on top of the freshly
        // pushed ability (resolves first). No-op for {T} abilities.
        processPendingActionTriggers(state);

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
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

        if (!hasManaAbility(card)) {
            throw new Error("Card has no mana ability to tap/untap");
        }

        const ability = getActivatedManaAbility(card);
        // CR 605.1a / 606 — a NON-tap mana ability whose cost is mana
        // (Farrelite Priest "{1}: Add {W}") has no tap toggle to flip: it can be
        // activated repeatedly and may carry a side effect (a conditional
        // delayed sacrifice). `tapUntap` only models tap-based sources, so route
        // these through `activateManaAbility`, which pays the mana cost, runs
        // the ability's `resolve`, and records the per-turn activation count.
        if (ability && !ability.cost.tap && ability.cost.mana) {
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

        // Block untap if mana was spent on a cast
        if (wasTapped && card.manaCommitted) {
            throw new Error("Cannot untap: mana already spent");
        }

        // Track produced mana so we can carry it on the PERMANENT_TAPPED event
        // (CR 605.2 / 603.2 — Mana Flare reads `manaProduced` to add the
        // matching color). Set on the tap branches, undefined on untap.
        let producedThisActivation: ManaCost | undefined;

        // Determine mana to add/remove
        if (ability?.manaChoices || ability?.getManaChoices) {
            // Choice-based mana ability (e.g. Birds of Paradise, Black Lotus,
            // or board-conditional Fellwar Stone)
            if (!wasTapped) {
                if (args.manaChoiceIndex === undefined) {
                    throw new Error("Must choose a mana color");
                }
                // CR 106.1 — board-conditional `getManaChoices` takes precedence.
                const choices = getEffectiveManaChoices(
                    card,
                    player.id,
                    state.players.map((p) => ({
                        playerId: p.id,
                        battlefield: p.battlefield,
                    }))
                );
                const rawChosen = choices?.[args.manaChoiceIndex];
                if (!rawChosen) throw new Error("Invalid mana choice");
                // CR 614 — Deep Water rewrites a land's produced mana to {U}.
                const chosen = applyLandManaReplacement(
                    state,
                    player.id,
                    card,
                    rawChosen
                );

                // CR 122.6 / 605.1a — Mana Battery: the chosen index N is the
                // number of charge counters this activation removes ("Remove any
                // number of charge counters: Add 1 + N mana"). Validate and pay
                // the scaling counter cost up-front so we never half-apply the
                // tap. Snapshotted on the instance so an untap (before the mana
                // is spent) restores the counters.
                const counterType = ability?.manaChoiceRemovesCounters;
                if (counterType !== undefined && args.manaChoiceIndex > 0) {
                    const have = card.counters?.[counterType] ?? 0;
                    if (have < args.manaChoiceIndex) {
                        throw new Error("Not enough counters for this choice");
                    }
                    payRemoveCounterCost(card, {
                        type: counterType,
                        count: args.manaChoiceIndex,
                    });
                }

                // CR 605.2 — emit before any sacrifice path moves the card off
                // the battlefield, so the event still carries the source's
                // pre-sacrifice types/subtypes.
                emitPermanentTapped(state, card, true, chosen);
                producedThisActivation = chosen;

                // Pay cost: tap (+ sacrifice if required)
                if (isSacrifice) {
                    moveCard(player, card.id, "battlefield", "graveyard");
                } else {
                    card.isTapped = true;
                    // Remember the exact mana produced so untap can refund it.
                    // Fixed-color abilities use manaProduced and don't need this.
                    card.chosenMana = chosen;
                    if (counterType !== undefined && args.manaChoiceIndex > 0) {
                        card.manaCounterRemoval = {
                            type: counterType,
                            count: args.manaChoiceIndex,
                        };
                    }
                }

                // Add chosen mana to pool
                for (const [color, amount] of Object.entries(chosen)) {
                    if (
                        color !== "X" &&
                        typeof amount === "number" &&
                        amount > 0
                    ) {
                        player.manaPool[color as keyof typeof player.manaPool] =
                            (player.manaPool[
                                color as keyof typeof player.manaPool
                            ] ?? 0) + amount;
                    }
                }
            } else {
                // Untap: refund exactly the mana that was chosen on tap.
                // Falls back to manaProduced for legacy instances (pre-chosenMana).
                const refund = card.chosenMana;
                if (refund) {
                    for (const [color, amount] of Object.entries(refund)) {
                        if (
                            color !== "X" &&
                            typeof amount === "number" &&
                            amount > 0
                        ) {
                            const key = color as keyof typeof player.manaPool;
                            player.manaPool[key] = Math.max(
                                0,
                                (player.manaPool[key] ?? 0) - amount
                            );
                        }
                    }
                }
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
                card.chosenMana = undefined;
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
                        const list = player.restrictedMana ?? [];
                        const entry = list.find(
                            (r) =>
                                r.color === manaColor &&
                                r.restriction === restriction
                        );
                        if (entry) {
                            entry.amount = Math.max(0, entry.amount - amount);
                        }
                        const remaining = list.filter((r) => r.amount > 0);
                        player.restrictedMana =
                            remaining.length > 0 ? remaining : undefined;
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
                }
            }
            // CR 605.1a / ADR 0039 — pay the "Sacrifice this" portion of a
            // fixed-output sacrifice mana ability (Basal Thrull). Done after
            // the mana is produced and the PERMANENT_TAPPED event is emitted
            // (above), so leaves-the-battlefield triggers see the mana already
            // added. One-way: there is no untap branch for a sacrificed source.
            if (isSacrifice && !wasTapped) {
                moveCard(player, card.id, "battlefield", "graveyard");
            }
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
            armDelayedTriggerOnTap(state, ability, card, args.playerId);
        }

        // CR 603.2 — flush the PERMANENT_TAPPED event into a trigger pass so
        // Manabarbs / Mana Flare / Wild Growth land on the stack right after
        // the mana ability resolves. Skip on untap (no event was emitted).
        if (producedThisActivation) {
            processPendingActionTriggers(state);
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
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);

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
        // This path is for non-tap, mana-cost mana abilities only. Tap mana
        // abilities (lands, mana rocks) go through `tapUntap`.
        if (ability.cost.tap || !ability.cost.mana) {
            throw new Error("Use tapUntap for tap mana abilities");
        }
        // CR 602.5 — phase-restricted templates are illegal outside their phase.
        if (
            ability.activationPhaseRestriction &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            throw new Error("Ability cannot be activated during this phase");
        }

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

        // CR 605.3c — resolve immediately without the stack. Synthesize a
        // transient stack item so `resolveTopOfStack` builds a full
        // SpellContext for the source, run the resolve, then pop. The item is
        // pushed and immediately resolved within this single mutation, so it is
        // never observable on the stack and never grants priority.
        const stackItem: StackItem = {
            ...structuredClone(card),
            zone: "stack" as const,
            castById: args.playerId,
            abilityId: args.abilityId,
            ...(resolved.grantedSourceCardId
                ? { grantedSourceCardId: resolved.grantedSourceCardId }
                : {}),
        };
        state.stack.push(stackItem);
        // Increment BEFORE resolving so getActivationCount inside resolve()
        // counts this activation (CR 602.5). A mana cost (no {T}) emits
        // ABILITY_ACTIVATED.
        recordActivation(state, card, args.abilityId, false);
        resolveTopOfStack(state);
        // Flush any ABILITY_ACTIVATED / mana-add triggers queued during the
        // immediate resolve (CR 603.2/603.3).
        processPendingActionTriggers(state);

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
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertNoPendingChoices(state);

        const player = getPlayer(state, args.playerId);
        const instance = player.grantedAbilities?.find(
            (g) => g.id === args.grantedAbilityInstanceId
        );
        if (!instance) throw new Error("Granted ability not found");

        const sourceCard = getCardById(instance.sourceCardId);
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
                throw new Error("Another spell is already being cast");
            }
            if (state.pendingActivation) {
                throw new Error("Another ability is already being activated");
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

        // CR 118.4 — a player can't pay more life than they have.
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

/** Debug: patch any value in the game state by dot-separated path. */
export const debugPatchState = mutation({
    args: {
        gameId: v.id("games"),
        path: v.string(),
        value: v.any(),
    },
    handler: async (ctx, args) => {
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

/** Debug: reset game — rebuild initial state from the game record. */
export const debugResetGame = mutation({
    args: {
        gameId: v.id("games"),
    },
    handler: async (ctx, args) => {
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");

        const existing = await getLatestGameState(ctx, args.gameId);

        const idCounter: { nextInstanceId?: number } = {};
        const playersState = game.players.map((p) =>
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
 */
export const debugBo3Sideboard = mutation({
    args: { gameId: v.id("games") },
    handler: async (ctx, args) => {
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
                zone: v.optional(
                    v.union(
                        v.literal("hand"),
                        v.literal("battlefield"),
                        v.literal("graveyard"),
                        v.literal("exile")
                    )
                ),
                tapped: v.optional(v.boolean()),
                count: v.optional(v.number()),
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
            })
        ),
        phase: v.optional(v.string()),
        /** Give each player this many Plains. Default 0. */
        landCount: v.optional(v.number()),
        /** Fill each player's library with this many Plains. Default: unchanged. */
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
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        const state = structuredClone(gameState.state) as GameState;
        // If the game is still in the pre-game mulligan phase (CR 103.5),
        // confirm the mulligan for both players so the scenario takes over a
        // clean turn-1 state. The scenario's own `phase` override (later in
        // this handler) wins if specified.
        if (state.mulligan) {
            finalizeMulligan(state);
        }

        const p1 = state.players[0];
        const p2 = state.players[1];

        // Clear battlefields, hands, graveyards, exile
        p1.battlefield = [];
        p2.battlefield = [];
        p1.hand = [];
        p2.hand = [];
        p1.graveyard = [];
        p2.graveyard = [];
        p1.exile = [];
        p2.exile = [];

        // Helper to create an instance from a card name
        function makeInstance(
            cardName: string,
            controllerId: string,
            zone: "hand" | "battlefield" | "library" | "graveyard" | "exile",
            opts?: { tapped?: boolean }
        ) {
            const def = getCardByName(cardName);
            return {
                id: allocInstanceId(state),
                card: { id: def.id },
                types: def.types,
                subtypes: def.subtypes ?? [],
                power: def.power,
                toughness: def.toughness,
                staticAbilities: def.staticAbilities ?? [],
                controllerId,
                ownerId: controllerId,
                zone,
                isTapped: opts?.tapped ?? false,
                isSummoningSick: false,
            };
        }

        // Place requested cards
        for (const entry of args.cards) {
            const player = entry.owner === "me" ? p1 : p2;
            const zone = entry.zone ?? "battlefield";
            const count = entry.count ?? 1;
            for (let i = 0; i < count; i++) {
                const instance = makeInstance(entry.name, player.id, zone, {
                    tapped: entry.tapped,
                });
                if (zone === "hand") {
                    player.hand.push(instance);
                } else if (zone === "graveyard") {
                    player.graveyard.push(instance);
                } else if (zone === "exile") {
                    player.exile.push(instance as CardInstanceState);
                    // ADR 0026 slice 6 — face-down exile (impulse-draw): stamp
                    // the card known to its controller only via the primitive
                    // (reuses knownTo; opponents see a face-down card).
                    if (entry.faceDownExile) {
                        exileFaceDownCard(
                            player,
                            instance.id,
                            "exile",
                            player.id
                        );
                    }
                } else {
                    if (entry.damageMarked && entry.damageMarked > 0) {
                        (instance as CardInstanceState).damageMarked =
                            entry.damageMarked;
                    }
                    if (entry.faceDown) {
                        turnFaceDown(instance as CardInstanceState);
                    }
                    if (entry.counters) {
                        (instance as CardInstanceState).counters = {
                            ...entry.counters,
                        };
                    }
                    if (entry.attackedLastTurn) {
                        (instance as CardInstanceState).attackedDuringLastTurn =
                            true;
                    }
                    // CR 302.6 — entered this turn: starts the control-continuity
                    // clock so a manland animated the same turn reads sick (#545).
                    if (entry.summoningSick) {
                        (instance as CardInstanceState).isSummoningSick = true;
                    }
                    player.battlefield.push(instance);
                }
            }
        }

        // Add lands (only if explicitly requested)
        const landCount = args.landCount ?? 0;
        for (let i = 0; i < landCount; i++) {
            p1.battlefield.push(makeInstance("Plains", p1.id, "battlefield"));
            p2.battlefield.push(makeInstance("Plains", p2.id, "battlefield"));
        }

        // Fill libraries if requested
        if (args.libraryCount !== undefined) {
            p1.library = [];
            p2.library = [];
            for (let i = 0; i < args.libraryCount; i++) {
                p1.library.push(makeInstance("Plains", p1.id, "library"));
                p2.library.push(makeInstance("Plains", p2.id, "library"));
            }
        }

        // Mark "me"'s last hand card as drawn this turn (Jandor's Ring's
        // "discard the last card you drew this turn" cost). Cleared at the
        // next turn start by advanceTurn.
        if (args.markLastDrawn && p1.hand.length > 0) {
            p1.lastDrawnCardId = p1.hand[p1.hand.length - 1].id;
        }

        // CR 611.2 — replay continuous keyword-grant / activated-grant static
        // effects across the freshly-built battlefield. The placement loop
        // bypasses `finalizeSpellResolution`'s entry hooks, so a Zombie Master
        // dropped via the scenario doesn't naturally reach its Zombies. One
        // pass per source is enough: each call walks every permanent and
        // pushes matching grants — order-independent because the predicate is
        // a function of subtype/id, not of timestamp.
        for (const player of state.players) {
            for (const source of player.battlefield) {
                applySourceStaticEffects(state, source);
            }
        }

        // The placement loop bypasses ETB triggers, so "as ~ enters, choose an
        // opponent" (Cursed Rack, The Rack — #292) never resolved. Auto-pick
        // the controller's opponent so the scenario exercises the stored choice
        // (2-player: a single opponent, so no ambiguity).
        for (const player of state.players) {
            for (const source of player.battlefield) {
                if (source.chosenPlayerId !== undefined) continue;
                const cardId = (source.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                const choosesOpponent = def?.triggeredAbilities?.some((t) =>
                    t.id.endsWith("-choose-opponent")
                );
                if (choosesOpponent) {
                    source.chosenPlayerId = getOpponentId(
                        state,
                        source.controllerId
                    );
                }
            }
        }

        // Set the turn number if requested (turn 1 skips the draw step).
        if (args.turn !== undefined) {
            state.turn = args.turn;
        }

        // Set phase if requested
        if (args.phase) {
            state.phase = args.phase as Phase;
            if (args.phase === "DECLARE_ATTACKERS") {
                state.combat = {
                    attackerIds: [],
                    confirmed: false,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                };
            }
        }

        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        state.pendingCast = undefined;
        state.stack = [];

        // Pin the PRNG so the next random draw is deterministic (CR 705 /
        // ADR 0023) — e.g. force a Bottle of Suleiman coin flip to WIN/LOSE.
        if (args.rngSeed !== undefined) {
            state.rngSeed = args.rngSeed;
            state.rngCounter = 0;
        }

        // Seed poison counters (CR 122). A player reaching ten or more loses
        // the game (CR 704.5c) on the next SBA sweep.
        if (args.poison) {
            if (args.poison.me) p1.poisonCounters = args.poison.me;
            if (args.poison.opp) p2.poisonCounters = args.poison.opp;
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
