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
// This module is also the home of the search's SHARED commit sequences (issue
// #4444): `commitCastInSearch`, `payActivationInSearch`,
// `payGrantedAbilityInSearch`, `summonCompanionInSearch`, `turnFaceUpInSearch`
// and `declineCastWindowInSearch`, plus the coarse mana model in
// `searchTapPlan.ts`. The ISMCTS applier (`applyMoveInSearch`, `search.ts`) and
// `applyMoveForSearch` below both call them, so a new cost leg is written once
// for the Bot. What stays here is only what the greedy leaf does DIFFERENTLY:
// settling the cast segment instead of handing out priority, and resolving
// combat against a shallow defender best-response.
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
//   * A cast trigger whose PLACEMENT suspends is dropped (issue #3026). Since
//     the `cast-spell` leaf started announcing through the real choke point,
//     `processPendingActionTriggers` can park a `pendingTarget` for a TARGETING
//     cast trigger, or stash two-or-more orderable ones off-stack in
//     `pendingTriggerBatch` (`gre/triggers.ts`). This sandbox answers only
//     `land-entry-tapped` choices, so such a batch never lands and the leaf
//     keeps an unanswered `pendingChoice`. Storm itself is exempt
//     (`sliceNeedsOrdering` skips engine-internal triggers) and the ISMCTS
//     sandbox is unaffected (the search enumerates `submit-target` /
//     `resolution-choice` as real decisions), so this rides the same
//     "greedy selector has no live caller" exemption as the note above.

import type {
    CardInstanceState,
    GameState,
    GrantedAbilityInstance,
    PlayerState,
    StackItem,
} from "./state";
import {
    exileCardFromGraveyard,
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
import type {
    ActivatedAbility,
    AdditionalCostSpec,
    CardDefinition,
} from "../cards/types";
import { spliceAugmentedDefinition } from "./splice";
import {
    additionalCostPaymentSnapshot,
    buildCastPermanentCostChoice,
    type KickerPayments,
} from "./kicker";
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
import {
    isPlaneswalker,
    manaGateBattlefields,
    manaValue,
    replaceProducedManaColor,
} from "./constants";
import {
    activationSacrificePayment,
    planActivationCostPicks,
} from "./activationCostPicks";
// CR 118.8 / 608.2h — the single authority that removes the chosen victims AND
// returns the snapshot-flagged one's characteristics (issue #2375).
import {
    applySacrificeSelection,
    sacrificeSnapshotFromResults,
    sacrificeSourceSnapshot,
    isSacrificeSelectionComplete,
} from "./sacrificeChoice";
import { captureNinjutsuAttackTarget } from "./ninjutsu";
import { payExertActivationCost } from "./exert";
import { applyTapPlanInSearch } from "./searchTapPlan";
import { checkStateBasedActions } from "./sba";
import { applyPlayLandFromAnyZone, finalizeLandEntry } from "./playLand";
import {
    applyAllCombatDamage,
    buildAutoDamageAssignments,
    emitAttackersDeclaredEvents,
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
import { morphTurnUpPaymentPlan } from "./morph";
import { applyCastModeCharacteristics } from "./castMode";
import { turnFaceUp } from "./faceDown";
import { COMPANION_SUMMON_COST } from "./companion";
import { spellHasDelve, delveEligibleCards, genericPortion } from "./payWith";
import { genericManaShortfall, spendGraveyardPlayPermission } from "./rules";
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
// resolvers, so the search's accept (`commitCastInSearch`) and decline
// (`declineCastWindowInSearch`) are the EXACT functions the mutations drive.
import { consumeMadnessCastChoice, declineMadness } from "./madness";
import { consumeReboundCastChoice, declineRebound } from "./rebound";
import { phyrexianPipCount } from "./phyrexian";
import { announcedModeFields } from "./modeSelection";

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
            head.landSourceZone,
            // CR 712.12 — the chosen face, as on the real submit path.
            head.landEntryFace
        );
    }
}

