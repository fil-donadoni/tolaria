// Pure macro-move simulation for the vs-AI Bot's greedy search (ADR 0001,
// issue #111).
//
// `applyMoveForSearch(state, playerId, move)` returns a NEW GameState in which
// `move` has been played out to a stable, comparable point — the leaf the
// greedy selector (`greedySelectMove`) hands to `evaluate`. It reuses the real
// GRE resolution primitives (no second/approximate engine, ADR 0001): a spell
// goes on the stack and resolves through `resolveTopOfStack`; combat damage is
// applied through the same `applyAllCombatDamage` the phase machine uses. The
// input state is never mutated — it is cloned first via `cloneGameState`.
//
// Combat needs an opponent reply to be meaningful (a lone attack into a wall is
// only "suicidal" once the defender blocks). So a `declare-attackers` move is
// resolved through a SHALLOW defender best-response: the opponent picks, from
// its real legal blocker set, the block that minimises the bot's evaluation,
// then combat damage is applied. This is the one place the 1-ply selector looks
// past its own move; full game-tree search (instant responses, multi-step
// combat) is deferred to ISMCTS (issue #112).
//
// Known, documented simulation limits for this slice (the server stays the sole
// authority, so an inexact sandbox only costs move quality, never legality):
//   * Mana is modelled as tapping the planned sources; the pool is not drained
//     coin-exact (eval only reads available-mana coarsely).
//   * `activate-ability` applies its costs but does NOT resolve the ability's
//     effect. The original note here claimed the greedy selector therefore
//     never *prefers* such an activation — that stopped being true when
//     loyalty abilities became enumerable (issue #2491): a `+N` loyalty cost
//     is a board GAIN, so the sandbox pays it, skips the payoff, and still
//     scores the leaf above `pass`. The reason this is a documented limit
//     rather than a bug is that the path is DEAD in production —
//     `greedySelectMove` (`gre/greedy.ts`) has no live caller, the Brain
//     (`src/lib/ai/brain-request.ts`) runs `searchWithTrace`, and the ISMCTS
//     sandbox `applyMoveInSearch` (`gre/search.ts`) does push the ability so
//     its payoff and its price are scored together (issue #1920). Anything
//     that revives the greedy selector owes this leg the same push.
//   * Single-block only, matching `enumerateMoves`' single-block scope.

import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./state";
import {
    removeFromZone,
    removePermanentTo,
    resolveTopOfStack,
    getOpponentId,
    tapPermanent,
    canPayMayPayCost,
    discardToGraveyard,
    payExileThisCost,
    moveCard,
    normalizeManaCost,
    applyCostModifiers,
    getCostModifiers,
    payRemoveCounterCost,
    payDiscardLastDrawn,
    payDiscardAtRandomCost,
    canPayRemoveCounterCost,
    canPayLifeCost,
    canPayDiscardLastDrawn,
    canPayDiscardAtRandom,
    assignMayPayHandCards,
    getPlayer,
    emitSpellCastEvent,
    processPendingActionTriggers,
} from "./state";
import {
    additionalCostHandLeg,
    resolveAdditionalCosts,
} from "./additionalCost";
import type { AdditionalCostSpec, CardDefinition } from "../cards/types";
import { buildCastPermanentCostChoice, type KickerPayments } from "./kicker";
import { completeSacrificeSelection } from "./paymentPicks";
import { applyCastSacrificeVictims, type CastCostPicks } from "./castCostPicks";
import { cheapestFirst } from "./paymentPicks";
// CR 613.1f (issue #1920 review, finding 4) — the POST-LAYER ability set, the
// same authority the search's push gate reads (`effectiveAbilityOf`). Two
// different answers to "which ability is this" is how an ability gets pushed
// and resolved with its costs unpaid.
import { effectiveAbilityOf } from "./ai/abilityTiming";
// CR 606 (issue #2491) — the shared loyalty authority, so the search pays the
// signed loyalty leg exactly as the mutation's commit sites do.
import { loyaltyActivationViolation, payLoyaltyCost } from "./loyalty";
import { isPlaneswalker, manaGateBattlefields, manaValue } from "./constants";
import {
    activationSacrificePayment,
    planActivationCostPicks,
} from "./activationCostPicks";
// CR 118.8 / 608.2h — the single authority that removes the chosen victims AND
// returns the snapshot-flagged one's characteristics (issue #2375).
import { applySacrificeSelection } from "./sacrificeChoice";
import { checkStateBasedActions } from "./sba";
import { applyBestowCharacteristics } from "./bestow";
import { applyPlayLandFromAnyZone, finalizeLandEntry } from "./playLand";
import {
    applyAllCombatDamage,
    buildAutoDamageAssignments,
    wasCastOffSorceryTiming,
} from "./phases";
import {
    markAttacking,
    markDeclaredBlockers,
    recordAttackerDeclared,
} from "./combat";
import { recordBlockedAttackers } from "./banding";
import { cloneGameState } from "./clone";
import { hasRetrace, RETRACE_COST_LEGS } from "./retrace";
import { enumerateMoves, type Move } from "./moves";
import { evaluate } from "./evaluate";
import { tryGetDefinition, getInstanceManaCost } from "../cards";
import {
    consumeSpellManaSubstitutionGrant,
    getManaSubstitutions,
} from "./state";
import { buildAutoTapSources, solveSmartAutoTap } from "./autoTap";
import { isMorphCastId, morphTurnUpPaymentPlan } from "./morph";
import { turnFaceDown, turnFaceUp } from "./faceDown";
import { COMPANION_SUMMON_COST } from "./companion";
import { spellHasDelve, delveEligibleCards, genericPortion } from "./payWith";
import { genericManaShortfall, markGraveyardPermanentCastUsed } from "./rules";
import {
    buildCastExileCostChoice,
    castSourceForSearch,
    findCastSourceCard,
    graveyardCastMechanism,
    graveyardCastStackFlags,
    reboundCastStackFlags,
} from "./castCost";
import type { CastFromZone } from "./castCost";
// CR 702.35a / 702.88a-c (issue #2983) — the reflexive cast windows' own pure
// resolvers, so this sandbox's accept and decline are the EXACT functions the
// mutations drive, matching `applyMoveInSearch` (search.ts).
import { consumeMadnessCastChoice, declineMadness } from "./madness";
import { consumeReboundCastChoice, declineRebound } from "./rebound";
import { phyrexianPipCount } from "./phyrexian";

/** CR 614.12 / ADR 0051 — drain every pending stackless `land-entry-tapped`
 *  pay-choice (a shock land played OR put onto the battlefield by an effect)
 *  with the ADR 0016 minimal-legal default: pay iff affordable (life ≥ cost),
 *  else enter tapped. Keeps the 1-ply search leaf deterministic and never
 *  stalled — a rollout can't interactively answer a choice. Uses each choice's
 *  own `playerId` (the entering land's controller), which for a reanimation may
 *  differ from the acting player. */
function autoFinalizeLandEntryChoices(state: GameState): void {
    while (true) {
        const head = state.pendingChoices?.[0];
        if (
            head?.kind !== "land-entry-tapped" ||
            !head.landInstanceId ||
            !head.cost
        ) {
            break;
        }
        const accept = canPayMayPayCost(state, head.playerId, head.cost);
        state.pendingChoices =
            state.pendingChoices!.length > 1
                ? state.pendingChoices!.slice(1)
                : undefined;
        finalizeLandEntry(
            state,
            head.playerId,
            head.landInstanceId,
            head.cost,
            accept,
            head.landSourceZone
        );
    }
}

/** CR 702.66b / 601.2g (issue #1661) — pay a `cast-spell` search move's delve
 *  portion by exiling graveyard cards, mirroring `tryAutoCommitPendingCast`'s
 *  real-path order (`convex/game.ts`): the delve/flashback exile-cost cards
 *  move to exile BEFORE the cast card itself leaves its own zone.
 *
 *  MUST be called BEFORE `applyTapPlan` taps the move's mana sources.
 *  `genericManaShortfall` (below) reads the caster's CURRENTLY UNTAPPED mana
 *  to decide the forced-minimum delve count, exactly like the real
 *  announce-time computation (`buildDelveExileChoice` in `game.ts`, called
 *  before any land is tapped) — calling this after the tap plan already ran
 *  would see zero untapped mana, read the coloured pip as uncoverable, and
 *  silently no-op the whole delve payment (caught by this fix's own test).
 *
 *  `enumerateMoves` (`moves.ts:599-623`) already discounts the move's
 *  `tapPlan` by the number of FORCED delve exiles when it builds this move
 *  (the same `genericManaShortfall` computation below, mirrored here rather
 *  than carried on `Move` — `moves.ts` is out of scope for this fix, owned in
 *  parallel by issue #1663). Without this, a search leaf that only replays
 *  `tapPlan` evaluates a delve cast as costing NOTHING from the graveyard:
 *  Treasure Cruise gets systematically over-rated and a later graveyard-cost
 *  play walked by the SAME rollout (escape, flashback, another delve cast)
 *  can illegally reuse graveyard cards that were already spent.
 *
 *  The search leaf has no player to consult for WHICH cards to delve (unlike
 *  the real path's `exileFromGraveyardChoice.pickedCardIds`, a genuine
 *  tactical choice), so it exiles the first N eligible cards — a conservative
 *  deterministic pick, the same policy this file's `activate-ability` case
 *  already uses for its sacrifice/tap-other costs. Shared by both search
 *  leaves that replay a `cast-spell` move (`applyMove.ts`'s own
 *  `applyMoveForSearch` and `search.ts`'s `applyMoveInSearch`) since they
 *  duplicate the same tap-plan-only cast-spell shape. */
