import type {
    Combat,
    GameOver,
    PendingActivation,
    PendingCast,
    PendingTarget,
} from "~/types/game";

// Solo-mode viewer selection lives in convex/ as the single source of truth so
// the server projection and the client board never diverge on "who is the solo
// viewer" (see convex/soloViewer.ts). Re-exported here so existing
// `~/lib/priority` consumers keep their import path.
export { computeSoloViewerId, type SoloViewerCtx } from "@convex/soloViewer";

export type HasPriorityCtx = {
    playerId: string;
    activePlayerId: string;
    priorityPlayerId: string;
    phase: string;
    pendingCast?: PendingCast;
    pendingActivation?: PendingActivation;
    pendingTarget?: PendingTarget;
    combat?: Combat;
    /** Melee (#669) — when set, the ATTACKING (active) player declares this
     *  combat's blocks instead of the defending player. Survives the wire
     *  projection (top-level GameState key kept in `PublicGameState`), so the
     *  client's "who selects blockers" mirror flips to match the server. */
    meleeCombat?: boolean;
};

/** The seat that declares this combat's blocks (CR 509.1): the defending
 *  (non-active) player normally, or the attacking (active) player under Melee
 *  (`meleeCombat`, #669). */
function blockDeclarerIsLocal(ctx: HasPriorityCtx): boolean {
    return ctx.meleeCombat
        ? ctx.playerId === ctx.activePlayerId
        : ctx.playerId !== ctx.activePlayerId;
}

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
        blockDeclarerIsLocal(ctx)
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
        !blockDeclarerIsLocal(ctx);
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
