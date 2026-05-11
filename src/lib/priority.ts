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

export function isAssigningDamage(ctx: HasPriorityCtx): boolean {
    return (
        (ctx.phase === "COMBAT_DAMAGE" ||
            ctx.phase === "FIRST_STRIKE_DAMAGE") &&
        !!ctx.combat &&
        ctx.combat.damageConfirmed === false &&
        ctx.playerId === ctx.activePlayerId
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
        !isAssigningDamage(ctx) &&
        !isWaitingOnOpponent(ctx)
    );
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

    return ctx.priorityPlayerId;
}