export function applyDelveExileForSearch(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    chosenX: number | undefined
): void {
    if (!spellHasDelve(card)) return;
    const delveFuel = delveEligibleCards(player, card.id).length;
    if (delveFuel === 0) return;
    const rawCost = getInstanceManaCost(card) ?? {};
    const normCost = normalizeManaCost(rawCost, { chosenX: chosenX ?? 0 });
    // Cost modifiers (CR 601.2f) apply before the delve offset, mirroring the
    // enumerator; skipped for a Phyrexian-mana spell (same carve-out as
    // `enumerateSpellMoves`, moves.ts:582 — no shipped card combines the two).
    if (phyrexianPipCount(rawCost) === 0) {
        applyCostModifiers(normCost, getCostModifiers(state, card, "spell"));
    }
    const shortfall = genericManaShortfall(player, card, normCost, state);
    const delveCount = Math.min(
        delveFuel,
        genericPortion(normCost),
        Number.isFinite(shortfall) ? shortfall : 0
    );
    if (delveCount <= 0) return;
    // CHEAPEST FIRST, matching `castExileViewFor` + `chooseCastExileCost`
    // (`gre/paymentPicks.ts`) — the pair the LIVE bot answers the delve park
    // with. Both were raw graveyard order until issue #2980 reordered the live
    // one; leaving this in zone order would have the tree model a different
    // post-cast graveyard than the bot actually produces, and which cards leave
    // is observable (threshold, delirium, escape fodder, a graveyard-counting
    // CDA).
    for (const c of cheapestFirst(delveEligibleCards(player, card.id)).slice(
        0,
        delveCount
    )) {
        moveCard(player, c.id, "graveyard", "exile");
    }
}

/** CR 601.2b / 601.2h / 118.8 — pay the CASTER-CHOSEN additional-cost leg a
 *  `cast-spell` move announced, on a search sandbox state, in place.
 *
 *  Same reason `applyDelveExileForSearch` above exists: a cost the search tree
 *  does not charge is a cost the Bot values at zero. Bitter Triumph's two legs
 *  differ ONLY in what they cost (a card from hand vs 3 life) — leave them
 *  unpaid and the two Moves are indistinguishable and the pick is rollout
 *  noise, which is the whole decision this issue exists to make real.
 *
 *  WHICH card pays the discard leg is chosen by the SAME assignment authority
 *  the real path uses (`assignMayPayHandCards`, shared with the picker, the
 *  submit boundary and `paymentPicks.ts`'s bot realisation), fed the sandbox's
 *  own hand-order preference — so the search charges a legal payment rather
 *  than a summed count. No-op for a card with no `oneOf`; the leg's own
 *  sacrifice/exile shapes are not applied here, matching this file's
 *  pre-existing (and separately tracked) omission of the non-chosen additional
 *  costs — no shipped `oneOf` leg carries one. */
export function applyAdditionalCostLegForSearch(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    legId: string | undefined
): void {
    if (!legId) return;
    const player = getPlayer(state, playerId);
    const card = player.hand.find((c) => c.id === cardInstanceId);
    const defId = card ? (card.card as { id?: string }).id : undefined;
    const def = defId ? tryGetDefinition(defId) : undefined;
    const spec = resolveAdditionalCosts(def?.additionalCosts, legId);
    if (!spec) return;
    // CR 119.4 — the life leg. SBAs run at the end of the cast-spell case.
    if (spec.payLife && spec.payLife > 0) player.life -= spec.payLife;
    // CR 701.9 — the discard leg. The cast card itself is never eligible
    // (CR 601.2a): it is excluded by name here because it has not left hand yet
    // on this sandbox path.
    const handLeg = additionalCostHandLeg(spec)?.hand;
    if (!handLeg) return;
    const eligible = player.hand.filter((c) => c.id !== cardInstanceId);
    const picks = assignMayPayHandCards(
        eligible,
        handLeg,
        eligible.map((c) => c.id)
    );
    if (!picks) return;
    for (const c of picks) discardToGraveyard(state, playerId, c.id);
}

/** CR 702.33a / 601.2f (issue #2081) — pay a `cast-spell` move's paid Kickers'
 *  PERMANENT leg on a search sandbox state, in place: sacrifice or return,
 *  picked deterministically CHEAPEST-FIRST via `completeSacrificeSelection` —
 *  the SAME conservative policy the live owed-payment seam uses to answer the
 *  real `sacrificeSelection` park a Kicker's permanent leg ALWAYS raises
 *  (ADR 0079/0091) — so a search-tree kicker cast values the same class of
 *  payment a live game would make.
 *
 *  Neither the MANA leg nor the LIFE leg is paid here: `moves.ts` folds the
 *  mana leg into the Move's `tapPlan` (`foldKickerCosts`) and the life leg
 *  into `payLife` (`kickerLifeCost`) at enumeration time, and BOTH cast-spell
 *  cases already deduct `move.payLife` unconditionally — the same field
 *  Phyrexian mana already rode on, so the Kicker life leg reuses that seam
 *  rather than adding a second one.
 *
 *  No HAND leg branch: `enumerateKickerVariants` (`gre/kicker.ts`) never
 *  enumerates a hand-leg Kicker combo (fail CLOSED — no shipped Kicker
 *  carries one), so `payments` reaching this function never names one; a
 *  future hand-leg Kicker card must extend the enumerator's bound before this
 *  needs to grow a branch for it.
 *
 *  Shared by BOTH move-application sandboxes — `applyMoveForSearch` below and
 *  `applyMoveInSearch` (`search.ts`) — for the same reason
 *  `applyRetraceCastForSearch` is: a cost charged in one tree and not the
 *  other is a divergence between the greedy selector and ISMCTS. */
export function applyKickerPermanentLegForSearch(
    state: GameState,
    playerId: string,
    cardDef: CardDefinition,
    payments: KickerPayments | undefined
): void {
    if (!payments) return;
    // CR 701.21 / 400.7 — the permanent leg(s): sacrifice or return, picked
    // cheapest-first. `enumerateKickerVariants` already confirmed
    // enough DISTINCT matching permanents exist (`canPayKickerLegs` →
    // `canAffordCostLegsPermanents`), so `completeSacrificeSelection` should
    // always resolve; the `if (picked)` guard is defence in depth only, never
    // expected to trip on a Move this sandbox itself enumerated.
    const permSel = buildCastPermanentCostChoice(
        state,
        playerId,
        undefined,
        cardDef,
        payments,
        cardDef.name ?? "Kicker"
    );
    if (!permSel) return;
    const picked = completeSacrificeSelection(state, permSel);
    if (!picked) return;
    for (const id of picked) {
        if (permSel.action === "sacrifice") {
            removePermanentTo(state, id, "graveyard", "sacrifice");
        } else {
            removePermanentTo(state, id, "hand");
        }
    }
}

/** CR 601.2f / 701.21 / 701.13 (issue #2135) — pay a `cast-spell` move's
 *  MANDATORY additional-cost parks on a search sandbox state, in place: the
 *  filtered sacrifice (the card's own `additionalCosts.sacrificeFilter` plus
 *  Drought's board-wide static sacrifice) and the exile additional cost (Soul
 *  Exchange).
 *
 *  Same reason `applyDelveExileForSearch` / `applyAdditionalCostLegForSearch`
 *  exist: a cost the search tree does not charge is a cost the Bot values at
 *  zero — a Natural Order cast was valued as free removal while the sacrifice
 *  it must make never happened in the tree. WHICH card pays rides on the move
 *  (`castCostPicks`, `gre/castCostPicks.ts`), chosen deterministically
 *  cheapest-first (K=1, `gre/parkKinds.ts`), and this applies exactly the cards
 *  `executor.ts` will name to `selectSacrifice` / `selectAdditionalCost` — the
 *  search and live play agree by construction rather than by parallel
 *  maintenance.
 *
 *  Shared by BOTH move-application sandboxes — `applyMoveForSearch` below and
 *  `applyMoveInSearch` (`search.ts`) — for the same reason
 *  `applyRetraceCastForSearch` is: a cost charged in one tree and not the
 *  other is a divergence between the greedy selector and ISMCTS. */
