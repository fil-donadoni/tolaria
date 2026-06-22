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
    moveCard,
    markEnteredThisTurn,
    removeFromZone,
    removePermanentTo,
    resolveTopOfStack,
    emitPermanentEntered,
    processPendingActionTriggers,
    getOpponentId,
    tapPermanent,
} from "./state";
import { matchesPermanentFilter } from "../cards/filters";
import { checkStateBasedActions } from "./sba";
import { applyAllCombatDamage, buildAutoDamageAssignments } from "./phases";
import { recordBlockedAttackers } from "./banding";
import { cloneGameState } from "./clone";
import { enumerateMoves, type Move } from "./moves";
import { evaluate } from "./evaluate";
import { tryGetCardById } from "../cards";

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
        case "name-card":
        case "random-reveal-ack":
            // No board change worth modelling for a 1-ply leaf: passing keeps
            // the position; a mulligan / resolution-choice / may-pay /
            // random-reveal-ack pick's value is not material here (these are
            // brain-resolved and never reach the search anyway —
            // `enumerateMoves` returns [] while a choice is pending).
            return next;

        case "play-land": {
            const card = moveCard(
                player,
                move.cardInstanceId,
                "hand",
                "battlefield"
            );
            if (card.types.includes("Land")) {
                player.landsPlayedThisTurn =
                    (player.landsPlayedThisTurn ?? 0) + 1;
            }
            // CR 302.6 — a land (or any permanent) played this turn starts its
            // control-continuity clock. Inert until the permanent becomes a
            // creature; a manland (Mishra's Factory) animated the same turn it
            // was played then correctly reads summoning-sick.
            markEnteredThisTurn(card);
            emitPermanentEntered(next, card);
            processPendingActionTriggers(next);
            checkStateBasedActions(next);
            return next;
        }

        case "cast-spell": {
            applyTapPlan(next, playerId, move.tapPlan);
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
                    const def = tryGetCardById(
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
                                    ability.cost.sacrificeFilter!
                                )
                        );
                        if (candidates.length > 0) {
                            const pick = candidates.reduce((lo, c) => {
                                const mv = (d: CardInstanceState) => {
                                    const cd = tryGetCardById(
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
                }
            }
            checkStateBasedActions(next);
            return next;

        case "declare-attackers": {
            if (move.attackerIds.length === 0) return next;
            next.combat = {
                attackerIds: [...move.attackerIds],
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
