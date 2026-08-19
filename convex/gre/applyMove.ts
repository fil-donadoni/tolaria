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
//     effect (these are rarely enumerated and never in the #111 acceptance
//     set); the bot therefore never *prefers* such an activation.
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
    exileCardFromGraveyard,
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
} from "./state";
// CR 613.1f (issue #1920 review, finding 4) — the POST-LAYER ability set, the
// same authority the search's push gate reads (`effectiveAbilityOf`). Two
// different answers to "which ability is this" is how an ability gets pushed
// and resolved with its costs unpaid.
import { effectiveAbilityOf } from "./ai/abilityTiming";
import { isPlaneswalker, manaGateBattlefields } from "./constants";
import {
    activationSacrificeVictims,
    planActivationCostPicks,
} from "./activationCostPicks";
import { checkStateBasedActions } from "./sba";
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
import { enumerateMoves, type Move } from "./moves";
import { evaluate } from "./evaluate";
import { tryGetDefinition, getInstanceManaCost } from "../cards";
import { getManaSubstitutions } from "./state";
import { buildAutoTapSources, solveSmartAutoTap } from "./autoTap";
import { COMPANION_SUMMON_COST } from "./companion";
import { spellHasDelve, delveEligibleCards, genericPortion } from "./payWith";
import { genericManaShortfall } from "./rules";
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
            accept
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
    for (const c of delveEligibleCards(player, card.id).slice(0, delveCount)) {
        moveCard(player, c.id, "graveyard", "exile");
    }
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
 *  Two legs stay out, both deliberately and neither of them free value:
 *    * `cost.loyalty` (CR 606.5) — `enumerateAbilityMoves` refuses loyalty
 *      abilities outright, so no move carrying one exists to pay.
 *    * `notedManaSpent` (CR 106.10) — not a cost at all but a record OF the
 *      cost, needing a coin-exact pool delta the coarse tap-plan mana model
 *      does not produce. Documented at the search's push site. */
export function applyActivationCostsForSearch(
    state: GameState,
    playerId: string,
    move: Extract<Move, { kind: "activate-ability" }>
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
            exileCardFromGraveyard(owner, move.cardInstanceId);
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

    if (ability.cost.tap) src.isTapped = true;
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
    for (const id of activationSacrificeVictims(
        state,
        owner,
        src,
        ability,
        picks
    )) {
        removePermanentTo(state, id, "graveyard", "sacrifice");
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
 *  reflects the spent mana; exact pool accounting is unnecessary for eval. */
function applyTapPlan(
    state: GameState,
    playerId: string,
    tapPlan: { cardInstanceId: string }[]
): void {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    for (const tap of tapPlan) {
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
        case "madness-decline":
        case "rebound-decline":
        case "submit-target":
            // issue #2283 — a raised target submission is likewise not a 1-ply
            // material move; the ISMCTS applier (`applyMoveInSearch`,
            // search.ts) is the one that commits it through the shared
            // authority.
            // No board change worth modelling for a 1-ply leaf: passing keeps
            // the position; a mulligan / resolution-choice / may-pay /
            // land-entry / random-reveal-ack / madness-decline / rebound-decline
            // pick's value is not material here (these are brain-resolved and
            // never reach the search anyway — `enumerateMoves` returns [] while
            // a choice is pending).
            return next;

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

        case "cast-spell": {
            // CR 702.66b / 601.2g (issue #1661) — pay the delve exile BEFORE
            // the tap plan runs (see `applyDelveExileForSearch`'s doc — its
            // forced-minimum calc needs the caster's mana still untapped) and
            // before the spell leaves hand, mirroring
            // `tryAutoCommitPendingCast`'s real-path order.
            const preCastSpell = player.hand.find(
                (c) => c.id === move.cardInstanceId
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
            // CR 107.4f — pay the Phyrexian pips this move chose to cover with
            // life (2 each); the mana-paid pips are already in `tapPlan`.
            if (move.payLife && move.payLife > 0) {
                player.life -= move.payLife;
            }
            const spellCard = removeFromZone(
                player,
                move.cardInstanceId,
                "hand"
            );
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
            };
            next.stack.push(stackItem);
            resolveTopOfStack(next);
            // CR 614.12 / ADR 0051 — a spell that puts a shock land onto the
            // battlefield (tutor / reanimation) enqueues a stackless
            // `land-entry-tapped` pay-choice; drain it so the search leaf never
            // stalls on a choice a rollout can't interactively answer.
            autoFinalizeLandEntryChoices(next);
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