/** CR 702.66b / 601.2g (issue #1661) — pay a `cast-spell` search move's delve
 *  portion by exiling graveyard cards, mirroring `tryAutoCommitPendingCast`'s
 *  real-path order (`convex/gre/activation.ts`): the delve/flashback exile-cost cards
 *  move to exile BEFORE the cast card itself leaves its own zone.
 *
 *  MUST be called BEFORE `applyTapPlanInSearch` taps the move's mana sources.
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
 *  already uses for its sacrifice/tap-other costs. Called from the search's
 *  one cast commit sequence (`commitCastInSearch`, issue #4444). */
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
        applyCostModifiers(
            normCost,
            // CR 601.2a — the CASTER, explicitly (see `announcerId`).
            getCostModifiers(state, card, "spell", undefined, player.id)
        );
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
    legId: string | undefined,
    // CR 601.2b / 118.4 (issue #2714) — the announced X of a
    // `discard: { count: "X" }` additional cost. Ignored by every other leg.
    chosenX?: number
): void {
    const player = getPlayer(state, playerId);
    const card = player.hand.find((c) => c.id === cardInstanceId);
    const defId = card ? (card.card as { id?: string }).id : undefined;
    const def = defId ? tryGetDefinition(defId) : undefined;
    const spec = resolveAdditionalCosts(def?.additionalCosts, legId);
    if (!spec) return;
    // CR 601.2b (issue #2714) — an ANNOUNCED-X discard is charged even with no
    // `oneOf` leg chosen, because X is the Bot's own decision: leave it unpaid
    // and every X prices identically, so the search always announces the
    // largest one (Sickening Dreams for the whole hand, every time). Every
    // OTHER non-chosen additional cost stays this file's pre-existing and
    // separately tracked omission — widening that is not this issue's scope.
    const announcedXDiscard = spec.discard?.count === "X";
    if (!legId && !announcedXDiscard) return;
    // CR 119.4 — the life leg. SBAs run at the end of the cast-spell case.
    if (legId && spec.payLife && spec.payLife > 0) player.life -= spec.payLife;
    // CR 701.9 — the discard leg. The cast card itself is never eligible
    // (CR 601.2a): it is excluded by name here because it has not left hand yet
    // on this sandbox path.
    const handLeg = additionalCostHandLeg(spec, chosenX)?.hand;
    if (!handLeg) return;
    const eligible = player.hand.filter((c) => c.id !== cardInstanceId);
    const picks = assignMayPayHandCards(
        eligible,
        handLeg,
        eligible.map((c) => c.id)
    );
    if (!picks) return;
    for (const c of picks)
        discardToGraveyard(state, playerId, c.id, { kind: "cost" });
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
 *  Called from the search's one cast commit sequence (`commitCastInSearch`,
 *  issue #4444), so both search appliers charge it. */
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
 *  Called from the search's one cast commit sequence (`commitCastInSearch`,
 *  issue #4444), so both search appliers charge it. */
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
            // CR 608.2b — a stale Move naming a card that has since left the
            // zone charges nothing; `moveCard` THROWS on a miss, so the
            // presence check stays.
            if (!source.some((c) => c.id === id)) continue;
            // Through the general zone-mover, exactly as `tryCommitCast`
            // (`game.ts`) does on the live path — so the sandbox pays the same
            // side effects the real cast does, the CR 400.7 graveyard-departure
            // tally (issue #3240) included, rather than a hand-rolled splice
            // that has to remember each of them.
            moveCard(player, id, exileZone, "exile");
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
 *  Called from the search's one cast commit sequence (`commitCastInSearch`,
 *  issue #4444), so both search appliers charge it. */
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
        for (const c of picks ?? [])
            discardToGraveyard(state, playerId, c.id, { kind: "cost" });
    }
    return "graveyard";
}

