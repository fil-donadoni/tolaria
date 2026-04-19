import type { Phase } from "./types";
import type { GameEvent } from "../cards/types";
import type { CardInstanceState, GameState } from "./state";
import { drawCard, getOpponentId, getPlayer, resolveTopOfStack } from "./state";
import { getEffectivePower, getEffectiveToughness } from "./layers";
import { collectTriggers } from "./triggers";

/** Ordered sequence of all phases/steps in a turn. */
const PHASE_ORDER: Phase[] = [
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
    "CLEANUP",
];

/** Phases where no player receives priority (automatic). */
const AUTO_PHASES = new Set<Phase>(["UNTAP", "CLEANUP"]);

/** Returns the next phase after the given one, or null if end of turn (CLEANUP). */
function nextPhase(current: Phase): Phase | null {
    const idx = PHASE_ORDER.indexOf(current);
    if (idx === -1) throw new Error(`Unknown phase: ${current}`);
    if (idx === PHASE_ORDER.length - 1) return null;
    return PHASE_ORDER[idx + 1];
}

/** Untap step: untap all permanents, clear committed/summoning sickness (CR 502.4). */
function untapStep(state: GameState): void {
    const player = getPlayer(state, state.activePlayerId);
    for (const card of player.battlefield) {
        card.isTapped = false;
        card.manaCommitted = undefined;
        card.isSummoningSick = undefined;
        card.chosenMana = undefined;
    }
}

/** Draw step: active player draws a card. Skipped on turn 1 (CR 103.8). */
function drawStep(state: GameState): void {
    if (state.turn === 1) return;
    drawCard(getPlayer(state, state.activePlayerId));
}

/** Inverts blockerAssignments (blockerId→attackerId) to attackerId→blockerId[]. */
function getBlockersPerAttacker(state: GameState): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    if (!state.combat) return result;
    for (const [blockerId, attackerId] of Object.entries(
        state.combat.blockerAssignments
    )) {
        if (!result[attackerId]) result[attackerId] = [];
        result[attackerId].push(blockerId);
    }
    return result;
}

function getCardPower(state: GameState, card: CardInstanceState): number {
    return Math.max(0, getEffectivePower(state, card));
}

function getCardToughness(state: GameState, card: CardInstanceState): number {
    return getEffectiveToughness(state, card);
}

/** Returns true if any attacker has 2+ blockers (needs manual damage assignment). */
function combatDamageNeedsManual(state: GameState): boolean {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    for (const blockerIds of Object.values(blockersPerAttacker)) {
        if (blockerIds.length >= 2) return true;
    }
    return false;
}

/** Build auto damage assignments for attackers with 0 or 1 blocker. */
function buildAutoDamageAssignments(
    state: GameState
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        const blockers = blockersPerAttacker[attackerId] ?? [];
        const hasTrample = attacker.staticAbilities.includes("trample");

        if (blockers.length === 1) {
            const blocker = defender.battlefield.find(
                (c) => c.id === blockers[0]
            );
            if (hasTrample && blocker) {
                // Trample: assign lethal damage to blocker, excess to defender
                const lethal = getCardToughness(state, blocker);
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) {
                    assignment[defenderId] = toDefender;
                }
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        }
        // 0 blockers = unblocked, handled separately in applyAllCombatDamage
    }
    return result;
}

/** Build default damage assignments for multi-blocker attackers.
 *  Uses blockerOrder for ordering. With trample, assigns lethal to each in order, excess to defender. */
