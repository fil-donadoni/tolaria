import type {
    Combat,
    GameOver,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingTarget,
} from "~/types/game";

export type HasPriorityCtx = {
    playerId: string;
    activePlayerId: string;
    priorityPlayerId: string;
    phase: string;
    pendingCast?: PendingCast;
    pendingActivation?: PendingActivation;
    pendingTarget?: PendingTarget;
    combat?: Combat;
};

export type AutoPassBlockedCtx = HasPriorityCtx & {
    stackCount: number;
    autoPassPlayers?: string[];
    gameOver?: GameOver;
};

export function isSelectingAttackers(ctx: HasPriorityCtx): boolean {
    return (
        ctx.phase === "DECLARE_ATTACKERS" &&
        !!ctx.combat &&
        !ctx.combat.confirmed &&
        ctx.playerId === ctx.activePlayerId
    );
}

export function isSelectingBlockers(ctx: HasPriorityCtx): boolean {
    return (
        ctx.phase === "DECLARE_BLOCKERS" &&
        !!ctx.combat &&
        !ctx.combat.blockersConfirmed &&
        ctx.playerId !== ctx.activePlayerId
    );
}

/** The next player still owing a damage-assignment choice this step (CR
 *  702.21j-k can hand authority to the defending player). Mirrors
 *  `outstandingDamageAssigner` in convex/gre/banding.ts. Falls back to the
 *  active player when no per-source authority map is present (legacy /
 *  non-banding combat). */
export function outstandingDamageAssigner(ctx: HasPriorityCtx): string {
    const combat = ctx.combat;
    if (!combat) return ctx.activePlayerId;
    const assigners = combat.damageAssignerIds;
    if (!assigners) return ctx.activePlayerId;
    const confirmed = new Set(combat.damageAssignmentConfirmedBy ?? []);
    for (const playerId of Object.values(assigners)) {
        if (!confirmed.has(playerId)) return playerId;
    }
    return ctx.activePlayerId;
}

/** True while a combat-damage step is awaiting manual assignment. No player
 *  receives priority until damage is applied. */
export function isDamageStepOpen(ctx: HasPriorityCtx): boolean {
    return (
        (ctx.phase === "COMBAT_DAMAGE" ||
            ctx.phase === "FIRST_STRIKE_DAMAGE") &&
        !!ctx.combat &&
        ctx.combat.damageConfirmed === false
    );
}

export function isAssigningDamage(ctx: HasPriorityCtx): boolean {
    return (
        isDamageStepOpen(ctx) && ctx.playerId === outstandingDamageAssigner(ctx)
    );
}

export function isWaitingOnOpponent(ctx: HasPriorityCtx): boolean {
    const opponentSelectingAttackers =
        ctx.phase === "DECLARE_ATTACKERS" &&
        !!ctx.combat &&
        !ctx.combat.confirmed &&
        ctx.playerId !== ctx.activePlayerId;
    const opponentSelectingBlockers =
        ctx.phase === "DECLARE_BLOCKERS" &&
        !!ctx.combat &&
        !ctx.combat.blockersConfirmed &&
        ctx.playerId === ctx.activePlayerId;
    return opponentSelectingAttackers || opponentSelectingBlockers;
}

export function computeHasPriority(ctx: HasPriorityCtx): boolean {
    return (
        ctx.playerId === ctx.priorityPlayerId &&
        !ctx.pendingCast &&
        !ctx.pendingActivation &&
        !ctx.pendingTarget &&
        !isSelectingAttackers(ctx) &&
        !isSelectingBlockers(ctx) &&
        !isDamageStepOpen(ctx) &&
        !isWaitingOnOpponent(ctx)
    );
}

/** Coarse priority status for the local player, for the board-wide priority
 *  indicator (#152). Three mutually exclusive states:
 *  - `"mine"`     — it's on the local player to act: they hold priority, own an
 *                   in-flight sub-action (mid-cast / choosing targets), or owe a
 *                   combat decision (declaring attackers/blockers, assigning
 *                   damage).
 *  - `"opponent"` — it's on the opponent to act (their priority, their pending
 *                   sub-action, or their combat decision).
 *  - `"none"`     — no one is being asked for input: the game is over, a
 *                   pre-priority/turn-based phase is running (mulligan, untap,
 *                   cleanup), or the stack/step is auto-resolving. */