/** CR 602.1 / 118 (issue #2155) — pay EVERY non-mana cost of an
 *  `activate-ability` move on a search sandbox state, in place.
 *
 *  Reached through `payActivationInSearch` from BOTH search appliers (issue
 *  #4444). One implementation is the point: the ISMCTS tree used to apply only
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
 *  The caller applies the MANA leg (`applyTapPlanInSearch`) itself; this covers only
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
        // so CARD_DISCARDED fires. Reachable since issue #2390 gave
        // `enumerateAbilityMoves` its hand scan; before that no enumerated move
        // arrived here, and the branch existed so the helper would pay EVERY
        // leg it can be handed rather than leaving one silently free (issue
        // #1920 review, finding 2).
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
            // CR 702.29c (issue #3118, closed here by #3206) — the cycling
            // MARKER must ride the search-side discard exactly as it rides the
            // mutation's (`activateAbilityOnState`, `convex/gre/activation.ts`). Without
            // it the ONE CARD_DISCARDED event carries no cause inside the tree,
            // so a "when you cycle this card" trigger (CR 702.29c) fires on the
            // real board and not in the Bot's search — the bot prices a cycling
            // card as a plain cantrip and never sees the trigger it is played
            // for. Latent until Decree of Silence became `cycledTrigger`'s
            // first shipped consumer; live from that card on.
            discardToGraveyard(
                state,
                handOwner.id,
                move.cardInstanceId,
                { kind: "cost" },
                handAbility.cost.cyclingCost ? "cycling" : undefined
            );
        }
        // CR 702.49a — the NINJUTSU return leg, the other board-changing cost a
        // hand-source ability can carry. Paid through the same
        // `activationSacrificePayment` → `applySacrificeSelection` pair the
        // battlefield branch below uses, so the search gives up the attacker
        // exactly as the mutation does. Left unpaid it is the failure this
        // function's own header warns about: the tree keeps a 5/4 attacking
        // AND the creature it was supposed to return, and ranks a line the
        // server would price very differently.
        if (
            handOwner &&
            handCard &&
            handAbility?.cost.returnUnblockedAttacker
        ) {
            const payment = activationSacrificePayment(
                state,
                handOwner,
                handCard,
                handAbility,
                move.costPicks
            );
            // Fail CLOSED: an incomplete selection means no legal victim was
            // available (or none was named), so the activation is one the
            // server would refuse — report it rather than buying the effect.
            if (!payment || !isSacrificeSelectionComplete(payment))
                return false;
            // CR 702.49c — capture the defender before the bounce removes the
            // returned creature from combat.
            captureNinjutsuAttackTarget(state, handCard, payment);
            applySacrificeSelection(state, payment);
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
        payRemoveCounterCost(state, src, ability.cost.removeCounter);
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
    // CR 118.1 + CR 608.2h — the source's own last-known characteristics, taken
    // BEFORE it leaves, exactly as the mutation path stamps them
    // (`sacrificeSourceSnapshot`, `gre/sacrificeChoice.ts`): without it the tree
    // pays "Sacrifice this creature" and resolves "It deals damage equal to its
    // power" for nothing (Cinder Shade, issue #1417).
    const selfSacrificeSnapshot = ability.cost.sacrifice
        ? sacrificeSourceSnapshot(state, src)
        : undefined;
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
    // CR 602.1a / 601.2h — the "Return this permanent to its owner's hand"
    // cost (Attunement): the source is off the battlefield and back in hand
    // before the ability is ever on the stack. Applied in the search slice for
    // the same reason the two legs above are — a line that kept the permanent
    // on the board would evaluate a position live play never reaches. No
    // graveyard twin to dispatch on: the leg is battlefield-source only, so
    // `src` is always the whole answer here.
    if (ability.cost.returnThisToHand) {
        removePermanentTo(state, src.id, "hand");
    }
    // CR 701.43a / 602.1a — the "Exert this permanent" leg (Arena of Glory).
    // Applied in the search slice for the same reason the legs above are: a
    // line that skipped it would score a land that untaps next turn, so the
    // Bot would take the ability for free and misprice every turn after.
    if (ability.cost.exertThis) {
        payExertActivationCost(state, src);
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
        // ONE projection, shared with the cast-side sandbox and the mutation
        // path (`sacrificeSnapshotFromResults`, `gre/sacrificeChoice.ts`).
        // This site used to hand-write its own and had already fallen a field
        // behind — issue #3806's `colors` never reached the ACTIVATION-cost
        // tree, so an ability reading the victim's colours back would have
        // discarded nothing inside it.
        const snapshot = sacrificeSnapshotFromResults(
            applySacrificeSelection(state, sacPayment)
        );
        if (out && snapshot) out.additionalSacrificeSnapshot = snapshot;
    }
    // The self-sacrifice snapshot is the LAST of the three legs to win, the
    // mutation path's `sacrifice-filter ?? exile ?? self` order — so it is
    // stamped only when the filtered leg wrote nothing, and the exile leg below
    // may still replace it.
    if (out && selfSacrificeSnapshot && !out.additionalSacrificeSnapshot)
        out.additionalSacrificeSnapshot = selfSacrificeSnapshot;
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
            (!out.additionalSacrificeSnapshot ||
                out.additionalSacrificeSnapshot === selfSacrificeSnapshot) &&
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
            // Through the shared `exileCardFromGraveyard` primitive the live
            // activation path uses (`game.ts`), so the sandbox inherits its
            // CR 608.2b miss guard and the CR 400.7 graveyard-departure tally
            // (issue #3240) instead of restating either.
            if (gyOwner) exileCardFromGraveyard(gyOwner, id);
        }
    }
    // CR 118.3 — the discard leg (Survival of the Fittest, Iron-Shield Elf).
    for (const id of picks.discardIds ?? []) {
        discardToGraveyard(state, owner.id, id, { kind: "cost" });
    }
    return true;
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

/** How a search applier wants the cast COMMITTED — the one place the greedy
 *  1-ply sandbox and the ISMCTS tree legitimately differ (issue #4444). */
export type SearchCastOptions = {
    /** CR 117.3c — the caster receives priority after casting, and the ISMCTS
     *  tree hands it over (auto-passed, so the opponent gets a real response
     *  window) BEFORE the cast is announced, in the order `commitPendingCast`
     *  (`convex/game.ts`) uses. The greedy sandbox resolves the cast segment
     *  itself straight away and leaves priority where it was. */
    handPriorityToCaster: boolean;
};

/** The search's ONE cast commit sequence (issue #4444): pay every cost leg the
 *  Move carries, move the card to the stack, stamp the stack item and announce
 *  the cast. Both search appliers call it — the ISMCTS tree
 *  (`applyMoveInSearch`, `search.ts`), the chokepoint every rollout, blade
 *  scenario and self-play game routes through, and the greedy 1-ply sandbox
 *  (`applyMoveForSearch` below). Until issue #4444 each carried its own copy of
 *  these fourteen steps, so every new cost leg was written twice for the Bot and
 *  the two drifted (issue #2473 named them "two wholesale reimplementations of
 *  build a StackItem from a cast"; the grant consumption below had reached only
 *  the greedy copy).
 *
 *  Mutates `state` in place. Returns the pushed stack item, or `null` when the
 *  Move is STALE — its source zone no longer holds the card, or a cost it names
 *  can no longer be paid — in which case nothing reaches the stack. The caller
 *  owns everything after the announcement: the tree drains auto-passes, the
 *  greedy sandbox resolves the cast segment. */