export function applyCastCostPicksForSearch(
    state: GameState,
    playerId: string,
    card: CardInstanceState,
    cardDef: CardDefinition | undefined,
    chosenLegId: string | undefined,
    picks: CastCostPicks | undefined,
    costOut?: {
        additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
    },
    /** CR 601.3 / 702.34 (issue #2980) — the zone this cast leaves, and the X
     *  it announced. Only a `"graveyard"` cast owes the flashback sacrifice leg
     *  and the escape / flashback EXILE leg, so a hand cast of the same card is
     *  charged exactly what it was before; `chosenX` sizes the one X-dependent
     *  leg (`flashbackExileFromGraveyard`). */
    opts?: { castFromZone?: CastFromZone; chosenX?: number }
): boolean {
    if (!picks) return true;
    const castFromZone = opts?.castFromZone ?? "hand";
    const player = getPlayer(state, playerId);
    const spec = resolveAdditionalCosts(cardDef?.additionalCosts, chosenLegId);
    // CR 702.138a / 702.34a / 118.8 — VALIDATED FIRST, applied last: every id
    // the Move named must still be in the zone it was picked from, or this Move
    // is stale and the caller must skip it rather than put the spell on the
    // stack for free. That matters far more here than for the sacrifice legs,
    // because escape (unlike flashback) exiles nothing on resolution: an
    // uncharged escape cast is recastable from the graveyard forever, the
    // unbounded-recast shape the retrace land discard exists to bound. Checked
    // before THIS function mutates anything, so a refusal never leaves a
    // half-paid cost behind here. It is NOT a whole-move rollback: by the time
    // this runs the caller has already applied the tap plan, the life payment,
    // the chosen additional-cost leg and the Kicker permanent leg, and the
    // caller's bail keeps those — the same shape the pre-existing
    // `castSource === null` bail below already has.
    const exileIds = picks.exileCostCardIds ?? [];
    const exileZone =
        exileIds.length > 0
            ? castExileSourceZone(
                  state,
                  player,
                  card,
                  castFromZone,
                  spec,
                  opts?.chosenX
              )
            : undefined;
    if (exileIds.length > 0) {
        if (!exileZone) return false;
        const held = exileZone === "hand" ? player.hand : player.graveyard;
        if (!exileIds.every((id) => held.some((c) => c.id === id))) {
            return false;
        }
    }
    // CR 701.21 — the sacrifice victims: the ones the server auto-resolves at
    // announcement (fungible board) PLUS the ones the payer names. Both leave
    // the battlefield; `picks.sacrificeIds` alone is the submission list, not
    // the payment. CR 118.8 / 608.2h — the snapshot-flagged victim's mv /
    // subtypes / power come back through `costOut` so the caller can stamp them
    // onto the pushed stack item, exactly as `tryCommitCast` does: without it
    // every card that reads the victim back (`getAdditionalSacrificeMv` —
    // Metamorphosis, Sacrifice, Burnt Offering) resolves for NOTHING in the
    // tree, so the search pays a creature and a card for a blank and can never
    // find the ritual line.
    const sacSnapshot = applyCastSacrificeVictims(
        state,
        player,
        card,
        spec,
        picks,
        cardDef?.name ?? "Sacrifice",
        castFromZone
    );
    if (costOut && sacSnapshot) {
        costOut.additionalSacrificeSnapshot = sacSnapshot;
    }
    // CR 701.13 — the exile additional cost (Soul Exchange), whose exiled
    // permanent snapshots into the SAME stack-item field and OVERWRITES the
    // sacrifice one when both are present — the ordering `tryCommitCast` uses
    // (`convex/game.ts`), mirrored here so the two paths cannot diverge.
    if (picks.additionalCostCardId) {
        const exiled = player.battlefield.find(
            (c) => c.id === picks.additionalCostCardId
        );
        if (costOut && exiled) {
            const exDefId = (exiled.card as { id?: string }).id;
            const exDef = exDefId ? tryGetDefinition(exDefId) : undefined;
            costOut.additionalSacrificeSnapshot = {
                cardInstanceId: exiled.id,
                mv: manaValue(exDef?.manaCost),
                ...(exiled.subtypes && exiled.subtypes.length > 0
                    ? { subtypes: [...exiled.subtypes] }
                    : {}),
            };
        }
        removePermanentTo(state, picks.additionalCostCardId, "exile");
    }
    // CR 702.138a escape / 702.34a / 118.8 — the exile cost itself: the named cards
    // move graveyard (or hand) → exile, exactly as `tryCommitCast` moves them
    // once `selectCastExileCost` has recorded the same ids.
    if (exileIds.length > 0 && exileZone) {
        const source = exileZone === "hand" ? player.hand : player.graveyard;
        for (const id of exileIds) {
            const idx = source.findIndex((c) => c.id === id);
            if (idx === -1) continue;
            const [moved] = source.splice(idx, 1);
            player.exile.push(moved);
        }
    }
    return true;
}

/** CR 702.34a / 702.138a escape — which of the caster's OWN zones a cast's exile cost
 *  is paid from: `"hand"` for the flashback exile-from-hand leg, `"graveyard"`
 *  for every other shape. Re-derived from the ONE builder the announcement and
 *  the enumerator both read (`buildCastExileCostChoice`) rather than stored on
 *  the Move, so the sandbox can never disagree with the picker the server parks
 *  on about where the cards come from. `undefined` when the cast owes no exile
 *  cost at all — a stale Move, which the caller skips. */
function castExileSourceZone(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    castFromZone: CastFromZone,
    spec: AdditionalCostSpec | undefined,
    chosenX: number | undefined
): "graveyard" | "hand" | undefined {
    const build = buildCastExileCostChoice(state, player, card, castFromZone, {
        additionalCosts: spec,
        chosenX,
    });
    if (!build || "unpayable" in build) return undefined;
    return build.choice.zone ?? "graveyard";
}

/** CR 702.81a (issue #2358) — is this `cast-spell` move a RETRACE cast, and if
 *  so charge its additional cost on a search sandbox state, in place.
 *
 *  Returns the zone the spell leaves from (`"graveyard"`) so the caller can
 *  route `removeFromZone` and stamp `castFromGraveyard`; `undefined` for every
 *  other cast, leaving the caller's hand/library logic untouched.
 *
 *  Charging the discard here is not an accuracy nicety, it is what TERMINATES
 *  the line. CR 702.81a exiles nothing, so a retraced instant or sorcery is put
 *  back into its owner's graveyard as it finishes resolving (CR 608.2m) and is
 *  immediately castable again; the only thing that stops the search re-casting
 *  it at every node is the land card each cast destroys. A sandbox that skipped
 *  the discard would model an unbounded free recast loop and value it
 *  accordingly.
 *
 *  Shared by BOTH move-application sandboxes — `applyMoveForSearch` below and
 *  `applyMoveInSearch` (`search.ts`) — because a cost charged in one tree and
 *  not the other is a divergence between the greedy selector and ISMCTS. */
export function applyRetraceCastForSearch(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): "graveyard" | undefined {
    const player = getPlayer(state, playerId);
    const card = player.graveyard.find((c) => c.id === cardInstanceId);
    if (!card || !hasRetrace(state, card)) return undefined;
    // CR 601.2a — the card being cast is in the graveyard, so no hand card is
    // ever the cast card; the exclusion is passed for symmetry with the
    // additional-cost path above.
    const handLeg = RETRACE_COST_LEGS.hand;
    if (handLeg) {
        const eligible = player.hand.filter((c) => c.id !== cardInstanceId);
        const picks = assignMayPayHandCards(
            eligible,
            handLeg,
            eligible.map((c) => c.id)
        );
        for (const c of picks ?? []) discardToGraveyard(state, playerId, c.id);
    }
    return "graveyard";
}