function buildDefaultDamageAssignments(
    state: GameState
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        // Use blockerOrder if available, fall back to blockersPerAttacker
        const blockers =
            state.combat!.blockerOrder?.[attackerId] ??
            blockersPerAttacker[attackerId] ??
            [];
        const hasTrample = attacker.staticAbilities.includes("trample");

        if (blockers.length === 1) {
            if (hasTrample) {
                const blocker = defender.battlefield.find(
                    (c) => c.id === blockers[0]
                );
                const lethal = blocker ? getCardToughness(state, blocker) : 0;
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) assignment[defenderId] = toDefender;
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        } else if (blockers.length >= 2) {
            const assignment: Record<string, number> = {};
            if (hasTrample) {
                // Default with trample: lethal to each in order, excess to defender
                let remaining = getCardPower(state, attacker);
                for (const blockerId of blockers) {
                    const blocker = defender.battlefield.find(
                        (c) => c.id === blockerId
                    );
                    const lethal = blocker
                        ? getCardToughness(state, blocker)
                        : 0;
                    const toThis = Math.min(remaining, lethal);
                    assignment[blockerId] = toThis;
                    remaining -= toThis;
                }
                if (remaining > 0) assignment[defenderId] = remaining;
            } else {
                // Default without trample: all damage to first blocker
                for (let i = 0; i < blockers.length; i++) {
                    assignment[blockers[i]] =
                        i === 0 ? getCardPower(state, attacker) : 0;
                }
            }
            result[attackerId] = assignment;
        }
    }
    return result;
}

/**
 * Apply all combat damage and move dead creatures to graveyard.
 * @param damageAssignments attackerId → { blockerId: damage } for blocked attackers
 */