export function commitCastInSearch(
    state: GameState,
    playerId: string,
    move: Extract<Move, { kind: "cast-spell" }>,
    options: SearchCastOptions
): StackItem | null {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return null;
    // CR 702.35a / 702.88a (issue #2983) — a cast that ACCEPTS an open
    // reflexive cast window consumes that window's pending choice, in the SAME
    // two calls and the SAME order the `announceCast` mutation makes them
    // (`convex/game.ts`), and for the same reason: the choice blocks priority,
    // so leaving it in the queue would put the spell on the stack with its own
    // window still open — a position the server can never produce, in which the
    // tree would then be offered the window's candidates all over again for a
    // card that has already left exile.
    //
    // Both are no-ops unless the head choice is THIS card's window for THIS
    // player, so an ordinary cast made while some unrelated choice sits in the
    // queue is untouched.
    consumeMadnessCastChoice(state, playerId, move.cardInstanceId);
    consumeReboundCastChoice(state, playerId, move.cardInstanceId);
    // CR 702.66b / 601.2g (issue #1661) — pay the delve exile BEFORE the tap
    // plan runs (`applyDelveExileForSearch`'s forced-minimum calc needs the
    // caster's mana still untapped, mirroring the real announce-time
    // computation) and before the spell leaves its zone, in
    // `tryAutoCommitPendingCast`'s real-path order (`convex/gre/activation.ts`).
    // CR 601.3 (issue #2980) — the zone the Move DECLARES, not the hand: a
    // hand-only lookup skipped this whole pre-cast cost block for every
    // graveyard and exile cast the enumerator offers, so an escape cast's exile
    // went uncharged and the spell reached the stack for free.
    const preCastSpell = findCastSourceCard(
        state,
        player,
        move.cardInstanceId,
        move.castFromZone
    );
    if (preCastSpell) {
        applyDelveExileForSearch(state, player, preCastSpell, move.chosenX);
    }
    applyTapPlanInSearch(state, playerId, move.tapPlan);
    // CR 609.4b / 118.14 (issue #2890) — a one-shot "for one spell this turn,
    // you may spend mana as though it were mana of any type" grant (North Star)
    // is spent by a cast in the SEARCH world too. Popped unconditionally rather
    // than through the real path's "was it needed" counterfactual: the tap plan
    // is the coarse mana model (not a coin-exact pool drain), so the
    // counterfactual has nothing honest to read. Not popping it let one
    // activation fund several off-colour casts down a line and over-valued
    // North Star. (Until issue #4444 only the greedy sandbox popped it — the
    // tree, which is the one the Bot plays through, never did.)
    consumeSpellManaSubstitutionGrant(state, playerId);
    // CR 107.4f / 702.33a (issue #2081) — pay the LIFE this move chose to cover
    // with life: Phyrexian pips (2 per pip) and/or a paid Kicker's life leg
    // (`kickerLifeCost`, folded into `move.payLife` by `moves.ts` at enumeration
    // time). The mana-paid pips are already in `tapPlan`; an uncharged
    // `payLife` makes any life-paying variant free.
    if (move.payLife && move.payLife > 0) {
        player.life -= move.payLife;
    }
    // CR 601.2b / 601.2h / 118.8 — pay the CASTER-CHOSEN additional cost leg
    // this Move announced ("discard a card or pay 3 life"). Paid BEFORE the
    // spell leaves its zone, in the real commit order
    // (`finalizeTargetSelection`), because the discard leg reads the caster's
    // hand and the cast card itself is never eligible (CR 601.2a). The two legs
    // differ only in their cost, so an uncharged leg makes the choice between
    // them pure rollout noise.
    applyAdditionalCostLegForSearch(
        state,
        playerId,
        move.cardInstanceId,
        move.additionalCostLegId,
        move.chosenX
    );
    // CR 702.33a / 601.2f (issue #2081) — pay a paid Kicker's PERMANENT leg
    // (sacrifice/return) before the spell leaves its zone, for the same reason.
    // `preCastSpell` is looked up in the zone the Move DECLARES (issue #2980),
    // so this is right for whichever zone the cast actually leaves.
    if (move.kickerPayments && preCastSpell) {
        const kickerCardDef = tryGetDefinition(
            (preCastSpell.card as { id?: string }).id ?? ""
        );
        if (kickerCardDef) {
            applyKickerPermanentLegForSearch(
                state,
                playerId,
                kickerCardDef,
                move.kickerPayments
            );
        }
    }
    // CR 601.2f / 701.21 / 701.13 (issue #2135) — pay the mandatory
    // additional-cost parks (filtered sacrifice + Drought, and the exile
    // additional cost) before the spell leaves its zone. The picks ride on the
    // move (`castCostPicks`), so the search charges exactly what the executor
    // will submit.
    const castCostOut: {
        additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
    } = {};
    if (move.castCostPicks && preCastSpell) {
        const castCostsPaid = applyCastCostPicksForSearch(
            state,
            playerId,
            preCastSpell,
            tryGetDefinition((preCastSpell.card as { id?: string }).id ?? "") ??
                undefined,
            move.additionalCostLegId,
            move.castCostPicks,
            castCostOut,
            {
                castFromZone: move.castFromZone,
                chosenX: move.chosenX,
            }
        );
        // CR 702.138a escape (issue #2980) — the exile cost could not be paid
        // from the zone the Move named: a STALE Move (the graveyard changed
        // between enumeration and application). Skip it rather than put the
        // spell on the stack for free — escape exiles nothing on resolution, so
        // an uncharged escape cast is recastable forever.
        if (!castCostsPaid) return null;
    }
    // CR 702.81a (issue #2358) — a RETRACE cast leaves the GRAVEYARD, not the
    // hand, and discards a land card from hand on the way. The discard is what
    // BOUNDS the line: retrace exiles nothing, so the spell returns to the
    // graveyard on resolution (CR 608.2n) and is recastable, and only the
    // shrinking supply of lands stops the tree recasting it forever.
    const retraceZone = applyRetraceCastForSearch(
        state,
        playerId,
        move.cardInstanceId
    );
    // CR 601.3 / 400.7 (issue #2971) — the zone this cast leaves and the player
    // whose zone it is, through the shared resolver. A hard-coded `"hand"` threw
    // `Card <id> not found in hand` for every graveyard and exile cast the
    // enumerator offers, and cannot express a cross-player exile grant at all
    // (the card sits in the OPPONENT's exile). `null` = a stale Move no
    // permitted source still holds.
    const castSource = castSourceForSearch(
        state,
        player,
        move.cardInstanceId,
        move.castFromZone,
        retraceZone
    );
    if (castSource === null) return null;
    const castFromZone = castSource.zone;
    // CR 702.139 (issue #1392, Lurrus) / ADR 0093 — a once-per-turn graveyard
    // play permission is SPENT at commit by every real commit site. Read the
    // mechanism while the card is still IN the graveyard, then charge it:
    // without this the search recasts the same permanent every turn for free.
    const castMechanism =
        castFromZone === "graveyard"
            ? graveyardCastMechanism(
                  state,
                  castSource.owner,
                  castSource.owner.graveyard.find(
                      (c) => c.id === move.cardInstanceId
                  )!,
                  playerId
              )
            : undefined;
    const spellCard = removeFromZone(
        state,
        castSource.owner,
        move.cardInstanceId,
        castFromZone,
        playerId
    );
    if (castMechanism === "permission") {
        spendGraveyardPlayPermission(
            state,
            castSource.owner,
            "cast",
            spellCard
        );
    }
    const stackItem: StackItem = {
        ...spellCard,
        castById: playerId,
        ...(move.targets.length > 0 ? { targets: move.targets } : {}),
        ...(move.chosenX !== undefined ? { chosenX: move.chosenX } : {}),
        ...announcedModeFields(move),
        // CR 702.33 / 702.27a (issue #2081) — snapshot the payment record onto
        // the stack item exactly where the real commit paths snapshot it
        // (`PendingCast.kickerPayments` / `.buybackPaid` → `StackItem`), so a
        // resolving Kicker/Buyback spell reads `wasKicked` /
        // `{ additionalCostPaid }` / the Buyback return-to-hand redirect
        // correctly inside the search.
        // CR 702.33d / 702.175a (ADR 0085) — partitioned by keyword at the
        // write, exactly as the real commit paths partition it (`game.ts`).
        // CR 702.47c (issue #2394) — through the SAME splice seam the mutation
        // and the enumerator use, so the stack item carries `splicedCardIds` and
        // the resolving spell runs the merged script. Without it the search
        // would pay the splice cost the enumerator offered and then evaluate a
        // board where the spliced text never happened.
        ...additionalCostPaymentSnapshot(
            spliceAugmentedDefinition(
                tryGetDefinition((spellCard.card as { id?: string }).id ?? ""),
                castSource.owner,
                move.cardInstanceId
            ),
            move.kickerPayments
        ),
        ...(move.buybackPaid ? { buybackPaid: move.buybackPaid } : {}),
        // CR 118.8 / 608.2h — the additional-cost victim snapshot the cost
        // payment above collected, stamped exactly as `tryCommitCast` stamps
        // it, so a spell reading the victim back at resolve
        // (`getAdditionalSacrificeMv` — Metamorphosis, Sacrifice, Burnt
        // Offering) produces its real effect instead of a blank.
        ...(castCostOut.additionalSacrificeSnapshot
            ? {
                  additionalSacrificeSnapshot:
                      castCostOut.additionalSacrificeSnapshot,
              }
            : {}),
        // CR 307.1 / 117.1a / 601.3a (issue #2473) — the search never calls
        // into `game.ts`'s commit paths, so it needs its own stamp or the bot
        // simulates a game in which the flag is universally absent. Evaluated
        // immediately PRE-push, after the cost payment above, so it reads the
        // same pre-cast board the mutation path reads at announcement.
        ...(wasCastOffSorceryTiming(state, playerId)
            ? { castOffSorceryTiming: true }
            : {}),
        // CR 702.34 / 702.138 / 702.81a / 702.88a (issue #2971) — the
        // zone-dependent stack flags, read from the SAME two helpers every real
        // commit site spreads (`gre/castCost.ts`). Flashback's `exileOnResolve`
        // is the one that BOUNDS the line: without it the search models a
        // flashback card as infinitely recastable. A new mechanism added to
        // those helpers reaches the search for free.
        ...graveyardCastStackFlags(state, spellCard, castFromZone),
        ...reboundCastStackFlags(spellCard, castFromZone),
    };
    // CR 601.2b (issues #2388 / #2705 / #1964 / #2796) — the characteristics of
    // the CAST MODE the caster chose: Bestow's Aura rewrite (702.103b), Morph's
    // face-down 2/2 (702.37c), Dash's marker (702.109a) and Evoke's (702.74a),
    // through the single census (`gre/castMode.ts`). A mode left unstamped is a
    // mode the search cannot see at all — how the bot came to bestow a +1/+1
    // Aura onto the OPPONENT's creature (issue #2796).
    applyCastModeCharacteristics(state, stackItem, move.alternativeCostId);
    state.stack.push(stackItem);
    if (options.handPriorityToCaster) {
        // CR 117.3c — the caster gets priority but auto-passes it (no Ctrl), so
        // the opponent gets to respond before the spell resolves.
        state.passCount = 0;
        state.priorityPlayerId = playerId;
        state.singleShotAutoPass = playerId;
    }
    // CR 601.2i / 603.3 (issue #3026) — the SPELL_CAST choke point, in the same
    // position and the same order the mutation path puts it
    // (`commitPendingCast`, `convex/game.ts`). Reaching it is what makes
    // `spellsCastThisTurn` (Storm, ADR 0052), the caster's own per-turn tally
    // (issue #1343) and the lifetime `spellsCastThisGame` (issue #790) count in
    // the search at all, and what puts a keyword-synthesized or self-scoped
    // cast trigger on the stack ABOVE the spell (`collectCastTriggers`).
    emitSpellCastEvent(state, stackItem);
    // CR 603.3 — flush the battlefield-watching cast triggers the event just
    // queued before the caller moves on: a drain can reach two consecutive
    // passes and start resolving the very spell whose trigger has not been
    // placed yet.
    processPendingActionTriggers(state);
    return stackItem;
}

