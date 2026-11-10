// Combat damage confirmation (CR 510.1), auth-free — moved out of
// `convex/game.ts` (issue #9028) so the Bot liveness ladder can confirm an
// outstanding damage assignment without a Convex context. `confirmDamage` and
// the ladder both call it; the rules live here once.
import { assertGameNotOver } from "./activation";
import { outstandingDamageAssigner } from "./banding";
import { combatDamageAssignmentCompleteness } from "./damageAssignment";
import { assertExpectedInput } from "./expectedInput";
import type { DeclineOutcome } from "./owedInputDeclines";
import {
    applyAllCombatDamage,
    buildDefaultDamageAssignments,
    drainAutoPasses,
} from "./phases";
import { checkStateBasedActions } from "./sba";
import type { GameState } from "./state";

/** The guards a damage CONFIRMATION runs: the game is live, the window is a
 *  combat damage step's (ADR 0047 `anyPlayer` — the actor is the assigner,
 *  not the priority holder), the assignment is open and `playerId` assigns at
 *  least one source (CR 510.1c-d; CR 702.22j-k banding can hand that to the
 *  defending player). Returns the open `combat`. */
function assertDamageConfirmationOpen(
    state: GameState,
    playerId: string
): NonNullable<GameState["combat"]> {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId,
        expect: "priority",
        anyPlayer: true,
    });
    if (
        state.phase !== "FIRST_STRIKE_DAMAGE" &&
        state.phase !== "COMBAT_DAMAGE"
    ) {
        throw new Error("Not in a combat damage step");
    }
    if (!state.combat || state.combat.damageConfirmed !== false) {
        throw new Error("Damage assignment is not open");
    }
    const assigners = new Set(
        Object.values(state.combat.damageAssignerIds ?? {})
    );
    if (!assigners.has(playerId)) {
        throw new Error("You have no combat damage to assign");
    }
    return state.combat;
}

/** Confirm `playerId`'s portion of combat damage as currently assigned. Damage
 *  is dealt once every distinct assigner has confirmed (CR 510.2), followed by
 *  the CR 704.3 sweep and priority to the active player (CR 510.3). An
 *  incomplete assignment throws before any state is touched. */
export function confirmDamageOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    const combat = assertDamageConfirmationOpen(state, playerId);
    const assignerIds = combat.damageAssignerIds ?? {};

    // CR 510.1a/e — reject an incomplete assignment rather than silently
    // applying the shortfall (#2906). Every source THIS player assigns must
    // total its effective power, counted only against currently-legal targets
    // (a stale entry aimed at a target that left combat since the assignment
    // was entered doesn't count, and a source whose legal targets have all left
    // combat owes zero — see `combatDamageAssignmentCompleteness`). Checked
    // before any state is touched, so a rejection leaves the confirmation set
    // and the map untouched.
    for (const [sourceId, assignerId] of Object.entries(assignerIds)) {
        if (assignerId !== playerId) continue;
        const { complete, assigned, required } =
            combatDamageAssignmentCompleteness(
                state,
                sourceId,
                combat.damageAssignments?.[sourceId] ?? {}
            );
        if (!complete) {
            throw new Error(
                `${sourceId}'s combat damage assignment must total exactly ` +
                    `${required} (currently ${assigned})`
            );
        }
    }

    const confirmedBy = new Set(combat.damageAssignmentConfirmedBy ?? []);
    confirmedBy.add(playerId);
    combat.damageAssignmentConfirmedBy = [...confirmedBy];

    // Wait for every distinct assigner before applying damage.
    if (outstandingDamageAssigner(combat)) return { changed: true };

    const kind =
        state.phase === "FIRST_STRIKE_DAMAGE" ? "first-strike" : "regular";
    applyAllCombatDamage(state, combat.damageAssignments ?? {}, kind);
    combat.damageConfirmed = true;
    combat.damageAssignerIds = undefined;
    combat.damageAssignmentConfirmedBy = undefined;

    // Check SBA after combat damage (CR 704.5)
    checkStateBasedActions(state);

    if (!state.gameOver) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
    }
    return { changed: true };
}

/** Confirm the DEFAULT assignment for every source `playerId` assigns (CR
 *  510.1c-d): reseed those sources from the engine's own default — the one
 *  the step opened with — then confirm. Whatever the player had half-entered
 *  is replaced, so the result is a complete, legal assignment. */
export function confirmDefaultDamageOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    const combat = assertDamageConfirmationOpen(state, playerId);
    const kind =
        state.phase === "FIRST_STRIKE_DAMAGE" ? "first-strike" : "regular";
    const defaults = buildDefaultDamageAssignments(state, kind);
    const assignments = { ...(combat.damageAssignments ?? {}) };
    for (const [sourceId, assignerId] of Object.entries(
        combat.damageAssignerIds ?? {}
    )) {
        if (assignerId !== playerId || !defaults[sourceId]) continue;
        assignments[sourceId] = defaults[sourceId];
    }
    combat.damageAssignments = assignments;
    return confirmDamageOnState(state, playerId);
}