/** CR 602.1 / 118 (issue #2155) — pay EVERY non-mana cost of an
 *  `activate-ability` move on a search sandbox state, in place.
 *
 *  Shared by BOTH move-application sandboxes — `applyMoveForSearch` below (the
 *  greedy 1-ply selector) and `applyMoveInSearch` (`search.ts`, the ISMCTS
 *  path). One implementation is the point: the ISMCTS tree used to apply only
 *  the tap plan, so the additional costs (`cost.sacrifice`,
 *  `cost.sacrificeFilter`, `cost.tapOtherFilter`, `cost.discardFilter`,
 *  `cost.exileFromGraveyard`) were FREE in the very tree that picks the move.
 *  A cost-free activation whose payoff the search also cannot see (issue
 *  #1920) scores exactly equal to `pass` and wins on rollout noise — the bot
 *  sacrificed a land to Sylvan Safekeeper with nothing on the stack (#2422)
 *  and emptied its hand to Iron-Shield Elf's discard (#2415). Same precedent
 *  as `applyDelveExileForSearch` above.
 *
 *  WHICH cards pay is the activator's choice, so the move carries it
 *  (`costPicks`, `activationCostPicks.ts`) and this applies exactly the cards
 *  `executor.ts` will later name to the server. A hand-built move with no
 *  `costPicks` falls back to the same module's deterministic default, so the
 *  search, the greedy sandbox and the live bot can never drift.
 *
 *  `playerId` is the ACTIVATING player — the one who pays. It is deliberately
 *  a parameter rather than derived from the source permanent: CR 113.3c lets a
 *  card grant "any player may activate", in which case the ability is
 *  enumerated off the OPPONENT's battlefield (`moves.ts`) with `costPicks`
 *  built from the activator's own resources, so the source's controller is the
 *  wrong player to discard/sacrifice/tap from.
 *
 *  The caller applies the MANA leg (`applyTapPlan`) itself; this covers only
 *  what is left.
 *
 *  EVERY other leg is now paid (issue #1920 review, finding 2). `cost.life`,
 *  `cost.removeCounter`, `cost.discardLastDrawn`, `cost.discardAtRandom` and
 *  `cost.discardThis` were still free here after #2448 closed the sacrifice /
 *  tap-other / filtered-discard / graveyard-exile legs. That was a benign tie
 *  while the ability's payoff was invisible; the moment the search could SEE
 *  what an activation buys (#1920), an unpaid leg became free VALUE in the
 *  scoring leaf — the exact shape of the shipped field repros #2422 / #2415.
 *  Measured before the fix: a Thallid with three spore counters, PRECOMBAT_MAIN,
 *  200 iterations at seed 1 — `main` chose `pass`, the #1920 branch chose the
 *  activation, and the three counters were still on the card in the leaf that
 *  scored it.
 *
 *  `cost.loyalty` (CR 606.4) IS paid here as of issue #2491. It used to be the
 *  one leg exempted on the grounds that `enumerateAbilityMoves` refused loyalty
 *  abilities outright, so no move carrying one existed to pay. That
 *  justification died with the enumeration gate: a loyalty move now exists, and
 *  an unpaid loyalty leg would let the search simulate free unlimited
 *  activations — a `-6` ultimate every ply, on a walker whose counters never
 *  move and whose CR 606.3 lock is never set.
 *
 *  One leg stays out, deliberately and not as free value:
 *    * `notedManaSpent` (CR 106.10) — not a cost at all but a record OF the
 *      cost, needing a coin-exact pool delta the coarse tap-plan mana model
 *      does not produce. Documented at the search's push site. */
