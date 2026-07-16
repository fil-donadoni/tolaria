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

import type { CardInstanceState, GameState, StackItem } from "./state";
import {
    removeFromZone,
    removePermanentTo,
    resolveTopOfStack,
    getOpponentId,
    tapPermanent,
    canPayMayPayCost,
    discardToGraveyard,
} from "./state";
import { matchesPermanentFilter } from "../cards/filters";
import { isPlaneswalker } from "./constants";
import { handCardMatchesFilter } from "./alternativeCost";
import { liveSupertypesOf } from "./snow";
import { checkStateBasedActions } from "./sba";
import { applyPlayLand, finalizeLandEntry } from "./playLand";
import { applyAllCombatDamage, buildAutoDamageAssignments } from "./phases";
import { recordBlockedAttackers } from "./banding";
import { cloneGameState } from "./clone";
import { enumerateMoves, type Move } from "./moves";
import { evaluate } from "./evaluate";
import { tryGetDefinition } from "../cards";

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
        const blocker = findCreature(state, blockerId);
        if (blocker) blocker.isBlocking = true;
    }
    state.combat.blockerAssignments = byBlocker;
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
        case "name-card":
        case "random-reveal-ack":
        case "madness-decline":
            // No board change worth modelling for a 1-ply leaf: passing keeps
            // the position; a mulligan / resolution-choice / may-pay /
            // land-entry / random-reveal-ack / madness-decline pick's value is
            // not material here (these are brain-resolved and never reach the
            // search anyway — `enumerateMoves` returns [] while a choice is
            // pending).
            return next;

        case "play-land": {
            // Shared canonical play-land core (CR 305 / 302.6) — identical to
            // the authoritative `playCard` mutation in game.ts. See playLand.ts.
            applyPlayLand(next, player, move.cardInstanceId);
            // CR 614.12 / ADR 0051 — a shock land suspends entry on a
            // `land-entry-tapped` pending choice. Search must not stall on it.
            autoFinalizeLandEntryChoices(next);
            return next;
        }

        case "cast-spell": {
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
            // Costs only (see file header): tap the source and planned mana, do
            // not resolve the ability's effect this slice.
            applyTapPlan(next, playerId, move.tapPlan);
            {
                // CR 113.3c — the source may be on another player's battlefield
                // ("any player may activate"), so search globally. Tap it only
                // when the ability actually has a {T} cost; any-player damage
                // abilities (Ifh-Bíff Efreet) don't tap their source.
                let src: CardInstanceState | undefined;
                for (const p of next.players) {
                    src = p.battlefield.find(
                        (c) => c.id === move.cardInstanceId
                    );
                    if (src) break;
                }
                if (src) {
                    const def = tryGetDefinition(
                        (src.card as { id?: string }).id ?? ""
                    );
                    const ability = def?.activatedAbilities?.find(
                        (a) => a.id === move.abilityId
                    );
                    if (ability?.cost.tap) src.isTapped = true;
                    // CR 602.1 — sacrifice costs change the board materially, so
                    // they're applied in the search slice (even though the
                    // ability's effect resolves later) to keep the evaluated
                    // position honest. Self-sacrifice removes the source; a
                    // filtered sacrifice removes the lowest-mana-value matching
                    // permanent (a conservative deterministic pick — the bot
                    // doesn't model the human's free choice here).
                    if (ability?.cost.sacrifice) {
                        removePermanentTo(
                            next,
                            src.id,
                            "graveyard",
                            "sacrifice"
                        );
                    } else if (ability?.cost.sacrificeFilter) {
                        const owner = next.players.find((p) =>
                            p.battlefield.some((c) => c.id === src!.id)
                        );
                        const candidates = (owner?.battlefield ?? []).filter(
                            (c) =>
                                matchesPermanentFilter(
                                    c,
                                    ability.cost.sacrificeFilter!,
                                    { supertypesOf: liveSupertypesOf }
                                )
                        );
                        if (candidates.length > 0) {
                            const pick = candidates.reduce((lo, c) => {
                                const mv = (d: CardInstanceState) => {
                                    const cd = tryGetDefinition(
                                        (d.card as { id?: string }).id ?? ""
                                    );
                                    return cd?.manaCost
                                        ? Object.values(
                                              cd.manaCost
                                          ).reduce<number>(
                                              (a, v) =>
                                                  a +
                                                  (typeof v === "number"
                                                      ? v
                                                      : 0),
                                              0
                                          )
                                        : 0;
                                };
                                return mv(c) < mv(lo) ? c : lo;
                            });
                            removePermanentTo(
                                next,
                                pick.id,
                                "graveyard",
                                "sacrifice"
                            );
                        }
                    }
                    // CR 602.1 / 118.8 — tap-other-creatures cost (Hand of
                    // Justice): tap the first N untapped matching permanents
                    // the activator controls, excluding the source. A
                    // conservative deterministic pick — the search doesn't
                    // model the human's free choice of which to tap.
                    if (ability?.cost.tapOtherFilter) {
                        const owner = next.players.find((p) =>
                            p.battlefield.some((c) => c.id === src!.id)
                        );
                        const { filter, count } = ability.cost.tapOtherFilter;
                        const picks = (owner?.battlefield ?? [])
                            .filter(
                                (c) =>
                                    c.id !== src!.id &&
                                    !c.isTapped &&
                                    matchesPermanentFilter(c, filter, {
                                        selfControllerId: owner?.id,
                                        supertypesOf: liveSupertypesOf,
                                    })
                            )
                            .slice(0, count);
                        for (const perm of picks) tapPermanent(next, perm);
                    }
                    // CR 602.1 / 118.3 — "discard a card matching <filter>"
                    // cost (Survival of the Fittest): discard the lowest-
                    // mana-value matching card(s) from the activator's hand.
                    // A conservative deterministic pick — the search doesn't
                    // model the human's free choice of which card to discard.
                    if (ability?.cost.discardFilter) {
                        const owner = next.players.find((p) =>
                            p.battlefield.some((c) => c.id === src!.id)
                        );
                        const { filter, count } = ability.cost.discardFilter;
                        const candidates = (owner?.hand ?? [])
                            .filter((c) => handCardMatchesFilter(c, filter))
                            .sort((a, b) => {
                                const mv = (d: CardInstanceState) => {
                                    const cd = tryGetDefinition(
                                        (d.card as { id?: string }).id ?? ""
                                    );
                                    return cd?.manaCost
                                        ? Object.values(
                                              cd.manaCost
                                          ).reduce<number>(
                                              (acc, v) =>
                                                  acc +
                                                  (typeof v === "number"
                                                      ? v
                                                      : 0),
                                              0
                                          )
                                        : 0;
                                };
                                return mv(a) - mv(b);
                            })
                            .slice(0, count);
                        if (owner) {
                            for (const pick of candidates) {
                                discardToGraveyard(next, owner.id, pick.id);
                            }
                        }
                    }
                }
            }
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
                atk.isAttacking = true;
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