/** The search's ONE activation cost payment (issue #4444): the mana through
 *  the coarse tap plan, then every non-mana leg through
 *  `applyActivationCostsForSearch`. `false` when a leg could not be met — the
 *  helper then changed nothing beyond the taps, and the caller must not buy the
 *  ability's effect. */
export function payActivationInSearch(
    state: GameState,
    playerId: string,
    move: Extract<Move, { kind: "activate-ability" }>,
    out?: {
        additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
    }
): boolean {
    applyTapPlanInSearch(state, playerId, move.tapPlan);
    return applyActivationCostsForSearch(state, playerId, move, out);
}

/** CR 702.35a / 702.88a (issue #2983) — decline a reflexive CAST WINDOW
 *  through the SAME pure resolvers the two decline mutations drive
 *  (`declineMadness` / `declineRebound`), followed by the identical CR 117.3c
 *  priority reset those mutations perform: the reflexive ability is done, so
 *  priority returns to the ACTIVE player, not to the decliner. */
export function declineCastWindowInSearch(
    state: GameState,
    move: Extract<Move, { kind: "madness-decline" | "rebound-decline" }>
): void {
    if (move.kind === "madness-decline") {
        declineMadness(state);
    } else {
        declineRebound(state);
    }
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
}

/** CR 116.2 / 702.139a — the companion summon special action. Coarse mana
 *  model: taps a representative source set for the {3} without draining the
 *  pool coin-exact — legality (including affordability) was established by
 *  `canSummonCompanion` at enumeration time (`moves.ts`). No stack item
 *  (CR 116.2a); the caller owns the priority bookkeeping. */