export function applyAllCombatDamage(
    state: GameState,
    damageAssignments: Record<string, Record<string, number>>
): void {
    if (!state.combat) return;

    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const blockersPerAttacker = getBlockersPerAttacker(state);

    // Track damage received: cardId → total damage
    const damageReceived: Record<string, number> = {};
    const events: GameEvent[] = [];

    for (const attackerId of state.combat.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue; // removed before damage (e.g. killed by instant)

        const blockers = blockersPerAttacker[attackerId] ?? [];
        const attackerPower = getCardPower(state, attacker);

        if (blockers.length === 0) {
            // Unblocked: damage to defending player
            if (attackerPower > 0) {
                defender.life -= attackerPower;
                events.push({
                    type: "DAMAGE_DEALT",
                    sourceInstanceId: attacker.id,
                    sourceControllerId: attacker.controllerId,
                    target: { type: "player", id: defenderId },
                    amount: attackerPower,
                    isCombat: true,
                });
            }
        } else {
            // Blocked: distribute attacker's damage to blockers (and defender if trample)
            const assignments = damageAssignments[attackerId] ?? {};
            for (const [targetId, damage] of Object.entries(assignments)) {
                if (damage <= 0) continue;
                if (targetId === defenderId) {
                    // Trample excess damage to defending player
                    defender.life -= damage;
                    events.push({
                        type: "DAMAGE_DEALT",
                        sourceInstanceId: attacker.id,
                        sourceControllerId: attacker.controllerId,
                        target: { type: "player", id: defenderId },
                        amount: damage,
                        isCombat: true,
                    });
                } else {
                    damageReceived[targetId] =
                        (damageReceived[targetId] ?? 0) + damage;
                    events.push({
                        type: "DAMAGE_DEALT",
                        sourceInstanceId: attacker.id,
                        sourceControllerId: attacker.controllerId,
                        target: { type: "permanent", id: targetId },
                        amount: damage,
                        isCombat: true,
                    });
                }
            }

            // All blockers deal their power to the attacker
            for (const blockerId of blockers) {
                const blocker = defender.battlefield.find(
                    (c) => c.id === blockerId
                );
                if (!blocker) continue; // removed before damage
                const blockerPower = getCardPower(state, blocker);
                if (blockerPower <= 0) continue;
                damageReceived[attackerId] =
                    (damageReceived[attackerId] ?? 0) + blockerPower;
                events.push({
                    type: "DAMAGE_DEALT",
                    sourceInstanceId: blocker.id,
                    sourceControllerId: blocker.controllerId,
                    target: { type: "permanent", id: attackerId },
                    amount: blockerPower,
                    isCombat: true,
                });
            }
        }
    }

    // Check for deaths: damage >= toughness → move to graveyard
    const deadIds = new Set<string>();
    for (const [cardId, damage] of Object.entries(damageReceived)) {
        // Find the creature on either player's battlefield
        const card =
            activePlayer.battlefield.find((c) => c.id === cardId) ??
            defender.battlefield.find((c) => c.id === cardId);
        if (card && damage >= getCardToughness(state, card)) {
            deadIds.add(cardId);
        }
    }

    // Move dead creatures to their owner's graveyard
    for (const player of state.players) {
        const dead = player.battlefield.filter((c) => deadIds.has(c.id));
        for (const card of dead) {
            player.battlefield = player.battlefield.filter(
                (c) => c.id !== card.id
            );
            card.zone = "graveyard";
            card.isAttacking = undefined;
            card.isBlocking = undefined;
            card.isTapped = false;
            const owner = getPlayer(state, card.ownerId);
            owner.graveyard.push(card);
        }
    }

    // Collect triggered abilities fired by this damage step (CR 603.2). Dead
    // permanents are already gone, so their own triggers are skipped — that's
    // not strictly CR-correct for LTB/"when ~ dies" triggers, but those are
    // out of scope here.
    const triggers = collectTriggers(state, events);
    if (triggers.length > 0) {
        state.stack.push(...triggers);
        // Active player gets priority again with triggers on the stack (CR 117.3c).
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Perform automatic entry actions for the current phase. */
function performPhaseEntry(state: GameState): void {
    switch (state.phase) {
        case "UNTAP":
            untapStep(state);
            break;
        case "DRAW":
            drawStep(state);
            break;
        case "DECLARE_ATTACKERS":
            state.combat = {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
            break;
        case "DECLARE_BLOCKERS": {
            if (state.combat) {
                state.combat.blockerAssignments = {};
                state.combat.pendingBlockerId = undefined;
                state.combat.blockersConfirmed = false;
            }
            break;
        }
        case "COMBAT_DAMAGE": {
            if (state.combat && state.combat.attackerIds.length > 0) {
                const needsManual = combatDamageNeedsManual(state);
                if (needsManual) {
                    // Pre-fill default assignments and wait for active player
                    state.combat.damageAssignments =
                        buildDefaultDamageAssignments(state);
                    state.combat.damageConfirmed = false;
                } else {
                    // All auto: apply immediately
                    applyAllCombatDamage(
                        state,
                        buildAutoDamageAssignments(state)
                    );
                }
            }
            break;
        }
        case "END_OF_COMBAT": {
            if (state.combat) {
                const activePlayer = getPlayer(state, state.activePlayerId);
                const defenderId = getOpponentId(state, state.activePlayerId);
                const defender = getPlayer(state, defenderId);
                for (const card of activePlayer.battlefield) {
                    card.isAttacking = undefined;
                }
                for (const card of defender.battlefield) {
                    card.isBlocking = undefined;
                }
                state.combat = undefined;
            }
            break;
        }
        case "CLEANUP":
            // No-op for now (hand size check, "until end of turn" effects are future work)
            break;
    }
}

/** Advance turn: increment counter, swap active player, reset autoPass. */
function advanceTurn(state: GameState): void {
    state.turn += 1;
    state.activePlayerId = getOpponentId(state, state.activePlayerId);
    state.autoPassPlayers = undefined;
}

/**
 * Advance the game to the next phase/step.
 * Called when both players pass priority with an empty stack.
 * Auto-phases (UNTAP, CLEANUP) are traversed without giving priority.
 * Returns the list of phases traversed (for event emission).
 */
/** Empty mana pools for all players (CR 500.4). Tapped lands become committed (non-untappable until untap step). */
function emptyManaPools(state: GameState): void {
    for (const player of state.players) {
        for (const color of Object.keys(player.manaPool)) {
            player.manaPool[color] = 0;
        }
        for (const card of player.battlefield) {
            if (card.isTapped) {
                card.manaCommitted = true;
            }
        }
    }
}

export function advancePhase(state: GameState): Phase[] {
    const traversed: Phase[] = [];

    // CR 500.4: mana pools empty when a step or phase ends
    emptyManaPools(state);

    const next = nextPhase(state.phase);

    if (next === null) {
        // End of turn → advance to next turn
        advanceTurn(state);
        state.phase = "UNTAP";
    } else {
        state.phase = next;
    }

    traversed.push(state.phase);

    // Check combat state before entry actions (END_OF_COMBAT clears it)
    const hadAttackers = !!state.combat && state.combat.attackerIds.length > 0;
    performPhaseEntry(state);

    const skipEmptyCombat =
        (state.phase === "DECLARE_BLOCKERS" ||
            state.phase === "COMBAT_DAMAGE" ||
            state.phase === "END_OF_COMBAT") &&
        !hadAttackers;

    if (AUTO_PHASES.has(state.phase) || skipEmptyCombat) {
        // Auto-phase or empty combat: skip straight through (no priority given)
        traversed.push(...advancePhase(state));
    } else {
        // Priority phase: active player gets priority
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }

    return traversed;
}

/**
 * Drain auto-passes: while the current priority holder is in autoPassPlayers,
 * simulate their pass. Handles both stack resolution and phase advancement.
 * Stops when priority lands on a non-auto-pass player or a new turn begins
 * (which clears autoPassPlayers).
 */
export function drainAutoPasses(state: GameState): void {
    const maxIterations = 50; // safety bound
    for (let i = 0; i < maxIterations; i++) {
        const autoPass = state.autoPassPlayers ?? [];
        if (!autoPass.includes(state.priorityPlayerId)) break;

        // Auto-confirm attackers with current selection when auto-passing
        if (
            state.phase === "DECLARE_ATTACKERS" &&
            state.combat &&
            !state.combat.confirmed
        ) {
            const activePlayer = getPlayer(state, state.activePlayerId);
            for (const attackerId of state.combat.attackerIds) {
                const card = activePlayer.battlefield.find(
                    (c) => c.id === attackerId
                );
                if (card) {
                    if (!card.staticAbilities.includes("vigilance")) {
                        card.isTapped = true;
                    }
                    card.isAttacking = true;
                }
            }
            state.combat.confirmed = true;
            state.combat.blockerAssignments = {};
            state.combat.blockersConfirmed = false;
        }

        // Auto-confirm blockers when defending player auto-passes
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            !state.combat.blockersConfirmed
        ) {
            const defenderId = getOpponentId(state, state.activePlayerId);
            const defender = getPlayer(state, defenderId);
            for (const blockerId of Object.keys(
                state.combat.blockerAssignments
            )) {
                const card = defender.battlefield.find(
                    (c) => c.id === blockerId
                );
                if (card) card.isBlocking = true;
            }
            state.combat.pendingBlockerId = undefined;
            state.combat.blockersConfirmed = true;

            // Initialize blocker order (same logic as confirmBlockers)
            const blockerOrder: Record<string, string[]> = {};
            for (const [blockerId, attackerId] of Object.entries(
                state.combat.blockerAssignments
            )) {
                if (!blockerOrder[attackerId]) blockerOrder[attackerId] = [];
                blockerOrder[attackerId].push(blockerId);
            }
            state.combat.blockerOrder = blockerOrder;
            // Auto-confirm order (no multi-block reordering during auto-pass)
            state.combat.blockerOrderConfirmed = true;
        }

        // Auto-confirm blocker order when attacking player auto-passes
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            state.combat.blockerOrderConfirmed === false
        ) {
            state.combat.blockerOrderConfirmed = true;
        }

        // Auto-confirm damage assignment when active player auto-passes
        if (
            state.phase === "COMBAT_DAMAGE" &&
            state.combat &&
            state.combat.damageConfirmed === false
        ) {
            applyAllCombatDamage(state, state.combat.damageAssignments ?? {});
            state.combat.damageConfirmed = true;
        }

        state.passCount += 1;

        if (state.passCount >= 2 && state.stack.length > 0) {
            resolveTopOfStack(state);
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        } else if (state.passCount >= 2 && state.stack.length === 0) {
            advancePhase(state);
            // advanceTurn clears autoPassPlayers, so the loop will exit naturally
        } else {
            state.priorityPlayerId = getOpponentId(
                state,
                state.priorityPlayerId
            );
        }
    }
}

/** Returns true if sorcery-speed actions are legal (main phase, empty stack, active player has priority). */
export function isSorceryTiming(state: GameState): boolean {
    return (
        (state.phase === "PRECOMBAT_MAIN" ||
            state.phase === "POSTCOMBAT_MAIN") &&
        state.stack.length === 0 &&
        state.priorityPlayerId === state.activePlayerId
    );
}
