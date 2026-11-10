// Attack-declaration finalization (CR 508), auth-free — moved out of
// `convex/game.ts` (issue #9002) so the Bot liveness ladder can complete a
// parked attack-sacrifice tax without a Convex context. `confirmAttackers`,
// the attack-tax resume paths and `selectSacrificeOnState` all call it; the
// rules live here once.
import { getPlayer } from "./lookup";
import { markAttacking, recordAttackerDeclared } from "./combat";
import { drainAutoPasses, emitAttackersDeclaredEvents } from "./phases";
import { tapPermanent, type GameState } from "./state";

/** Finalize the attacker declaration once every combat-declaration cost is paid
 *  (CR 508): tap and mark the attackers, open blocker declaration, fire the
 *  "when creatures attack" triggers, and hand priority to the active player.
 *  Shared by the inline path (fungible/no tax) and the selectSacrifice resume
 *  path (attack sacrifice tax chosen). */
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