export function summonCompanionInSearch(
    state: GameState,
    player: PlayerState
): void {
    const companion = player.companion;
    if (!companion || companion.used) return;
    const plan = solveSmartAutoTap(
        player.manaPool,
        COMPANION_SUMMON_COST,
        getManaSubstitutions(state, player.id),
        buildAutoTapSources(player.battlefield, manaGateBattlefields(state))
    );
    if (plan) {
        for (const step of plan) {
            const src = player.battlefield.find((c) => c.id === step.cardId);
            if (src) src.isTapped = true;
        }
    }
    player.hand.push({ ...companion.instance, zone: "hand" });
    companion.used = true;
}

/** CR 116.2b / 702.37e — the turn-face-up special action. Same coarse mana
 *  model as `summonCompanionInSearch`: legality AND affordability were
 *  established by `canTurnFaceUp` at enumeration time.
 *
 *  CR 708.8 — `turnFaceUp` mutates the permanent IN PLACE and it never
 *  re-enters the battlefield, so no ETB trigger of its own or of any other
 *  permanent fires. Structural, not a suppression flag. The caller runs SBAs:
 *  the identity swap re-seats layer 6 from the INSTANCE, and the board's own
 *  continuous effects are recomposed by that recompute tick. */
export function turnFaceUpInSearch(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): void {
    const permanent = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!permanent) return;
    const plan = morphTurnUpPaymentPlan(state, player, permanent);
    if (plan) {
        const tapped = new Set(plan.map((step) => step.cardId));
        for (const src of player.battlefield) {
            if (tapped.has(src.id)) src.isTapped = true;
        }
    }
    turnFaceUp(state, permanent);
}