export function applyActivationCostsForSearch(
    state: GameState,
    playerId: string,
    move: Extract<Move, { kind: "activate-ability" }>,
    /** OUT-collector for the cost by-product the resulting stack item needs
     *  (CR 118.1 / 608.2h): the snapshot of the additional-cost VICTIM, which
     *  is gone by the time the ability resolves. Two legs fill it, the same two
     *  the mutation path fills it from and writing the same
     *  `StackItem.additionalSacrificeSnapshot` field — the single card exiled
     *  from a graveyard to pay `cost.exileFromGraveyard` (Necropolis reads it
     *  back as X) and, since issue #2375, the snapshot-flagged permanent
     *  sacrificed to pay `cost.sacrificeFilter` (Priest of Yawgmoth, Freyalise
     *  Supplicant, Broadside Bombardiers). Optional so every existing caller
     *  keeps the plain boolean contract; the search's push site
     *  (`applyMoveInSearch`, `search.ts`) passes one so the tree resolves the
     *  ability with the same numbers live play would. */
    out?: {
        additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
    }
): boolean {
    // CR 113.3c — the source may be on another player's battlefield ("any
    // player may activate"), so search globally.
    let src: CardInstanceState | undefined;
    for (const p of state.players) {
        src = p.battlefield.find((c) => c.id === move.cardInstanceId);
        if (src) break;
    }
    // CR 113.6 / 702.129a — a GRAVEYARD-source activation (Eternalize, Ashen
    // Ghoul). The source is on no battlefield, so the scan above finds
    // nothing; apply the one cost leg that changes the board here — "exile
    // this card from your graveyard" — so a search line cannot keep
    // pretending the card is still a reanimation/eternalize resource.
    if (!src) {
        const owner = state.players.find((p) =>
            p.graveyard.some((c) => c.id === move.cardInstanceId)
        );
        const gvCard = owner?.graveyard.find(
            (c) => c.id === move.cardInstanceId
        );
        const gvAbility = gvCard
            ? tryGetDefinition(
                  (gvCard.card as { id?: string }).id ?? ""
              )?.activatedAbilities?.find((a) => a.id === move.abilityId)
            : undefined;
        if (owner && gvAbility?.cost.exileThis) {
            payExileThisCost(state, owner, move.cardInstanceId, true);
        }
        // CR 113.6 / 702.29a — a HAND-source activation (Cycling, Harvester of
        // Misery's `activateFromHand` discard ability). Its one board-changing
        // cost leg is "Discard this card", paid through the shared choke point
        // so CARD_DISCARDED fires. `enumerateAbilityMoves` scans only the
        // battlefield and the graveyard, so no enumerated move reaches this
        // branch today — it is here so the helper pays EVERY leg it can be
        // handed, rather than leaving one silently free (issue #1920 review,
        // finding 2).
        const handOwner = state.players.find((p) =>
            p.hand.some((c) => c.id === move.cardInstanceId)
        );
        const handCard = handOwner?.hand.find(
            (c) => c.id === move.cardInstanceId
        );
        const handAbility = handCard
            ? tryGetDefinition(
                  (handCard.card as { id?: string }).id ?? ""
              )?.activatedAbilities?.find((a) => a.id === move.abilityId)
            : undefined;
        if (handOwner && handAbility?.cost.discardThis) {
            discardToGraveyard(state, handOwner.id, move.cardInstanceId);
        }
        return true;
    }

    // CR 613.1f — the POST-LAYER ability (finding 4): a GRANTED activated
    // ability resolves here exactly as it does at the search's push gate, so
    // the two can never disagree about which ability is being paid for.
    const ability = effectiveAbilityOf(src, move.abilityId);
    if (!ability) return false;

    // AFFORDABILITY FIRST, before a single mutation (issue #1920 review round
    // 2). The three legs below are paid by helpers that THROW when the payer is
    // short, and the round-2 version of this function guarded each one inline —
    // which turned an unpayable leg into a silently FREE one. That is a worse
    // failure than the throw it replaced: the search kept the payoff and
    // dropped the price, and (with no `removeCounter` gate in the enumerator at
    // the time) the bot ranked a Thallid activation the server rejects ABOVE
    // `pass`.
    //
    // A payer that cannot pay must SAY SO and change nothing — never continue.
    // The caller declines to push on `false` (`applyMoveInSearch`,
    // `gre/search.ts`), so an unpayable activation can no longer buy its effect.
    const payer = state.players.find((p) => p.id === playerId);
    if (
        ability.cost.removeCounter &&
        !canPayRemoveCounterCost(src, ability.cost.removeCounter)
    ) {
        return false;
    }
    if (
        ability.cost.life !== undefined &&
        (!payer || !canPayLifeCost(payer, ability.cost.life))
    ) {
        return false;
    }
    if (
        ability.cost.discardLastDrawn &&
        (!payer || !canPayDiscardLastDrawn(payer))
    ) {
        return false;
    }
    // CR 118.3 — the leg whose payer CLAMPS instead of throwing, so it needs
    // the report even more than its siblings: without it the helper paid
    // nothing, returned true, and the push proceeded on a server-illegal move.
    if (
        ability.cost.discardAtRandom &&
        (!payer || !canPayDiscardAtRandom(payer))
    ) {
        return false;
    }
    // CR 606.3 / 606.6 (issue #2491) — the LOYALTY leg's affordability, through
    // the same authority the enumerator and the mutation read. Fail-closed
    // backstop for the hand-built moves this exported function also accepts
    // (tests, blade setup steps): `enumerateAbilityMoves` already refuses an
    // illegal loyalty activation, so a legal search line never reaches here
    // with a violation. Reported rather than skipped, exactly as its siblings
    // above are — a skipped loyalty leg is a FREE ultimate in the scoring leaf.
    if (loyaltyActivationViolation(state, src, ability) !== null) {
        return false;
    }

    if (ability.cost.tap) src.isTapped = true;
    // CR 606.4 (issue #2491) — put on / remove the loyalty counters the loyalty
    // symbol names and set the CR 606.3 per-permanent lock, through the SAME
    // helper the mutation's commit sites call. Without it the tree keeps the
    // ability's payoff and pays nothing: the walker's counters never move, the
    // lock is never set, and the enumerator (which reads both) offers the
    // ultimate again on the very next ply.
    payLoyaltyCost(src, ability);
    // CR 119.4 — the life leg (fetchland-style "Pay N life", Griselbrand).
    if (ability.cost.life !== undefined && payer) {
        payer.life -= ability.cost.life;
    }
    // CR 118 / 122.1c — the counter-removal leg (Thallid's three spore
    // counters), through the shared affordability authority. The payability
    // CHECK happened before any mutation (see the guard above `src.isTapped`),
    // so reaching here means the source is not short and `payRemoveCounterCost`
    // cannot throw.
    if (ability.cost.removeCounter) {
        payRemoveCounterCost(src, ability.cost.removeCounter);
    }
    // CR 118.3 — "discard the last card you drew this turn" (Jandor's Ring).
    if (ability.cost.discardLastDrawn && payer) {
        payDiscardLastDrawn(state, payer);
    }
    // CR 118.3 — the random-discard leg (Coral Helm). `payDiscardAtRandomCost`
    // clamps to hand size, so an empty hand is a no-op rather than a throw; the
    // `payer` guard is here only so an unknown `playerId` cannot reach the
    // `getPlayer` inside it, matching every sibling leg in this function.
    if (ability.cost.discardAtRandom && payer) {
        payDiscardAtRandomCost(state, playerId, ability.cost.discardAtRandom);
    }
    // CR 602.1 — sacrifice costs change the board materially, so they're
    // applied in the search slice (even though the ability's effect resolves
    // later) to keep the evaluated position honest. Self-sacrifice removes
    // the source; a FILTERED sacrifice is a named victim and rides on the
    // move with the other deferred legs below.
    if (ability.cost.sacrifice) {
        removePermanentTo(state, src.id, "graveyard", "sacrifice");
    }
    // CR 118.1 / 601.2h — the self-EXILE cost's battlefield leg (Feldon's
    // Cane): the source is gone, to exile rather than the graveyard, before the
    // ability is ever on the stack. Applied in the search slice for the same
    // reason the sacrifice leg above is — a line that kept the permanent (or
    // banked it as a graveyard resource) would evaluate a position live play
    // never reaches. The GRAVEYARD leg of the same flag is paid in the `!src`
    // branch above, where the source is not on any battlefield.
    if (ability.cost.exileThis && !ability.activateFromGraveyard) {
        removePermanentTo(state, src.id, "exile");
    }
    // CR 602.1 / 118 — the DEFERRED cost legs (sacrifice, tap-other,
    // exile-from-graveyard, discard). The payer is the ACTIVATING player, NOT
    // the source's controller — see the header note on CR 113.3c.
    const owner = state.players.find((p) => p.id === playerId);
    const picks =
        move.costPicks ??
        (owner
            ? (planActivationCostPicks(state, owner, src, ability) ?? undefined)
            : undefined);
    if (!owner) return true;
    // CR 701.21 — the filtered-sacrifice victims, both the ones the server
    // auto-resolves at announcement and the ones the payer names.
    //
    // CR 118.8 / 608.2h (issue #2375) — routed through `applySacrificeSelection`
    // rather than a bare `removePermanentTo` loop so the SNAPSHOT of the
    // snapshot-flagged victim comes back and is stamped onto `out`, exactly as
    // `sacrificeSnapshotFromSelection` does on the mutation path
    // (`convex/game.ts`). Without it the search pays a creature and then
    // resolves an ability that reads the victim back — Priest of Yawgmoth's
    // "{B} for each…", Freyalise Supplicant's "damage equal to that creature's
    // power", Broadside Bombardiers' "2 plus the sacrificed permanent's mana
    // value" — for NOTHING, so the tree scores the activation as pure loss and
    // the bot can never find the line. Same class as the exile-from-graveyard
    // snapshot below, which had already been closed.
    const sacPayment = activationSacrificePayment(
        state,
        owner,
        src,
        ability,
        picks
    );
    if (sacPayment) {
        const results = applySacrificeSelection(state, sacPayment);
        const snap = results.find((r) => r.snapshot);
        if (out && snap) {
            out.additionalSacrificeSnapshot = {
                cardInstanceId: snap.id,
                mv: snap.mv,
                ...(snap.subtypes ? { subtypes: snap.subtypes } : {}),
                ...(snap.power !== undefined ? { power: snap.power } : {}),
            };
        }
    }
    if (!picks) return true;
    for (const id of picks.tapOtherIds ?? []) {
        const perm = owner.battlefield.find((c) => c.id === id);
        if (perm) tapPermanent(state, perm);
    }
    // CR 118.5 — exile from a graveyard (Night Soil, Grim Lavamancer): the
    // cards leave the graveyard now, so a later graveyard-cost play in the
    // same rollout cannot reuse them.
    const exile = picks.exileFromGraveyard;
    if (exile) {
        const gyOwner = state.players.find(
            (p) => p.id === exile.graveyardOwnerId
        );
        // CR 118.1 / 608.2h — snapshot the single exiled card BEFORE it leaves
        // the graveyard, so the item this move pushes carries the same
        // "the exiled card's mana value" the mutation path captures
        // (`exileCostSnapshot`, `game.ts`). Single-card costs only, matching
        // that authority: "the exiled card" has no referent above one.
        //
        // The SACRIFICE leg above wins the collision (`!out.additionalSacrificeSnapshot`),
        // which is how the mutation path resolves it too — `game.ts`'s
        // `activationSacrificeSnapshot ?? activationExileSnapshot`, whose own
        // comment records the reason: adding an exile leg must never silently
        // change what an existing sacrifice-cost card (Priest of Yawgmoth,
        // Freyalise Supplicant) reads back. No shipped ability declares both,
        // so this is a latent divergence, not a live bug — but a search that
        // resolved it the other way from the server is exactly the drift this
        // whole out-collector exists to prevent.
        if (
            out &&
            !out.additionalSacrificeSnapshot &&
            exile.cardInstanceIds.length === 1
        ) {
            const snap = gyOwner?.graveyard.find(
                (c) => c.id === exile.cardInstanceIds[0]
            );
            if (snap) {
                const snapDefId = (snap.card as { id?: string }).id;
                const snapDef = snapDefId
                    ? tryGetDefinition(snapDefId)
                    : undefined;
                out.additionalSacrificeSnapshot = {
                    cardInstanceId: snap.id,
                    mv: manaValue(snapDef?.manaCost),
                    ...(snap.subtypes && snap.subtypes.length > 0
                        ? { subtypes: [...snap.subtypes] }
                        : {}),
                };
            }
        }
        for (const id of exile.cardInstanceIds) {
            const idx = gyOwner?.graveyard.findIndex((c) => c.id === id) ?? -1;
            if (!gyOwner || idx < 0) continue;
            const [card] = gyOwner.graveyard.splice(idx, 1);
            card.zone = "exile";
            gyOwner.exile.push(card);
        }
    }
    // CR 118.3 — the discard leg (Survival of the Fittest, Iron-Shield Elf).
    for (const id of picks.discardIds ?? []) {
        discardToGraveyard(state, owner.id, id);
    }
    return true;
}

/** Tap the planned mana sources on the (already cloned) state. Coarse model:
 *  a source listed in the tap plan is marked tapped so the resulting position
 *  reflects the spent mana; exact pool accounting is unnecessary for eval.
 *
 *  Issue #2420 — an `abilityId`-carrying entry ACTIVATES the source's own
 *  non-tap mana ability (Urza's `tapOtherFilter`, Farrelite Priest's pure
 *  `cost.mana`) rather than tapping the source: `cardInstanceId` itself is
 *  never tapped by this payment (CR 602.1 — Urza is never tapped by its own
 *  cost); only the permanent(s) named in `tapOtherIds`, if any, are. */
function applyTapPlan(
    state: GameState,
    playerId: string,
    tapPlan: {
        cardInstanceId: string;
        abilityId?: string;
        tapOtherIds?: string[];
    }[]
): void {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    for (const tap of tapPlan) {
        if (tap.abilityId) {
            for (const otherId of tap.tapOtherIds ?? []) {
                const other = player.battlefield.find((c) => c.id === otherId);
                if (other) other.isTapped = true;
            }
            continue;
        }
        const src = player.battlefield.find((c) => c.id === tap.cardInstanceId);
        if (src) src.isTapped = true;
    }
}

/** Resolve all combat damage for a fully-declared combat to a stable point,
 *  reusing the exact pipeline the phase machine runs (first-strike step, then
 *  regular, with SBA between/after). Single-block / no-banding positions need
 *  no manual assignment, so the auto assignments are authoritative here. */
function resolveCombatDamage(state: GameState): void {
    if (!state.combat || state.combat.attackerIds.length === 0) return;
    applyAllCombatDamage(
        state,
        buildAutoDamageAssignments(state, "first-strike"),
        "first-strike"
    );
    checkStateBasedActions(state);
    if (state.combat) {
        applyAllCombatDamage(
            state,
            buildAutoDamageAssignments(state, "regular"),
            "regular"
        );
    }
    checkStateBasedActions(state);
}