export type PriorityState = "mine" | "opponent" | "none";

export type PriorityStateCtx = HasPriorityCtx & { gameOver?: GameOver };

/** Phases where no player ever receives priority (CR 502/514 + pre-game). */
const NON_PRIORITY_PHASES = new Set(["MULLIGAN", "UNTAP", "CLEANUP"]);

export function computePriorityState(ctx: PriorityStateCtx): PriorityState {
    if (ctx.gameOver) return "none";
    if (NON_PRIORITY_PHASES.has(ctx.phase)) return "none";

    // Turn-based combat decisions (CR 508/509/510) suspend priority. The
    // selecting/assigning helpers are defined from the local player's seat, so
    // a true result always means it's on the local player.
    if (
        isSelectingAttackers(ctx) ||
        isSelectingBlockers(ctx) ||
        isAssigningDamage(ctx)
    ) {
        return "mine";
    }
    if (isWaitingOnOpponent(ctx)) return "opponent";
    if (isDamageStepOpen(ctx)) return "opponent"; // opponent owes the assignment

    // In-flight sub-actions (mid-cast, choosing targets) belong to one player.
    const pendingOwner =
        ctx.pendingCast?.playerId ??
        ctx.pendingActivation?.playerId ??
        ctx.pendingTarget?.playerId;
    if (pendingOwner)
        return pendingOwner === ctx.playerId ? "mine" : "opponent";

    // Plain priority window.
    return ctx.priorityPlayerId === ctx.playerId ? "mine" : "opponent";
}

export function computeAutoPassBlocked(ctx: AutoPassBlockedCtx): boolean {
    if (ctx.gameOver) return true;
    if (ctx.autoPassPlayers?.includes(ctx.playerId)) return true;
    if (!computeHasPriority(ctx)) return true;
    if (ctx.stackCount > 0) return true;
    return false;
}

export type SoloViewerCtx = {
    activePlayerId: string;
    priorityPlayerId: string;
    phase: string;
    combat?: Combat;
    pendingCast?: PendingCast;
    pendingActivation?: PendingActivation;
    pendingTarget?: PendingTarget;
    pendingChoices?: PendingChoice[];
    playerIds: readonly string[];
};

// CR 509.1 — defender declares blockers as a turn-based action before the
// active player receives priority in DECLARE_BLOCKERS. priorityPlayerId still
// reads as active during that window, so solo viewer must steer to the
// defender (or any other player owning a pending action) explicitly.
export function computeSoloViewerId(ctx: SoloViewerCtx): string {
    const choiceOwner = ctx.pendingChoices?.[0]?.playerId;
    if (choiceOwner) return choiceOwner;
    if (ctx.pendingTarget?.playerId) return ctx.pendingTarget.playerId;
    if (ctx.pendingCast?.playerId) return ctx.pendingCast.playerId;
    if (ctx.pendingActivation?.playerId) return ctx.pendingActivation.playerId;

    if (
        ctx.phase === "DECLARE_BLOCKERS" &&
        ctx.combat &&
        !ctx.combat.blockersConfirmed
    ) {
        const defender = ctx.playerIds.find((id) => id !== ctx.activePlayerId);
        if (defender) return defender;
    }

    // CR 702.21j-k: when banding hands damage-assignment authority to the
    // defending player, steer the solo viewer to whoever still owes a choice.
    if (
        (ctx.phase === "COMBAT_DAMAGE" ||
            ctx.phase === "FIRST_STRIKE_DAMAGE") &&
        ctx.combat &&
        ctx.combat.damageConfirmed === false
    ) {
        const assigners = ctx.combat.damageAssignerIds;
        if (assigners) {
            const confirmed = new Set(
                ctx.combat.damageAssignmentConfirmedBy ?? []
            );
            for (const playerId of Object.values(assigners)) {
                if (!confirmed.has(playerId)) return playerId;
            }
        }
    }

    return ctx.priorityPlayerId;
}