/** CR 113.1b / 605.3a (issue #2903) — pay a PLAYER-level granted ability
 *  (Channel's "Pay 1 life: Add {C}.") the way the `activatePlayerAbility`
 *  mutation does, and for a MANA ability (CR 605.3b — never uses the stack)
 *  resolve it on the spot by crediting the pool. The template is a reference
 *  resolved through the card-definition lookup — there is no instance to read
 *  it off. `null` when the grant or its template is gone, or when the template
 *  carries a mana cost: a player grant's mana cost is paid from the pool and no
 *  shipped grant carries one (the enumerator skips such templates), so a
 *  hand-built move with one is refused rather than credited free mana. Nothing
 *  is paid in that case. The caller puts a non-mana ability on the stack. */
export function payGrantedAbilityInSearch(
    state: GameState,
    player: PlayerState,
    move: Extract<Move, { kind: "activate-granted-ability" }>
): {
    grant: GrantedAbilityInstance;
    template: ActivatedAbility;
} | null {
    const grant = player.grantedAbilities?.find(
        (g) => g.id === move.grantedAbilityInstanceId
    );
    const template = grant
        ? tryGetDefinition(grant.sourceCardId)?.activatedAbilities?.find(
              (a) => a.id === move.abilityId
          )
        : undefined;
    if (!grant || !template || template.cost.mana) return null;
    // CR 119.4 — the life leg, which the enumeration-time affordability gate
    // already vouched for.
    if (template.cost.life !== undefined) {
        player.life -= template.cost.life;
    }
    if (!template.useStack) {
        template.effect?.({
            addMana: (amount) => {
                // CR 614.1a (issue #3811) — the same colour replacement the
                // mutation applies.
                for (const [color, count] of Object.entries(
                    replaceProducedManaColor(state, player.id, amount)
                )) {
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
    return { grant, template };
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
        case "number-choice":
        case "random-reveal-ack":
        case "submit-target":
            // issue #2283 — a raised target submission is likewise not a 1-ply
            // material move; the ISMCTS applier (`applyMoveInSearch`,
            // search.ts) is the one that commits it through the shared
            // authority.
            // No board change worth modelling for a 1-ply leaf: passing keeps
            // the position; a mulligan / resolution-choice / may-pay /
            // land-entry / random-reveal-ack pick's value is not material here.
            //
            // The parenthetical this used to carry — "these are brain-resolved
            // and never reach the search anyway" — has been false since the
            // first candidate generator shipped, and each registered kind makes
            // it more so (issue #2996 adds `order-top`, so a `resolution-choice`
            // Move now really is enumerated while a choice is pending). It is
            // harmless HERE only because this is the greedy 1-ply sandbox
            // (`greedySelectMove`), which no production path runs: the ISMCTS
            // applier is `applyMoveInSearch` (search.ts), and THAT one applies
            // every choice answer through the real resolver. Do not copy the
            // claim; check `CHOICE_CANDIDATE_GENERATORS` instead.
            return next;

        case "madness-decline":
        case "rebound-decline":
            // CR 702.35a / 702.88a (issue #2983) — both reflexive cast windows
            // carry a candidate generator, so these Moves are really enumerated
            // while the choice is pending; a no-op would leave the choice at the
            // queue head. The shared decline (issue #4444).
            declineCastWindowInSearch(next, move);
            checkStateBasedActions(next);
            return next;

        case "play-land": {
            // Shared canonical play-land core (CR 305 / 302.6) — identical to
            // the authoritative `playCard` mutation in game.ts. See playLand.ts.
            // Routed through `applyPlayLandFromAnyZone` so an alternate-zone
            // land play the enumerator legitimately offers (a graveyard land
            // under Icetill Explorer, the top library land under Courser of
            // Kruphix) resolves here too. Hard-coding `applyPlayLand` made this
            // path throw `Card <id> not found in hand` for exactly those moves.
            // CR 712.12 — the chosen face rides the Move (ADR 0122 §2);
            // absent is `"front"`, which is every land that is not modal.
            applyPlayLandFromAnyZone(
                next,
                player,
                move.cardInstanceId,
                move.face
            );
            // CR 614.12 / ADR 0051 — a shock land suspends entry on a
            // `land-entry-tapped` pending choice. Search must not stall on it.
            autoFinalizeLandEntryChoices(next);
            return next;
        }

        case "summon-companion":
            summonCompanionInSearch(next, player);
            return next;

        case "turn-face-up":
            turnFaceUpInSearch(next, player, move.cardInstanceId);
            // CR 704.3 / 613.1f — SBAs, like every sibling branch: the identity
            // swap re-seats layer 6 from the INSTANCE, and this call's recompute
            // tick recomposes the board's continuous effects around it.
            checkStateBasedActions(next);
            return next;

        case "cast-spell": {
            // The shared commit sequence (issue #4444). This sandbox then
            // resolves the cast segment itself, so it leaves priority alone.
            const stackDepthBeforeCast = next.stack.length;
            const stackItem = commitCastInSearch(next, playerId, move, {
                handPriorityToCaster: false,
            });
            if (stackItem === null) return next;
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
                // Depth alone is the wrong bound: a cast trigger can REMOVE an
                // item that was on the stack before the cast (a storm copy of a
                // counterspell, a "whenever you cast, counter target spell"),
                // which drops the depth back to its pre-cast value while the
                // cast spell itself is still sitting there unresolved — the
                // very leaf shape this drain exists to prevent. So the cast
                // item's own presence is part of the condition.
                const castItemStillOnStack = next.stack.some(
                    (i) => i.id === stackItem.id
                );
                if (
                    next.stack.length <= stackDepthBeforeCast &&
                    !castItemStillOnStack
                ) {
                    break;
                }
                const depthBefore = next.stack.length;
                const topIdBefore = next.stack[next.stack.length - 1]?.id;
                resolveTopOfStack(next);
                // NOT `checkStateBasedActions` here, deliberately (CR 704.3).
                // SBAs are checked whenever a player WOULD receive priority, so
                // a storm-copied pinger's third copy ought to fizzle once the
                // first two killed its target (CR 608.2b) — but neither
                // `drainAutoPasses` (`gre/phases.ts`, the ISMCTS side) nor the
                // mutation path checks between two resolutions either. Running
                // them HERE alone would make this sandbox the only one of the
                // three with that timing, which is precisely the greedy-vs-
                // ISMCTS divergence this issue exists to close. Drafted as an
                // engine-wide finding instead:
                // `docs/findings/3026-sbas-not-checked-between-resolutions.md`.
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
            // Costs only (see file header): the shared payment (issue #4444),
            // without the push `applyMoveInSearch` makes (issue #1920).
            payActivationInSearch(next, playerId, move);
            checkStateBasedActions(next);
            return next;

        case "activate-granted-ability":
            // CR 113.1b / 605.3a (issue #2903) — the shared payment, which also
            // resolves a mana ability on the spot. A non-mana grant is not
            // pushed here, the same costs-only limit as `activate-ability`.
            if (!payGrantedAbilityInSearch(next, player, move)) return next;
            checkStateBasedActions(next);
            return next;

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
            // CR 508.1g / 701.43d — the optional exert costs the move chose,
            // filtered to ids actually declared. `emitAttackersDeclaredEvents`
            // below pays them and batches their triggers with the attack
            // triggers, exactly as the server's `finalizeConfirmAttackers` does.
            const exertIds = (move.exertIds ?? []).filter((id) =>
                move.attackerIds.includes(id)
            );
            next.combat = {
                attackerIds: [...move.attackerIds],
                ...(attackTargets ? { attackTargets } : {}),
                ...(exertIds.length > 0 ? { exertedIds: exertIds } : {}),
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
            // CR 508.1m (issue #3222) — the attack triggers, then a bounded
            // drain of the segment they created, so the defender's best
            // response and the leaf `evaluate` both see the board the attack
            // actually produces (battle cry's pump, exalted's, annihilator's
            // sacrifice). Same shape as the cast-segment drain above: bounded,
            // and it stops on the first pass that makes no progress, so a
            // resolution suspended on a PendingChoice cannot spin — a
            // suspending attack trigger is simply left unresolved, the same
            // documented limit the cast leg carries.
            emitAttackersDeclaredEvents(next);
            for (let step = 0; step < MAX_CAST_RESOLUTION_STEPS; step++) {
                if (next.stack.length === 0) break;
                if ((next.pendingChoices?.length ?? 0) > 0) break;
                // CR 603.3d (PR review) — a TARGETED attack trigger is parked
                // by `raiseTriggerTargetSelection` with the item still ON the
                // stack and `pendingTarget` set. Resolving it here would
                // resolve it with no target chosen; stopping leaves the leaf
                // honestly unresolved, the same shape the `pendingChoices`
                // break above leaves.
                if (next.pendingTarget) break;
                const depthBefore = next.stack.length;
                const topIdBefore = next.stack[next.stack.length - 1]?.id;
                resolveTopOfStack(next);
                if (
                    next.stack.length === depthBefore &&
                    next.stack[next.stack.length - 1]?.id === topIdBefore
                ) {
                    break;
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