/** The defender's shallow best response to a declared attack: the legal blocker
 *  assignment that minimises the bot's post-combat evaluation. Returns the
 *  blocker→attacker pairs to apply. */
function bestDefenderBlocks(
    state: GameState,
    botId: string,
    defenderId: string
): { blockerId: string; attackerId: string }[] {
    const replies = enumerateMoves(state, defenderId).filter(
        (m): m is Extract<Move, { kind: "declare-blockers" }> =>
            m.kind === "declare-blockers"
    );
    if (replies.length === 0) return [];

    let bestScore = Infinity;
    let best = replies[0].assignments;
    for (const reply of replies) {
        const probe = cloneGameState(state);
        applyBlockAssignments(probe, reply.assignments);
        resolveCombatDamage(probe);
        const score = evaluate(probe, botId);
        if (score < bestScore) {
            bestScore = score;
            best = reply.assignments;
        }
    }
    return best;
}

function applyBlockAssignments(
    state: GameState,
    assignments: { blockerId: string; attackerId: string }[]
): void {
    if (!state.combat) return;
    const byBlocker: Record<string, string[]> = {};
    for (const { blockerId, attackerId } of assignments) {
        (byBlocker[blockerId] ??= []).push(attackerId);
    }
    state.combat.blockerAssignments = byBlocker;
    // CR 509.1a — the ONE blocker-marking chokepoint. The refresh it carries
    // is what lets `resolveCombatDamage` / `evaluate` below SEE a conditional
    // keyword grant that turns on while blocking (Snow Devil's first strike):
    // this probe never runs an SBA pass, so without it the greedy blocker
    // chooser valued every block against stale `staticAbilities` (issue #1826).
    markDeclaredBlockers(state);
    state.combat.blockersConfirmed = true;
    recordBlockedAttackers(state);
}

/** Upper bound on the resolution steps the `cast-spell` leaf drains after a
 *  cast (issue #3026). One cast can put more than one item on the stack — a
 *  storm trigger, then one copy per prior spell this turn — and each copy
 *  resolves in its own step, so the drain cannot be a single `resolveTopOfStack`
 *  any more. Generous relative to any real storm count, and a bound rather than
 *  a `while` so a card whose resolution re-pushes itself can never hang the
 *  sandbox. */
const MAX_CAST_RESOLUTION_STEPS = 64;

function findCreature(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const c = p.battlefield.find((x) => x.id === id);
        if (c) return c;
    }
    return undefined;
}

/** Simulate `move` for `playerId` on a clone of `state`, returning the resulting
 *  stable position for evaluation. Pure: `state` is not mutated. */
