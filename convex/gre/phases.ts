import type { Phase } from "./types";
import type { GameState } from "./state";
import { getOpponentId, getPlayer, moveCard, resolveTopOfStack } from "./state";

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
const AUTO_PHASES = new Set<Phase>(["UNTAP", "DECLARE_BLOCKERS", "CLEANUP"]);

/** Returns the next phase after the given one, or null if end of turn (CLEANUP). */
function nextPhase(current: Phase): Phase | null {
    const idx = PHASE_ORDER.indexOf(current);
    if (idx === -1) throw new Error(`Unknown phase: ${current}`);
    if (idx === PHASE_ORDER.length - 1) return null;
    return PHASE_ORDER[idx + 1];
}

/** Untap step: untap all permanents, clear mana pool and committed flags (CR 502.4). */
function untapStep(state: GameState): void {
    const player = getPlayer(state, state.activePlayerId);
    for (const card of player.battlefield) {
        card.isTapped = false;
        card.manaCommitted = undefined;
        card.isSummoningSick = undefined;
    }
    for (const color of Object.keys(player.manaPool)) {
        player.manaPool[color] = 0;
    }
}

/** Draw step: active player draws a card. Skipped on turn 1 (CR 103.8). */
function drawStep(state: GameState): void {
    if (state.turn === 1) return;

    const player = getPlayer(state, state.activePlayerId);
    if (player.library.length === 0) return;

    moveCard(player, player.library[0].id, "library", "hand");
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
            state.combat = { attackerIds: [], confirmed: false };
            break;
        case "COMBAT_DAMAGE": {
            if (state.combat && state.combat.attackerIds.length > 0) {
                const activePlayer = getPlayer(state, state.activePlayerId);
                const defenderId = getOpponentId(state, state.activePlayerId);
                const defender = getPlayer(state, defenderId);

                let totalDamage = 0;
                for (const attackerId of state.combat.attackerIds) {
                    const attacker = activePlayer.battlefield.find(
                        (c) => c.id === attackerId
                    );
                    if (attacker) {
                        const power =
                            (attacker.card as { power?: number }).power ?? 0;
                        totalDamage += Math.max(0, power);
                    }
                }
                defender.life -= totalDamage;
            }
            break;
        }
        case "END_OF_COMBAT": {
            if (state.combat) {
                const activePlayer = getPlayer(state, state.activePlayerId);
                for (const card of activePlayer.battlefield) {
                    card.isAttacking = undefined;
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
export function advancePhase(state: GameState): Phase[] {
    const traversed: Phase[] = [];

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
        (state.phase === "COMBAT_DAMAGE" || state.phase === "END_OF_COMBAT") &&
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
                    card.isTapped = true;
                    card.isAttacking = true;
                }
            }
            state.combat.confirmed = true;
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
