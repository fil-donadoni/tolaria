import { v, type GenericId } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
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
    commitLandsForCost,
    resolveTopOfStack,
    normalizeManaCost,
    isManaCostCovered,
    getManaSubstitutions,
    getCostModifiers,
    applyCostIncrease,
    emitSpellCastEvent,
    emitPermanentTapped,
    emitAbilityActivated,
    emitPermanentEntered,
    discardPermanentTappedEvent,
    processPendingActionTriggers,
    allocInstanceId,
    tapPermanent,
} from "./gre/state";
import { buildAutoTapSources, solveAutoTap } from "./gre/autoTap";
import { isGuardedAgainst } from "./gre/permanentGuard";
import type { Color, ManaCost, SpellMode } from "./cards/types";
import {
    assertLegalAction,
    getLegalTargets,
    getPendingTargetSourceColors,
    getPendingTargetSourceTypes,
    hasColor,
    isProtectedFromColors,
    matchesMvFilter,
    resolveMvFilter,
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
    getActivatedManaAbility,
    getActivatedManaColor,
    getActivatedManaRestriction,
    getDynamicManaProduced,
    getFixedManaAmount,
    hasManaAbility,
    isTapLockedBySummoningSickness,
} from "./gre/constants";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    getRequiredAttackerIds,
    mustAttack,
    getRequiredBlockerAssignments,
    getMaxBlockTargets,
} from "./gre/combat";
import {
    hasBanding,
    getEffectiveBlockGraph,
    outstandingDamageAssigner,
    isLegalBandComposition,
    recordBlockedAttackers,
} from "./gre/banding";
import { checkStateBasedActions } from "./gre/sba";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "./gre/pendingChoiceSubmit";
import { findActiveGameForUser, gameBelongsToUser } from "./gameLifecycle";

export const STARTING_HAND_SIZE = 7;

/** Thrown by create/join when the user already occupies an active game (#155). */
const ACTIVE_GAME_MESSAGE =
    "You already have an active game. Finish or leave it before starting another.";

