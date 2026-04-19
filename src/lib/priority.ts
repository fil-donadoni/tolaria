import type {
    Combat,
    GameOver,
    PendingCast,
    PendingTarget,
} from "~/types/game";

export type HasPriorityCtx = {
    playerId: string;
    activePlayerId: string;
    priorityPlayerId: string;
    phase: string;
    pendingCast?: PendingCast;
    pendingTarget?: PendingTarget;
    combat?: Combat;
};

export type AutoPassBlockedCtx = HasPriorityCtx & {
    undoableBy?: string;
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
        ctx.phase === "COMBAT_DAMAGE" &&
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
    if (ctx.undoableBy === ctx.playerId) return true;
    return false;
}