export function applyMoveForSearch(
    state: GameState,
    playerId: string,
    move: Move
): GameState {
    const next = cloneGameState(state);
    const player = next.players.find((p) => p.id === playerId);
    if (!player) return next;

    switch (move.kind) {
        case "pass":
        case "mulligan":
        case "mulligan-bottom":
        case "resolution-choice":
        case "may-pay":
        case "land-entry":
        case "draw-replacement":
        case "name-card":
        case "random-reveal-ack":
        case "submit-target":
            // issue #2283 — a raised target submission is likewise not a 1-ply
            // material move; the ISMCTS applier (`applyMoveInSearch`,
            // search.ts) is the one that commits it through the shared
            // authority.
            // No board change worth modelling for a 1-ply leaf: passing keeps
            // the position; a mulligan / resolution-choice / may-pay /
            // land-entry / random-reveal-ack pick's value is not material here
            // (these are brain-resolved and never reach the search anyway —
            // `enumerateMoves` returns [] while a choice is pending).
            return next;

        case "madness-decline":
        case "rebound-decline": {
            // CR 702.35a / 702.88c (issue #2983) — these two USED to sit in the
            // no-op list above, under its "never reach the search anyway"
            // reasoning. That reasoning is now false: both reflexive cast
            // windows carry a candidate generator, so `enumerateMoves` really
            // does return these Moves while the choice is pending, and a no-op
            // here would leave the choice at the queue head — the position this
            // leaf then scores is one in which the decision was never made.
            //
            // This file's standing rule is that the greedy selector and the
            // ISMCTS tree must not disagree about what a move does (issue
            // #2473), so this mirrors `applyMoveInSearch`'s branch exactly:
            // the same pure resolvers the decline mutations drive, then the
            // CR 117.3c priority reset back to the ACTIVE player.
            if (move.kind === "madness-decline") {
                declineMadness(next);
            } else {
                declineRebound(next);
            }
            next.priorityPlayerId = next.activePlayerId;
            next.passCount = 0;
            checkStateBasedActions(next);
            return next;
        }

        case "play-land": {
            // Shared canonical play-land core (CR 305 / 302.6) — identical to
            // the authoritative `playCard` mutation in game.ts. See playLand.ts.
            // Routed through `applyPlayLandFromAnyZone` so an alternate-zone
            // land play the enumerator legitimately offers (a graveyard land
            // under Icetill Explorer, the top library land under Courser of
            // Kruphix) resolves here too. Hard-coding `applyPlayLand` made this
            // path throw `Card <id> not found in hand` for exactly those moves.
            applyPlayLandFromAnyZone(next, player, move.cardInstanceId);
            // CR 614.12 / ADR 0051 — a shock land suspends entry on a
            // `land-entry-tapped` pending choice. Search must not stall on it.
            autoFinalizeLandEntryChoices(next);
            return next;
        }

        case "summon-companion": {
            // CR 116.2 / 702.139a — the companion summon special action.
            // Coarse mana model matching this file's own `play-land`/
            // `cast-spell` leaves (see header): taps a representative source
            // set for the {3} without draining the pool coin-exact — legality
            // (including affordability) was already established by
            // `canSummonCompanion` at enumeration time (moves.ts), so this
            // leaf only needs to move the position forward for evaluation.
            const companion = player.companion;
            if (companion && !companion.used) {
                const subs = getManaSubstitutions(next, playerId);
                const sources = buildAutoTapSources(
                    player.battlefield,
                    manaGateBattlefields(next)
                );
                const plan = solveSmartAutoTap(
                    player.manaPool,
                    COMPANION_SUMMON_COST,
                    subs,
                    sources
                );
                if (plan) {
                    for (const step of plan) {
                        const src = player.battlefield.find(
                            (c) => c.id === step.cardId
                        );
                        if (src) src.isTapped = true;
                    }
                }
                player.hand.push({ ...companion.instance, zone: "hand" });
                companion.used = true;
            }
            return next;
        }

        case "turn-face-up": {
            // CR 116.2b / 702.37e — the turn-face-up special action. Same
            // coarse mana model as `summon-companion` above (taps a
            // representative source set without draining the pool coin-exact):
            // legality AND affordability were already established by
            // `canTurnFaceUp` at enumeration time, so this leaf only needs to
            // move the position forward for evaluation.
            //
            // CR 708.8 — the permanent is mutated IN PLACE by `turnFaceUp` and
            // never re-enters the battlefield, so no ETB trigger of its own or
            // of any other permanent fires. That is structural, not a
            // suppression flag: there is no enter-the-battlefield path here to
            // suppress.
            const permanent = player.battlefield.find(
                (c) => c.id === move.cardInstanceId
            );
            if (permanent) {
                const plan = morphTurnUpPaymentPlan(next, player, permanent);
                if (plan) {
                    const tapped = new Set(plan.map((step) => step.cardId));
                    for (const src of player.battlefield) {
                        if (tapped.has(src.id)) src.isTapped = true;
                    }
                }
                turnFaceUp(permanent);
            }
            return next;
        }

        case "cast-spell": {
            // CR 702.35a / 702.88a (issue #2983) — a cast that ACCEPTS an open
            // reflexive cast window consumes that window's pending choice, in
            // the same two calls and the same order `announceCast` makes them
            // (convex/game.ts) and `applyMoveInSearch` mirrors. Without it this
            // leaf scores a position with the spell on the stack AND its own
            // window still open — one the server can never produce. Both are
            // no-ops unless the head choice is THIS card's window for THIS
            // player.
            consumeMadnessCastChoice(next, playerId, move.cardInstanceId);
            consumeReboundCastChoice(next, playerId, move.cardInstanceId);
            // CR 702.66b / 601.2g (issue #1661) — pay the delve exile BEFORE
            // the tap plan runs (see `applyDelveExileForSearch`'s doc — its
            // forced-minimum calc needs the caster's mana still untapped) and
            // before the spell leaves hand, mirroring
            // `tryAutoCommitPendingCast`'s real-path order.
            // CR 601.3 (issue #2980) — the zone the Move DECLARES, not the
            // hand: a hand-only lookup skipped this whole pre-cast cost block
            // for every graveyard and exile cast the enumerator offers, so an
            // escape cast's exile went uncharged and the spell reached the
            // stack for free.
            const preCastSpell = findCastSourceCard(
                next,
                player,
                move.cardInstanceId,
                move.castFromZone
            );
            if (preCastSpell) {
                applyDelveExileForSearch(
                    next,
                    player,
                    preCastSpell,
                    move.chosenX
                );
            }
            applyTapPlan(next, playerId, move.tapPlan);
            // CR 609.4b / 118.14 (issue #2890) — a one-shot "for one spell this
            // turn, you may spend mana as though it were mana of any type"
            // grant (North Star) is spent by a cast in the SEARCH world too.
            // Popped unconditionally rather than through the real path's
            // "was it needed" counterfactual: this leaf pays with the coarse
            // mana model documented in this file's header (a tap plan, not a
            // coin-exact pool drain), so the counterfactual has nothing honest
            // to read. Not popping it let one activation fund several off-colour
            // casts down a line and over-valued North Star.
            consumeSpellManaSubstitutionGrant(next, playerId);
            // CR 107.4f — pay the Phyrexian pips this move chose to cover with
            // life (2 each); the mana-paid pips are already in `tapPlan`.
            if (move.payLife && move.payLife > 0) {
                player.life -= move.payLife;
            }
            // CR 601.2b / 601.2h / 118.8 — pay the CASTER-CHOSEN additional
            // cost leg this Move announced ("discard a card or pay 3 life").
            // Paid BEFORE the spell leaves hand, mirroring the real commit
            // order (`finalizeTargetSelection`), because the discard leg reads
            // the caster's hand and the cast card itself is never eligible
            // (CR 601.2a). Without this the search values a Bitter Triumph line
            // as a free removal spell and the Bot mis-picks between its legs.
            applyAdditionalCostLegForSearch(
                next,
                playerId,
                move.cardInstanceId,
                move.additionalCostLegId
            );
            // CR 702.33a / 601.2f (issue #2081) — pay a paid Kicker's
            // PERMANENT leg (sacrifice/return) before the spell leaves its
            // zone, the same ordering `applyAdditionalCostLegForSearch` above
            // uses for the same reason. `preCastSpell` (found above, before
            // removal) is looked up in the zone the Move DECLARES since issue
            // #2980, so this no longer rests on "no shipped Kicker card is cast
            // from anywhere but hand" — it is right for whichever zone the cast
            // actually leaves.
            if (move.kickerPayments && preCastSpell) {
                const kickerCardDef = tryGetDefinition(
                    (preCastSpell.card as { id?: string }).id ?? ""
                );
                if (kickerCardDef) {
                    applyKickerPermanentLegForSearch(
                        next,
                        playerId,
                        kickerCardDef,
                        move.kickerPayments
                    );
                }
            }
            // CR 601.2f / 701.21 / 701.13 (issue #2135) — pay the mandatory
            // additional-cost parks (filtered sacrifice + Drought, and the exile
            // additional cost) before the spell leaves its zone, in the same
            // pre-removal block as the Kicker permanent leg above. The picks
            // ride on the move (`castCostPicks`), so the search charges exactly
            // what the executor will submit.
            const castCostOut: {
                additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
            } = {};
            let castCostsPaid = true;
            if (move.castCostPicks && preCastSpell) {
                castCostsPaid = applyCastCostPicksForSearch(
                    next,
                    playerId,
                    preCastSpell,
                    tryGetDefinition(
                        (preCastSpell.card as { id?: string }).id ?? ""
                    ) ?? undefined,
                    move.additionalCostLegId,
                    move.castCostPicks,
                    castCostOut,
                    {
                        castFromZone: move.castFromZone,
                        chosenX: move.chosenX,
                    }
                );
            }
            // CR 702.138a escape (issue #2980) — the exile cost could not be
            // paid from the zone the Move named: a STALE Move (the
            // graveyard changed between enumeration and application).
            // Skip it rather than put the spell on the stack for free —
            // escape exiles nothing on resolution, so an uncharged
            // escape cast is recastable forever.
            if (!castCostsPaid) return next;
            // CR 702.81a (issue #2358) — a RETRACE cast leaves the GRAVEYARD
            // and pays a discarded land on the way. Probed (and charged) before
            // the zone decision below, which knows only hand and library.
            const retraceZone = applyRetraceCastForSearch(
                next,
                playerId,
                move.cardInstanceId
            );
            // CR 601.3 / 400.7 (issue #2971) — the zone this cast leaves and
            // the player whose zone it is, through the shared resolver. This
            // leaf used to GUESS (hand, unless the id was the library top),
            // which throws `Card <id> not found in hand` for every graveyard
            // and exile cast the enumerator now offers, and cannot express a
            // cross-player exile grant at all (the card sits in the OPPONENT's
            // exile). `null` = a stale Move no permitted source still holds:
            // skip it, leaving the position unchanged, exactly as the
            // `play-land` leaf does.
            const castSource = castSourceForSearch(
                next,
                player,
                move.cardInstanceId,
                move.castFromZone,
                retraceZone
            );
            if (castSource === null) return next;
            const castFromZone = castSource.zone;
            // CR 702.139 (issue #1392, Lurrus) — the once-per-turn
            // permanent-permission cast is CONSUMED at commit by every real
            // commit site (`markGraveyardPermanentCastUsed`). Read the
            // mechanism while the card is still IN the graveyard, then charge
            // it: without this the search recasts the same permanent every turn
            // for free and prices a line that does not exist.
            const castMechanism =
                castFromZone === "graveyard"
                    ? graveyardCastMechanism(
                          next,
                          castSource.owner,
                          castSource.owner.graveyard.find(
                              (c) => c.id === move.cardInstanceId
                          )!,
                          playerId
                      )
                    : undefined;
            const spellCard = removeFromZone(
                castSource.owner,
                move.cardInstanceId,
                castFromZone
            );
            if (castMechanism === "permanent-permission") {
                markGraveyardPermanentCastUsed(next, playerId);
            }
            const stackItem: StackItem = {
                ...spellCard,
                castById: playerId,
                ...(move.targets.length > 0 ? { targets: move.targets } : {}),
                ...(move.chosenX !== undefined
                    ? { chosenX: move.chosenX }
                    : {}),
                ...(move.chosenModeId
                    ? { chosenModeId: move.chosenModeId }
                    : {}),
                // CR 702.33 / 702.27a (issue #2081) — snapshot the payment
                // record onto the stack item exactly where the real commit
                // paths snapshot it (`PendingCast.kickerPayments` /
                // `.buybackPaid` → `StackItem`), so a resolving Kicker/Buyback
                // spell reads `wasKicked` / `{ additionalCostPaid }` / the Buyback
                // return-to-hand redirect correctly inside the search.
                ...(move.kickerPayments
                    ? { kickerPayments: move.kickerPayments }
                    : {}),
                ...(move.buybackPaid ? { buybackPaid: move.buybackPaid } : {}),
                // CR 118.8 / 608.2h — the additional-cost victim snapshot, so a
                // spell that reads it back at resolve (`getAdditionalSacrificeMv`)
                // produces its real effect in the sandbox instead of a blank.
                ...(castCostOut.additionalSacrificeSnapshot
                    ? {
                          additionalSacrificeSnapshot:
                              castCostOut.additionalSacrificeSnapshot,
                      }
                    : {}),
                // CR 307.1 / 117.1a / 601.3a (issue #2473) — the bot
                // search-tree `cast-spell` executor is a wholesale
                // reimplementation of "build a StackItem from a cast", not a
                // caller of `game.ts`'s commit paths, so it needs its own
                // stamp (already silently omitted `evoked`/`dashed`/`escaped`
                // before this change — same gap, this Op closes only this
                // flag). `next` is the full post-cost-payment clone, still
                // pre-push, so `wasCastOffSorceryTiming` reads the same
                // pre-cast board state the real commit paths do.
                ...(wasCastOffSorceryTiming(next, playerId)
                    ? { castOffSorceryTiming: true }
                    : {}),
                // CR 702.34 / 702.138 / 702.81a / 702.88a (issue #2971) — the
                // zone-dependent stack flags, read from the SAME two helpers
                // every real commit site spreads (`gre/castCost.ts`), rather
                // than the single hand-written retrace flag this leaf carried
                // before. That is what makes the census complete by
                // construction: Flashback's `exileOnResolve`, Escape's
                // `escaped`, a per-card grant's exile rider, retrace's bare
                // `castFromGraveyard` and Rebound's `reboundFromHand` all
                // arrive together, and a new mechanism added to those helpers
                // reaches the sandbox for free.
                ...graveyardCastStackFlags(next, spellCard, castFromZone),
                ...reboundCastStackFlags(spellCard, castFromZone),
            };
            // CR 702.103b (issue #2388) — a BESTOW variant of this move casts
            // the card as an Aura enchantment, not as a creature. The sandbox
            // resolves the item below (`resolveTopOfStack`), so without this
            // the search would evaluate every bestow line as "a 1/1 body
            // entered" and never see the attachment or the +1/+1 it grants —
            // the two things that make the mode worth choosing. Compared by
            // reference against the definition, the same discriminator
            // `announceCast` uses.
            if (
                move.alternativeCostId !== undefined &&
                move.alternativeCostId ===
                    tryGetDefinition(
                        (spellCard.card as { id?: string }).id ?? ""
                    )?.bestow?.id
            ) {
                applyBestowCharacteristics(stackItem);
            }
            // CR 702.37c (issue #2705) — a MORPH variant of this move puts a
            // FACE-DOWN 2/2 on the stack, not the printed card: "It becomes a
            // 2/2 face-down creature card with no text, no name, no subtypes,
            // and no mana cost … Put it onto the stack (as a face-down spell
            // with the same characteristics) … When the spell resolves, it
            // enters the battlefield with the same characteristics the spell
            // had." The sandbox resolves the item immediately below, so
            // without this the search would evaluate every morph line as
            // though the real creature had entered — valuing a hidden 2/2 at
            // the price of a 4/5 flier, and never seeing that the unmorph
            // still has to be paid for.
            if (
                isMorphCastId(
                    tryGetDefinition(
                        (spellCard.card as { id?: string }).id ?? ""
                    ) ?? undefined,
                    move.alternativeCostId
                )
            ) {
                turnFaceDown(stackItem, "morph");
            }
            // CR 702.109a (issue #1964) — a DASH variant of this move must
            // stamp `dashed: true` on the resulting stack item (which rides
            // onto the entering permanent for free, the `escaped`/`evoked`
            // precedent) — otherwise `dashTrigger`'s `conditionOnSelf:
            // self.dashed === true` (`convex/cards/abilities/dash.ts`) can
            // never decide TRUE inside a search rollout, so the haste grant
            // and delayed return would never fire even though `moves.ts` now
            // enumerates the dash cast itself. Same reference-equality
            // discriminator the Bestow check above uses.
            if (
                move.alternativeCostId !== undefined &&
                move.alternativeCostId ===
                    tryGetDefinition(
                        (spellCard.card as { id?: string }).id ?? ""
                    )?.dash?.id
            ) {
                stackItem.dashed = true;
            }
            // CR 601.2i / 603.3 (issue #3026) — announce the cast through the
            // single choke point, which is what makes `spellsCastThisTurn`
            // (Storm, ADR 0052), the caster's own per-turn tally (issue #1343,
            // connive / Ledger Shredder) and the lifetime `spellsCastThisGame`
            // (issue #790) count in this sandbox at all, and what puts a
            // keyword-synthesized or self-scoped cast trigger on the stack
            // above the spell (`collectCastTriggers`). Both hand-built
            // "StackItem from a cast" reimplementations (issue #2473) pushed
            // without ever announcing, so the greedy selector and ISMCTS agreed
            // only by both being wrong: every storm spell copied zero times.
            const stackDepthBeforeCast = next.stack.length;
            next.stack.push(stackItem);
            emitSpellCastEvent(next, stackItem);
            processPendingActionTriggers(next);
            // CR 603.3b — the cast trigger now sits ABOVE the spell, and a
            // storm trigger pushes its copies when IT resolves, so the single
            // `resolveTopOfStack` this leaf used to make would resolve the
            // trigger and leave the spell itself unresolved — a leaf `evaluate`
            // cannot compare against `pass`. Drain the whole cast-induced
            // segment back to its pre-cast depth instead: that is the "stable,
            // comparable point" this sandbox's contract promises (file header).
            // Bounded, and it stops on the first pass that makes no progress so
            // a `resolveTopOfStack` suspended on a PendingChoice cannot spin.
            for (let step = 0; step < MAX_CAST_RESOLUTION_STEPS; step++) {
                if (next.stack.length <= stackDepthBeforeCast) break;
                const depthBefore = next.stack.length;
                const topIdBefore = next.stack[next.stack.length - 1]?.id;
                resolveTopOfStack(next);
                // CR 614.12 / ADR 0051 — a spell that puts a shock land onto
                // the battlefield (tutor / reanimation) enqueues a stackless
                // `land-entry-tapped` pay-choice; drain it so the search leaf
                // never stalls on a choice a rollout can't interactively
                // answer.
                autoFinalizeLandEntryChoices(next);
                const progressed =
                    next.stack.length !== depthBefore ||
                    next.stack[next.stack.length - 1]?.id !== topIdBefore;
                if (!progressed) break;
            }
            checkStateBasedActions(next);
            return next;
        }

        case "activate-ability":
            // Costs only (see file header): tap the planned mana, pay every
            // non-mana cost leg through the sandbox-shared helper
            // (`applyActivationCostsForSearch`, issue #2155), do not resolve
            // the ability's effect this slice (issue #1920).
            applyTapPlan(next, playerId, move.tapPlan);
            applyActivationCostsForSearch(next, playerId, move);
            checkStateBasedActions(next);
            return next;

        case "activate-granted-ability": {
            // CR 113.1b / 605.3a (issue #2903) — a PLAYER-level granted ability
            // (Channel's "Pay 1 life: Add {C}."). Pay the life and, for a mana
            // ability, credit the pool, mirroring `activatePlayerAbility`
            // (`convex/game.ts`). The greedy 1-ply selector has no live caller
            // (`greedySelectMove`), but this keeps the two search sandboxes
            // consistent — see the file header's note on the revived-selector
            // obligation.
            const grant = player.grantedAbilities?.find(
                (g) => g.id === move.grantedAbilityInstanceId
            );
            const template = grant
                ? tryGetDefinition(
                      grant.sourceCardId
                  )?.activatedAbilities?.find((a) => a.id === move.abilityId)
                : undefined;
            if (!template) return next;
            // Fail-closed: a player grant's MANA cost is paid from the pool and
            // no shipped player grant carries one (the enumerator skips such
            // templates), so a hand-built move with one must not be credited
            // free mana here.
            if (template.cost.mana) return next;
            if (template.cost.life !== undefined) {
                player.life -= template.cost.life;
            }
            if (!template.useStack) {
                template.effect?.({
                    addMana: (amount) => {
                        for (const [color, count] of Object.entries(amount)) {
                            if (
                                color !== "X" &&
                                typeof count === "number" &&
                                count > 0
                            ) {
                                player.manaPool[color] =
                                    (player.manaPool[color] ?? 0) + count;
                            }
                        }
                    },
                });
            }
            checkStateBasedActions(next);
            return next;
        }

        case "declare-attackers": {
            if (move.attackerIds.length === 0) return next;
            // CR 508.1a (issue #1220) — carry per-attacker planeswalker attack
            // targets, keeping only entries whose attacker is declared and whose
            // planeswalker the defender still controls.
            const defenderIdForAttack = getOpponentId(next, playerId);
            const defenderBf =
                next.players.find((p) => p.id === defenderIdForAttack)
                    ?.battlefield ?? [];
            let attackTargets: Record<string, string> | undefined;
            if (move.attackTargets) {
                const filtered: Record<string, string> = {};
                for (const [atkId, pwId] of Object.entries(
                    move.attackTargets
                )) {
                    if (
                        move.attackerIds.includes(atkId) &&
                        defenderBf.some(
                            (c) => c.id === pwId && isPlaneswalker(c)
                        )
                    ) {
                        filtered[atkId] = pwId;
                    }
                }
                if (Object.keys(filtered).length > 0) attackTargets = filtered;
            }
            next.combat = {
                attackerIds: [...move.attackerIds],
                ...(attackTargets ? { attackTargets } : {}),
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
            for (const id of move.attackerIds) {
                const atk = findCreature(next, id);
                if (!atk) continue;
                // Shared helper (`gre/combat.ts`, issue #1195) — sets BOTH
                // `combat.attackerIds` membership (already true here;
                // idempotent) AND `isAttacking` together.
                markAttacking(next, atk);
                // CR 506.3 — the shared declaration record, so this 1-ply
                // greedy sim's leaves carry the SAME "a creature attacked this
                // turn" facts the server writes. Without it the greedy
                // evaluator reads `creatureAttackedThisTurn` as unset right
                // after declaring attackers, and mis-scores every
                // "if no creatures attacked this turn" effect (issue #1944).
                recordAttackerDeclared(next, atk);
                if (!atk.staticAbilities.includes("vigilance")) {
                    // CR 708.9 / ADR 0013 — face-down attacker turns up on tap.
                    tapPermanent(next, atk);
                }
            }
            // Defender chooses blocks during DECLARE_BLOCKERS; set the phase so
            // the move enumerator surfaces the legal blocker replies.
            next.phase = "DECLARE_BLOCKERS";
            const defenderId = getOpponentId(next, playerId);
            const blocks = bestDefenderBlocks(next, playerId, defenderId);
            applyBlockAssignments(next, blocks);
            resolveCombatDamage(next);
            return next;
        }

        case "declare-blockers": {
            applyBlockAssignments(next, move.assignments);
            resolveCombatDamage(next);
            return next;
        }
    }
}