type DeckInput = {
    id: string;
    name: string;
    format: string;
    cards: { cardId: string; cardName: string }[];
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

/** If SBA detected game over, persist the result to the games table. */
async function finalizeGameOver(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    _seq: number,
    state: GameState
) {
    if (!state.gameOver) return;

    await ctx.db.patch(gameId, {
        status: "finished",
        winner: state.gameOver.winnerId,
        updatedAt: Date.now(),
    });
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
function tapSourceIntoPayment(
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

    if (ability?.manaChoices) {
        if (manaChoiceIndex === undefined) {
            throw new Error("Must choose a mana color");
        }
        const chosen = ability.manaChoices[manaChoiceIndex];
        if (!chosen) throw new Error("Invalid mana choice");

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
        }
        for (const [color, amount] of Object.entries(chosen)) {
            if (color !== "X" && typeof amount === "number" && amount > 0) {
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        }
        tappedLandIds.push(card.id);
        return;
    }

    const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
    if (!manaColor) throw new Error("Card does not produce mana");
    card.isTapped = true;
    // CR 106.1 / 605.1a — board-conditional output (Urza trio) is computed from
    // the controller's battlefield now and snapshotted onto `chosenMana` so the
    // untap/refund path returns the exact amount that was added.
    const amount = getFixedManaAmount(card, manaColor, player.battlefield);
    if (getDynamicManaProduced(card, player.battlefield)) {
        card.chosenMana = { [manaColor]: amount } as ManaCost;
    }
    player.manaPool[manaColor] = (player.manaPool[manaColor] ?? 0) + amount;
    emitPermanentTapped(state, card, true, { [manaColor]: amount } as ManaCost);
    tappedLandIds.push(card.id);
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

/** If the activator's pool now covers pendingActivation, pay mana, apply the
 *  deferred tap/sacrifice costs on the source, push the ability on the stack,
 *  and swap priority. Mirrors tryAutoCommitPendingCast for abilities. Returns
 *  the source card name on commit, or null if nothing was committed. */
function tryAutoCommitPendingActivation(
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
    if (pa.sacrificeSource) {
        removePermanentTo(state, card.id, "graveyard");
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
        };
        removePermanentTo(state, sacrificed.id, "graveyard");
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

    // Sacrifice the picked permanent (CR 117.9) and snapshot its mana value
    // for the stack item — the resolve reads it via
    // SpellContext.getAdditionalSacrificeMv.
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
        };
        removePermanentTo(state, sacrificed.id, "graveyard");
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
 *  whole table. Finished/solo games never enter this query's bandwidth. */
export const listOpenGames = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return [];
        const waiting = await ctx.db
            .query("games")
            .withIndex("by_status", (q) => q.eq("status", "waiting"))
            .collect();
        return waiting.filter((g) => !g.players.some((p) => p.id === userId));
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
});

export const createGame = mutation({
    args: {
        name: v.string(),
        deck: deckValidator,
        bgColor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        // #155: at most one active game per user. Guard runs server-side so it
        // holds against double-click / two-tab races (Convex OCC retries the
        // loser, which then sees the new game and is rejected here).
        if (await findActiveGameForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        const now = Date.now();

        const player: PlayerInput = {
            id: user._id,
            name: user.nickname,
            bgColor: args.bgColor ?? PLAYER_COLORS[0],
            deck: args.deck,
        };

        const gameId = await ctx.db.insert("games", {
            name: args.name,
            status: "waiting",
            players: [player],
            createdAt: now,
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
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        // #155: one active game per user (see createGame).
        if (await findActiveGameForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        const deck2 = args.deck2 ?? args.deck;

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

        const gameId = await ctx.db.insert("games", {
            name: args.name,
            status: "playing",
            players: allPlayers,
            solo: true,
            vsAi: args.vsAi === true ? true : undefined,
            createdAt: now,
            updatedAt: now,
        });

        const idCounter: { nextInstanceId?: number } = {};
        const playersState = allPlayers.map((p) =>
            buildPlayerState(p, idCounter)
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

        // CR 103.5: enter the mulligan phase — declarations begin with the
        // starting player. advancePhase is deferred to finalizeMulligan.
        initialState.phase = "MULLIGAN" as Phase;
        initialState.mulligan = makeMulliganState(initialState);
        initialState.priorityPlayerId = initialState.mulligan.declaringPlayerId;

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
        // #155: reject joining when the user already occupies another active
        // game (their own waiting room or an in-progress game).
        if (await findActiveGameForUser(ctx, user._id))
            throw new Error(ACTIVE_GAME_MESSAGE);
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
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
        const allPlayers = [...game.players, player];
        const now = Date.now();

        // Update game record
        await ctx.db.patch(args.gameId, {
            status: "playing",
            players: allPlayers,
            updatedAt: now,
        });

        const idCounter: { nextInstanceId?: number } = {};
        const playersState = allPlayers.map((p) =>
            buildPlayerState(p, idCounter)
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

        // CR 103.5: enter the mulligan phase — declarations begin with the
        // starting player. advancePhase is deferred to finalizeMulligan.
        initialState.phase = "MULLIGAN" as Phase;
        initialState.mulligan = makeMulliganState(initialState);
        initialState.priorityPlayerId = initialState.mulligan.declaringPlayerId;

        await saveGameState(ctx, args.gameId, 0, initialState, null);
    },
});

/** #155: the caller's current active (waiting/playing) game, or null. The
 *  lobby uses this to surface an existing game instead of letting the user
 *  attempt a (rejected) second creation. */
export const myActiveGame = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        const game = await findActiveGameForUser(ctx, userId);
        if (!game) return null;
        return {
            gameId: game._id,
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
        // Delete any state snapshots first, then the orphan waiting room.
        const states = await ctx.db
            .query("game_states")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect();
        for (const s of states) await ctx.db.delete(s._id);
        await ctx.db.delete(args.gameId);
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

        const card = moveCard(
            player,
            args.cardInstanceId,
            "hand",
            "battlefield"
        );

        // CR 305.2: track the land drop. The legality check above already
        // enforces the per-turn limit; this only records the spend so the
        // next call to getLegalActions returns no "play" action.
        if (card.types.includes("Land")) {
            player.landsPlayedThisTurn = (player.landsPlayedThisTurn ?? 0) + 1;
        }

        // CR 603.6a — emit PERMANENT_ENTERED so triggered abilities
        // (e.g. Ankh of Mishra) see the land entering the battlefield.
        emitPermanentEntered(state, card);
        processPendingActionTriggers(state);

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
 *  additional generic cost modifier (CR 601.2f). */
function finalizeTargetSelection(
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
        assertActivationTimingLegal(state, card, ability);

        const hasXInCost =
            ability.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        const abilityChosenX = hasXInCost ? chosenX : undefined;
        if (hasXInCost && abilityChosenX === undefined) {
            throw new Error("This ability requires a chosen X value");
        }
        const manaCost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana, {
                  chosenX: abilityChosenX,
              })
            : undefined;
        if (manaCost) {
            applyCostIncrease(
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
        if (manaUncovered || ability.cost.sacrificeFilter) {
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
                ...(abilityChosenX !== undefined
                    ? { chosenX: abilityChosenX }
                    : {}),
                keepPriority,
                targets,
                ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            };
            // If mana was already covered (sacrifice-choice-only deferral),
            // commit fires once selectActivationCost sets the pickedId.
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
        if (ability.cost.sacrifice) {
            removePermanentTo(state, card.id, "graveyard");
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
    applyCostIncrease(manaCost, getCostModifiers(state, cardInHand, "spell"));

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
                cardInHand.types
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
        applyCostIncrease(
            manaCost,
            getCostModifiers(state, cardInHand, "spell")
        );

        const additionalCostSpec = cardDef.additionalCosts;
        if (additionalCostSpec?.sacrificeFilter) {
            // CR 117.9: the cast is illegal if the player can't pay the
            // additional cost. Validate up-front before entering pendingCast.
            const candidates = player.battlefield.filter((c) =>
                matchesPermanentFilter(c, additionalCostSpec.sacrificeFilter)
            );
            if (candidates.length === 0) {
                throw new Error(
                    "No legal permanent to pay the additional cost"
                );
            }
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
                additionalCost: {
                    kind: "sacrifice",
                    filter: additionalCostSpec.sacrificeFilter,
                },
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

        if (ability?.manaChoices) {
            // Choice-based source (dual lands, Birds of Paradise, Black Lotus).
            if (args.manaChoiceIndex === undefined) {
                throw new Error("Must choose a mana color");
            }
            const chosen = ability.manaChoices[args.manaChoiceIndex];
            if (!chosen) throw new Error("Invalid mana choice");

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

            card.isTapped = true;
            // CR 106.1 / 605.1a — board-conditional output (Urza trio) computed
            // from the controller's battlefield and snapshotted onto
            // `chosenMana` so untap refunds the exact amount added.
            const amount = getFixedManaAmount(
                card,
                manaColor,
                player.battlefield
            );
            if (getDynamicManaProduced(card, player.battlefield)) {
                card.chosenMana = { [manaColor]: amount } as ManaCost;
            }
            player.manaPool[manaColor] =
                (player.manaPool[manaColor] ?? 0) + amount;
            emitPermanentTapped(state, card, true, {
                [manaColor]: amount,
            } as ManaCost);
            state.pendingCast.tappedLandIds.push(card.id);
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
        if (!matchesPermanentFilter(candidate, ac.filter)) {
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
        const sources = buildAutoTapSources(player.battlefield);
        const plan = solveAutoTap(
            player.manaPool,
            pending.manaCost,
            getManaSubstitutions(state, player.id),
            sources
        );
        if (!plan) {
            throw new Error("No mana combination can pay this cost");
        }

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

        // Pool now covers the cost (the solver guarantees it) → commit.
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

/** Pick the permanent to sacrifice for an activated ability's
 *  "sacrifice a permanent matching <filter>" cost (CR 602.1 / 118.5).
 *  Mirrors selectAdditionalCost for the spell path. Commit fires via
 *  tryAutoCommitPendingActivation once both the pick and the mana are in. */
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
        const sc = pa.sacrificeChoice;
        if (!sc) {
            throw new Error("This ability has no sacrifice cost picker");
        }
        if (sc.pickedId) {
            throw new Error("Sacrifice cost already paid");
        }
        const player = getPlayer(state, args.playerId);
        const candidate = player.battlefield.find(
            (c) => c.id === args.cardInstanceId
        );
        if (!candidate) {
            throw new Error("Selected permanent not on your battlefield");
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
            // CR 611 — a continuous `permanent-guard` (Guardian Beast) may bar
            // targeting entirely. Mirror of the getLegalTargets gate. The
            // source's card types (CR 109.5) narrow source-type-filtered guards
            // (Artifact Ward's "abilities from artifact sources").
            const sourceTypes = getPendingTargetSourceTypes(
                state,
                pt.cardInstanceId,
                pt.kind ?? "cast"
            );
            if (
                isGuardedAgainst(
                    state,
                    matchedCard,
                    "cantBeTargeted",
                    sourceTypes
                )
            ) {
                throw new Error(
                    "Target can't be the target of spells or abilities"
                );
            }
        } else if (args.targetType === "player") {
            if (!wantsAny && !reqTypes.includes("player")) {
                throw new Error("Must target a permanent");
            }
            if (pt.colorFilter) {
                throw new Error("Players have no color");
            }
            const found = state.players.some((p) => p.id === args.targetId);
            if (!found) throw new Error("Invalid player target");
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

        // CR 707.10b — declining a copy-retarget is not aborting a cast: the
        // copy stays on the stack with its inherited targets and a fresh
        // priority round begins (the copying spell has already resolved).
        const wasCopyRetarget = state.pendingTarget.kind === "copy-retarget";
        state.pendingTarget = undefined;
        if (wasCopyRetarget) {
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
                        return members.some(hasBanding);
                    });
                if (state.combat.bands.length === 0) {
                    state.combat.bands = undefined;
                }
            }
        } else {
            // Select — must be eligible
            const validation = validateAttackerEligibility(
                card,
                defenderBattlefield
            );
            if (!validation.eligible) {
                throw new Error(validation.reason);
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

        const power = Math.max(0, source.power ?? 0);
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
        // CR 602.1 — enforce the controller-only default unless the ability is
        // explicitly "any player may activate". `card.controllerId` is the
        // source's controller; only that player may activate otherwise.
        if (
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
            if (
                targetHasXInCost &&
                (args.chosenX === undefined || args.chosenX < 0)
            ) {
                throw new Error("This ability requires a chosen X value");
            }
            const targetChosenX = targetHasXInCost ? args.chosenX : undefined;
            // CR 202.2 / 702.16b: the source's colors come from the
            // permanent owning the activated ability.
            const abilitySourceColors = STATIC_EFFECT_CTX.getColors(card);
            const legal = getLegalTargets(
                state,
                effectiveTargetReq,
                abilitySourceColors,
                args.playerId,
                targetChosenX,
                card.types
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
        const manaCost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana, { chosenX })
            : undefined;
        if (manaCost) {
            applyCostIncrease(
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
        if (manaUncovered || needsSacrificeChoice) {
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
                ...(ability.cost.sacrificeFilter
                    ? {
                          sacrificeChoice: {
                              filter: ability.cost.sacrificeFilter,
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
        if (ability.cost.sacrifice) {
            removePermanentTo(state, card.id, "graveyard");
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
        if (ability?.manaChoices) {
            // Choice-based mana ability (e.g. Birds of Paradise, Black Lotus)
            if (!wasTapped) {
                if (args.manaChoiceIndex === undefined) {
                    throw new Error("Must choose a mana color");
                }
                const chosen = ability.manaChoices[args.manaChoiceIndex];
                if (!chosen) throw new Error("Invalid mana choice");

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
                card.chosenMana = undefined;
                card.isTapped = false;
            }
        } else {
            // Fixed mana ability (lands, Mox, Sol Ring)
            card.isTapped = !card.isTapped;
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
                    if (isDynamic) {
                        card.chosenMana = { [manaColor]: amount } as ManaCost;
                    }
                    player.manaPool[manaColor] =
                        (player.manaPool[manaColor] ?? 0) + amount;
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
                    player.manaPool[manaColor] =
                        (player.manaPool[manaColor] ?? 0) - amount;
                    if (isDynamic) card.chosenMana = undefined;
                }
            }
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
                        v.literal("graveyard")
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
                /** Pre-seed counters (CR 122) on a battlefield permanent —
                 *  e.g. `{ "+1/+1": 3 }` for Triskelion or `{ doom: 2 }` for
                 *  Armageddon Clock. Keyed by counter type. Battlefield only. */
                counters: v.optional(v.record(v.string(), v.number())),
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

        // Clear battlefields, hands, graveyards
        p1.battlefield = [];
        p2.battlefield = [];
        p1.hand = [];
        p2.hand = [];
        p1.graveyard = [];
        p2.graveyard = [];

        // Helper to create an instance from a card name
        function makeInstance(
            cardName: string,
            controllerId: string,
            zone: "hand" | "battlefield" | "library" | "graveyard",
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

        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
    },
});
